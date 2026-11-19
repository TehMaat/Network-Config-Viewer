import {
  newNode,
  type DiagnosticCode,
  type SyntaxDiagnostic,
  type SyntaxNode,
  type SyntaxTree,
} from './types';

export type IndentDialect = 'cisco' | 'cisco-sb';

interface Frame {
  node: SyntaxNode;
  indent: number;
  /** "exit" blocks (Cisco Small Business) contain lines that are not indented. */
  type: 'indent' | 'exit';
}

interface OpenBlock {
  node: SyntaxNode;
  index: number;
  code: DiagnosticCode;
  closes: (raw: string) => boolean;
}

interface Pass {
  nodes: SyntaxNode[];
  diagnostics: SyntaxDiagnostic[];
  unterminated: { index: number; code: DiagnosticCode } | null;
}

/** Small Business blocks whose content is not indented and that end with "exit". */
const SB_EXIT_BLOCKS = [
  /^vlan database$/,
  /^line (console|ssh|telnet)$/,
  /^(ip|ipv6|mac) access-list( extended)? \S+$/,
  /^management access-list \S+$/,
  /^spanning-tree mst configuration$/,
  /^(class-map|policy-map)\s/,
  /^ip dhcp pool (host|network) \S+$/,
  /^ipv6 dhcp pool \S+$/,
];

const MAX_RECOVERIES = 20;

/**
 * Parses configurations where nesting follows indentation (Cisco IOS, IOS-XE, NX-OS, ASA,
 * Small Business, and many other vendors). Handles the constructs that break the rule:
 * banners with a delimiter, PEM blocks, certificate chains ending with "quit" and, for
 * Small Business, blocks closed by "exit" and the file header.
 */
export function parseIndented(lines: string[], dialect: IndentDialect = 'cisco'): SyntaxTree {
  const ignored = new Map<number, DiagnosticCode>();
  let pass = parseOnce(lines, dialect, ignored);
  while (pass.unterminated && ignored.size < MAX_RECOVERIES) {
    ignored.set(pass.unterminated.index, pass.unterminated.code);
    pass = parseOnce(lines, dialect, ignored);
  }
  const diagnostics = [
    ...[...ignored].map(([index, code]) => ({ line: index + 1, code })),
    ...pass.diagnostics,
  ].sort((a, b) => a.line - b.line);
  return { family: 'indent', nodes: pass.nodes, lineCount: lines.length, diagnostics };
}

function parseOnce(
  lines: string[],
  dialect: IndentDialect,
  ignored: Map<number, DiagnosticCode>,
): Pass {
  const nodes: SyntaxNode[] = [];
  const diagnostics: SyntaxDiagnostic[] = [];
  const stack: Frame[] = [];
  let open: OpenBlock | null = null;
  let lastIndent = 0;
  const sb = dialect === 'cisco-sb';

  const extend = (lineNo: number) => {
    for (const frame of stack) frame.node.endLine = lineNo;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;

    if (open) {
      open.node.endLine = lineNo;
      extend(lineNo);
      if (open.closes(raw)) open = null;
      continue;
    }

    const text = raw.trim();
    if (text === '') continue;
    let indent = measureIndent(raw);
    // Certificate chains end with "<spaces><tab>quit": keep it with the hex lines.
    if (text === 'quit' && indent > lastIndent) indent = lastIndent;

    if (sb && indent === 0 && text === 'exit') {
      const exitIndex = lastExitFrame(stack);
      if (exitIndex !== -1) {
        // "exit" belongs to its block, not to the last line inside it.
        stack.length = exitIndex + 1;
        extend(lineNo);
        stack.length = exitIndex;
        lastIndent = 0;
        continue;
      }
    }

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.type === 'indent' && top.indent >= indent) {
        stack.pop();
        continue;
      }
      // A new top-level block while an "exit" block is still open: the "exit" is missing.
      if (
        top.type === 'exit' &&
        indent === 0 &&
        (isSbExitBlock(text) || /^interface\s/.test(text))
      ) {
        diagnostics.push({ line: top.node.line, code: 'unclosed-block' });
        stack.pop();
        continue;
      }
      break;
    }

    const parent = stack.length > 0 ? stack[stack.length - 1]!.node : null;
    const node = newNode(lineNo, text, text.startsWith('!') ? 'comment' : 'statement');
    (parent ? parent.children : nodes).push(node);
    if (parent) parent.kind = 'block';
    extend(lineNo);
    lastIndent = indent;

    if (node.kind === 'comment') continue;
    if (!ignored.has(i)) {
      const multi = multiLine(text, sb);
      if (multi) {
        node.kind = 'block';
        open = { node, index: i, ...multi };
        continue;
      }
    }
    if (sb && indent === 0 && isSbExitBlock(text)) {
      node.kind = 'block';
      stack.push({ node, indent, type: 'exit' });
      continue;
    }
    stack.push({ node, indent, type: 'indent' });
  }

  if (open) {
    return { nodes, diagnostics, unterminated: { index: open.index, code: open.code } };
  }
  for (const frame of stack) {
    if (frame.type === 'exit') diagnostics.push({ line: frame.node.line, code: 'unclosed-block' });
  }
  return { nodes, diagnostics, unterminated: null };
}

/** Indentation width; a tab advances to the next multiple of 8. */
function measureIndent(raw: string): number {
  let width = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === ' ') width++;
    else if (ch === '\t') width = (Math.floor(width / 8) + 1) * 8;
    else break;
  }
  return width;
}

function lastExitFrame(stack: Frame[]): number {
  for (let k = stack.length - 1; k >= 0; k--) {
    if (stack[k]!.type === 'exit') return k;
  }
  return -1;
}

function isSbExitBlock(text: string): boolean {
  return SB_EXIT_BLOCKS.some((re) => re.test(text));
}

/** Constructs whose following lines belong to this line regardless of indentation. */
function multiLine(text: string, sb: boolean): Omit<OpenBlock, 'node' | 'index'> | null {
  const banner = bannerDelimiter(text);
  if (banner && !banner.closedOnSameLine) {
    return { code: 'unterminated-banner', closes: (raw) => raw.includes(banner.delimiter) };
  }
  if (/^-----BEGIN [A-Z0-9 ]+-----/.test(text) && !/-----END [A-Z0-9 ]+-----/.test(text)) {
    return { code: 'unterminated-block', closes: (raw) => /-----END [A-Z0-9 ]+-----/.test(raw) };
  }
  if (sb && text === 'config-file-header') {
    return { code: 'unterminated-block', closes: (raw) => raw.trim() === '@' };
  }
  const marker = sb ? /^(\S+)-start$/.exec(text) : null;
  if (marker) {
    const end = `${marker[1]}-end`;
    return { code: 'unterminated-block', closes: (raw) => raw.trim().startsWith(end) };
  }
  return null;
}

/**
 * "banner motd ^C" (as shown by "show running-config"), the ETX character (0x03, in files
 * copied with TFTP) or any other non-alphanumeric character opens a banner that ends at the
 * next occurrence of the same delimiter. ASA banners have no delimiter and stay on one line.
 */
export function bannerDelimiter(
  text: string,
): { delimiter: string; closedOnSameLine: boolean } | null {
  const m = /^banner\s+\S+\s+(.*)$/.exec(text);
  if (!m) return null;
  const rest = m[1]!;
  let delimiter: string;
  if (rest.startsWith('^C')) delimiter = '^C';
  else if (rest.startsWith('\u0003')) delimiter = '\u0003';
  else if (rest.length > 0 && /[^A-Za-z0-9\s]/.test(rest[0]!)) delimiter = rest[0]!;
  else return null;
  return { delimiter, closedOnSameLine: rest.slice(delimiter.length).includes(delimiter) };
}

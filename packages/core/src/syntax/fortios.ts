import { newNode, type SyntaxDiagnostic, type SyntaxNode, type SyntaxTree } from './types';

interface Frame {
  node: SyntaxNode;
  type: 'config' | 'edit';
}

interface Pass {
  nodes: SyntaxNode[];
  diagnostics: SyntaxDiagnostic[];
  /** 0-based line where a quoted value is opened and never closed. */
  unterminatedAt: number | null;
}

const MAX_RECOVERIES = 20;

/**
 * Parses the FortiOS syntax: "config" opens a table or a group of settings, "edit" an entry,
 * "next" closes the entry and "end" the table. Nesting comes from the keywords, not from
 * indentation: inside "config global" and inside each VDOM the blocks start at column 0.
 * Quoted values can span several lines (certificates, keys, replacement messages) and use
 * backslash escapes.
 */
export function parseFortios(lines: string[]): SyntaxTree {
  const ignored = new Set<number>();
  let pass = parseOnce(lines, ignored);
  // A quote that is never closed would swallow the rest of the file: treat that line as
  // complete and parse again.
  while (pass.unterminatedAt !== null && ignored.size < MAX_RECOVERIES) {
    ignored.add(pass.unterminatedAt);
    pass = parseOnce(lines, ignored);
  }
  const diagnostics = [
    ...[...ignored].map((i) => ({ line: i + 1, code: 'unterminated-string' as const })),
    ...pass.diagnostics,
  ].sort((a, b) => a.line - b.line);
  return { family: 'fortios', nodes: pass.nodes, lineCount: lines.length, diagnostics };
}

function parseOnce(lines: string[], ignored: Set<number>): Pass {
  const nodes: SyntaxNode[] = [];
  const diagnostics: SyntaxDiagnostic[] = [];
  const stack: Frame[] = [];
  let openString: SyntaxNode | null = null;
  let openStringIndex = -1;

  const extend = (lineNo: number) => {
    for (const frame of stack) frame.node.endLine = lineNo;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;

    if (openString) {
      openString.endLine = lineNo;
      extend(lineNo);
      if (!scanQuotes(raw, true)) openString = null;
      continue;
    }

    const text = raw.trim();
    if (text === '') continue;
    const siblings = stack.length > 0 ? stack[stack.length - 1]!.node.children : nodes;

    if (text.startsWith('#')) {
      siblings.push(newNode(lineNo, text, 'comment'));
      extend(lineNo);
      continue;
    }

    const keyword = firstWord(text);
    if (keyword === 'config' || keyword === 'edit') {
      const node = newNode(lineNo, text, 'block');
      siblings.push(node);
      extend(lineNo);
      stack.push({ node, type: keyword });
      continue;
    }
    if (keyword === 'next') {
      const top = stack[stack.length - 1];
      if (top?.type === 'edit') {
        extend(lineNo);
        stack.pop();
      } else {
        diagnostics.push({ line: lineNo, code: 'unexpected-close' });
        siblings.push(newNode(lineNo, text, 'statement'));
        extend(lineNo);
      }
      continue;
    }
    if (keyword === 'end') {
      let configIndex = -1;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k]!.type === 'config') {
          configIndex = k;
          break;
        }
      }
      if (configIndex === -1) {
        diagnostics.push({ line: lineNo, code: 'unexpected-close' });
        siblings.push(newNode(lineNo, text, 'statement'));
        continue;
      }
      for (let k = stack.length - 1; k > configIndex; k--) {
        diagnostics.push({ line: stack[k]!.node.line, code: 'unclosed-block' });
      }
      extend(lineNo);
      stack.length = configIndex;
      continue;
    }

    const node = newNode(lineNo, text, 'statement');
    siblings.push(node);
    extend(lineNo);
    if (!ignored.has(i) && scanQuotes(raw, false)) {
      openString = node;
      openStringIndex = i;
    }
  }

  if (openString) {
    return { nodes, diagnostics, unterminatedAt: openStringIndex };
  }
  for (const frame of stack) {
    diagnostics.push({ line: frame.node.line, code: 'unclosed-block' });
  }
  return { nodes, diagnostics, unterminatedAt: null };
}

function firstWord(text: string): string {
  const space = text.search(/\s/);
  return space === -1 ? text : text.slice(0, space);
}

/** Returns whether a quoted value is still open at the end of the line. */
export function scanQuotes(line: string, inString: boolean): boolean {
  let open = inString;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charCodeAt(i);
    if (ch === 92 /* \ */) {
      i++;
    } else if (ch === 34 /* " */) {
      open = !open;
    }
  }
  return open;
}

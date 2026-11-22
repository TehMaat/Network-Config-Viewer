import type { SyntaxNode } from '../syntax/types';
import type { Coverage, CoverageSection, LineStatus, Reference, Src } from '../model/types';

const UNSET = 0;
const UNDERSTOOD = 1;
const IGNORED = 2;

export type SymbolKind =
  | 'interface'
  | 'vlan'
  | 'acl'
  | 'object-group'
  | 'route-map'
  | 'prefix-list'
  | 'peer-group'
  | 'address'
  | 'service'
  | 'zone'
  | 'vip'
  | 'ippool'
  | 'schedule'
  | 'phase1'
  | 'sdwan-zone'
  | 'health-check'
  | 'wtp-profile';

interface PendingReference {
  line: number;
  from: number;
  to: number;
  kind: SymbolKind | SymbolKind[];
  name: string;
  context?: string;
}

/**
 * State shared by a driver while it reads a file: which lines it understood or ignored on
 * purpose, the names it defined and the names it found as references to them.
 */
export class DriverContext {
  readonly lines: string[];
  private readonly status: Uint8Array;
  private readonly symbols = new Map<string, number>();
  private readonly pending: PendingReference[] = [];

  constructor(lines: string[]) {
    this.lines = lines;
    this.status = new Uint8Array(lines.length + 1);
  }

  /** Marks the first line of a node (or a single line) as understood. */
  understood(node: SyntaxNode | number): void {
    this.set(typeof node === 'number' ? node : node.line, UNDERSTOOD);
  }

  /** Marks the whole node (first line to end line, children included) as understood. */
  understoodAll(node: SyntaxNode): void {
    for (let l = node.line; l <= node.endLine; l++) this.set(l, UNDERSTOOD);
  }

  /** Marks the whole node as ignored on purpose (comments, banners, certificates...). */
  ignoredAll(node: SyntaxNode): void {
    for (let l = node.line; l <= node.endLine; l++) {
      if (this.status[l] === UNSET) this.status[l] = IGNORED;
    }
  }

  ignored(line: number): void {
    if (this.status[line] === UNSET) this.status[line] = IGNORED;
  }

  /** The block lines that close a node ("next", "end", "exit") belong to it. */
  understoodClosing(node: SyntaxNode): void {
    const last =
      node.children.length > 0 ? lastLine(node.children[node.children.length - 1]!) : node.line;
    for (let l = last + 1; l <= node.endLine; l++) this.set(l, UNDERSTOOD);
  }

  private set(line: number, value: number) {
    if (line < 1 || line > this.lines.length) return;
    if (value === UNDERSTOOD || this.status[line] === UNSET) this.status[line] = value;
  }

  lineStatus(line: number): LineStatus | null {
    const raw = this.lines[line - 1];
    if (raw === undefined || raw.trim() === '') return null;
    const s = this.status[line];
    return s === UNDERSTOOD ? 'understood' : s === IGNORED ? 'ignored' : 'unknown';
  }

  // ---- symbols and references -----------------------------------------------------

  define(kind: SymbolKind, name: string, line: number, context = ''): void {
    const key = `${kind}|${context}|${name}`;
    if (!this.symbols.has(key)) this.symbols.set(key, line);
  }

  defined(kind: SymbolKind, name: string, context = ''): boolean {
    return this.symbols.has(`${kind}|${context}|${name}`);
  }

  /** A name at known columns of a line that may point to a definition. */
  refAt(
    line: number,
    from: number,
    to: number,
    kind: SymbolKind | SymbolKind[],
    name: string,
    context?: string,
  ): void {
    if (from < 0 || to <= from) return;
    this.pending.push({
      line,
      from,
      to,
      kind,
      name,
      ...(context !== undefined ? { context } : {}),
    });
  }

  /** A name somewhere in a line, after the given column. */
  ref(
    line: number,
    name: string,
    kind: SymbolKind | SymbolKind[],
    after = 0,
    context?: string,
  ): void {
    const raw = this.lines[line - 1] ?? '';
    const from = findWord(raw, name, after);
    if (from >= 0) this.refAt(line, from, from + name.length, kind, name, context);
  }

  references(): Reference[] {
    const out: Reference[] = [];
    for (const p of this.pending) {
      const kinds = Array.isArray(p.kind) ? p.kind : [p.kind];
      let target: number | undefined;
      for (const kind of kinds) {
        target =
          this.symbols.get(`${kind}|${p.context ?? ''}|${p.name}`) ??
          (p.context ? this.symbols.get(`${kind}||${p.name}`) : undefined);
        if (target !== undefined) break;
      }
      if (target !== undefined && target !== p.line) {
        out.push({ line: p.line, from: p.from, to: p.to, targetLine: target });
      }
    }
    return out.sort((a, b) => a.line - b.line || a.from - b.from);
  }

  // ---- coverage -------------------------------------------------------------------

  coverage(sectionOf: (line: number) => string): Coverage {
    let total = 0;
    let understood = 0;
    let ignored = 0;
    const unknownLines: number[] = [];
    const sections = new Map<string, CoverageSection>();
    for (let l = 1; l <= this.lines.length; l++) {
      const status = this.lineStatus(l);
      if (status === null) continue;
      total++;
      if (status === 'understood') understood++;
      else if (status === 'ignored') ignored++;
      else {
        unknownLines.push(l);
        const key = sectionOf(l);
        const section = sections.get(key);
        if (section) section.lines++;
        else sections.set(key, { section: key, lines: 1, firstLine: l });
      }
    }
    return {
      total,
      understood,
      ignored,
      unknown: total - understood - ignored,
      unknownLines,
      sections: [...sections.values()].sort(
        (a, b) => b.lines - a.lines || a.firstLine - b.firstLine,
      ),
    };
  }
}

function lastLine(node: SyntaxNode): number {
  return node.endLine;
}

/** Column of a whole word in a line, or -1. */
export function findWord(raw: string, word: string, after = 0): number {
  let from = raw.indexOf(word, after);
  while (from >= 0) {
    const before = from === 0 ? ' ' : raw[from - 1]!;
    const next = raw[from + word.length] ?? ' ';
    if (/[\s"',]/.test(before) && /[\s"',]/.test(next)) return from;
    from = raw.indexOf(word, from + 1);
  }
  return -1;
}

export function nodeSrc(node: SyntaxNode): Src {
  return [[node.line, node.endLine]];
}

export function lineSrc(line: number): Src {
  return [[line, line]];
}

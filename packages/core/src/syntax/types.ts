import type { SyntaxFamily } from '../detect/types';

export type NodeKind = 'block' | 'statement' | 'comment';

/** A line of the configuration, with the lines that belong to it. */
export interface SyntaxNode {
  /** 1-based first line. */
  line: number;
  /** 1-based last line: children, continuation lines and the closing line ("next", "end", "exit"). */
  endLine: number;
  /** The first line without surrounding whitespace. */
  text: string;
  kind: NodeKind;
  children: SyntaxNode[];
}

export type DiagnosticCode =
  | 'unterminated-string'
  | 'unterminated-banner'
  | 'unterminated-block'
  | 'unclosed-block'
  | 'unexpected-close';

export interface SyntaxDiagnostic {
  /** 1-based line. */
  line: number;
  code: DiagnosticCode;
}

export interface SyntaxTree {
  family: SyntaxFamily;
  nodes: SyntaxNode[];
  lineCount: number;
  diagnostics: SyntaxDiagnostic[];
}

export function newNode(line: number, text: string, kind: NodeKind): SyntaxNode {
  return { line, endLine: line, text, kind, children: [] };
}

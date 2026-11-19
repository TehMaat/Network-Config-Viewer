import { findPrompts } from '../detect/show';
import type { SyntaxFamily } from '../detect/types';
import { parseFortios } from './fortios';
import { parseIndented, type IndentDialect } from './indent';
import { newNode, type SyntaxNode, type SyntaxTree } from './types';

export * from './types';
export { parseFortios, scanQuotes } from './fortios';
export { bannerDelimiter, parseIndented, type IndentDialect } from './indent';

export interface ParseOptions {
  dialect?: IndentDialect;
}

/** Builds the syntax tree of a text for the given family. */
export function parseSyntax(
  lines: string[],
  family: SyntaxFamily,
  options: ParseOptions = {},
): SyntaxTree {
  switch (family) {
    case 'fortios':
      return parseFortios(lines);
    case 'indent':
      return parseIndented(lines, options.dialect ?? 'cisco');
    case 'show':
      return parseShow(lines);
    default:
      return { family: 'plain', nodes: [], lineCount: lines.length, diagnostics: [] };
  }
}

/** A prompt with nothing typed after it, as found at the end of a terminal log. */
const BARE_PROMPT = /^[A-Za-z0-9][\w.\-/:]*(?:\([^)]*\))?(?: \([^)\s]+\))?\s?[#>$]\s*$/;

/** Command output: one block for each command, from its prompt to the next one. */
export function parseShow(lines: string[]): SyntaxTree {
  const prompts = findPrompts(lines);
  const nodes: SyntaxNode[] = prompts.map((prompt, n) => {
    const next = prompts[n + 1]?.index ?? lines.length;
    let last = next - 1;
    while (last > prompt.index && (lines[last]!.trim() === '' || BARE_PROMPT.test(lines[last]!)))
      last--;
    const node = newNode(prompt.index + 1, lines[prompt.index]!.trim(), 'block');
    node.endLine = last + 1;
    return node;
  });
  return { family: 'show', nodes, lineCount: lines.length, diagnostics: [] };
}

/** Foldable ranges as pairs of 1-based [first line, last line]. */
export function foldRanges(tree: SyntaxTree): Int32Array {
  const out: number[] = [];
  const walk = (nodes: SyntaxNode[]) => {
    for (const node of nodes) {
      if (node.endLine > node.line) out.push(node.line, node.endLine);
      if (node.children.length > 0) walk(node.children);
    }
  };
  walk(tree.nodes);
  return Int32Array.from(out);
}

export interface OutlineEntry {
  line: number;
  endLine: number;
  label: string;
  depth: number;
}

export interface Outline {
  entries: OutlineEntry[];
  /** True when the outline was cut at {@link MAX_OUTLINE_ENTRIES}. */
  truncated: boolean;
}

export const MAX_OUTLINE_ENTRIES = 5000;

/**
 * The main blocks of the configuration, for navigation:
 * - FortiOS: "config" blocks (also nested ones) and the VDOMs, but not the single entries;
 * - indentation: the top-level blocks (interfaces, routing, lines, banners...);
 * - command output: one entry per command.
 */
export function buildOutline(tree: SyntaxTree): Outline {
  const entries: OutlineEntry[] = [];
  let truncated = false;
  const add = (node: SyntaxNode, depth: number): boolean => {
    if (entries.length >= MAX_OUTLINE_ENTRIES) {
      truncated = true;
      return false;
    }
    entries.push({ line: node.line, endLine: node.endLine, label: label(node.text), depth });
    return true;
  };

  if (tree.family === 'fortios') {
    const walk = (nodes: SyntaxNode[], depth: number, insideVdom: boolean) => {
      for (const node of nodes) {
        if (node.kind !== 'block') continue;
        const isConfig = node.text.startsWith('config ');
        const isVdomEntry = insideVdom && node.text.startsWith('edit ');
        if (!isConfig && !isVdomEntry) continue;
        if (!add(node, depth)) return;
        if (depth < 3) walk(node.children, depth + 1, node.text === 'config vdom');
      }
    };
    walk(tree.nodes, 0, false);
  } else if (tree.family === 'indent' || tree.family === 'show') {
    for (const node of tree.nodes) {
      if (node.kind === 'block' && !add(node, 0)) break;
    }
  }
  return { entries, truncated };
}

function label(text: string): string {
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

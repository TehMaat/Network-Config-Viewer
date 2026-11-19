import type { Detected, Evidence, EvidenceRule } from './types';

export interface LineMatch {
  /** 0-based index in the lines array. */
  index: number;
  match: RegExpExecArray;
}

/** First line in [from, to) matching the pattern. */
export function findLine(
  lines: string[],
  re: RegExp,
  from = 0,
  to = lines.length,
): LineMatch | null {
  const end = Math.min(to, lines.length);
  for (let i = Math.max(0, from); i < end; i++) {
    const match = re.exec(lines[i]!);
    if (match) return { index: i, match };
  }
  return null;
}

/** All lines in [from, to) matching the pattern. */
export function findLines(lines: string[], re: RegExp, from = 0, to = lines.length): LineMatch[] {
  const out: LineMatch[] = [];
  const end = Math.min(to, lines.length);
  for (let i = Math.max(0, from); i < end; i++) {
    const match = re.exec(lines[i]!);
    if (match) out.push({ index: i, match });
  }
  return out;
}

/** Index of the first non-empty line at or after `from`, or -1. */
export function firstNonEmpty(lines: string[], from = 0): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i]!.trim() !== '') return i;
  }
  return -1;
}

export function evidence(rule: EvidenceRule, index?: number, lines?: string[]): Evidence {
  if (index === undefined || !lines) return { rule };
  return { rule, line: index + 1, excerpt: excerpt(lines[index] ?? '') };
}

export function detected<T>(
  value: T,
  rule: EvidenceRule,
  index?: number,
  lines?: string[],
): Detected<T> {
  return { value, evidence: evidence(rule, index, lines) };
}

export function excerpt(line: string): string {
  const text = line.trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

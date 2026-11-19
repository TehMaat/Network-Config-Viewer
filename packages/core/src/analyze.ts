import { detect } from './detect';
import type { Detection, OsId, SyntaxFamily } from './detect/types';
import { buildOutline, foldRanges, parseSyntax, type Outline, type SyntaxTree } from './syntax';
import { splitLines } from './text';

export interface Structure {
  tree: SyntaxTree;
  /** Pairs of 1-based [first line, last line] that can be folded. */
  folds: Int32Array;
  outline: Outline;
}

export interface Analysis extends Structure {
  detection: Detection;
  lineCount: number;
}

/** Recognises a text file and builds its structure for the viewer. */
export function analyzeText(text: string): Analysis {
  const lines = splitLines(text);
  const detection = detect(lines);
  return {
    detection,
    lineCount: lines.length,
    ...structureOf(lines, detection.syntax, detection.os?.value),
  };
}

/** Structure of a text with a given syntax family, for example after a manual correction. */
export function structureFor(text: string, family: SyntaxFamily, os?: OsId): Structure {
  return structureOf(splitLines(text), family, os);
}

function structureOf(lines: string[], family: SyntaxFamily, os?: OsId): Structure {
  const tree = parseSyntax(lines, family, { dialect: os === 'cisco-sb' ? 'cisco-sb' : 'cisco' });
  return { tree, folds: foldRanges(tree), outline: buildOutline(tree) };
}

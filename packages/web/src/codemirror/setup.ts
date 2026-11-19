import { foldService, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// Colours come from CSS variables, defined for the light and the dark theme in styles.css.
export const highlightStyle = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--ncv-syntax-keyword)', fontWeight: '600' },
    { tag: tags.operatorKeyword, color: 'var(--ncv-syntax-negation)', fontWeight: '600' },
    { tag: tags.propertyName, color: 'var(--ncv-syntax-property)' },
    { tag: tags.string, color: 'var(--ncv-syntax-string)' },
    { tag: tags.number, color: 'var(--ncv-syntax-number)' },
    { tag: tags.comment, color: 'var(--ncv-syntax-comment)', fontStyle: 'italic' },
    { tag: tags.atom, color: 'var(--ncv-syntax-atom)' },
    { tag: tags.typeName, color: 'var(--ncv-syntax-type)' },
    { tag: tags.meta, color: 'var(--ncv-syntax-meta)' },
    { tag: tags.heading, color: 'var(--ncv-syntax-heading)', fontWeight: '700' },
  ]),
);

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--mantine-color-body)',
    color: 'var(--mantine-color-text)',
  },
  // The active line and the cursor already show where the focus is.
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'var(--mantine-font-family-monospace)',
    lineHeight: '1.55',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--ncv-gutter-bg)',
    color: 'var(--mantine-color-dimmed)',
    borderRight: '1px solid var(--mantine-color-default-border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'var(--ncv-active-line)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--ncv-selection) !important',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--ncv-search-match)',
    outline: '1px solid var(--ncv-search-match-border)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--ncv-search-match-selected)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--ncv-selection-match)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--ncv-gutter-bg)',
    color: 'var(--mantine-color-text)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--mantine-color-default-border)',
  },
  '.cm-panel input, .cm-panel button': {
    fontSize: '13px',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--ncv-gutter-bg)',
    border: '1px solid var(--mantine-color-default-border)',
    color: 'var(--mantine-color-dimmed)',
    padding: '0 6px',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--mantine-color-text)',
  },
});

/**
 * Folding comes from the parser in the worker: a pair of numbers for each foldable block.
 * The fold starts at the end of the first line and ends at the end of the last line.
 */
export function foldsExtension(folds: Int32Array): Extension {
  if (folds.length === 0) return [];
  const ends = new Map<number, number>();
  for (let i = 0; i < folds.length; i += 2) {
    const start = folds[i]!;
    const end = folds[i + 1]!;
    if (end > (ends.get(start) ?? 0)) ends.set(start, end);
  }
  return foldService.of((state, lineStart, lineEnd) => {
    const line = state.doc.lineAt(lineStart).number;
    const end = ends.get(line);
    if (end === undefined || end > state.doc.lines) return null;
    return { from: lineEnd, to: state.doc.line(end).to };
  });
}

/** CodeMirror's own texts (search panel, fold markers) in the user's language. */
export function phrasesExtension(phrases: Record<string, string>): Extension {
  return EditorState.phrases.of(phrases);
}

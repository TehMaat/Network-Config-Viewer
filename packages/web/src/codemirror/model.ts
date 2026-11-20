// What the neutral model adds to the config view: the lines that no driver understood are
// highlighted, and the names that point to a definition become links.
import { RangeSetBuilder, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Reference } from '@ncv/core';

const unknownLine = Decoration.line({ class: 'ncv-line-unknown' });

export function unknownLinesExtension(doc: Text, lines: readonly number[]): Extension {
  if (lines.length === 0) return [];
  const builder = new RangeSetBuilder<Decoration>();
  for (const line of lines) {
    if (line < 1 || line > doc.lines) continue;
    const at = doc.line(line).from;
    builder.add(at, at, unknownLine);
  }
  const set = builder.finish();
  return EditorView.decorations.of(set);
}

/**
 * Names that point to their definition. Clicking one jumps to the definition: the target is
 * kept in an attribute of the mark, so the click handler needs no lookup.
 */
export function referencesExtension(
  doc: Text,
  references: readonly Reference[],
  onFollow: (targetLine: number, fromLine: number) => void,
  label: (line: number) => string,
): Extension {
  if (references.length === 0) return [];
  const builder = new RangeSetBuilder<Decoration>();
  for (const ref of references) {
    if (ref.line < 1 || ref.line > doc.lines) continue;
    const line = doc.line(ref.line);
    const from = line.from + ref.from;
    const to = line.from + ref.to;
    if (to > line.to || from >= to) continue;
    builder.add(
      from,
      to,
      Decoration.mark({
        class: 'ncv-ref',
        attributes: { 'data-target': String(ref.targetLine), title: label(ref.targetLine) },
      }),
    );
  }
  const set: DecorationSet = builder.finish();
  return [
    EditorView.decorations.of(set),
    EditorView.domEventHandlers({
      click(event, view) {
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.ncv-ref');
        if (!target) return false;
        // A click that ends a selection is not a request to follow the link.
        if (!view.state.selection.main.empty) return false;
        const targetLine = Number(target.dataset.target);
        if (!Number.isFinite(targetLine)) return false;
        const fromLine = view.state.doc.lineAt(view.posAtDOM(target)).number;
        event.preventDefault();
        onFollow(targetLine, fromLine);
        return true;
      },
    }),
  ];
}

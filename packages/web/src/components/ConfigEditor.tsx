import { defaultKeymap } from '@codemirror/commands';
import {
  codeFolding,
  foldAll,
  foldedRanges,
  foldGutter,
  foldKeymap,
  unfoldAll,
  unfoldEffect,
} from '@codemirror/language';
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search';
import { Compartment, EditorSelection, EditorState, type StateEffect } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { eolSeparator, type Eol, type Reference, type SyntaxFamily } from '@ncv/core';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { languageFor } from '../codemirror/languages';
import { referencesExtension, unknownLinesExtension } from '../codemirror/model';
import { editorTheme, foldsExtension, highlightStyle, phrasesExtension } from '../codemirror/setup';

export interface EditorHandle {
  goToLine(line: number): void;
  /** Selects whole lines, for example the lines an element of a view comes from. */
  showLines(first: number, last: number): void;
  /** Back to where the last followed link was. */
  back(): void;
  openSearch(): void;
  foldAll(): void;
  unfoldAll(): void;
}

interface Props {
  text: string;
  eol: Eol;
  family: SyntaxFamily;
  folds: Int32Array;
  /** Lines no driver understood, highlighted when highlightUnknown is on. */
  unknownLines?: readonly number[];
  highlightUnknown?: boolean;
  /** Names that point to their definition. */
  references?: readonly Reference[];
  /** Called with the number of positions to go back to, after following a link. */
  onHistoryChange?(depth: number): void;
  ref?: Ref<EditorHandle>;
}

/** Read-only view of the original text. The document is never changed. */
export function ConfigEditor({
  text,
  eol,
  family,
  folds,
  unknownLines,
  highlightUnknown = true,
  references,
  onHistoryChange,
  ref,
}: Props) {
  const { t, i18n } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const history = useRef<number[]>([]);
  const historyListener = useRef(onHistoryChange);
  useEffect(() => {
    historyListener.current = onHistoryChange;
  }, [onHistoryChange]);
  const compartments = useRef({
    language: new Compartment(),
    folds: new Compartment(),
    phrases: new Compartment(),
    unknown: new Compartment(),
    references: new Compartment(),
  });

  // Created once per file: the parent remounts this component when the file changes.
  useEffect(() => {
    const parent = container.current;
    if (!parent) return;
    const separator = eolSeparator(eol);
    const c = compartments.current;
    const state = EditorState.create({
      doc: text,
      extensions: [
        // With a single line ending style, lines are joined back with it: copying gives the
        // exact original text, also with Windows line endings.
        separator && separator !== '\n' ? EditorState.lineSeparator.of(separator) : [],
        EditorState.readOnly.of(true),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        codeFolding(),
        foldGutter(),
        search({ top: true }),
        highlightSelectionMatches(),
        keymap.of([...searchKeymap, ...foldKeymap, ...defaultKeymap]),
        editorTheme,
        highlightStyle,
        c.language.of([]),
        c.folds.of([]),
        c.phrases.of([]),
        c.unknown.of([]),
        c.references.of([]),
        EditorView.contentAttributes.of({ 'data-testid': 'config-editor' }),
      ],
    });
    view.current = new EditorView({ state, parent });
    history.current = [];
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [text, eol]);

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        compartments.current.language.reconfigure(languageFor(family)),
        compartments.current.folds.reconfigure(foldsExtension(folds)),
      ],
    });
  }, [family, folds, text]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({
      effects: compartments.current.unknown.reconfigure(
        highlightUnknown && unknownLines ? unknownLinesExtension(v.state.doc, unknownLines) : [],
      ),
    });
  }, [unknownLines, highlightUnknown, text]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const follow = (targetLine: number, fromLine: number) => {
      history.current.push(fromLine);
      historyListener.current?.(history.current.length);
      select(v, targetLine, targetLine);
    };
    v.dispatch({
      effects: compartments.current.references.reconfigure(
        references
          ? referencesExtension(v.state.doc, references, follow, (line) =>
              t('config.followLink', { line }),
            )
          : [],
      ),
    });
  }, [references, text, t]);

  useEffect(() => {
    const phrases = t('codemirror', { returnObjects: true }) as Record<string, string>;
    view.current?.dispatch({
      effects: compartments.current.phrases.reconfigure([
        phrasesExtension(phrases),
        EditorView.contentAttributes.of({ 'aria-label': t('viewer.ariaLabel') }),
      ]),
    });
  }, [t, i18n.language, text]);

  useImperativeHandle(
    ref,
    () => ({
      goToLine(line: number) {
        if (view.current) select(view.current, line, line, false);
      },
      showLines(first: number, last: number) {
        if (view.current) select(view.current, first, last);
      },
      back() {
        const v = view.current;
        const line = history.current.pop();
        historyListener.current?.(history.current.length);
        if (v && line !== undefined) select(v, line, line);
      },
      openSearch() {
        if (view.current) openSearchPanel(view.current);
      },
      foldAll() {
        if (view.current) foldAll(view.current);
      },
      unfoldAll() {
        if (view.current) unfoldAll(view.current);
      },
    }),
    [],
  );

  return <div ref={container} className="ncv-editor" data-testid="viewer" />;
}

/**
 * Puts the cursor on the first line, or selects the whole range, unfolding what hides it and
 * scrolling it to the top of the view.
 */
function select(v: EditorView, first: number, last: number, range = first !== last) {
  const doc = v.state.doc;
  const start = doc.line(Math.max(1, Math.min(first, doc.lines)));
  const end = doc.line(Math.max(start.number, Math.min(last, doc.lines)));
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(v.state).between(start.from, end.to, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }));
  });
  effects.push(EditorView.scrollIntoView(start.from, { y: 'start', yMargin: 24 }));
  v.dispatch({
    selection: range
      ? EditorSelection.range(start.from, end.to)
      : EditorSelection.cursor(start.from),
    effects,
  });
  v.focus();
}

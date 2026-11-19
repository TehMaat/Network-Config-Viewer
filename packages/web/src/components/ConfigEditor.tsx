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
import { eolSeparator, type Eol, type SyntaxFamily } from '@ncv/core';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { languageFor } from '../codemirror/languages';
import { editorTheme, foldsExtension, highlightStyle, phrasesExtension } from '../codemirror/setup';

export interface EditorHandle {
  goToLine(line: number): void;
  openSearch(): void;
  foldAll(): void;
  unfoldAll(): void;
}

interface Props {
  text: string;
  eol: Eol;
  family: SyntaxFamily;
  folds: Int32Array;
  ref?: Ref<EditorHandle>;
}

/** Read-only view of the original text. The document is never changed. */
export function ConfigEditor({ text, eol, family, folds, ref }: Props) {
  const { t, i18n } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const compartments = useRef({
    language: new Compartment(),
    folds: new Compartment(),
    phrases: new Compartment(),
  });

  // Created once per file: the parent remounts this component when the file changes.
  useEffect(() => {
    const parent = container.current;
    if (!parent) return;
    const separator = eolSeparator(eol);
    const { language, folds: foldsCompartment, phrases } = compartments.current;
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
        language.of([]),
        foldsCompartment.of([]),
        phrases.of([]),
        EditorView.contentAttributes.of({ 'data-testid': 'config-editor' }),
      ],
    });
    view.current = new EditorView({ state, parent });
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
        const v = view.current;
        if (!v) return;
        const target = v.state.doc.line(Math.max(1, Math.min(line, v.state.doc.lines)));
        const effects: StateEffect<unknown>[] = [];
        foldedRanges(v.state).between(target.from, target.from, (from, to) => {
          effects.push(unfoldEffect.of({ from, to }));
        });
        effects.push(EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 24 }));
        v.dispatch({ selection: EditorSelection.cursor(target.from), effects });
        v.focus();
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

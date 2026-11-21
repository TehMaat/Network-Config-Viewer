import type {
  Detection,
  Eol,
  FileKind,
  LoadIssueCode,
  OsId,
  SyntaxDiagnostic,
  SyntaxFamily,
  TextEncodingName,
} from '@ncv/core';

/** Corrections typed by the user; an empty string clears a value. */
export interface Overrides {
  kind?: FileKind;
  os?: OsId | '';
  version?: string;
  model?: string;
  hostname?: string;
}

export interface TextEntry {
  type: 'text';
  id: string;
  path: string[];
  name: string;
  size: number;
  encoding: TextEncodingName;
  bom: boolean;
  eol: Eol;
  lineCount: number;
  detection: Detection;
  overrides: Overrides;
  family: SyntaxFamily;
  diagnostics: SyntaxDiagnostic[];
  /** Incremented every time the structure (folds, outline) changes. */
  structureVersion: number;
  /** When the configuration was last changed, if written in it. */
  configDate?: string;
  /** Date of the file on the user's computer, as an ISO string. */
  modifiedAt?: string;
  /** The file in the archive of the open client; missing while it is being saved. */
  archived?: { fileId: string; addedAt: string };
  /** Saving in the archive failed: the code of the error. */
  saveError?: string;
  /** When the user chose this file as the current configuration of its device. */
  pinnedAt?: string;
}

export interface IssueEntry {
  type: 'issue';
  id: string;
  path: string[];
  size?: number;
  code: LoadIssueCode | 'worker-error';
  message?: string;
}

export type FileEntry = TextEntry | IssueEntry;

export interface FilesState {
  files: FileEntry[];
  selectedId: string | null;
  pendingBatches: number[];
}

export const initialFilesState: FilesState = { files: [], selectedId: null, pendingBatches: [] };

export type FilesAction =
  | { type: 'batch-started'; batch: number }
  | { type: 'batch-done'; batch: number }
  | { type: 'added'; entry: FileEntry }
  | { type: 'structure'; id: string; family: SyntaxFamily; diagnostics: SyntaxDiagnostic[] }
  | { type: 'select'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'clear' }
  | { type: 'override'; id: string; overrides: Overrides }
  | { type: 'archived'; id: string; archived: { fileId: string; addedAt: string } }
  | { type: 'save-failed'; id: string; code: string }
  | { type: 'pin'; id: string; pinnedAt: string | undefined };

export function filesReducer(state: FilesState, action: FilesAction): FilesState {
  switch (action.type) {
    case 'batch-started':
      return { ...state, pendingBatches: [...state.pendingBatches, action.batch] };
    case 'batch-done':
      return { ...state, pendingBatches: state.pendingBatches.filter((b) => b !== action.batch) };
    case 'added':
      return {
        ...state,
        files: [...state.files, action.entry],
        selectedId: state.selectedId ?? action.entry.id,
      };
    case 'structure':
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id && f.type === 'text'
            ? {
                ...f,
                family: action.family,
                diagnostics: action.diagnostics,
                structureVersion: f.structureVersion + 1,
              }
            : f,
        ),
      };
    case 'select':
      return { ...state, selectedId: action.id };
    case 'remove': {
      const index = state.files.findIndex((f) => f.id === action.id);
      const files = state.files.filter((f) => f.id !== action.id);
      let selectedId = state.selectedId;
      if (selectedId === action.id) {
        selectedId = files[Math.min(index, files.length - 1)]?.id ?? null;
      }
      return { ...state, files, selectedId };
    }
    case 'clear':
      return { ...state, files: [], selectedId: null };
    case 'override':
      return updateText(state, action.id, (f) => ({ ...f, overrides: action.overrides }));
    case 'archived':
      return updateText(state, action.id, (f) => {
        const { saveError: _saveError, ...rest } = f;
        return { ...rest, archived: action.archived };
      });
    case 'save-failed':
      return updateText(state, action.id, (f) => ({ ...f, saveError: action.code }));
    case 'pin':
      return updateText(state, action.id, (f) => {
        const { pinnedAt: _pinnedAt, ...rest } = f;
        return action.pinnedAt ? { ...rest, pinnedAt: action.pinnedAt } : rest;
      });
  }
}

function updateText(
  state: FilesState,
  id: string,
  change: (entry: TextEntry) => TextEntry,
): FilesState {
  return {
    ...state,
    files: state.files.map((f) => (f.id === id && f.type === 'text' ? change(f) : f)),
  };
}

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
  | { type: 'override'; id: string; overrides: Overrides };

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
      return {
        ...state,
        files: state.files.map((f) =>
          f.id === action.id && f.type === 'text' ? { ...f, overrides: action.overrides } : f,
        ),
      };
  }
}

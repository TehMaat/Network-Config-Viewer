import type {
  Detection,
  DeviceModel,
  Eol,
  LoadIssueCode,
  ModelHints,
  OsId,
  Outline,
  SyntaxDiagnostic,
  ShowFile,
  SyntaxFamily,
  TextEncodingName,
} from '@ncv/core';

/** Messages from the page to the worker. */
export type WorkerRequest =
  | { type: 'load'; batch: number; files: { name: string; buffer: ArrayBuffer }[] }
  | { type: 'structure'; id: string; family: SyntaxFamily; os?: OsId; hints: ModelHints }
  | { type: 'forget'; ids: string[] };

export interface StructureData {
  family: SyntaxFamily;
  /** Pairs of 1-based [first line, last line]. */
  folds: Int32Array;
  outline: Outline;
  diagnostics: SyntaxDiagnostic[];
  /** Neutral model, when the operating system has a driver. */
  model: DeviceModel | null;
  /** Commands and real state, when the file holds the output of show commands. */
  show: ShowFile | null;
}

export interface TextFileMessage {
  type: 'text';
  batch: number;
  id: string;
  path: string[];
  name: string;
  size: number;
  text: string;
  /** The original bytes, for "download the original". */
  bytes: ArrayBuffer;
  encoding: TextEncodingName;
  bom: boolean;
  eol: Eol;
  lineCount: number;
  detection: Detection;
  structure: StructureData;
}

export interface IssueMessage {
  type: 'issue';
  batch: number;
  id: string;
  path: string[];
  size?: number;
  code: LoadIssueCode;
}

/** Messages from the worker to the page. */
export type WorkerMessage =
  | TextFileMessage
  | IssueMessage
  | { type: 'done'; batch: number }
  | { type: 'structure'; id: string; structure: StructureData }
  | { type: 'error'; batch?: number; message: string };

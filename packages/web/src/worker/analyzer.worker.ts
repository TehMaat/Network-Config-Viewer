// Reads, recognises and parses the files away from the page, so that large configurations
// never freeze the interface. Nothing here talks to the network.
import {
  analyzeLines,
  buildModel,
  configDate,
  loadFile,
  modelHints,
  readShowFile,
  splitLines,
  structureOfLines,
  type ModelHints,
  type OsId,
  type Structure,
} from '@ncv/core';
import type { LoadInput, StructureData, WorkerMessage, WorkerRequest } from './protocol';

interface WorkerScope {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
/** The lines of every file, to rebuild structure and model after a manual correction. */
const texts = new Map<string, string[]>();
let counter = 0;

const nextId = () => `f${++counter}`;

scope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case 'load':
      load(request.batch, request.files);
      break;
    case 'structure':
      restructure(request.id, request.family, request.hints, request.os);
      break;
    case 'forget':
      for (const id of request.ids) texts.delete(id);
      break;
  }
};

function structureData(lines: string[], structure: Structure, hints: ModelHints): StructureData {
  return {
    family: structure.tree.family,
    folds: structure.folds,
    outline: structure.outline,
    diagnostics: structure.tree.diagnostics,
    model: buildModel(lines, structure.tree, hints),
    show: hints.kind === 'show' ? readShowFile(lines) : null,
  };
}

function load(batch: number, files: LoadInput[]) {
  for (const file of files) {
    try {
      loadFile(
        { name: file.name, bytes: new Uint8Array(file.buffer) },
        {
          text: (loaded) => {
            const id = nextId();
            const lines = splitLines(loaded.decoded.text);
            const analysis = analyzeLines(lines);
            texts.set(id, lines);
            // A standalone copy: the bytes may be a view into a larger archive buffer.
            const bytes = loaded.bytes.slice().buffer;
            const date = configDate(lines);
            scope.postMessage(
              {
                type: 'text',
                batch,
                id,
                path: file.path ?? loaded.path,
                name: loaded.name,
                size: loaded.bytes.length,
                text: loaded.decoded.text,
                bytes,
                encoding: loaded.decoded.encoding,
                bom: loaded.decoded.bom,
                eol: loaded.decoded.eol,
                lineCount: analysis.lineCount,
                detection: analysis.detection,
                structure: structureData(lines, analysis, modelHints(analysis.detection)),
                ...(date ? { configDate: date } : {}),
                ...(file.archiveId ? { archiveId: file.archiveId } : {}),
                ...(file.lastModified ? { lastModified: file.lastModified } : {}),
              },
              [bytes, analysis.folds.buffer],
            );
          },
          issue: (issue) => {
            scope.postMessage({
              type: 'issue',
              batch,
              id: nextId(),
              ...issue,
              ...(file.path ? { path: file.path } : {}),
              ...(file.archiveId ? { archiveId: file.archiveId } : {}),
            });
          },
        },
      );
    } catch (error) {
      scope.postMessage({ type: 'error', batch, message: String(error) });
    }
  }
  scope.postMessage({ type: 'done', batch });
}

function restructure(id: string, family: StructureData['family'], hints: ModelHints, os?: OsId) {
  const lines = texts.get(id);
  if (lines === undefined) return;
  try {
    const structure = structureOfLines(lines, family, os);
    scope.postMessage(
      { type: 'structure', id, structure: structureData(lines, structure, hints) },
      [structure.folds.buffer],
    );
  } catch (error) {
    scope.postMessage({ type: 'error', message: String(error) });
  }
}

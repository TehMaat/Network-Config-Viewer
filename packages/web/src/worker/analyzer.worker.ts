// Reads, recognises and parses the files away from the page, so that large configurations
// never freeze the interface. Nothing here talks to the network.
import { analyzeText, loadFile, structureFor } from '@ncv/core';
import type { StructureData, WorkerMessage, WorkerRequest } from './protocol';

interface WorkerScope {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const texts = new Map<string, string>();
let counter = 0;

const nextId = () => `f${++counter}`;

scope.onmessage = (event) => {
  const request = event.data;
  switch (request.type) {
    case 'load':
      load(request.batch, request.files);
      break;
    case 'structure':
      restructure(request.id, request.family, request.os);
      break;
    case 'forget':
      for (const id of request.ids) texts.delete(id);
      break;
  }
};

function load(batch: number, files: { name: string; buffer: ArrayBuffer }[]) {
  for (const file of files) {
    try {
      loadFile(
        { name: file.name, bytes: new Uint8Array(file.buffer) },
        {
          text: (loaded) => {
            const id = nextId();
            const analysis = analyzeText(loaded.decoded.text);
            texts.set(id, loaded.decoded.text);
            // A standalone copy: the bytes may be a view into a larger archive buffer.
            const bytes = loaded.bytes.slice().buffer;
            const structure: StructureData = {
              family: analysis.tree.family,
              folds: analysis.folds,
              outline: analysis.outline,
              diagnostics: analysis.tree.diagnostics,
            };
            scope.postMessage(
              {
                type: 'text',
                batch,
                id,
                path: loaded.path,
                name: loaded.name,
                size: loaded.bytes.length,
                text: loaded.decoded.text,
                bytes,
                encoding: loaded.decoded.encoding,
                bom: loaded.decoded.bom,
                eol: loaded.decoded.eol,
                lineCount: analysis.lineCount,
                detection: analysis.detection,
                structure,
              },
              [bytes, analysis.folds.buffer],
            );
          },
          issue: (issue) => {
            scope.postMessage({ type: 'issue', batch, id: nextId(), ...issue });
          },
        },
      );
    } catch (error) {
      scope.postMessage({ type: 'error', batch, message: String(error) });
    }
  }
  scope.postMessage({ type: 'done', batch });
}

function restructure(
  id: string,
  family: StructureData['family'],
  os?: Parameters<typeof structureFor>[2],
) {
  const text = texts.get(id);
  if (text === undefined) return;
  try {
    const structure = structureFor(text, family, os);
    scope.postMessage(
      {
        type: 'structure',
        id,
        structure: {
          family: structure.tree.family,
          folds: structure.folds,
          outline: structure.outline,
          diagnostics: structure.tree.diagnostics,
        },
      },
      [structure.folds.buffer],
    );
  } catch (error) {
    scope.postMessage({ type: 'error', message: String(error) });
  }
}

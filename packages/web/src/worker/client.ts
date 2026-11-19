import type { OsId, SyntaxFamily } from '@ncv/core';
import type { WorkerMessage, WorkerRequest } from './protocol';

/** Talks to the analysis worker. */
export class AnalyzerClient {
  private readonly worker: Worker;
  private batch = 0;

  constructor(onMessage: (message: WorkerMessage) => void) {
    this.worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => onMessage(event.data);
    this.worker.onerror = (event) => {
      onMessage({ type: 'error', message: event.message || 'worker error' });
    };
  }

  /** Sends the files to the worker, which takes ownership of the buffers. Returns the batch number. */
  load(files: { name: string; buffer: ArrayBuffer }[]): number {
    const batch = ++this.batch;
    this.post(
      { type: 'load', batch, files },
      files.map((f) => f.buffer),
    );
    return batch;
  }

  restructure(id: string, family: SyntaxFamily, os?: OsId): void {
    this.post({ type: 'structure', id, family, ...(os ? { os } : {}) });
  }

  forget(ids: string[]): void {
    if (ids.length > 0) this.post({ type: 'forget', ids });
  }

  dispose(): void {
    this.worker.terminate();
  }

  private post(request: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(request, transfer);
  }
}

import type { Outline } from '@ncv/core';

/** The heavy data of a file, kept outside React state to avoid copying it around. */
export interface FileContent {
  text: string;
  bytes: Uint8Array;
  folds: Int32Array;
  outline: Outline;
}

const contents = new Map<string, FileContent>();

export const contentStore = {
  get: (id: string) => contents.get(id),
  set: (id: string, content: FileContent) => contents.set(id, content),
  update: (id: string, change: Partial<FileContent>) => {
    const current = contents.get(id);
    if (current) contents.set(id, { ...current, ...change });
  },
  delete: (id: string) => contents.delete(id),
  clear: () => contents.clear(),
};

import type { DeviceModel, Outline, ShowFile } from '@ncv/core';

/** The heavy data of a file, kept outside React state to avoid copying it around. */
export interface FileContent {
  text: string;
  bytes: Uint8Array;
  folds: Int32Array;
  outline: Outline;
  /** Neutral model of the device, when its operating system has a driver. */
  model: DeviceModel | null;
  /** Commands and real state of a file of show outputs. */
  show: ShowFile | null;
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

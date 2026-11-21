// Files grouped by device (#10): every device has its current configuration, the previous
// versions and the shows. The current one is the most recent, unless the user chose another.

import { fileNameDate, hostKey } from '@ncv/core';
import { effectiveDetection } from './effective';
import type { FileEntry, TextEntry } from './files';

export type DateSource = 'config' | 'file-name' | 'file' | 'added';

export interface FileDate {
  date: string;
  source: DateSource;
}

/** The date of a version: written in the config, in the file name, of the file, of the upload. */
export function fileDate(entry: TextEntry): FileDate | null {
  if (entry.configDate) return { date: entry.configDate, source: 'config' };
  const fromName = fileNameDate(entry.path.at(-1) ?? entry.name);
  if (fromName) return { date: fromName, source: 'file-name' };
  if (entry.modifiedAt) return { date: entry.modifiedAt, source: 'file' };
  if (entry.archived) return { date: entry.archived.addedAt, source: 'added' };
  return null;
}

export interface DeviceGroup {
  /** Hostname in lower case, without the domain. */
  key: string;
  hostname: string;
  current: TextEntry;
  /** The other configurations, most recent first. */
  versions: TextEntry[];
  /** The current configuration was chosen by hand. */
  pinned: boolean;
}

const isConfig = (f: FileEntry): f is TextEntry =>
  f.type === 'text' && effectiveDetection(f.detection, f.overrides).kind.value === 'config';

const hostnameOf = (f: TextEntry) => effectiveDetection(f.detection, f.overrides).hostname.value;

/** Configurations with a hostname, grouped by device. */
export function deviceGroups(files: readonly FileEntry[]): DeviceGroup[] {
  const byKey = new Map<string, { hostname: string; entries: TextEntry[] }>();
  for (const file of files) {
    if (!isConfig(file)) continue;
    const hostname = hostnameOf(file)?.trim();
    if (!hostname) continue;
    const key = hostKey(hostname);
    const group = byKey.get(key) ?? { hostname, entries: [] };
    group.entries.push(file);
    byKey.set(key, group);
  }
  const order = new Map(files.map((f, i) => [f.id, i]));
  const groups: DeviceGroup[] = [];
  for (const [key, { hostname, entries }] of byKey) {
    // Most recent first; without a date, the one loaded last.
    const sorted = [...entries].sort((a, b) => {
      const da = fileDate(a)?.date ?? '';
      const db = fileDate(b)?.date ?? '';
      if (da !== db) return db.localeCompare(da);
      return (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0);
    });
    const pinned = entries
      .filter((e) => e.pinnedAt)
      .sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!))[0];
    const current = pinned ?? sorted[0]!;
    groups.push({
      key,
      hostname,
      current,
      versions: sorted.filter((e) => e !== current),
      pinned: pinned !== undefined,
    });
  }
  return groups.sort((a, b) => a.hostname.localeCompare(b.hostname));
}

import { assignShows, hostKey, mergeStates, type AssignReason, type DeviceState } from '@ncv/core';
import { contentStore } from './content';
import { effectiveDetection } from './effective';
import type { FileEntry, TextEntry } from './files';

export interface LinkedShow {
  entry: TextEntry;
  reason: AssignReason;
}

export interface ShowLinks {
  /** Files of shows of every device, by the id of its config file. */
  showsOf: Map<string, LinkedShow[]>;
  /** The device of every file of shows. */
  deviceOf: Map<string, { device: TextEntry; reason: AssignReason }>;
}

/**
 * Which files of shows belong to which configuration: by hostname, serial number or file
 * name, or by the hostname corrected by hand on the file of shows. With several versions of
 * a device, only the current one (in `current`) gets the shows.
 */
export function linkShows(files: readonly FileEntry[], current?: ReadonlySet<string>): ShowLinks {
  const texts = files.filter((f): f is TextEntry => f.type === 'text');
  const devices = texts.flatMap((entry) => {
    if (current && !current.has(entry.id) && isVersioned(entry, texts, current)) return [];
    const model = contentStore.get(entry.id)?.model;
    if (!model) return [];
    const hostname =
      effectiveDetection(entry.detection, entry.overrides).hostname.value ?? model.hostname;
    return hostname ? [{ id: entry.id, hostname }] : [];
  });
  const shows = texts.flatMap((entry) => {
    const show = contentStore.get(entry.id)?.show;
    if (!show) return [];
    const hostname = show.hostname ?? entry.detection.hostname?.value;
    return [
      {
        id: entry.id,
        ...(entry.overrides.hostname?.trim() ? { manualHostname: entry.overrides.hostname } : {}),
        ...(hostname ? { hostname } : {}),
        serials: show.state.serials,
        fileName: entry.name,
      },
    ];
  });
  const assigned = assignShows(devices, shows);
  const byId = new Map(texts.map((t) => [t.id, t]));
  const links: ShowLinks = { showsOf: new Map(), deviceOf: new Map() };
  for (const [showId, a] of assigned) {
    const show = byId.get(showId);
    const device = byId.get(a.device);
    if (!show || !device) continue;
    links.deviceOf.set(showId, { device, reason: a.reason });
    links.showsOf.set(a.device, [
      ...(links.showsOf.get(a.device) ?? []),
      { entry: show, reason: a.reason },
    ]);
  }
  return links;
}

/** The real state of a device: its files of shows put together. */
export function deviceState(shows: readonly LinkedShow[] | undefined): DeviceState | null {
  if (!shows || shows.length === 0) return null;
  const parts = shows.flatMap(({ entry }) => {
    const state = contentStore.get(entry.id)?.show?.state;
    return state ? [{ file: entry.id, state }] : [];
  });
  return parts.length > 0 ? mergeStates(parts) : null;
}

/** A configuration with the same hostname as a current one: a previous version. */
function isVersioned(
  entry: TextEntry,
  texts: readonly TextEntry[],
  current: ReadonlySet<string>,
): boolean {
  const name = effectiveDetection(entry.detection, entry.overrides).hostname.value;
  if (!name) return false;
  const key = hostKey(name);
  return texts.some((t) => {
    if (!current.has(t.id)) return false;
    const other = effectiveDetection(t.detection, t.overrides).hostname.value;
    return other !== undefined && hostKey(other) === key;
  });
}

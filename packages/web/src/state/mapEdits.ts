// The changes made by hand to the map of a client (#15, part 3), as map.json keeps them: every
// function gives a new object and leaves the one it gets as it is.

import {
  MAP_FORMAT,
  type LinkDecision,
  type ManualExternal,
  type ManualLink,
  type MapEdits,
  type MapPosition,
  type Site,
} from '@ncv/core';

export const EMPTY_EDITS: MapEdits = {};

const without = <T>(record: Record<string, T> | undefined, key: string) => {
  const out = { ...(record ?? {}) };
  delete out[key];
  return out;
};

/** The same key, whatever its case: hostnames and site names are compared this way. */
const sameKey = (record: Record<string, unknown> | undefined, key: string) =>
  Object.keys(record ?? {}).find((k) => k.toLowerCase() === key.toLowerCase());

/** An inferred link confirmed, discarded, or back as the correlation found it (null). */
export function withDecision(
  edits: MapEdits,
  linkId: string,
  decision: LinkDecision | null,
): MapEdits {
  const decisions = without(edits.decisions, linkId);
  if (decision) decisions[linkId] = decision;
  // A correction by hand that replaced the link goes with the decision.
  const links =
    decision === null
      ? (edits.links ?? []).map((l) => {
          if (l.replaces !== linkId) return l;
          const { replaces: _replaces, ...rest } = l;
          return rest;
        })
      : edits.links;
  return { ...edits, decisions, ...(links ? { links } : {}) };
}

export function withLink(edits: MapEdits, link: ManualLink): MapEdits {
  const links = edits.links ?? [];
  return {
    ...edits,
    links: links.some((l) => l.id === link.id)
      ? links.map((l) => (l.id === link.id ? link : l))
      : [...links, link],
  };
}

export function withoutLink(edits: MapEdits, id: string): MapEdits {
  return { ...edits, links: (edits.links ?? []).filter((l) => l.id !== id) };
}

export function withExternal(edits: MapEdits, external: ManualExternal): MapEdits {
  const externals = edits.externals ?? [];
  return {
    ...edits,
    externals: externals.some((e) => e.id === external.id)
      ? externals.map((e) => (e.id === external.id ? external : e))
      : [...externals, external],
  };
}

/** A node added by hand goes away with the links added to it. */
export function withoutExternal(edits: MapEdits, id: string): MapEdits {
  const touches = (l: ManualLink) =>
    ('external' in l.a && l.a.external === id) || ('external' in l.b && l.b.external === id);
  return {
    ...edits,
    externals: (edits.externals ?? []).filter((e) => e.id !== id),
    links: (edits.links ?? []).filter((l) => !touches(l)),
    positions: {
      ...edits.positions,
      externals: without(edits.positions?.externals, `manual:${id}`),
    },
  };
}

/** The site chosen for a device, or the one proposed again (null). Its position goes too. */
export function withDeviceSite(edits: MapEdits, hostname: string, site: string | null): MapEdits {
  const key = sameKey(edits.deviceSites, hostname) ?? hostname;
  const deviceSites = without(edits.deviceSites, key);
  if (site?.trim()) deviceSites[hostname] = site.trim();
  const moved = sameKey(edits.positions?.devices, hostname);
  return {
    ...edits,
    deviceSites,
    positions: {
      ...edits.positions,
      devices: moved ? without(edits.positions?.devices, moved) : (edits.positions?.devices ?? {}),
    },
  };
}

/**
 * A site renamed as a whole: the names proposed for its devices, and the devices put in it by
 * hand, take the new name. Two sites with the same name are one: this is how sites are merged.
 */
export function withSiteName(edits: MapEdits, site: Site, name: string): MapEdits {
  const next = name.trim();
  if (!next) return edits;
  const sites = { ...(edits.sites ?? {}) };
  const proposed = site.proposed ?? (site.name ? [site.name] : []);
  for (const p of proposed) {
    const key = sameKey(sites, p);
    if (key) delete sites[key];
    // Back to the name proposed: nothing to remember.
    if (p.toLowerCase() !== next.toLowerCase()) sites[p] = next;
  }
  const deviceSites = Object.fromEntries(
    Object.entries(edits.deviceSites ?? {}).map(([host, s]) => [
      host,
      s.toLowerCase() === site.name.toLowerCase() ? next : s,
    ]),
  );
  return { ...edits, sites, deviceSites };
}

export function withPosition(
  edits: MapEdits,
  kind: 'devices' | 'externals',
  key: string,
  position: MapPosition | null,
): MapEdits {
  const current = edits.positions?.[kind];
  const list = without(current, sameKey(current, key) ?? key);
  if (position) list[key] = { x: Math.round(position.x), y: Math.round(position.y) };
  return { ...edits, positions: { ...edits.positions, [kind]: list } };
}

export function withoutPositions(edits: MapEdits): MapEdits {
  const { positions: _positions, ...rest } = edits;
  return rest;
}

/** What changes the infrastructure: everything but the positions, which change only the drawing. */
export const structuralEdits = withoutPositions;

/** The changes of a tab added to those of a client: the tab wins where both say something. */
export function mergeEdits(base: MapEdits, extra: MapEdits): MapEdits {
  const byId = <T extends { id: string }>(a: T[] = [], b: T[] = []) => [
    ...a.filter((x) => !b.some((y) => y.id === x.id)),
    ...b,
  ];
  return {
    sites: { ...base.sites, ...extra.sites },
    deviceSites: { ...base.deviceSites, ...extra.deviceSites },
    externals: byId(base.externals, extra.externals),
    links: byId(base.links, extra.links),
    decisions: { ...base.decisions, ...extra.decisions },
    positions: {
      devices: { ...base.positions?.devices, ...extra.positions?.devices },
      externals: { ...base.positions?.externals, ...extra.positions?.externals },
    },
  };
}

/** The map as map.json has it: format, version and only what is there. */
export function mapFile(edits: MapEdits): MapEdits {
  const { format: _format, version: _version, updatedAt: _updatedAt, ...rest } = edits;
  const out: MapEdits = { format: MAP_FORMAT, version: 1 };
  if (Object.keys(rest.sites ?? {}).length > 0) out.sites = rest.sites!;
  if (Object.keys(rest.deviceSites ?? {}).length > 0) out.deviceSites = rest.deviceSites!;
  if ((rest.externals ?? []).length > 0) out.externals = rest.externals!;
  if ((rest.links ?? []).length > 0) out.links = rest.links!;
  if (Object.keys(rest.decisions ?? {}).length > 0) out.decisions = rest.decisions!;
  const devices = rest.positions?.devices ?? {};
  const externals = rest.positions?.externals ?? {};
  if (Object.keys(devices).length > 0 || Object.keys(externals).length > 0) {
    out.positions = {
      ...(Object.keys(devices).length > 0 ? { devices } : {}),
      ...(Object.keys(externals).length > 0 ? { externals } : {}),
    };
  }
  return out;
}

/** A new id that is not taken: letters, digits and hyphens, as map.json wants them. */
export function newId(text: string, taken: readonly string[]): string {
  const base =
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'nodo';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

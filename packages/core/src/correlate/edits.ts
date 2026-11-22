// Changes made by hand to the map of a client (#15, part 3): sites renamed, merged or chosen
// for a device, links added by hand (also towards nodes outside the client), inferred links
// confirmed or discarded, positions on the map. They are kept in map.json, in the archive of
// the client, and refer to devices and ports by hostname and interface, never by file: a new
// version of a configuration keeps them. The original files are never touched.

import { hostKey } from '../show/assign';
import type { DeviceInfo } from './devices';
import type { SiteAssignment } from './sites';
import type { ExternalNode, Link, LinkEnd, Site } from './types';

export const MAP_FORMAT = 'ncv-map';

/** Links added by hand: a cable, an aggregate, a private WAN (MPLS, point to point). */
export const MANUAL_LINK_KINDS = ['cable', 'lag', 'wan'] as const;
export type ManualLinkKind = (typeof MANUAL_LINK_KINDS)[number];

/** A side of a link added by hand: a port of a device, or a node added by hand. */
export type ManualEnd = { device: string; interface?: string } | { external: string };

export interface ManualLink {
  /** Chosen by the app: letters, digits and hyphens. */
  id: string;
  kind: ManualLinkKind;
  a: ManualEnd;
  b: ManualEnd;
  note?: string;
  /** The inferred link this one corrects: that one is discarded. */
  replaces?: string;
}

/** A node outside the client added by hand: a router of the provider, a NAS, a switch. */
export interface ManualExternal {
  id: string;
  label: string;
  detail?: string;
  /** Name of its site. */
  site?: string;
}

export interface MapPosition {
  x: number;
  y: number;
}

export type LinkDecision = 'confirmed' | 'discarded';

export interface MapEdits {
  format?: typeof MAP_FORMAT;
  version?: 1;
  updatedAt?: string;
  /** Sites renamed: the name proposed → the name chosen. Sites with the same name are one. */
  sites?: Record<string, string>;
  /** The site chosen for a device, by hostname. */
  deviceSites?: Record<string, string>;
  externals?: ManualExternal[];
  links?: ManualLink[];
  /** Inferred links confirmed or discarded, by the id of the link. */
  decisions?: Record<string, LinkDecision>;
  /**
   * Nodes moved on the map, by hostname or by the id of the external node: from the corner of
   * their site as the map lays it out, or from the middle of the map outside the sites.
   */
  positions?: {
    devices?: Record<string, MapPosition>;
    externals?: Record<string, MapPosition>;
  };
}

/** True when nothing was changed by hand. */
export function isEmptyEdits(edits: MapEdits | null | undefined): boolean {
  if (!edits) return true;
  return (
    Object.keys(edits.sites ?? {}).length === 0 &&
    Object.keys(edits.deviceSites ?? {}).length === 0 &&
    (edits.externals ?? []).length === 0 &&
    (edits.links ?? []).length === 0 &&
    Object.keys(edits.decisions ?? {}).length === 0 &&
    Object.keys(edits.positions?.devices ?? {}).length === 0 &&
    Object.keys(edits.positions?.externals ?? {}).length === 0
  );
}

/** Id of a node added by hand in the graph, and of a device of a link that is not there. */
export const manualExternalId = (id: string) => `manual:${id}`;
export const missingDeviceId = (hostname: string) => `missing:${hostKey(hostname)}`;
export const manualLinkId = (id: string) => `manual:${id}`;

function slug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'site'
  );
}

/**
 * The sites with the changes made by hand: a device in the site chosen for it, the sites renamed,
 * and sites with the same name merged. Nodes outside the client follow their site.
 */
export function editSites(
  nodes: readonly { key: string; hostname: string }[],
  auto: SiteAssignment,
  edits: MapEdits | undefined,
): SiteAssignment {
  const rename = new Map(
    Object.entries(edits?.sites ?? {}).map(([from, to]) => [from.trim().toLowerCase(), to.trim()]),
  );
  const chosen = new Map(
    Object.entries(edits?.deviceSites ?? {}).map(([host, site]) => [hostKey(host), site.trim()]),
  );
  if (rename.size === 0 && chosen.size === 0) return auto;
  const byId = new Map(auto.sites.map((s) => [s.id, s]));
  const sites = new Map<string, Site>();
  const siteOf = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const n of nodes) {
    const proposed = byId.get(auto.siteOf.get(n.key) ?? '');
    const proposedName = proposed?.name ?? '';
    const renamed = proposedName ? rename.get(proposedName.toLowerCase()) : undefined;
    const name = chosen.get(n.key) || renamed || proposedName;
    const manual = name !== proposedName;
    let id = ids.get(name.toLowerCase());
    if (!id) {
      // A site that keeps its name keeps its id, so that what refers to it still finds it.
      const base = !manual && proposed ? proposed.id : name ? slug(name) : 'no-site';
      id = base;
      for (let i = 2; [...ids.values()].includes(id); i++) id = `${base}-${i}`;
      ids.set(name.toLowerCase(), id);
      sites.set(id, {
        id,
        name,
        source: manual ? 'manual' : (proposed?.source ?? 'none'),
        devices: [],
      });
    }
    const site = sites.get(id)!;
    site.devices.push(n.key);
    if (manual) site.source = 'manual';
    siteOf.set(n.key, id);
  }
  return { sites: [...sites.values()], siteOf };
}

export interface LinkEditResult {
  links: Link[];
  externals: ExternalNode[];
  /** Inferred links discarded by hand, to be shown again on request. */
  discarded: Link[];
  /** Links added by hand towards a device that is not in the client any more. */
  orphans: { link: string; hostname: string }[];
  /** Links added by hand on an interface that the configuration does not have. */
  unknownPorts: { link: string; device: string; interface: string }[];
}

/**
 * The links with the changes made by hand: the inferred links confirmed or discarded, and the
 * links and the nodes added by hand. A link towards a device that is no longer in the client
 * stays, towards a node that says so.
 */
export function editLinks(
  links: readonly Link[],
  externals: readonly ExternalNode[],
  byKey: ReadonlyMap<string, DeviceInfo>,
  siteIdOf: (name: string | undefined) => string | undefined,
  edits: MapEdits | undefined,
): LinkEditResult {
  const decisions = { ...(edits?.decisions ?? {}) };
  for (const m of edits?.links ?? []) if (m.replaces) decisions[m.replaces] = 'discarded';
  const kept: Link[] = [];
  const discarded: Link[] = [];
  for (const link of links) {
    const decision = decisions[link.id];
    if (decision === 'discarded') {
      discarded.push(link);
    } else {
      kept.push(decision === 'confirmed' ? { ...link, confirmed: true } : link);
    }
  }

  const out = [...externals];
  for (const e of edits?.externals ?? []) {
    const site = siteIdOf(e.site);
    out.push({
      id: manualExternalId(e.id),
      kind: 'manual',
      label: e.label,
      ...(e.detail ? { detail: e.detail } : {}),
      ...(site ? { site } : {}),
    });
  }

  const orphans: LinkEditResult['orphans'] = [];
  const unknownPorts: LinkEditResult['unknownPorts'] = [];
  const known = new Set(out.map((e) => e.id));
  const end = (side: ManualEnd, link: string): LinkEnd => {
    if ('external' in side) {
      const id = manualExternalId(side.external);
      if (!known.has(id)) {
        known.add(id);
        out.push({ id, kind: 'missing', label: side.external });
      }
      return { node: id };
    }
    const device = byKey.get(hostKey(side.device));
    if (!device) {
      // Kept, and said: the device is not among the ones loaded.
      const id = missingDeviceId(side.device);
      if (!known.has(id)) {
        known.add(id);
        out.push({ id, kind: 'missing', label: side.device.trim() });
      }
      orphans.push({ link, hostname: side.device.trim() });
      return { node: id, ...(side.interface ? { interface: side.interface } : {}) };
    }
    const port = device.resolvePort(side.interface);
    if (port && !port.known) {
      unknownPorts.push({ link, device: device.key, interface: port.name });
    }
    return {
      node: device.key,
      ...(port
        ? {
            interface: port.name,
            context: device.contextOf(device.iface(port.name)),
            ...(port.known ? {} : { unknownInterface: true }),
          }
        : {}),
    };
  };
  for (const m of edits?.links ?? []) {
    const id = manualLinkId(m.id);
    const a = end(m.a, id);
    const b = end(m.b, id);
    const source = 'device' in m.a ? hostKey(m.a.device) : manualExternalId(m.a.external);
    kept.push({
      id,
      kind: m.kind,
      a,
      b,
      sources: [{ kind: 'manual', device: source, ...(m.note ? { text: m.note } : {}), evidence: [] }],
      verified: false,
      manual: true,
      ...(m.note ? { note: m.note } : {}),
    });
  }
  return { links: kept, externals: out, discarded, orphans, unknownPorts };
}

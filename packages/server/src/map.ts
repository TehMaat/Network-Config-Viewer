// The map of a client changed by hand (#15, part 3), in map.json next to client.json: sites
// renamed or chosen, nodes and links added by hand, inferred links confirmed or discarded,
// positions. It is checked field by field before it is written: what is not expected, or is too
// long, too many or not a value of the right kind, is refused. The original files of the client
// are never touched.
//
// The same shape is described for the app by MapEdits in packages/core/src/correlate/edits.ts:
// the map of the example client (samples/mappa-esempio.json) is checked by the tests of both.

import { ArchiveError } from './archive.js';

export const MAP_FORMAT = 'ncv-map';
/** Largest map.json accepted: far more than the map of a large client. */
export const MAX_MAP_BYTES = 2 * 1024 * 1024;

export const LINK_KINDS = ['cable', 'lag', 'wan'] as const;
export const DECISIONS = ['confirmed', 'discarded'] as const;

export interface MapEnd {
  device?: string;
  interface?: string;
  external?: string;
}

export interface MapFile {
  format: typeof MAP_FORMAT;
  version: 1;
  updatedAt?: string;
  sites?: Record<string, string>;
  deviceSites?: Record<string, string>;
  externals?: { id: string; label: string; detail?: string; site?: string }[];
  links?: {
    id: string;
    kind: (typeof LINK_KINDS)[number];
    a: MapEnd;
    b: MapEnd;
    note?: string;
    replaces?: string;
  }[];
  decisions?: Record<string, (typeof DECISIONS)[number]>;
  positions?: {
    devices?: Record<string, { x: number; y: number }>;
    externals?: Record<string, { x: number; y: number }>;
  };
}

const LIMITS = {
  sites: 1_000,
  deviceSites: 10_000,
  externals: 2_000,
  links: 10_000,
  decisions: 20_000,
  positions: 20_000,
  coordinate: 1_000_000,
};

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Names that would change an object instead of being a key of it. */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

const fail = (): never => {
  throw new ArchiveError(400, 'invalid-map');
};

type Plain = Record<string, unknown>;

function object(value: unknown, keys: readonly string[]): Plain {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail();
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail();
  return value as Plain;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return fail();
  const clean = value.trim();
  if (clean.length === 0 || clean.length > max || CONTROL.test(clean)) fail();
  return clean;
}

const optional = <T>(value: unknown, read: (v: unknown) => T): T | undefined =>
  value === undefined ? undefined : read(value);

function id(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) return fail();
  return value;
}

/** An object used as a map from a name to a value, with a limit on how many. */
function record<T>(
  value: unknown,
  limit: number,
  readKey: (k: string) => string,
  readValue: (v: unknown) => T,
): Record<string, T> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail();
  const entries = Object.entries(value);
  if (entries.length > limit) fail();
  return Object.fromEntries(
    entries.map(([k, v]) => {
      if (RESERVED.has(k)) fail();
      return [readKey(k), readValue(v)];
    }),
  );
}

function list<T>(value: unknown, limit: number, read: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > limit) return fail();
  return value.map(read);
}

function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail();
  if (Math.abs(value) > LIMITS.coordinate) fail();
  return Math.round(value * 10) / 10;
}

function position(value: unknown): { x: number; y: number } {
  const p = object(value, ['x', 'y']);
  return { x: coordinate(p.x), y: coordinate(p.y) };
}

function end(value: unknown): MapEnd {
  const e = object(value, ['device', 'interface', 'external']);
  if (e.external !== undefined) {
    if (e.device !== undefined || e.interface !== undefined) fail();
    return { external: id(e.external) };
  }
  const iface = optional(e.interface, (v) => text(v, 100));
  return { device: text(e.device, 100), ...(iface ? { interface: iface } : {}) };
}

function unique<T extends { id: string }>(items: T[]): T[] {
  if (new Set(items.map((i) => i.id)).size !== items.length) fail();
  return items;
}

/** A map as the app sends it, checked and cleaned; anything else is refused. */
export function cleanMap(value: unknown): MapFile {
  const m = object(value, [
    'format',
    'version',
    'updatedAt',
    'sites',
    'deviceSites',
    'externals',
    'links',
    'decisions',
    'positions',
  ]);
  if (m.format !== MAP_FORMAT || m.version !== 1) fail();
  const name = (v: unknown) => text(v, 100);
  const out: MapFile = { format: MAP_FORMAT, version: 1 };
  if (m.sites !== undefined) out.sites = record(m.sites, LIMITS.sites, name, name);
  if (m.deviceSites !== undefined) {
    out.deviceSites = record(m.deviceSites, LIMITS.deviceSites, name, name);
  }
  if (m.externals !== undefined) {
    out.externals = unique(
      list(m.externals, LIMITS.externals, (v) => {
        const e = object(v, ['id', 'label', 'detail', 'site']);
        const detail = optional(e.detail, (d) => text(d, 500));
        const site = optional(e.site, name);
        return {
          id: id(e.id),
          label: name(e.label),
          ...(detail ? { detail } : {}),
          ...(site ? { site } : {}),
        };
      }),
    );
  }
  if (m.links !== undefined) {
    out.links = unique(
      list(m.links, LIMITS.links, (v) => {
        const l = object(v, ['id', 'kind', 'a', 'b', 'note', 'replaces']);
        if (!(LINK_KINDS as readonly unknown[]).includes(l.kind)) fail();
        const note = optional(l.note, (n) => text(n, 500));
        const replaces = optional(l.replaces, (r) => text(r, 400));
        return {
          id: id(l.id),
          kind: l.kind as (typeof LINK_KINDS)[number],
          a: end(l.a),
          b: end(l.b),
          ...(note ? { note } : {}),
          ...(replaces ? { replaces } : {}),
        };
      }),
    );
  }
  if (m.decisions !== undefined) {
    out.decisions = record(
      m.decisions,
      LIMITS.decisions,
      (k) => text(k, 400),
      (v) => {
        if (!(DECISIONS as readonly unknown[]).includes(v)) fail();
        return v as (typeof DECISIONS)[number];
      },
    );
  }
  if (m.positions !== undefined) {
    const p = object(m.positions, ['devices', 'externals']);
    out.positions = {
      ...(p.devices !== undefined
        ? { devices: record(p.devices, LIMITS.positions, name, position) }
        : {}),
      ...(p.externals !== undefined
        ? { externals: record(p.externals, LIMITS.positions, (k) => text(k, 400), position) }
        : {}),
    };
  }
  return out;
}

export const EMPTY_MAP: MapFile = { format: MAP_FORMAT, version: 1 };

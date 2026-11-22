// Cables and LAGs between devices (#15): verified by the LLDP and CDP neighbours of the shows,
// inferred from the descriptions of the ports that name another device. Cables between the
// members of two port-channels become one LAG with its cables.

import type { Interface } from '../model/types';
import { portLive } from '../query/state';
import { hostKey } from '../show/assign';
import type { Neighbor } from '../show/types';
import type { AddressIndex, DeviceInfo } from './devices';
import { combineStates, configEvidence, showEvidence, type NewLink } from './links';
import type { EndState, ExternalNode, LinkSource } from './types';

interface ClaimEnd {
  device: string;
  port?: string;
  known: boolean;
}

interface Claim {
  a: ClaimEnd;
  b: ClaimEnd;
  source: LinkSource;
}

interface Side {
  device: string;
  logical?: string;
  known: boolean;
}

interface CableRecord {
  a: Side;
  b: Side;
  lag: boolean;
  cables: Map<string, { a: string; b?: string; verified: boolean }>;
  sources: LinkSource[];
}

export interface CableResult {
  links: NewLink[];
  externals: ExternalNode[];
  /** Nodes joined by a cable: they are in the same site. */
  pairs: [string, string][];
  /** Ports whose description names a device, while LLDP or CDP sees another one. */
  mismatches: DescriptionMismatch[];
}

export interface DescriptionMismatch {
  device: string;
  port: string;
  description: string;
  /** The device the description names. */
  described: string;
  /** The neighbour seen on the port, and by which protocol. */
  seen: string;
  protocol: 'lldp' | 'cdp';
  evidence: LinkSource['evidence'];
}

/** "SW-HQ-ACC1.esempio.example", "SW1(FOC1234X0AB)" → the hostname. */
function neighborName(device: string): string {
  return device.trim().replace(/\([^)]*\)$/, '');
}

/**
 * Neighbours that are network devices: bridges, switches and routers. Phones, access points and
 * stations are not drawn on the map.
 */
function networkNeighbor(n: Neighbor): boolean {
  const caps = n.capabilities?.trim();
  if (!caps) return true;
  const token = (re: string) => new RegExp(`(^|[\\s,])(${re})(?=$|[\\s,])`, 'i').test(caps);
  if (token('W|T|S|Phone|Host|WLAN|Station')) return false;
  return token('B|R|Router|Switch|Bridge');
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Something that looks like an interface name: "Gi1/0/12", "x1", "port12", "internal1". */
const INTERFACE_LIKE = /^[A-Za-z][A-Za-z-]*\d+(?:[/.:]\d+)*$/;

interface HostPattern {
  key: string;
  re: RegExp;
  length: number;
}

/** The device a description names, the longest hostname first, and the text after it. */
function namedDevice(
  description: string,
  patterns: readonly HostPattern[],
  self: string,
): { device: string; rest: string } | undefined {
  for (const p of patterns) {
    if (p.key === self) continue;
    const m = p.re.exec(description);
    if (m) return { device: p.key, rest: description.slice(m.index + m[0].length) };
  }
  return undefined;
}

function firstToken(rest: string): string | undefined {
  return rest.replace(/^[\s\-_:/.,]+/, '').split(/[\s,;()]+/)[0] || undefined;
}

/** The logical side of a port: its port-channel when it is a member. */
function logicalOf(
  info: DeviceInfo | undefined,
  port: string | undefined,
): { logical?: string; member?: string; lag: boolean } {
  if (!port) return { lag: false };
  if (!info) return { logical: port, lag: false };
  const lag = info.lagOf(port);
  if (lag && lag !== port) return { logical: lag, member: port, lag: true };
  return { logical: port, lag: lag === port };
}

const compatible = (x?: string, y?: string) =>
  x === undefined || y === undefined || x.toLowerCase() === y.toLowerCase();

export function findCables(
  devices: readonly DeviceInfo[],
  byKey: ReadonlyMap<string, DeviceInfo>,
  index: AddressIndex,
): CableResult {
  const claims: Claim[] = [];
  const externals = new Map<string, ExternalNode>();
  const mismatches: DescriptionMismatch[] = [];
  /** What LLDP and CDP see on every port: a description cannot say otherwise. */
  const seen = new Map<string, { node: string; label: string; source: LinkSource }[]>();
  const portKey = (device: string, port: string) => `${device}|${port}`.toLowerCase();

  // Neighbours seen by LLDP and CDP: verified cables.
  for (const d of devices) {
    for (const n of d.state?.neighbors ?? []) {
      const local = d.resolvePort(n.local);
      const name = neighborName(n.device);
      let target = byKey.get(hostKey(name));
      if (!target && n.ip) {
        const owner = index.owners(n.ip, d.key)[0];
        if (owner) target = byKey.get(owner.device);
      }
      if (target?.key === d.key) continue;
      const source: LinkSource = {
        kind: n.protocol,
        device: d.key,
        text: [name, n.port].filter(Boolean).join(' '),
        evidence: showEvidence(d.key, n),
      };
      const a: ClaimEnd = { device: d.key, port: local?.name, known: local?.known ?? false };
      if (local?.name) {
        const key = portKey(d.key, local.name);
        seen.set(key, [
          ...(seen.get(key) ?? []),
          {
            node: target?.key ?? `host:${hostKey(name)}`,
            label: target?.input.hostname ?? name,
            source,
          },
        ]);
      }
      if (target) {
        const port = target.resolvePort(n.port);
        claims.push({
          a,
          b: { device: target.key, port: port?.name, known: port?.known ?? false },
          source,
        });
      } else if (networkNeighbor(n)) {
        const id = `host:${hostKey(name)}`;
        if (!externals.has(id)) {
          externals.set(id, {
            id,
            kind: 'neighbor',
            label: name,
            ...(n.platform ? { detail: n.platform } : {}),
          });
        }
        claims.push({ a, b: { device: id, port: n.port, known: false }, source });
      }
    }
  }

  // Descriptions that name another device of the client, and maybe its port.
  const patterns: HostPattern[] = devices
    .map((d) => ({
      key: d.key,
      re: new RegExp(`(?:^|[^A-Za-z0-9])(${escape(d.input.hostname)})(?=$|[^A-Za-z0-9])`, 'i'),
      length: d.input.hostname.length,
    }))
    .sort((x, y) => y.length - x.length);
  for (const d of devices) {
    for (const iface of d.model.interfaces) {
      if (!iface.description || (iface.kind !== 'physical' && iface.kind !== 'lag')) continue;
      const hit = namedDevice(iface.description, patterns, d.key);
      if (!hit) continue;
      const target = byKey.get(hit.device)!;
      const description: LinkSource = {
        kind: 'description',
        device: d.key,
        text: iface.description,
        evidence: configEvidence(d.key, iface.src),
      };
      // The neighbour seen on the port wins: a description that names another device is wrong.
      const neighbours = seen.get(portKey(d.key, iface.name)) ?? [];
      if (neighbours.length > 0 && !neighbours.some((x) => x.node === target.key)) {
        const other = neighbours[0]!;
        mismatches.push({
          device: d.key,
          port: iface.name,
          description: iface.description,
          described: target.input.hostname,
          seen: other.label,
          protocol: other.source.kind === 'cdp' ? 'cdp' : 'lldp',
          evidence: [...description.evidence, ...other.source.evidence],
        });
        continue;
      }
      const token = firstToken(hit.rest);
      const port = token ? target.resolvePort(token) : undefined;
      const usable = port && (port.known || INTERFACE_LIKE.test(token ?? ''));
      claims.push({
        a: { device: d.key, port: iface.name, known: true },
        b: {
          device: target.key,
          ...(usable ? { port: port.name } : {}),
          known: usable ? port.known : false,
        },
        source: description,
      });
    }
  }

  // Claims with both ports first: the others join the cable they agree with.
  const weight = (c: Claim) => (c.a.port ? 1 : 0) + (c.b.port ? 1 : 0);
  claims.sort((x, y) => weight(y) - weight(x));
  const records = new Map<string, CableRecord[]>();
  for (const claim of claims) {
    const flip = claim.a.device > claim.b.device;
    const ca = flip ? claim.b : claim.a;
    const cb = flip ? claim.a : claim.b;
    const la = logicalOf(byKey.get(ca.device), ca.port);
    const lb = logicalOf(byKey.get(cb.device), cb.port);
    const pair = `${ca.device}|${cb.device}`;
    const list = records.get(pair) ?? [];
    records.set(pair, list);
    let best: CableRecord | undefined;
    let bestScore = -1;
    for (const r of list) {
      if (!compatible(r.a.logical, la.logical) || !compatible(r.b.logical, lb.logical)) continue;
      const score = (r.a.logical && la.logical ? 1 : 0) + (r.b.logical && lb.logical ? 1 : 0);
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    if (!best) {
      best = {
        a: { device: ca.device, known: false },
        b: { device: cb.device, known: false },
        lag: false,
        cables: new Map(),
        sources: [],
      };
      list.push(best);
    }
    // A port-channel found through one of its members is in the configuration.
    const knownA = la.member ? true : ca.known;
    const knownB = lb.member ? true : cb.known;
    if (la.logical && (!best.a.logical || (knownA && !best.a.known))) {
      best.a = { device: ca.device, logical: best.a.logical ?? la.logical, known: knownA };
    }
    if (lb.logical && (!best.b.logical || (knownB && !best.b.known))) {
      best.b = { device: cb.device, logical: best.b.logical ?? lb.logical, known: knownB };
    }
    best.lag ||= la.lag || lb.lag;
    if (la.member || lb.member) {
      const memberA = la.member ?? (la.lag ? undefined : la.logical);
      const memberB = lb.member ?? (lb.lag ? undefined : lb.logical);
      if (memberA) {
        const key = `${memberA}|${memberB ?? ''}`.toLowerCase();
        const verified = claim.source.kind === 'lldp' || claim.source.kind === 'cdp';
        const existing = best.cables.get(key);
        if (existing) existing.verified ||= verified;
        else best.cables.set(key, { a: memberA, ...(memberB ? { b: memberB } : {}), verified });
      }
    }
    best.sources.push(claim.source);
  }

  const links: NewLink[] = [];
  const pairs: [string, string][] = [];
  for (const list of records.values()) {
    for (const r of list) {
      const da = byKey.get(r.a.device);
      const db = byKey.get(r.b.device);
      const end = (side: Side, info: DeviceInfo | undefined) => ({
        node: side.device,
        ...(info ? { context: info.contextOf(info.iface(side.logical)) } : {}),
        ...(side.logical ? { interface: side.logical } : {}),
        ...(side.logical && !side.known ? { unknownInterface: true } : {}),
      });
      const cables = [...r.cables.values()].sort((x, y) => x.a.localeCompare(y.a));
      const stateA = da ? sideState(da, r.a.logical, r.lag) : undefined;
      const stateB = db ? sideState(db, r.b.logical, r.lag) : undefined;
      links.push({
        kind: r.lag ? 'lag' : 'cable',
        a: end(r.a, da),
        b: end(r.b, db),
        sources: r.sources,
        ...(r.lag ? { cables } : {}),
        ...(stateA || stateB
          ? { state: { ...(stateA ? { a: stateA } : {}), ...(stateB ? { b: stateB } : {}) } }
          : {}),
      });
      pairs.push([r.a.device, r.b.device]);
    }
  }
  return { links, externals: [...externals.values()], pairs, mismatches };
}

const UP = new Set(['connected', 'up']);
const DOWN = new Set(['notconnect', 'disabled', 'err-disabled', 'down', 'suspended', 'inactive']);

function portState(iface: Interface, info: DeviceInfo): EndState | undefined {
  const status = portLive(iface, info.state).status;
  if (!status) return undefined;
  const value = UP.has(status.status) ? 'up' : DOWN.has(status.status) ? 'down' : undefined;
  if (!value) return undefined;
  return {
    status: value,
    text: status.statusText,
    evidence: showEvidence(info.key, status),
  };
}

/** What the shows of a side say about a port, or about the members of a port-channel. */
function sideState(info: DeviceInfo, port: string | undefined, lag: boolean): EndState | undefined {
  if (!info.state) return undefined;
  const iface = info.iface(port);
  if (!iface) return undefined;
  const own = portState(iface, info);
  if (own || !lag) return own;
  const members = (iface.members ?? [])
    .map((m) => info.iface(m))
    .filter((m): m is Interface => !!m)
    .map((m) => portState(m, info))
    .filter((s): s is EndState => !!s);
  return combineStates(members);
}

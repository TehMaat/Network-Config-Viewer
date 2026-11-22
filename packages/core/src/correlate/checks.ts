// Consistency checks between the devices of a client (#15, part 2; chapter 6 of the study):
// what the two sides of a link do not agree on, what is missing between them, and what keeps
// the ADVPN shortcuts from starting. Every problem names its devices and the lines it comes
// from; a value that is only an unconfirmed default never makes an error.

import { intToIp, parsePrefix, prefixBounds } from '../model/ip';
import type {
  BgpNeighbor,
  Interface,
  IpsecPhase2,
  IpsecTunnel,
  LogicalContext,
  Switchport,
  VlanSet,
} from '../model/types';
import { vlanSetHas } from '../model/vlans';
import { policyMatchesIp } from '../query/policies';
import type { DescriptionMismatch } from './cables';
import type { DeviceInfo } from './devices';
import type { LinkEditResult } from './edits';
import type { SubnetResult } from './l3';
import { configEvidence } from './links';
import type {
  Advpn,
  Infrastructure,
  Link,
  LinkEnd,
  LinkEvidence,
  Problem,
  ProblemCode,
  Severity,
} from './types';

class Problems {
  readonly list: Problem[] = [];

  add(
    code: ProblemCode,
    severity: Severity,
    devices: string[],
    values: Record<string, string>,
    evidence: LinkEvidence[],
    options: { link?: string; key?: string; unverified?: boolean } = {},
  ): Problem {
    const id = [code, options.link ?? '', options.key ?? devices.join(',')].join('|');
    const found = this.list.find((p) => p.id === id);
    if (found) return found;
    const problem: Problem = {
      id,
      code,
      // A default that is not confirmed yet is "to be checked", never an error.
      severity: options.unverified && severity === 'error' ? 'warning' : severity,
      ...(options.unverified ? { unverified: true } : {}),
      ...(options.link ? { link: options.link } : {}),
      devices,
      values,
      evidence,
    };
    this.list.push(problem);
    return problem;
  }
}

export interface CheckInput {
  infra: Omit<Infrastructure, 'problems' | 'advpn' | 'discarded'>;
  byKey: ReadonlyMap<string, DeviceInfo>;
  mismatches: readonly DescriptionMismatch[];
  subnets: Pick<SubnetResult, 'duplicates' | 'overlaps'>;
  /** Links added by hand towards devices or ports that are not there (#15, part 3). */
  orphans?: LinkEditResult['orphans'];
  unknownPorts?: LinkEditResult['unknownPorts'];
}

export function findProblems(input: CheckInput): { problems: Problem[]; advpn: Advpn } {
  const out = new Problems();
  const { infra, byKey } = input;
  const host = (key: string) =>
    byKey.get(key)?.input.hostname ?? infra.externals.find((e) => e.id === key)?.label ?? key;
  for (const link of infra.links) {
    switch (link.kind) {
      case 'ipsec':
        checkIpsec(link, byKey, out);
        break;
      case 'bgp':
        checkBgp(link, infra.links, byKey, host, out);
        break;
      case 'cable':
      case 'lag':
        checkCable(link, byKey, out);
        break;
      case 'ospf':
        checkOspf(link, byKey, out);
        break;
      default:
        break;
    }
  }
  checkAddresses(input.subnets, host, out);
  checkRoutes(infra.links, byKey, host, out);
  for (const m of input.mismatches) {
    out.add(
      'description-mismatch',
      'warning',
      [m.device],
      {
        device: host(m.device),
        port: m.port,
        description: m.description,
        described: m.described,
        seen: m.seen,
        protocol: m.protocol.toUpperCase(),
      },
      m.evidence,
      { key: `${m.device}|${m.port}` },
    );
  }
  checkDiscovery(infra.links, byKey, out);
  // A session down over a tunnel whose sides do not agree: the tunnel is the first suspect.
  for (const p of out.list) {
    if (p.code !== 'bgp-down') continue;
    const via = infra.links.find((l) => l.id === p.link)?.via;
    if (via && out.list.some((q) => q.link === via && q.severity === 'error')) {
      p.values.viaProblem = 'yes';
    }
  }
  checkManual(input, host, out);
  const advpn = checkAdvpn(infra.links, byKey, host, out);
  const rank = { error: 0, warning: 1, info: 2 } as const;
  out.list.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id));
  return { problems: out.list, advpn };
}

// ---- Links added by hand --------------------------------------------------------------

/** A link added by hand keeps its sides: one that is not there any more is said, not removed. */
function checkManual(input: CheckInput, host: (key: string) => string, out: Problems): void {
  const label = (node: string) =>
    input.infra.externals.find((e) => e.id === node)?.label ?? host(node);
  for (const o of input.orphans ?? []) {
    const link = input.infra.links.find((l) => l.id === o.link);
    if (!link) continue;
    const other = link.a.node.startsWith('missing:') ? link.b.node : link.a.node;
    const devices = input.byKey.has(other) ? [other] : [];
    out.add(
      'manual-orphan',
      'warning',
      devices,
      { device: o.hostname, other: label(other) },
      [],
      { link: link.id, key: o.hostname.toLowerCase() },
    );
  }
  for (const u of input.unknownPorts ?? []) {
    out.add(
      'manual-interface',
      'info',
      [u.device],
      { device: host(u.device), interface: u.interface },
      [],
      { link: u.link, key: `${u.device}|${u.interface}` },
    );
  }
}

// ---- IPsec ----------------------------------------------------------------------------

function tunnelOf(d: DeviceInfo, end: LinkEnd): IpsecTunnel | undefined {
  return d.logical(end.context)?.ipsec.find((t) => t.name === end.tunnel);
}

/** "10.10.0.0 255.255.0.0", "10.10.0.0/16" or nothing (everything) → "10.10.0.0/16". */
function selector(text: string | undefined): string {
  const p = text ? parsePrefix(text) : null;
  return p ? `${intToIp(prefixBounds(p)[0])}/${p.prefix}` : '0.0.0.0/0';
}

const mirrored = (a: IpsecPhase2, b: IpsecPhase2) =>
  selector(a.srcSubnet) === selector(b.dstSubnet) &&
  selector(a.dstSubnet) === selector(b.srcSubnet);

const selectors = (list: IpsecPhase2[]) =>
  list.map((p) => `${selector(p.srcSubnet)} ↔ ${selector(p.dstSubnet)}`).join(', ');

const common = <T>(a: readonly T[], b: readonly T[]) => a.some((x) => b.includes(x));

function checkIpsec(link: Link, byKey: ReadonlyMap<string, DeviceInfo>, out: Problems): void {
  const da = byKey.get(link.a.node);
  const db = byKey.get(link.b.node);
  const ta = da ? tunnelOf(da, link.a) : undefined;
  // A peer outside the client has only one side: nothing to compare.
  if (!da || !ta || !db) return;
  const names = { a: da.input.hostname, b: db.input.hostname, tunnelA: ta.name };
  const evidence = configEvidence(da.key, ta.src);
  const tb = tunnelOf(db, link.b);
  if (!tb) {
    out.add(
      'ipsec-no-tunnel',
      'error',
      [da.key, db.key],
      {
        ...names,
        interface: link.b.interface ?? '',
        peer: ta.remoteGw ?? ta.remoteGwDdns ?? '',
      },
      evidence,
      { link: link.id },
    );
    link.comparison = { compared: 0, issues: 1 };
    return;
  }
  evidence.push(...configEvidence(db.key, tb.src));
  let compared = 0;
  let issues = 0;
  const uncertain = (
    field: string,
    pa?: { unverified?: string[] },
    pb?: { unverified?: string[] },
  ) => !!(pa ?? ta).unverified?.includes(field) || !!(pb ?? tb).unverified?.includes(field);
  const differ = (code: ProblemCode, valueA: string, valueB: string, unverified = false) => {
    issues++;
    out.add(
      code,
      'error',
      [da.key, db.key],
      { ...names, tunnelB: tb.name, valueA, valueB },
      evidence,
      {
        link: link.id,
        unverified,
      },
    );
  };

  compared++;
  if (ta.ikeVersion !== tb.ikeVersion) {
    differ('ipsec-ike', `IKEv${ta.ikeVersion}`, `IKEv${tb.ikeVersion}`, uncertain('ikeVersion'));
  }
  if (ta.ikeVersion === 1 && tb.ikeVersion === 1) {
    compared++;
    if ((ta.mode ?? 'main') !== (tb.mode ?? 'main'))
      differ('ipsec-mode', ta.mode ?? 'main', tb.mode ?? 'main');
  }
  compared++;
  if ((ta.authMethod ?? 'psk') !== (tb.authMethod ?? 'psk')) {
    differ('ipsec-auth', ta.authMethod ?? 'psk', tb.authMethod ?? 'psk');
  }
  compared++;
  if (!common(ta.proposals, tb.proposals)) {
    differ(
      'ipsec-proposals',
      ta.proposals.join(' '),
      tb.proposals.join(' '),
      uncertain('proposals'),
    );
  }
  compared++;
  if (!common(ta.dhgrp, tb.dhgrp)) {
    differ('ipsec-dhgrp', ta.dhgrp.join(' '), tb.dhgrp.join(' '), uncertain('dhgrp'));
  }
  if (ta.phase2.length > 0 && tb.phase2.length > 0) {
    compared++;
    const pairs = ta.phase2.map((pa) => [pa, tb.phase2.find((pb) => mirrored(pa, pb))] as const);
    if (pairs.some(([, pb]) => !pb))
      differ('ipsec-selectors', selectors(ta.phase2), selectors(tb.phase2));
    for (const [pa, pb] of pairs) {
      if (!pb) continue;
      compared += 2;
      if (!common(pa.proposals, pb.proposals)) {
        differ('ipsec-p2-proposals', pa.proposals.join(' '), pb.proposals.join(' '));
      }
      if (pa.pfs !== pb.pfs) {
        differ('ipsec-pfs', pa.pfs ? 'PFS' : '—', pb.pfs ? 'PFS' : '—');
      } else if (pa.pfs) {
        compared++;
        if (!common(pa.dhgrp, pb.dhgrp)) {
          differ(
            'ipsec-p2-dhgrp',
            pa.dhgrp.join(' '),
            pb.dhgrp.join(' '),
            uncertain('dhgrp', pa, pb),
          );
        }
      }
    }
  }
  if (ta.advpn || tb.advpn) {
    compared++;
    // The dial-up hub sends the shortcuts, the branch receives them.
    const ok = link.dialup && ta.advpn === 'receiver' && tb.advpn === 'sender';
    if (!ok) {
      issues++;
      out.add(
        'ipsec-advpn',
        'warning',
        [da.key, db.key],
        { ...names, tunnelB: tb.name, valueA: ta.advpn ?? '—', valueB: tb.advpn ?? '—' },
        evidence,
        { link: link.id },
      );
    }
  }
  link.comparison = { compared, issues };
}

// ---- BGP ------------------------------------------------------------------------------

function neighborOf(d: DeviceInfo, end: LinkEnd): { neighbor?: BgpNeighbor; group?: BgpNeighbor } {
  const bgp = d.logical(end.context)?.routing.bgp;
  if (!bgp) return {};
  const neighbor = end.neighbor ? bgp.neighbors.find((n) => n.address === end.neighbor) : undefined;
  const groupName = end.range?.group ?? neighbor?.group;
  const group = groupName ? bgp.groups.find((g) => g.address === groupName) : undefined;
  return { ...(neighbor ? { neighbor } : {}), ...(group ? { group } : {}) };
}

function checkBgp(
  link: Link,
  links: readonly Link[],
  byKey: ReadonlyMap<string, DeviceInfo>,
  host: (key: string) => string,
  out: Problems,
): void {
  const da = byKey.get(link.a.node);
  if (!da) return;
  const db = byKey.get(link.b.node);
  const sideA = neighborOf(da, link.a);
  const evidence = configEvidence(da.key, (sideA.neighbor ?? sideA.group)?.src ?? []);
  const sideB = db ? neighborOf(db, link.b) : {};
  if (db) evidence.push(...configEvidence(db.key, (sideB.neighbor ?? sideB.group)?.src ?? []));
  const names = { a: host(link.a.node), b: host(link.b.node), ip: link.a.neighbor ?? '' };
  const down = [link.state?.a, link.state?.b].find((s) => s?.status === 'down');
  if (down) {
    const via = link.via ? links.find((l) => l.id === link.via) : undefined;
    const viaDown = !!via && [via.state?.a?.status, via.state?.b?.status].includes('down');
    out.add(
      'bgp-down',
      'error',
      db ? [da.key, db.key] : [da.key],
      {
        ...names,
        state: down.text ?? '',
        ...(via ? { via: [via.a.tunnel, via.b.tunnel].filter(Boolean).join(' ↔ ') } : {}),
        viaDown: viaDown ? 'yes' : 'no',
      },
      [...evidence, ...down.evidence],
      { link: link.id },
    );
  }
  if (!db) return;
  if (!link.b.neighbor && !link.b.range) {
    out.add(
      'bgp-no-neighbor',
      'error',
      [db.key, da.key],
      { ...names, ip: link.a.ip ?? '' },
      evidence,
      {
        link: link.id,
      },
    );
    return;
  }
  const asA = da.logical(link.a.context)?.routing.bgp?.asn;
  const asB = db.logical(link.b.context)?.routing.bgp?.asn;
  const expectedByA = sideA.neighbor?.remoteAs ?? sideA.group?.remoteAs;
  const expectedByB = sideB.neighbor?.remoteAs ?? sideB.group?.remoteAs;
  if (expectedByA && asB && expectedByA !== asB) {
    out.add(
      'bgp-as',
      'error',
      [da.key, db.key],
      { device: names.a, peer: names.b, expected: expectedByA, actual: asB },
      evidence,
      { link: link.id, key: `${da.key}>${db.key}` },
    );
  }
  if (expectedByB && asA && expectedByB !== asA) {
    out.add(
      'bgp-as',
      'error',
      [db.key, da.key],
      { device: names.b, peer: names.a, expected: expectedByB, actual: asA },
      evidence,
      { link: link.id, key: `${db.key}>${da.key}` },
    );
  }
}

// ---- Cables, trunks and LAGs ----------------------------------------------------------

/** The side negotiates or is set to carry many VLANs tagged. */
function isTrunk(own: Switchport, other: Switchport): boolean {
  switch (own.mode) {
    case 'trunk':
    case 'general':
      return true;
    case 'dynamic-desirable':
      return ['trunk', 'dynamic-auto', 'dynamic-desirable'].includes(other.mode);
    case 'dynamic-auto':
      return ['trunk', 'dynamic-desirable'].includes(other.mode);
    default:
      return false;
  }
}

/** The VLANs of a set that are not in another one, as "10, 20-25". */
function missing(from: VlanSet | undefined, other: VlanSet | undefined): string {
  if (!from) return '';
  const out: string[] = [];
  let start = 0;
  for (let v = 1; v <= 4095; v++) {
    const only = v <= 4094 && vlanSetHas(from, v) && !vlanSetHas(other, v);
    if (only && start === 0) start = v;
    if (!only && start !== 0) {
      out.push(start === v - 1 ? String(start) : `${start}-${v - 1}`);
      start = 0;
    }
  }
  return out.join(', ');
}

/** LACP (active or passive), PAgP or static: how the members of an aggregate are set. */
function lagProtocol(d: DeviceInfo, lag: Interface): string | undefined {
  const mode = lag.members?.map((m) => d.iface(m)?.lag?.mode).find(Boolean);
  if (!mode) return undefined;
  if (d.model.os === 'cisco-sb') return mode === 'on' ? 'static' : 'lacp-active';
  if (d.model.vendor === 'fortinet') return mode === 'static' ? 'static' : `lacp-${mode}`;
  return (
    {
      active: 'lacp-active',
      passive: 'lacp-passive',
      on: 'static',
      desirable: 'pagp-active',
      auto: 'pagp-passive',
    } as Record<string, string>
  )[mode];
}

function lagCompatible(a: string, b: string): boolean {
  if (a === 'static' || b === 'static') return a === b;
  const [pa, ma] = a.split('-');
  const [pb, mb] = b.split('-');
  return pa === pb && !(ma === 'passive' && mb === 'passive');
}

/** VLAN interfaces of a FortiGate on a port, or on the hardware switch the port is in. */
function fortigateVlans(d: DeviceInfo, iface: Interface): number[] {
  const parent = d.model.interfaces.find(
    (p) => p.kind === 'hard-switch' && p.members?.includes(iface.name),
  );
  const base = parent?.name ?? iface.name;
  return d.model.interfaces
    .filter((x) => x.parent === base && x.vlanId !== undefined)
    .map((x) => x.vlanId!)
    .sort((x, y) => x - y);
}

function checkCable(link: Link, byKey: ReadonlyMap<string, DeviceInfo>, out: Problems): void {
  const da = byKey.get(link.a.node);
  const db = byKey.get(link.b.node);
  const ia = da?.iface(link.a.interface);
  const ib = db?.iface(link.b.interface);
  if (!da || !db || !ia || !ib) return;
  const names = { a: da.input.hostname, b: db.input.hostname, portA: ia.name, portB: ib.name };
  const evidence = [...configEvidence(da.key, ia.src), ...configEvidence(db.key, ib.src)];
  const devices = [da.key, db.key];
  const add = (code: ProblemCode, severity: Severity, values: Record<string, string>) =>
    out.add(code, severity, devices, { ...names, ...values }, evidence, { link: link.id });

  if (link.kind === 'lag') {
    const lagA = ia.kind === 'lag';
    const lagB = ib.kind === 'lag';
    if (lagA !== lagB) {
      add('lag-one-side', 'error', {
        lag: lagA ? names.a : names.b,
        single: lagA ? names.b : names.a,
      });
    } else if (lagA && lagB) {
      const pa = lagProtocol(da, ia);
      const pb = lagProtocol(db, ib);
      if (pa && pb && !lagCompatible(pa, pb)) add('lag-mode', 'error', { valueA: pa, valueB: pb });
      const ca = ia.members?.length ?? 0;
      const cb = ib.members?.length ?? 0;
      if (ca > 0 && cb > 0 && ca !== cb)
        add('lag-cables', 'warning', { valueA: String(ca), valueB: String(cb) });
    }
  }

  const sa = ia.switchport;
  const sb = ib.switchport;
  if (sa && sb && sa.mode !== 'routed' && sb.mode !== 'routed') {
    const trunkA = isTrunk(sa, sb);
    const trunkB = isTrunk(sb, sa);
    if (trunkA !== trunkB || (sa.mode === 'dynamic-auto' && sb.mode === 'dynamic-auto')) {
      add('trunk-mode', 'error', { valueA: sa.mode, valueB: sb.mode });
    } else if (trunkA && trunkB) {
      const na = sa.nativeVlan ?? 1;
      const nb = sb.nativeVlan ?? 1;
      if (na !== nb) add('trunk-native', 'warning', { valueA: String(na), valueB: String(nb) });
      const onlyA = missing(sa.allowed, sb.allowed);
      const onlyB = missing(sb.allowed, sa.allowed);
      if (onlyA || onlyB)
        add('trunk-allowed', 'warning', { onlyA: onlyA || '—', onlyB: onlyB || '—' });
    }
  }
  // A FortiGate with VLAN interfaces on the port: the switch must carry them tagged.
  for (const [fd, fi, si, fortigateIsA] of [
    [da, ia, ib, true],
    [db, ib, ia, false],
  ] as const) {
    if (fd.model.vendor !== 'fortinet' || !si.switchport) continue;
    const absent = fortigateVlans(fd, fi).filter((v) => {
      const role = si.switchport!.mode === 'trunk' || si.switchport!.mode === 'general';
      return !role || !vlanSetHas(si.switchport!.allowed, v);
    });
    if (absent.length > 0) {
      add(
        'trunk-allowed',
        'warning',
        fortigateIsA
          ? { onlyA: absent.join(', '), onlyB: '—' }
          : { onlyA: '—', onlyB: absent.join(', ') },
      );
    }
  }

  const mtuA = ia.mtu;
  const mtuB = ib.mtu;
  if ((mtuA !== undefined || mtuB !== undefined) && (mtuA ?? 1500) !== (mtuB ?? 1500)) {
    // A side without an MTU in its configuration has the default one, and says so.
    add('mtu', 'warning', {
      valueA: String(mtuA ?? 1500),
      valueB: String(mtuB ?? 1500),
      ...(mtuA === undefined ? { defaultA: 'yes' } : {}),
      ...(mtuB === undefined ? { defaultB: 'yes' } : {}),
    });
  }
}

// ---- OSPF -----------------------------------------------------------------------------

/** "0" and "0.0.0.0" are the same area. */
const area = (text: string) => (/^\d+$/.test(text) ? intToIp(Number(text)) : text);

function ospfEntry(d: DeviceInfo, end: LinkEnd) {
  for (const ospf of d.logical(end.context)?.routing.ospf ?? []) {
    const entry = ospf.interfaces.find((i) => i.name === end.interface);
    if (entry) return entry;
  }
  return undefined;
}

function checkOspf(link: Link, byKey: ReadonlyMap<string, DeviceInfo>, out: Problems): void {
  const da = byKey.get(link.a.node);
  const db = byKey.get(link.b.node);
  if (!da || !db) return;
  const ea = ospfEntry(da, link.a);
  const eb = ospfEntry(db, link.b);
  const names = {
    a: da.input.hostname,
    b: db.input.hostname,
    portA: link.a.interface ?? '',
    portB: link.b.interface ?? '',
  };
  const evidence = [
    ...configEvidence(da.key, ea?.src ?? []),
    ...configEvidence(db.key, eb?.src ?? []),
  ];
  if (link.a.area && link.b.area && area(link.a.area) !== area(link.b.area)) {
    out.add(
      'ospf-area',
      'error',
      [da.key, db.key],
      { ...names, valueA: link.a.area, valueB: link.b.area },
      evidence,
      {
        link: link.id,
      },
    );
  }
  const passive = [ea?.passive ? names.a : '', eb?.passive ? names.b : ''].filter(Boolean);
  if (passive.length > 0) {
    out.add(
      'ospf-passive',
      'warning',
      [da.key, db.key],
      { ...names, passive: passive.join(', ') },
      evidence,
      {
        link: link.id,
      },
    );
  }
}

// ---- Addresses and routes -------------------------------------------------------------

function checkAddresses(
  subnets: Pick<SubnetResult, 'duplicates' | 'overlaps'>,
  host: (key: string) => string,
  out: Problems,
): void {
  for (const d of subnets.duplicates) {
    out.add(
      'ip-duplicate',
      'error',
      [...new Set(d.members.map((m) => m.device))],
      { ip: d.ip, where: d.members.map((m) => `${host(m.device)} ${m.interface}`).join(', ') },
      d.members.flatMap((m) => configEvidence(m.device, m.src)),
      { key: d.ip },
    );
  }
  for (const o of subnets.overlaps) {
    out.add(
      'subnet-overlap',
      'warning',
      [...new Set(o.members.map((m) => m.device))],
      {
        subnet: o.subnet,
        where: o.members.map((m) => `${host(m.device)} ${m.interface}`).join(', '),
      },
      o.members.flatMap((m) => configEvidence(m.device, m.src)),
      { key: o.subnet },
    );
  }
}

/**
 * Networks announced in BGP that a device with a routing table from the shows should have:
 * those of its peers, and those the route reflector it talks to reflects from its other clients.
 */
function checkRoutes(
  links: readonly Link[],
  byKey: ReadonlyMap<string, DeviceInfo>,
  host: (key: string) => string,
  out: Problems,
): void {
  const sessions = links.filter(
    (l) => l.kind === 'bgp' && byKey.has(l.a.node) && byKey.has(l.b.node),
  );
  const peersOf = (key: string) =>
    sessions.flatMap((l) =>
      l.a.node === key
        ? [{ here: l.a, there: l.b }]
        : l.b.node === key
          ? [{ here: l.b, there: l.a }]
          : [],
    );
  const reflects = (rr: DeviceInfo, towards: LinkEnd) => {
    const side = neighborOf(rr, towards);
    return !!(side.neighbor?.routeReflectorClient || side.group?.routeReflectorClient);
  };
  for (const d of byKey.values()) {
    const routes = d.state?.routes ?? [];
    if (routes.length === 0) continue;
    const expected = new Map<string, { from: string; src: LinkEvidence[]; context?: string }>();
    const announce = (e: DeviceInfo, end: LinkEnd, context?: string) => {
      for (const n of e.logical(end.context)?.routing.bgp?.networks ?? []) {
        const p = parsePrefix(n.prefix);
        if (!p) continue;
        const key = `${intToIp(prefixBounds(p)[0])}/${p.prefix}`;
        if (!expected.has(key)) {
          expected.set(key, {
            from: e.key,
            src: configEvidence(e.key, n.src),
            ...(context ? { context } : {}),
          });
        }
      }
    };
    for (const { here, there } of peersOf(d.key)) {
      const e = byKey.get(there.node)!;
      announce(e, there, here.context);
      // The peer reflects to this device the networks of its other peers.
      if (reflects(e, there)) {
        for (const other of peersOf(e.key)) {
          if (other.there.node === d.key) continue;
          announce(byKey.get(other.there.node)!, other.there, here.context);
        }
      }
    }
    for (const [prefix, from] of expected) {
      if (from.from === d.key) continue;
      const have = routes.some(
        (r) =>
          (!from.context || !r.context || r.context === from.context) &&
          sameNetwork(r.prefix, prefix),
      );
      if (have) continue;
      const table = d.state?.commands.find((c) => c.id === 'get router info routing-table all');
      out.add(
        'route-missing',
        'warning',
        [d.key, from.from],
        { device: host(d.key), prefix, from: host(from.from) },
        [
          ...from.src,
          ...(table
            ? [
                {
                  device: d.key,
                  ...(table.file ? { file: table.file } : {}),
                  src: [[table.line, table.line] as const],
                },
              ]
            : []),
        ],
        { key: `${d.key}|${prefix}` },
      );
    }
  }
}

function sameNetwork(a: string, b: string): boolean {
  const pa = parsePrefix(a);
  const pb = parsePrefix(b);
  return !!pa && !!pb && pa.prefix === pb.prefix && prefixBounds(pa)[0] === prefixBounds(pb)[0];
}

// ---- LLDP and CDP ---------------------------------------------------------------------

/** LLDP or CDP can tell what is at the other end of the port. */
function discoveryOn(d: DeviceInfo, port: string | undefined): boolean {
  const iface = d.iface(port);
  const device = d.model.discovery;
  if (!device) return true;
  const ports = [iface, ...(iface?.members ?? []).map((m) => d.iface(m))].filter(
    (x): x is Interface => !!x,
  );
  const portOn = (i: Interface | undefined) => {
    const cdp = device.cdp && i?.discovery?.cdp !== false;
    const lldp =
      d.model.vendor === 'fortinet'
        ? (i?.discovery?.lldpTransmit ?? device.lldp)
        : device.lldp && i?.discovery?.lldpTransmit !== false;
    return cdp || lldp;
  };
  return ports.length === 0 ? portOn(undefined) : ports.some(portOn);
}

function checkDiscovery(
  links: readonly Link[],
  byKey: ReadonlyMap<string, DeviceInfo>,
  out: Problems,
): void {
  for (const link of links) {
    // A link confirmed or added by hand has been seen by someone: no show is needed.
    if (link.kind !== 'cable' && link.kind !== 'lag') continue;
    if (link.verified || link.confirmed || link.manual) continue;
    for (const end of [link.a, link.b]) {
      const d = byKey.get(end.node);
      if (!d || !end.interface || end.unknownInterface || discoveryOn(d, end.interface)) continue;
      const discovery = d.model.discovery;
      out.add(
        'discovery-off',
        'info',
        [d.key],
        { device: d.input.hostname, port: end.interface },
        configEvidence(d.key, d.iface(end.interface)?.src ?? []),
        {
          link: link.id,
          key: `${d.key}|${end.interface}`,
          unverified: !!discovery?.unverified?.length,
        },
      );
    }
  }
}

// ---- ADVPN ----------------------------------------------------------------------------

/** A policy interface list that takes in a tunnel: by name, by zone, by SD-WAN zone or "any". */
function takesIn(names: readonly string[], tunnel: string, ctx: LogicalContext): boolean {
  if (names.includes(tunnel) || names.includes('any')) return true;
  if (ctx.zones.some((z) => names.includes(z.name) && z.interfaces.includes(tunnel))) return true;
  const member = ctx.sdwan?.members.find((m) => m.interface === tunnel);
  return !!member?.zone && names.includes(member.zone);
}

/** A host address in a network: the one after the network address. */
function sampleAddress(prefix: string): string | undefined {
  const p = parsePrefix(prefix);
  return p ? intToIp(prefixBounds(p)[0] + (p.prefix < 31 ? 1 : 0)) : undefined;
}

function checkAdvpn(
  links: readonly Link[],
  byKey: ReadonlyMap<string, DeviceInfo>,
  host: (key: string) => string,
  out: Problems,
): Advpn {
  const advpn: Advpn = { hubs: [], spokes: [], pairs: [] };
  for (const d of byKey.values()) {
    for (const ctx of d.model.contexts) {
      const tunnels = ctx.ipsec
        .filter((t) => t.type === 'dynamic' && t.advpn === 'sender')
        .map((t) => t.name);
      if (tunnels.length > 0) advpn.hubs.push({ device: d.key, context: ctx.name, tunnels });
    }
  }
  const tunnelsToHub = links.filter(
    (l) =>
      l.kind === 'ipsec' &&
      l.dialup &&
      advpn.hubs.some((h) => h.device === l.b.node && h.context === l.b.context),
  );
  for (const l of tunnelsToHub) {
    const d = byKey.get(l.a.node);
    const t = d ? tunnelOf(d, l.a) : undefined;
    if (!d || t?.advpn !== 'receiver') continue;
    const spoke = advpn.spokes.find((s) => s.device === d.key && s.hub === l.b.node);
    if (spoke) spoke.tunnels.push(t.name);
    else advpn.spokes.push({ device: d.key, hub: l.b.node, tunnels: [t.name] });
  }

  const blockers = new Map<string, string[]>();
  const block = (device: string, problem: Problem) =>
    blockers.set(device, [...(blockers.get(device) ?? []), problem.id]);

  for (const hub of advpn.hubs) {
    const d = byKey.get(hub.device)!;
    const ctx = d.logical(hub.context)!;
    // Traffic between two branches goes through the hub until the shortcut is up.
    const intrazone = ctx.zones.some(
      (z) => z.intrazone === 'allow' && hub.tunnels.some((t) => z.interfaces.includes(t)),
    );
    const policy = ctx.policies.some(
      (p) =>
        p.enabled &&
        p.action === 'accept' &&
        hub.tunnels.some((t) => takesIn(p.srcintf, t, ctx)) &&
        hub.tunnels.some((t) => takesIn(p.dstintf, t, ctx)),
    );
    if (!intrazone && !policy) {
      block(
        hub.device,
        out.add(
          'advpn-hub-policy',
          'warning',
          [hub.device],
          { hub: host(hub.device), vdom: hub.context },
          [],
          {},
        ),
      );
    }
    // The hub reflects the routes of the branches to each other without changing their next hop.
    const bgp = ctx.routing.bgp;
    if (bgp) {
      const groups = bgp.groups.filter(
        (g) =>
          bgp.ranges.some((r) => r.group === g.address) ||
          hub.tunnels.includes(g.interface ?? '') ||
          hub.tunnels.includes(g.updateSource ?? ''),
      );
      for (const g of groups.filter((x) => x.nextHopSelf)) {
        block(
          hub.device,
          out.add(
            'advpn-next-hop',
            'warning',
            [hub.device],
            { hub: host(hub.device), group: g.address },
            configEvidence(hub.device, g.src),
            {
              key: `${hub.device}|${g.address}`,
            },
          ),
        );
      }
      if (groups.length > 0 && !groups.some((g) => g.routeReflectorClient)) {
        block(
          hub.device,
          out.add(
            'advpn-no-rr',
            'warning',
            [hub.device],
            { hub: host(hub.device) },
            groups.flatMap((g) => configEvidence(hub.device, g.src)),
            {},
          ),
        );
      }
    }
  }

  for (const spoke of advpn.spokes) {
    const d = byKey.get(spoke.device)!;
    const others = advpn.spokes.filter((s) => s.hub === spoke.hub && s.device !== spoke.device);
    const lans = others.flatMap((s) =>
      byKey
        .get(s.device)!
        .model.contexts.flatMap((c) => (c.routing.bgp?.networks ?? []).map((n) => n.prefix)),
    );
    if (lans.length === 0) continue;
    const ctx = d.model.contexts.find((c) => c.ipsec.some((t) => spoke.tunnels.includes(t.name)))!;
    const allowed = lans.some((lan) => {
      const ip = sampleAddress(lan);
      return (
        !!ip &&
        ctx.policies.some(
          (p) =>
            p.enabled &&
            p.action === 'accept' &&
            spoke.tunnels.some((t) => takesIn(p.dstintf, t, ctx)) &&
            policyMatchesIp(p, ip, ctx, d.model).destination !== null,
        )
      );
    });
    if (!allowed) {
      block(
        spoke.device,
        out.add(
          'advpn-spoke-policy',
          'warning',
          [spoke.device],
          { device: host(spoke.device), hub: host(spoke.hub) },
          [],
          {},
        ),
      );
    }
  }

  // Every pair of branches of a hub: a shortcut seen in the shows, or why not.
  const errors = (device: string) =>
    out.list
      .filter(
        (p) =>
          p.severity === 'error' &&
          p.code.startsWith('ipsec-') &&
          p.devices.includes(device) &&
          tunnelsToHub.some((l) => l.id === p.link),
      )
      .map((p) => p.id);
  const allDown = (device: string, hub: string) => {
    const own = tunnelsToHub.filter((l) => l.a.node === device && l.b.node === hub);
    return (
      own.length > 0 && own.every((l) => [l.state?.a?.status, l.state?.b?.status].includes('down'))
    );
  };
  for (const hub of [...new Set(advpn.spokes.map((s) => s.hub))]) {
    const spokes = advpn.spokes
      .filter((s) => s.hub === hub)
      .map((s) => s.device)
      .sort();
    for (let i = 0; i < spokes.length; i++) {
      for (let j = i + 1; j < spokes.length; j++) {
        const a = spokes[i]!;
        const b = spokes[j]!;
        const active = links.some(
          (l) =>
            l.kind === 'shortcut' &&
            ((l.a.node === a && l.b.node === b) || (l.a.node === b && l.b.node === a)),
        );
        const reasons = active
          ? []
          : [
              ...(blockers.get(hub) ?? []),
              ...(blockers.get(a) ?? []),
              ...(blockers.get(b) ?? []),
              ...(allDown(a, hub) ? errors(a) : []),
              ...(allDown(b, hub) ? errors(b) : []),
            ];
        const down = !active && (allDown(a, hub) || allDown(b, hub));
        advpn.pairs.push({
          a,
          b,
          hub,
          status: active ? 'active' : reasons.length > 0 || down ? 'impossible' : 'possible',
          reasons: [...new Set(reasons)],
        });
      }
    }
  }
  return advpn;
}

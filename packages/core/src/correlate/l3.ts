// Layer 3 links (#15): subnets shared by two devices, or segments shared by more; the exits to
// the Internet; OSPF adjacencies between interfaces of two devices in the same subnet.

import { ipToInt, isIpv4, prefixContains } from '../model/ip';
import type { Interface } from '../model/types';
import { isPrivate, subnetKey, type AddressIndex, type DeviceInfo } from './devices';
import { configEvidence, type NewLink } from './links';
import { INTERNET, type ExternalNode } from './types';

interface Member {
  device: DeviceInfo;
  iface: Interface;
  ip: string;
  prefix: number;
}

/** Interfaces whose subnet can be shared with another device: tunnels and links inside the device are not. */
const SHARED_KINDS = new Set<Interface['kind']>([
  'physical',
  'lag',
  'svi',
  'subinterface',
  'hard-switch',
  'management',
  'virtual',
  'other',
]);

export interface SubnetResult {
  links: NewLink[];
  externals: ExternalNode[];
}

/**
 * Subnets of more than one device. Two devices make an L3 link, more devices a segment. The
 * same subnet in two sites is an overlap of addresses (part 2), not a link, unless it is a
 * point-to-point network (/30, /31) between two sites.
 */
export function findSubnets(
  devices: readonly DeviceInfo[],
  siteOf: ReadonlyMap<string, string>,
): SubnetResult {
  const groups = new Map<string, Member[]>();
  for (const d of devices) {
    for (const iface of d.model.interfaces) {
      if (!SHARED_KINDS.has(iface.kind)) continue;
      for (const a of iface.ipv4) {
        if (!isIpv4(a.ip) || a.prefix >= 32 || a.prefix < 8) continue;
        const key = subnetKey(a.ip, a.prefix);
        const list = groups.get(key) ?? [];
        list.push({ device: d, iface, ip: a.ip, prefix: a.prefix });
        groups.set(key, list);
      }
    }
  }
  const links: NewLink[] = [];
  const externals: ExternalNode[] = [];
  for (const [subnet, members] of groups) {
    const devicesIn = new Set(members.map((m) => m.device.key));
    if (devicesIn.size < 2) continue;
    // The same address on two devices is a duplicate (part 2): no link from it.
    const ips = new Map<string, string>();
    let duplicate = false;
    for (const m of members) {
      const other = ips.get(m.ip);
      if (other && other !== m.device.key) duplicate = true;
      ips.set(m.ip, m.device.key);
    }
    if (duplicate) continue;
    const sites = new Set([...devicesIn].map((k) => siteOf.get(k) ?? ''));
    const prefix = members[0]!.prefix;
    if (sites.size > 1 && prefix < 30) continue;
    const end = (m: Member) => ({
      node: m.device.key,
      context: m.device.contextOf(m.iface),
      interface: m.iface.name,
      ip: m.ip,
    });
    const source = (m: Member) => ({
      kind: 'subnet' as const,
      device: m.device.key,
      text: `${m.ip}/${m.prefix}`,
      evidence: configEvidence(m.device.key, m.iface.src),
    });
    if (devicesIn.size === 2) {
      const first = members[0]!;
      const second = members.find((m) => m.device.key !== first.device.key)!;
      links.push({
        kind: 'subnet',
        a: end(first),
        b: end(second),
        subnet,
        sources: [source(first), source(second)],
      });
      continue;
    }
    const id = `net:${subnet}`;
    externals.push({
      id,
      kind: 'segment',
      label: subnet,
      ...(sites.size === 1 && [...sites][0] ? { site: [...sites][0]! } : {}),
    });
    for (const m of members) {
      links.push({
        kind: 'subnet',
        a: end(m),
        b: { node: id },
        subnet,
        sources: [source(m)],
      });
    }
  }
  return { links, externals };
}

/**
 * Exits to the Internet: FortiOS interfaces with the WAN role or in an SD-WAN underlay zone;
 * on the others, the interface of a default route towards a public next hop outside the client.
 */
export function findInternet(devices: readonly DeviceInfo[], index: AddressIndex): NewLink[] {
  const links: NewLink[] = [];
  for (const d of devices) {
    const wan = new Map<
      string,
      { gateway?: string; evidence: ReturnType<typeof configEvidence> }
    >();
    const add = (name: string | undefined, gateway?: string, src: Interface['src'] = []) => {
      const iface = d.iface(name);
      if (!iface || iface.kind === 'tunnel') return;
      const entry = wan.get(iface.name) ?? { evidence: configEvidence(d.key, iface.src) };
      if (gateway && !entry.gateway) entry.gateway = gateway;
      entry.evidence.push(...configEvidence(d.key, src));
      wan.set(iface.name, entry);
    };
    for (const iface of d.model.interfaces) if (iface.role === 'wan') add(iface.name);
    for (const ctx of d.model.contexts) {
      for (const m of ctx.sdwan?.members ?? []) {
        const iface = d.iface(m.interface);
        if (iface && iface.kind !== 'tunnel') add(m.interface, m.gateway, m.src);
      }
      for (const r of ctx.routing.statics) {
        if (r.dst.prefix !== 0 || !r.enabled || r.blackhole) continue;
        const gw = r.gateway;
        // A next hop inside the client is not the Internet.
        if (gw && index.owners(gw).length > 0) continue;
        const known = r.device ? d.iface(r.device) : undefined;
        if (known && wan.has(known.name)) {
          add(known.name, gw, r.src);
          continue;
        }
        if (!gw || isPrivate(gw)) continue;
        const via = known ?? ifaceFor(d, gw);
        if (via) add(via.name, gw, r.src);
      }
    }
    for (const [name, entry] of wan) {
      const iface = d.iface(name)!;
      links.push({
        kind: 'internet',
        a: {
          node: d.key,
          context: d.contextOf(iface),
          interface: name,
          ...(iface.ipv4[0] ? { ip: iface.ipv4[0].ip } : {}),
        },
        b: { node: INTERNET },
        ...(entry.gateway ? { gateway: entry.gateway } : {}),
        sources: [{ kind: 'wan', device: d.key, evidence: entry.evidence }],
      });
    }
  }
  return links;
}

/** The interface whose subnet contains an address. */
function ifaceFor(d: DeviceInfo, address: string): Interface | undefined {
  const ip = ipToInt(address);
  if (ip === null) return undefined;
  return d.model.interfaces.find((i) => i.ipv4.some((a) => a.prefix < 32 && prefixContains(a, ip)));
}

/** OSPF on interfaces of two devices in the same subnet. */
export function findOspf(devices: readonly DeviceInfo[]): NewLink[] {
  interface OspfMember {
    device: DeviceInfo;
    context: string;
    iface: Interface;
    area?: string;
    src: Interface['src'];
  }
  const groups = new Map<string, OspfMember[]>();
  for (const d of devices) {
    for (const ctx of d.model.contexts) {
      for (const ospf of ctx.routing.ospf) {
        for (const oi of ospf.interfaces) {
          const iface = d.iface(oi.name);
          const a = iface?.ipv4[0];
          if (!iface || !a || a.prefix >= 32) continue;
          const key = subnetKey(a.ip, a.prefix);
          const list = groups.get(key) ?? [];
          list.push({
            device: d,
            context: ctx.name,
            iface,
            ...(oi.area ? { area: oi.area } : {}),
            src: oi.src.length > 0 ? oi.src : ospf.src,
          });
          groups.set(key, list);
        }
      }
    }
  }
  const links: NewLink[] = [];
  for (const [subnet, members] of groups) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const x = members[i]!;
        const y = members[j]!;
        if (x.device.key === y.device.key) continue;
        const end = (m: OspfMember) => ({
          node: m.device.key,
          context: m.context,
          interface: m.iface.name,
          ip: m.iface.ipv4[0]!.ip,
          ...(m.area ? { area: m.area } : {}),
        });
        links.push({
          kind: 'ospf',
          a: end(x),
          b: end(y),
          subnet,
          sources: [x, y].map((m) => ({
            kind: 'ospf' as const,
            device: m.device.key,
            text: m.area ? `area ${m.area}` : undefined,
            evidence: configEvidence(m.device.key, m.src),
          })),
        });
      }
    }
  }
  return links;
}

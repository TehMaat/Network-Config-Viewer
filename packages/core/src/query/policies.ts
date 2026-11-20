import { intToIp, ipToInt, networkOf, prefixContains, wildcardMatches } from '../model/ip';
import type {
  AddressObject,
  DeviceModel,
  FirewallPolicy,
  LogicalContext,
  ServiceObject,
  Vip,
} from '../model/types';
import type { IpMatch } from './acl';

/** An address name resolved to what it contains: objects, VIPs and the names not found. */
export interface ResolvedAddresses {
  addresses: AddressObject[];
  vips: Vip[];
  excluded: AddressObject[];
  unknown: string[];
}

/** Resolves an address, a group (with its exclusions) or a VIP of a VDOM, each group once. */
export function resolveAddress(
  name: string,
  ctx: LogicalContext,
  seen = new Set<string>(),
): ResolvedAddresses {
  const out: ResolvedAddresses = { addresses: [], vips: [], excluded: [], unknown: [] };
  if (seen.has(name)) return out;
  seen.add(name);
  const address = ctx.addresses.find((a) => a.name === name);
  if (address) {
    out.addresses.push(address);
    return out;
  }
  const vip = ctx.vips.find((v) => v.name === name);
  if (vip) {
    out.vips.push(vip);
    return out;
  }
  const group = ctx.addressGroups.find((g) => g.name === name);
  if (!group) {
    out.unknown.push(name);
    return out;
  }
  for (const member of group.members) {
    const r = resolveAddress(member, ctx, seen);
    out.addresses.push(...r.addresses);
    out.vips.push(...r.vips);
    out.excluded.push(...r.excluded);
    out.unknown.push(...r.unknown);
  }
  for (const member of group.exclude) {
    out.excluded.push(...resolveAddress(member, ctx, new Set()).addresses);
  }
  return out;
}

function inRange(start: string, end: string, ip: number): boolean {
  const a = ipToInt(start);
  const b = ipToInt(end);
  return a !== null && b !== null && ip >= a && ip <= b;
}

/** How an address object contains an IP. FQDN, geography and dynamic objects cannot tell. */
export function addressObjectMatchesIp(
  address: AddressObject,
  ip: number,
  model?: DeviceModel,
): IpMatch | null {
  if (address.subnet) {
    if (address.subnet.prefix === 0) return 'any';
    if (address.subnet.prefix === 32) return ipToInt(address.subnet.ip) === ip ? 'host' : null;
    return prefixContains(address.subnet, ip) ? 'subnet' : null;
  }
  if (address.range) return inRange(address.range.start, address.range.end, ip) ? 'subnet' : null;
  if (address.wildcard) {
    // FortiOS writes the bits to match as 1, like a netmask: Cisco wildcards are the inverse.
    const mask = ipToInt(address.wildcard.wildcard);
    if (mask === null) return null;
    return wildcardMatches(address.wildcard.ip, intToIp(0xffffffff - mask), ip) ? 'subnet' : null;
  }
  if (address.type === 'interface-subnet' && address.interface && model) {
    const iface = model.interfaces.find((i) => i.name === address.interface);
    return iface?.ipv4.some((a) => prefixContains(networkOf(a), ip)) ? 'subnet' : null;
  }
  return null;
}

/** A VIP contains its external address and the addresses it maps to. */
export function vipMatchesIp(vip: Vip, ip: number): boolean {
  const values = [...(vip.extip ? [vip.extip] : []), ...vip.mappedip];
  return values.some((v) => {
    const [start, end] = v.split('-');
    return end ? inRange(start!, end, ip) : ipToInt(start!) === ip;
  });
}

/** Whether a list of address names (srcaddr, dstaddr) contains an IP, and how. */
export function addressesMatchIp(
  names: readonly string[],
  ip: number,
  ctx: LogicalContext,
  model?: DeviceModel,
): IpMatch | null {
  let best: IpMatch | null = null;
  const rank = (m: IpMatch) => ({ host: 4, subnet: 3, group: 2, vip: 2, any: 1, negated: 0 })[m];
  for (const name of names) {
    const group = ctx.addressGroups.some((g) => g.name === name);
    const resolved = resolveAddress(name, ctx);
    let match: IpMatch | null = null;
    if (resolved.excluded.some((a) => addressObjectMatchesIp(a, ip, model) !== null)) continue;
    for (const a of resolved.addresses) {
      const m = addressObjectMatchesIp(a, ip, model);
      if (m && (match === null || rank(m) > rank(match))) match = m;
    }
    if (resolved.vips.some((v) => vipMatchesIp(v, ip))) match = 'vip';
    if (match && group && match !== 'any') match = 'group';
    if (match && (best === null || rank(match) > rank(best))) best = match;
  }
  return best;
}

/** Which side of a policy contains an IP, taking "negate" into account. */
export function policyMatchesIp(
  policy: FirewallPolicy,
  ip: string,
  ctx: LogicalContext,
  model?: DeviceModel,
): { source: IpMatch | null; destination: IpMatch | null } {
  const value = ipToInt(ip.trim());
  if (value === null) return { source: null, destination: null };
  const side = (names: string[], negate: boolean): IpMatch | null => {
    const m = addressesMatchIp(names, value, ctx, model);
    if (!negate) return m;
    return m === null ? 'negated' : null;
  };
  return {
    source: side(policy.srcaddr, policy.srcaddrNegate),
    destination: side(policy.dstaddr, policy.dstaddrNegate),
  };
}

/** The services of a name, through the service groups, each group once. */
export function resolveService(
  name: string,
  ctx: LogicalContext,
  seen = new Set<string>(),
): ServiceObject[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const service = ctx.services.find((s) => s.name === name);
  if (service) return [service];
  const group = ctx.serviceGroups.find((g) => g.name === name);
  return group ? group.members.flatMap((m) => resolveService(m, ctx, seen)) : [];
}

/** "tcp/443", "udp/53", "icmp/8", "ip/50", "all": the ports of a service, for the views. */
export function serviceText(service: ServiceObject): string[] {
  const ports = (proto: string, list: ServiceObject['tcp']) =>
    list.map(
      (p) =>
        `${proto}/${p.dst.low === p.dst.high ? p.dst.low : `${p.dst.low}-${p.dst.high}`}${p.src ? `:${p.src.low}-${p.src.high}` : ''}`,
    );
  switch (service.protocol) {
    case 'ICMP':
    case 'ICMP6': {
      const proto = service.protocol.toLowerCase();
      return [service.icmpType !== undefined ? `${proto}/${service.icmpType}` : proto];
    }
    case 'IP':
      return [service.protocolNumber ? `ip/${service.protocolNumber}` : 'all'];
    default:
      return [
        ...ports('tcp', service.tcp),
        ...ports('udp', service.udp),
        ...ports('sctp', service.sctp),
      ];
  }
}

/** Where every object of a VDOM is used: policies, groups, SD-WAN rules, other objects. */
export interface ObjectUse {
  kind: 'policy' | 'address-group' | 'service-group' | 'sdwan-rule' | 'zone' | 'static-route';
  name: string;
  /** Policy ID, rule ID, or the name of the group. */
  id: string;
}

export function objectUsage(ctx: LogicalContext): Map<string, ObjectUse[]> {
  const out = new Map<string, ObjectUse[]>();
  const add = (name: string, use: ObjectUse) => {
    const list = out.get(name);
    if (list) list.push(use);
    else out.set(name, [use]);
  };
  for (const p of ctx.policies) {
    const use: ObjectUse = { kind: 'policy', name: p.name ?? '', id: String(p.id) };
    for (const name of new Set([
      ...p.srcaddr,
      ...p.dstaddr,
      ...p.service,
      ...p.srcintf,
      ...p.dstintf,
      ...p.poolname,
    ])) {
      add(name, use);
    }
  }
  for (const g of ctx.addressGroups) {
    for (const m of [...g.members, ...g.exclude])
      add(m, { kind: 'address-group', name: g.name, id: g.name });
  }
  for (const g of ctx.serviceGroups) {
    for (const m of g.members) add(m, { kind: 'service-group', name: g.name, id: g.name });
  }
  for (const z of ctx.zones) {
    for (const m of z.interfaces) add(m, { kind: 'zone', name: z.name, id: z.name });
  }
  for (const r of ctx.sdwan?.rules ?? []) {
    for (const m of new Set([...r.srcaddr, ...r.dstaddr])) {
      add(m, { kind: 'sdwan-rule', name: r.name ?? '', id: String(r.id) });
    }
  }
  return out;
}

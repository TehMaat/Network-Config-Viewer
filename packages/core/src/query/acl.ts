import { ipToInt, prefixContains, wildcardMatches } from '../model/ip';
import type { AclEntry, AddressMatch, ObjectGroup, ObjectGroupEntry } from '../model/types';

/** How an address matched an IP: through "any", exactly, through a subnet or through a group. */
export type IpMatch = 'any' | 'host' | 'subnet' | 'group';

/** The entries of an object group with the nested groups resolved (each group once). */
export function expandObjectGroup(
  name: string,
  groups: readonly ObjectGroup[],
  seen = new Set<string>(),
): ObjectGroupEntry[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const group = groups.find((g) => g.name === name);
  if (!group) return [];
  const out: ObjectGroupEntry[] = [];
  for (const entry of group.entries) {
    if (entry.kind === 'group') out.push(...expandObjectGroup(entry.name, groups, seen));
    else out.push(entry);
  }
  return out;
}

function groupEntryMatches(entry: ObjectGroupEntry, ip: number): boolean {
  switch (entry.kind) {
    case 'host':
      return ipToInt(entry.ip) === ip;
    case 'subnet':
      return prefixContains(entry, ip);
    case 'range': {
      const from = ipToInt(entry.from);
      const to = ipToInt(entry.to);
      return from !== null && to !== null && ip >= from && ip <= to;
    }
    default:
      return false;
  }
}

/** Whether an address of an ACL entry contains the IP, and how. */
export function addressMatchesIp(
  match: AddressMatch | undefined,
  ip: number,
  groups: readonly ObjectGroup[],
): IpMatch | null {
  if (!match) return null;
  switch (match.kind) {
    case 'any':
      return 'any';
    case 'host':
      return ipToInt(match.ip) === ip ? 'host' : null;
    case 'wildcard':
      if (match.wildcard === '0.0.0.0') return ipToInt(match.ip) === ip ? 'host' : null;
      return wildcardMatches(match.ip, match.wildcard, ip) ? 'subnet' : null;
    case 'subnet':
      if (match.prefix === 32) return ipToInt(match.ip) === ip ? 'host' : null;
      return prefixContains(match, ip) ? 'subnet' : null;
    case 'object-group':
      return expandObjectGroup(match.name, groups).some((e) => groupEntryMatches(e, ip))
        ? 'group'
        : null;
    case 'other':
      return null;
  }
}

/** Which side of an ACL entry contains the IP. Remarks never match. */
export function aclEntryMatchesIp(
  entry: AclEntry,
  ip: string,
  groups: readonly ObjectGroup[],
): { source: IpMatch | null; destination: IpMatch | null } {
  const value = ipToInt(ip.trim());
  if (value === null || entry.action === 'remark') return { source: null, destination: null };
  return {
    source: addressMatchesIp(entry.source, value, groups),
    destination: addressMatchesIp(entry.destination, value, groups),
  };
}

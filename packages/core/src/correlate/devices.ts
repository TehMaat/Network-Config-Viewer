// What the correlation needs to know about every device, indexed once: interfaces by name,
// members of aggregates and hardware switches, and who owns every IP address.

import { ipToInt, isIpv4, networkOf, parsePrefix, prefixContains } from '../model/ip';
import { normalizeInterfaceName } from '../model/names';
import type { Interface, LogicalContext } from '../model/types';
import { hostKey } from '../show/assign';
import type { CorrelationInput } from './types';

export class DeviceInfo {
  readonly key: string;
  readonly cisco: boolean;
  private readonly byName = new Map<string, Interface>();
  private readonly byLower = new Map<string, Interface>();
  /** Members of aggregates and hardware switches, in lower case, with their parent. */
  private readonly parents = new Map<string, Interface>();

  constructor(readonly input: CorrelationInput) {
    this.key = hostKey(input.hostname);
    this.cisco = input.model.vendor === 'cisco';
    for (const iface of input.model.interfaces) {
      this.byName.set(iface.name, iface);
      this.byLower.set(iface.name.toLowerCase(), iface);
      for (const member of iface.members ?? []) this.parents.set(member.toLowerCase(), iface);
    }
  }

  get model() {
    return this.input.model;
  }

  get state() {
    return this.input.state ?? null;
  }

  /** The logical context of an interface: its VDOM, or the only context of a switch. */
  contextOf(iface: Interface | undefined): string {
    return iface?.context ?? this.model.contexts[0]?.name ?? 'default';
  }

  logical(name: string | undefined): LogicalContext | undefined {
    return this.model.contexts.find((c) => c.name === name) ?? this.model.contexts[0];
  }

  iface(name: string | undefined): Interface | undefined {
    if (!name) return undefined;
    return this.byName.get(name) ?? this.byLower.get(name.toLowerCase());
  }

  /**
   * An interface as a description or a neighbour writes it: "Te1/1/2", "x1", "internal1".
   * Cisco names are written in full; members of a hardware switch keep their own name.
   */
  resolvePort(text: string | undefined): { name: string; known: boolean } | undefined {
    const raw = text?.trim();
    if (!raw) return undefined;
    const exact = this.iface(raw);
    if (exact) return { name: exact.name, known: true };
    if (this.cisco) {
      const full = this.byName.get(normalizeInterfaceName(raw));
      if (full) return { name: full.name, known: true };
    }
    if (this.parents.has(raw.toLowerCase())) return { name: raw, known: true };
    return { name: this.cisco ? normalizeInterfaceName(raw) : raw, known: false };
  }

  /** The aggregate (port-channel) a port belongs to, or the port itself when it is one. */
  lagOf(port: string | undefined): string | undefined {
    const iface = this.iface(port);
    if (!iface) return undefined;
    if (iface.kind === 'lag') return iface.name;
    return iface.lag?.group;
  }

  isLag(port: string | undefined): boolean {
    return this.iface(port)?.kind === 'lag';
  }

  /** First address of an interface. */
  ipOf(name: string | undefined): string | undefined {
    return this.iface(name)?.ipv4[0]?.ip;
  }

  /** Every address of the device in a context, for matching BGP peers and ranges. */
  addresses(context?: string): string[] {
    return this.model.interfaces
      .filter((i) => !context || this.contextOf(i) === context)
      .flatMap((i) => i.ipv4.map((a) => a.ip));
  }

  /**
   * The local address of a session towards a peer: the update source, or the interface whose
   * subnet (or the remote subnet of a tunnel) contains the peer.
   */
  localAddressTowards(peer: string, context: string, updateSource?: string): string | undefined {
    const source = this.iface(updateSource);
    if (source?.ipv4[0]) return source.ipv4[0].ip;
    const ip = ipToInt(peer);
    if (ip === null) return undefined;
    for (const iface of this.model.interfaces) {
      if (this.contextOf(iface) !== context) continue;
      for (const a of iface.ipv4) {
        if (a.prefix < 32 && prefixContains(a, ip)) return a.ip;
      }
      if (iface.remoteIp && iface.ipv4[0] && prefixContains(iface.remoteIp, ip)) {
        return iface.ipv4[0].ip;
      }
    }
    return undefined;
  }

  /** The interface that has an address. */
  ifaceWithAddress(address: string | undefined): Interface | undefined {
    if (!address) return undefined;
    return this.model.interfaces.find((i) => i.ipv4.some((a) => a.ip === address));
  }
}

/** An address of an interface of a device. */
export interface OwnedAddress {
  device: string;
  context: string;
  iface: Interface;
  ip: string;
  prefix: number;
}

/** Who owns every IP address of the client. */
export class AddressIndex {
  private readonly byIp = new Map<string, OwnedAddress[]>();

  constructor(devices: readonly DeviceInfo[]) {
    for (const d of devices) {
      for (const iface of d.model.interfaces) {
        for (const a of iface.ipv4) {
          if (!isIpv4(a.ip) || a.ip === '0.0.0.0') continue;
          const owned = { device: d.key, context: d.contextOf(iface), iface, ...a };
          const list = this.byIp.get(a.ip);
          if (list) list.push(owned);
          else this.byIp.set(a.ip, [owned]);
        }
      }
    }
  }

  owners(ip: string | undefined, except?: string): OwnedAddress[] {
    if (!ip) return [];
    return (this.byIp.get(ip) ?? []).filter((o) => o.device !== except);
  }
}

/** "10.10.254.1/29" → "10.10.254.0/29". */
export function subnetKey(ip: string, prefix: number): string {
  const net = networkOf({ ip, prefix });
  return `${net.ip}/${net.prefix}`;
}

/** True when a prefix written as text ("10.255.1.0/24") contains an address. */
export function prefixHas(prefix: string, address: string | undefined): boolean {
  const p = parsePrefix(prefix);
  const ip = address ? ipToInt(address) : null;
  return p !== null && ip !== null && prefixContains(p, ip);
}

/** Private, shared and link-local addresses: a next hop there is not the Internet. */
export function isPrivate(address: string): boolean {
  const ip = ipToInt(address);
  if (ip === null) return false;
  const inside = (net: string, prefix: number) => prefixContains({ ip: net, prefix }, ip);
  return (
    inside('10.0.0.0', 8) ||
    inside('172.16.0.0', 12) ||
    inside('192.168.0.0', 16) ||
    inside('100.64.0.0', 10) ||
    inside('169.254.0.0', 16) ||
    inside('127.0.0.0', 8)
  );
}

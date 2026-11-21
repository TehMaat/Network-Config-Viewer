// The real state from the shows, put beside the model of the config, port by port.
// MAC addresses follow the rules decided in #6.

import { normalizeInterfaceName } from '../model/names';
import type { DeviceModel, Interface } from '../model/types';
import type { DeviceState, MacEntry, MacType, Neighbor, PoeState, PortState } from '../show/types';

/** A port with a configuration of its own: description, explicit mode, address or LAG. */
export function isConfiguredPort(iface: Interface): boolean {
  if (iface.description || iface.ipv4.length > 0 || iface.lag) return true;
  return !!iface.switchport && !(iface.defaults ?? []).includes('switchport.mode');
}

/**
 * Ports whose devices the MAC table shows (#6): configured physical ports and port-channels,
 * not shut down. SVIs, loopbacks and routed ports learn no MACs; members of a port-channel
 * have theirs on the port-channel.
 */
export function expectsMacs(iface: Interface): boolean {
  return (
    (iface.kind === 'physical' || iface.kind === 'lag') &&
    iface.switchport?.mode !== 'routed' &&
    !iface.lag &&
    !iface.shutdown &&
    isConfiguredPort(iface)
  );
}

export interface PortLive {
  status?: PortState;
  /** MACs learned on the port, with the sticky ones of the config marked as such. */
  macs: MacEntry[];
  /** Member of a port-channel: the MACs are on the port-channel. */
  macsOn?: string;
  neighbors: Neighbor[];
  poe?: PoeState;
  /** Flags of the port-channel, or of the member in its port-channel ("P" bundled, "D" down). */
  channelFlags?: string;
  /** Configured, not shut down, and no MAC learned while the MAC table was taken. */
  noMac: boolean;
}

export const hasMacTable = (state: DeviceState | null | undefined): boolean =>
  !!state?.commands.some((c) => c.id === 'show mac address-table');

/** Everything the shows say about one port of a switch or one interface of a firewall. */
export function portLive(iface: Interface, state: DeviceState | null | undefined): PortLive {
  const live: PortLive = { macs: [], neighbors: [], noMac: false };
  if (!state) return live;
  const name = iface.name;
  const same = (n: string) => normalizeInterfaceName(n) === name;
  const status = state.ports.find((p) => same(p.name));
  if (status) live.status = status;
  const sticky = new Set(
    (iface.portSecurity?.macs ?? []).filter((m) => m.sticky).map((m) => m.mac),
  );
  live.macs = state.macs
    .filter((m) => same(m.port))
    .map((m) => (sticky.has(m.mac) ? { ...m, type: 'sticky' as MacType } : m));
  if (iface.lag) live.macsOn = iface.lag.group;
  live.neighbors = state.neighbors.filter((n) => same(n.local));
  const poe = state.poe.find((p) => same(p.port));
  if (poe) live.poe = poe;
  const channel = state.etherchannels.find((e) => same(e.name));
  if (channel) live.channelFlags = channel.flags;
  else {
    for (const e of state.etherchannels) {
      const member = e.members.find((m) => same(m.name));
      if (member) live.channelFlags = member.flags;
    }
  }
  live.noMac = hasMacTable(state) && expectsMacs(iface) && live.macs.length === 0;
  return live;
}

/** VLAN names that only the shows know: VTP server or client keeps them out of the config. */
export function vlanNameFromState(
  id: number,
  state: DeviceState | null | undefined,
): string | undefined {
  return state?.vlans.find((v) => v.id === id)?.name;
}

/** Ports of a switch that are configured, not shut down, and have no MAC (#6), for the summary. */
export function portsWithoutMac(
  model: DeviceModel,
  state: DeviceState | null | undefined,
): string[] {
  if (!hasMacTable(state)) return [];
  return model.interfaces.filter((i) => portLive(i, state).noMac).map((i) => i.name);
}

/** The real state of a FortiGate tunnel: dial-up tunnels have one instance per peer. */
export function tunnelLive(name: string, state: DeviceState | null | undefined, context?: string) {
  const instances = (state?.tunnels ?? []).filter(
    (t) => t.name === name && (!context || !t.context || t.context === context),
  );
  return {
    instances,
    up: instances.filter((t) => t.selectorsUp > 0).length,
    down: instances.filter((t) => t.selectorsTotal > 0 && t.selectorsUp === 0).length,
  };
}

/** The state of a BGP neighbour, by its address, in the given VDOM. */
export function bgpPeerLive(
  address: string,
  state: DeviceState | null | undefined,
  context?: string,
) {
  return (state?.bgp ?? []).find(
    (p) => p.neighbor === address && (!context || !p.context || p.context === context),
  );
}

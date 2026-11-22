// Real state of a device, read from the output of show commands (chapter 3 of the study).
// It sits beside the neutral model of the config: the config says how the device should
// work, the shows say how it was working when they were taken.

import type { Src } from '../model/types';

/**
 * A value read from a show: its lines in the show file and, once the shows of a device are
 * put together, the file they come from.
 */
export interface StateItem {
  src: Src;
  file?: string;
}

/** The commands the readers understand, in their canonical form. */
export type ShowCommandId =
  | 'show version'
  | 'show inventory'
  | 'show interfaces status'
  | 'show vlan brief'
  | 'show vlan'
  | 'show etherchannel summary'
  | 'show cdp neighbors detail'
  | 'show lldp neighbors detail'
  | 'show lldp neighbors'
  | 'show mac address-table'
  | 'show ip arp'
  | 'show arp'
  | 'show power inline'
  | 'get system status'
  | 'get system interface physical'
  | 'get vpn ipsec tunnel summary'
  | 'diagnose vpn ike gateway list'
  | 'get router info routing-table all'
  | 'get router info bgp summary'
  | 'diagnose sys sdwan health-check'
  | 'diagnose sys sdwan service'
  | 'execute switch-controller get-conn-status'
  | 'diagnose switch-controller switch-info mac-table';

/** One command of a file, with the lines of its output. */
export interface ShowOutput {
  /** As typed after the prompt, or as recognised from the output. */
  command: string;
  /** Canonical form when a reader knows the command. */
  id?: ShowCommandId;
  /** The command was typed after a prompt (false: recognised from the shape of the output). */
  typed: boolean;
  hostname?: string;
  /** FortiOS: the VDOM in the prompt ("FGT (OFFICE) # ..."). */
  context?: string;
  /** 1-based line of the prompt, or of the first line of the output. */
  line: number;
  /** 1-based first and last line of the output, prompt excluded. */
  from: number;
  to: number;
  /** A reader took data from this output. */
  read: boolean;
}

export type PortStatus =
  | 'connected'
  | 'notconnect'
  | 'disabled'
  | 'err-disabled'
  | 'inactive'
  | 'monitoring'
  | 'suspended'
  | 'up'
  | 'down'
  | 'not-present'
  | 'other';

export interface PortState extends StateItem {
  /** Normalized interface name (GigabitEthernet1/0/1, port1, wan1). */
  name: string;
  status: PortStatus;
  /** As shown by the device ("connected", "Up", "err-disabled"). */
  statusText: string;
  vlan?: string;
  duplex?: string;
  speed?: string;
  type?: string;
  description?: string;
}

export interface ShowVlan extends StateItem {
  id: number;
  name: string;
  status?: string;
  ports: string[];
}

export interface EtherChannel extends StateItem {
  group: number;
  name: string;
  /** Flags of the port-channel, for example "SU": layer 2, in use. */
  flags: string;
  protocol?: string;
  members: { name: string; flags: string }[];
}

export interface Neighbor extends StateItem {
  protocol: 'cdp' | 'lldp';
  /** Normalized local interface. */
  local: string;
  device: string;
  port?: string;
  ip?: string;
  platform?: string;
  description?: string;
  capabilities?: string;
}

export type MacType = 'dynamic' | 'static' | 'sticky' | 'secure' | 'other';

export interface MacEntry extends StateItem {
  /** aa:bb:cc:dd:ee:ff */
  mac: string;
  vlan?: number;
  type: MacType;
  /** Normalized interface, port-channels included. */
  port: string;
}

export interface ArpEntry extends StateItem {
  ip: string;
  mac?: string;
  interface?: string;
  age?: string;
}

export interface PoeState extends StateItem {
  port: string;
  admin?: string;
  oper: string;
  watts?: number;
  device?: string;
  class?: string;
  maxWatts?: number;
}

export interface StackUnit extends StateItem {
  member: number;
  model?: string;
  serial?: string;
  version?: string;
}

export interface TunnelState extends StateItem {
  /** Name of the phase 1; dial-up instances ("HUB_0") point to their phase 1 too. */
  name: string;
  instance: string;
  remote?: string;
  selectorsTotal: number;
  selectorsUp: number;
  rxPackets?: number;
  txPackets?: number;
  ikeVersion?: number;
  ikeEstablished?: boolean;
  context?: string;
}

export interface RouteState extends StateItem {
  /** Protocol code as shown: C, S, B, O, O IA, K... */
  code: string;
  prefix: string;
  distance?: number;
  metric?: number;
  gateway?: string;
  interface?: string;
  age?: string;
  /** The route is in use (marked with "*" or "*>" on some systems, always for FortiOS). */
  selected: boolean;
  context?: string;
}

export interface BgpPeerState extends StateItem {
  neighbor: string;
  remoteAs?: string;
  upDown?: string;
  /** "Established" when a number of prefixes is shown, otherwise the state (Active, Idle...). */
  state: string;
  prefixes?: number;
  context?: string;
}

export interface SlaState extends StateItem {
  healthCheck: string;
  seq: number;
  member: string;
  alive: boolean;
  packetLoss?: number;
  latency?: number;
  jitter?: number;
  /** Bitmap of the SLAs met: bit 0 is SLA 1. */
  slaMap?: number;
  context?: string;
}

export interface SdwanServiceState extends StateItem {
  id: number;
  members: { seq: number; interface: string; alive: boolean; selected: boolean; sla?: number }[];
  context?: string;
}

/** Everything the shows of one device say, each value with the lines it comes from. */
/** A FortiSwitch managed by the FortiGate, as the FortiGate sees it (#15, part 4). */
export interface ManagedSwitchState extends StateItem {
  serial: string;
  name?: string;
  version?: string;
  status: 'up' | 'down';
  /** "Authorized/Up", as the FortiGate shows it. */
  statusText: string;
  address?: string;
}

/** A MAC address on a port of a managed FortiSwitch. */
export interface SwitchMacEntry extends MacEntry {
  /** Serial number of the switch. */
  switch: string;
}

export interface DeviceState {
  hostname?: string;
  version?: string;
  model?: string;
  serials: string[];
  uptime?: string;
  units: StackUnit[];
  ports: PortState[];
  vlans: ShowVlan[];
  etherchannels: EtherChannel[];
  neighbors: Neighbor[];
  macs: MacEntry[];
  arp: ArpEntry[];
  poe: PoeState[];
  tunnels: TunnelState[];
  routes: RouteState[];
  bgp: BgpPeerState[];
  sla: SlaState[];
  sdwanServices: SdwanServiceState[];
  /** FortiSwitches managed by the FortiGate, and the MAC addresses on their ports. */
  managedSwitches: ManagedSwitchState[];
  switchMacs: SwitchMacEntry[];
  /**
   * The state of a FortiSwitch managed by a FortiGate, taken from the shows of the FortiGate
   * (#15, part 4): the table of the MACs of the switches is the MAC table of the switch.
   */
  managed?: boolean;
  /** Commands read, for the summary: "show mac address-table" and where it is. */
  commands: { id: ShowCommandId; line: number; context?: string; file?: string }[];
}

export function emptyState(): DeviceState {
  return {
    serials: [],
    units: [],
    ports: [],
    vlans: [],
    etherchannels: [],
    neighbors: [],
    macs: [],
    arp: [],
    poe: [],
    tunnels: [],
    routes: [],
    bgp: [],
    sla: [],
    sdwanServices: [],
    managedSwitches: [],
    switchMacs: [],
    commands: [],
  };
}

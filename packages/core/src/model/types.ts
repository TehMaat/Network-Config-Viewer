// Neutral model of a device (chapter 4 of docs/STUDIO.md), first version for phase 1.
// Drivers translate each vendor's syntax into these structures; views, analyses and
// exports only work on them. Every element keeps the lines of the file it comes from.

import type { OsId, Vendor } from '../detect/types';

/** First and last line (1-based, inclusive) of a piece of configuration. */
export type LineRange = readonly [first: number, last: number];

/** Lines of the configuration an element comes from. */
export type Src = LineRange[];

export interface Element {
  src: Src;
  /** Fields whose value is not written in the file but comes from the vendor default. */
  defaults?: string[];
  /** Fields whose default value still has to be confirmed on real devices. */
  unverified?: string[];
}

// ---- VLANs ---------------------------------------------------------------------------

export interface VlanRange {
  from: number;
  to: number;
}

/** A set of VLANs: either all of them (1-4094) or a list of ranges. */
export interface VlanSet {
  all: boolean;
  ranges: VlanRange[];
}

export interface Vlan extends Element {
  id: number;
  name?: string;
  /** Not defined in the file: VLAN 1, or a VLAN used by ports (VTP server or client). */
  implicit?: boolean;
  /** Used as voice VLAN by a port or by the voice VLAN of a Small Business switch. */
  voice?: boolean;
}

// ---- Interfaces ----------------------------------------------------------------------

export type InterfaceKind =
  | 'physical'
  | 'lag'
  | 'svi'
  | 'loopback'
  | 'tunnel'
  | 'subinterface'
  | 'hard-switch'
  | 'vdom-link'
  | 'management'
  | 'virtual'
  | 'other';

export type SwitchportMode =
  'access' | 'trunk' | 'dynamic-auto' | 'dynamic-desirable' | 'general' | 'routed';

export interface Switchport {
  mode: SwitchportMode;
  accessVlan?: number;
  voiceVlan?: number;
  nativeVlan?: number;
  /** VLANs carried tagged (trunk, general). */
  allowed?: VlanSet;
  /** VLANs carried untagged (general mode of Cisco Small Business). */
  untagged?: VlanSet;
  nonegotiate?: boolean;
}

export interface Ipv4Address {
  ip: string;
  prefix: number;
  secondary?: boolean;
}

/** Where a port sits on the device: stack member, slot (0 = front ports) and port number. */
export interface PortPosition {
  member: number;
  slot: number;
  port: number;
  uplink: boolean;
}

export interface PortSecurityMac {
  mac: string;
  vlan?: number;
  sticky: boolean;
}

export interface Interface extends Element {
  name: string;
  kind: InterfaceKind;
  description?: string;
  /** Administratively down. */
  shutdown: boolean;
  /** Logical context (FortiOS VDOM). */
  context?: string;
  switchport?: Switchport;
  ipv4: Ipv4Address[];
  dhcpClient?: boolean;
  vrf?: string;
  /** Member of a link aggregation: name of the aggregate interface. */
  lag?: { group: string; mode?: string };
  /** Members of an aggregate or hardware switch. */
  members?: string[];
  /** Sub-interface or VLAN interface: parent interface and VLAN ID. */
  parent?: string;
  vlanId?: number;
  poe?: { mode: string };
  dot1x?: { dot1x: boolean; mab: boolean };
  stp?: { portfast?: boolean; bpduguard?: boolean };
  portSecurity?: { enabled: boolean; maximum?: number; sticky: boolean; macs: PortSecurityMac[] };
  speed?: string;
  duplex?: string;
  mtu?: number;
  position?: PortPosition;
  aclIn?: string;
  aclOut?: string;
  ospf?: { process?: string; area?: string; cost?: number };
  helperAddresses?: string[];
  policyRouteMap?: string;
  // FortiOS
  alias?: string;
  role?: string;
  allowAccess?: string[];
  addressingMode?: string;
  remoteIp?: Ipv4Address;
}

// ---- Access lists and object groups (switches) ---------------------------------------

export type AddressMatch =
  | { kind: 'any' }
  | { kind: 'host'; ip: string }
  | { kind: 'wildcard'; ip: string; wildcard: string }
  | { kind: 'subnet'; ip: string; prefix: number }
  | { kind: 'object-group'; name: string }
  | { kind: 'other'; text: string };

export interface PortMatch {
  op: 'eq' | 'neq' | 'lt' | 'gt' | 'range';
  ports: string[];
}

export interface AclEntry extends Element {
  seq?: number;
  action: 'permit' | 'deny' | 'remark';
  protocol?: string;
  source?: AddressMatch;
  sourcePort?: PortMatch;
  destination?: AddressMatch;
  destinationPort?: PortMatch;
  /** Services of a management ACL (Cisco Small Business). */
  services?: string[];
  options: string[];
  remark?: string;
  text: string;
}

export type AclBinding =
  | { kind: 'interface'; interface: string; direction: 'in' | 'out'; src: Src }
  | { kind: 'line'; line: string; direction: 'in' | 'out'; src: Src }
  | { kind: 'snmp'; src: Src }
  | { kind: 'route-map'; name: string; src: Src }
  | { kind: 'management'; src: Src };

export interface Acl extends Element {
  name: string;
  type: 'standard' | 'extended' | 'mac' | 'ipv6' | 'management';
  entries: AclEntry[];
  bindings: AclBinding[];
}

export type ObjectGroupEntry =
  | { kind: 'host'; ip: string }
  | { kind: 'subnet'; ip: string; prefix: number }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'group'; name: string }
  | { kind: 'service'; protocol: string; port?: PortMatch }
  | { kind: 'other'; text: string };

export interface ObjectGroup extends Element {
  name: string;
  type: 'network' | 'service';
  entries: (ObjectGroupEntry & { src: Src })[];
}

// ---- Routing -------------------------------------------------------------------------

export interface Prefix {
  ip: string;
  prefix: number;
}

export interface StaticRoute extends Element {
  dst: Prefix;
  gateway?: string;
  device?: string;
  distance?: number;
  vrf?: string;
  name?: string;
  blackhole?: boolean;
  sdwanZones?: string[];
  enabled: boolean;
  /** "default-gateway" for "ip default-gateway" on layer 2 switches. */
  kind: 'route' | 'default-gateway';
}

export interface PolicyRoute extends Element {
  id?: string;
  inputDevices: string[];
  srcaddr: string[];
  dstaddr: string[];
  protocol?: number;
  gateway?: string;
  outputDevice?: string;
  action?: string;
  /** Cisco PBR: route-map applied on an interface. */
  routeMap?: string;
  interface?: string;
  enabled?: boolean;
  comment?: string;
}

export interface PrefixListEntry extends Element {
  seq?: number;
  action: 'permit' | 'deny';
  prefix: string;
  ge?: number;
  le?: number;
}

export interface PrefixList extends Element {
  name: string;
  entries: PrefixListEntry[];
}

export interface RouteMapEntry extends Element {
  seq?: number;
  action: 'permit' | 'deny';
  match: string[];
  set: string[];
}

export interface RouteMap extends Element {
  name: string;
  entries: RouteMapEntry[];
}

export interface BgpNeighbor extends Element {
  /** IP address of the neighbour, or name of the group for a neighbour group. */
  address: string;
  remoteAs?: string;
  group?: string;
  description?: string;
  updateSource?: string;
  interface?: string;
  routeMapIn?: string;
  routeMapOut?: string;
  prefixListIn?: string;
  prefixListOut?: string;
  routeReflectorClient?: boolean;
  nextHopSelf?: boolean;
  shutdown?: boolean;
  vrf?: string;
}

export interface Bgp extends Element {
  asn: string;
  routerId?: string;
  neighbors: BgpNeighbor[];
  groups: BgpNeighbor[];
  ranges: (Element & { prefix: string; group: string })[];
  networks: (Element & { prefix: string; routeMap?: string })[];
  redistribute: (Element & { protocol: string; routeMap?: string })[];
}

export interface Ospf extends Element {
  process?: string;
  routerId?: string;
  /** "10.0.0.0/24", or the text as written when the wildcard is not contiguous. */
  networks: (Element & { prefix: string; area: string })[];
  areas: (Element & { id: string; type?: string })[];
  /** Interfaces in the process: from network statements or from the interface itself. */
  interfaces: (Element & { name: string; area?: string; cost?: number; passive: boolean })[];
  /** "passive-interface default": every interface is passive except the "no passive-interface" ones. */
  passiveDefault: boolean;
  passive: string[];
  notPassive: string[];
  redistribute: (Element & { protocol: string; routeMap?: string })[];
  /** Announces a default route ("default-information originate"). */
  defaultOriginate?: boolean;
}

export interface Routing {
  statics: StaticRoute[];
  policyRoutes: PolicyRoute[];
  bgp?: Bgp;
  ospf: Ospf[];
  prefixLists: PrefixList[];
  routeMaps: RouteMap[];
}

// ---- Firewall (FortiOS) --------------------------------------------------------------

export interface AddressObject extends Element {
  name: string;
  /** subnet, iprange, fqdn, geography, wildcard, interface-subnet, dynamic, mac... */
  type: string;
  subnet?: Prefix;
  range?: { start: string; end: string };
  fqdn?: string;
  country?: string;
  wildcard?: { ip: string; wildcard: string };
  interface?: string;
  comment?: string;
  /** Predefined object, not written in the file. */
  builtin?: boolean;
}

export interface AddressGroup extends Element {
  name: string;
  members: string[];
  exclude: string[];
  comment?: string;
  builtin?: boolean;
}

export interface PortRange {
  low: number;
  high: number;
}

export interface ServicePorts {
  dst: PortRange;
  src?: PortRange;
}

export interface ServiceObject extends Element {
  name: string;
  /** TCP/UDP/SCTP, ICMP, ICMP6, IP, ALL. */
  protocol: string;
  tcp: ServicePorts[];
  udp: ServicePorts[];
  sctp: ServicePorts[];
  icmpType?: number;
  icmpCode?: number;
  protocolNumber?: number;
  category?: string;
  comment?: string;
  builtin?: boolean;
}

export interface ServiceGroup extends Element {
  name: string;
  members: string[];
  comment?: string;
}

export interface Zone extends Element {
  name: string;
  interfaces: string[];
  intrazone?: string;
}

export interface FirewallPolicy extends Element {
  id: number;
  /** Position in the evaluation order (1 = first evaluated), not the ID. */
  order: number;
  name?: string;
  uuid?: string;
  enabled: boolean;
  srcintf: string[];
  dstintf: string[];
  srcaddr: string[];
  dstaddr: string[];
  srcaddrNegate: boolean;
  dstaddrNegate: boolean;
  service: string[];
  serviceNegate: boolean;
  action: string;
  schedule?: string;
  nat: boolean;
  ippool: boolean;
  poolname: string[];
  logtraffic: string;
  profiles: Record<string, string>;
  users: string[];
  groups: string[];
  internetService: string[];
  comments?: string;
}

export interface Vip extends Element {
  name: string;
  type?: string;
  extip?: string;
  extintf?: string;
  mappedip: string[];
  portforward: boolean;
  protocol?: string;
  extport?: string;
  mappedport?: string;
  comment?: string;
}

export interface IpPool extends Element {
  name: string;
  type: string;
  startip?: string;
  endip?: string;
  comment?: string;
}

// ---- IPsec and SD-WAN (FortiOS) ------------------------------------------------------

export interface IpsecPhase2 extends Element {
  name: string;
  proposals: string[];
  dhgrp: number[];
  pfs: boolean;
  srcSubnet?: string;
  dstSubnet?: string;
  autoNegotiate: boolean;
  keylifeSeconds?: number;
}

export interface IpsecTunnel extends Element {
  name: string;
  interface?: string;
  /** static, dynamic (dial-up) or ddns. */
  type: string;
  remoteGw?: string;
  remoteGwDdns?: string;
  ikeVersion: number;
  proposals: string[];
  dhgrp: number[];
  peertype?: string;
  netDevice: boolean;
  addRoute: boolean;
  advpn?: 'sender' | 'receiver';
  dpd?: string;
  phase2: IpsecPhase2[];
}

export interface SdwanMember extends Element {
  seq: number;
  interface: string;
  zone?: string;
  gateway?: string;
  cost?: number;
  priority?: number;
  weight?: number;
  enabled: boolean;
}

export interface SdwanSla extends Element {
  id: number;
  latency?: number;
  jitter?: number;
  packetloss?: number;
}

export interface SdwanHealthCheck extends Element {
  name: string;
  servers: string[];
  protocol: string;
  members: number[];
  sla: SdwanSla[];
}

export interface SdwanRule extends Element {
  id: number;
  name?: string;
  /** manual, priority (best quality), sla (lowest cost), load-balance (maximize bandwidth). */
  mode: string;
  dstaddr: string[];
  srcaddr: string[];
  internetService: string[];
  application: string[];
  healthCheck?: string;
  sla: { healthCheck: string; id?: number }[];
  priorityMembers: number[];
  priorityZones: string[];
  enabled: boolean;
}

export interface Sdwan extends Element {
  enabled: boolean;
  zones: (Element & { name: string })[];
  members: SdwanMember[];
  healthChecks: SdwanHealthCheck[];
  rules: SdwanRule[];
}

// ---- Device --------------------------------------------------------------------------

/** A logical context: a FortiOS VDOM, or the whole device for the others. */
export interface LogicalContext {
  name: string;
  zones: Zone[];
  addresses: AddressObject[];
  addressGroups: AddressGroup[];
  services: ServiceObject[];
  serviceGroups: ServiceGroup[];
  policies: FirewallPolicy[];
  vips: Vip[];
  ippools: IpPool[];
  routing: Routing;
  ipsec: IpsecTunnel[];
  sdwan?: Sdwan;
  acls: Acl[];
  objectGroups: ObjectGroup[];
}

export interface StackMember extends Element {
  member: number;
  model?: string;
}

/** A name in the configuration that points to its definition. */
export interface Reference {
  line: number;
  /** Columns (0-based) of the name in the line. */
  from: number;
  to: number;
  targetLine: number;
}

export type LineStatus = 'understood' | 'ignored' | 'unknown';

export interface CoverageSection {
  /** "config firewall shaping-policy", "snmp-server", "aaa"... */
  section: string;
  lines: number;
  firstLine: number;
}

export interface Coverage {
  /** Non-empty lines. */
  total: number;
  understood: number;
  ignored: number;
  unknown: number;
  /** Sections with lines not interpreted, largest first. */
  sections: CoverageSection[];
  /** 1-based numbers of the lines not interpreted, highlighted in the config view. */
  unknownLines: number[];
}

export type FeatureCode =
  | 'stack'
  | 'vdom'
  | 'lag'
  | 'poe'
  | 'dot1x'
  | 'port-security'
  | 'voice-vlan'
  | 'svi'
  | 'ip-routing'
  | 'static-routes'
  | 'ospf'
  | 'bgp'
  | 'pbr'
  | 'acl'
  | 'vtp'
  | 'sdwan'
  | 'ipsec'
  | 'advpn'
  | 'ha'
  | 'nat'
  | 'vip';

export type ModelWarningCode =
  | 'vtp-vlans-not-in-config'
  | 'unverified-defaults'
  | 'policy-disabled'
  | 'policy-no-log'
  | 'policy-any-any'
  | 'policy-all-management';

export interface ModelWarning {
  code: ModelWarningCode;
  line?: number;
  /** Logical context (VDOM) the warning is about. */
  context?: string;
}

export interface DeviceModel {
  vendor: Vendor;
  os: OsId;
  version?: string;
  model?: string;
  hostname?: string;
  stack: StackMember[];
  interfaces: Interface[];
  vlans: Vlan[];
  contexts: LogicalContext[];
  management?: { ip: string; interface?: string };
  vtpMode?: string;
  features: FeatureCode[];
  references: Reference[];
  coverage: Coverage;
  warnings: ModelWarning[];
}

export function emptyRouting(): Routing {
  return { statics: [], policyRoutes: [], ospf: [], prefixLists: [], routeMaps: [] };
}

export function emptyContext(name: string): LogicalContext {
  return {
    name,
    zones: [],
    addresses: [],
    addressGroups: [],
    services: [],
    serviceGroups: [],
    policies: [],
    vips: [],
    ippools: [],
    routing: emptyRouting(),
    ipsec: [],
    acls: [],
    objectGroups: [],
  };
}

// The infrastructure of a client (#15): the devices put together by the correlation, with the
// sites they are in, the links between them and the nodes outside the client (Internet,
// providers, peers, neighbours that were not loaded). Every link remembers where it comes from:
// the lines of the configurations and of the shows of both sides.

import type { DeviceModel, Src } from '../model/types';
import type { DeviceState } from '../show/types';

/** A device of the client, as the app gives it: the current configuration and its shows. */
export interface CorrelationInput {
  hostname: string;
  /** Id of the file of the configuration, to open the views of the device. */
  file: string;
  model: DeviceModel;
  state?: DeviceState | null;
}

export type DeviceType = 'firewall' | 'switch';

export interface InfraDevice {
  /** Hostname in lower case, without the domain: the id of the device in the graph. */
  key: string;
  hostname: string;
  file: string;
  type: DeviceType;
  vendor: DeviceModel['vendor'];
  os: DeviceModel['os'];
  version?: string;
  model?: string;
  /** Id of the site. */
  site: string;
  /** In an HA cluster: one configuration for two or more units. */
  ha: boolean;
  /** Logical contexts when there is more than one (FortiOS VDOMs). */
  contexts: string[];
  managementIp?: string;
  location?: string;
}

/** How the site of a device was found: SNMP location, hostname, cables, or not at all. */
export type SiteSource = 'snmp' | 'hostname' | 'cables' | 'none';

export interface Site {
  id: string;
  /** "Sede", "Filiale 1"; empty for the devices without a site. */
  name: string;
  source: SiteSource;
  devices: string[];
}

export type ExternalKind = 'internet' | 'provider' | 'peer' | 'neighbor' | 'segment';

/** A node that is not a device of the client. */
export interface ExternalNode {
  id: string;
  kind: ExternalKind;
  /** "Internet", "AS 64496", "198.51.100.200", "FGT-BR3", "10.10.99.0/24". */
  label: string;
  /** Description of a BGP peer, platform of a neighbour. */
  detail?: string;
  site?: string;
}

export type LinkKind =
  'cable' | 'lag' | 'subnet' | 'internet' | 'ipsec' | 'bgp' | 'ospf' | 'shortcut';

/**
 * Where a link comes from. Shows verify (LLDP, CDP, tunnels and BGP sessions seen up), the
 * configuration lets the link be inferred (descriptions, addresses, remote gateways, peers).
 */
export type SourceKind =
  | 'lldp'
  | 'cdp'
  | 'description'
  | 'subnet'
  | 'wan'
  | 'remote-gw'
  | 'ddns'
  | 'bgp-neighbor'
  | 'ospf'
  | 'tunnel-state'
  | 'bgp-state';

export const VERIFYING_SOURCES: readonly SourceKind[] = [
  'lldp',
  'cdp',
  'tunnel-state',
  'bgp-state',
];

/** Lines of the configuration of a device, or of one of its files of shows. */
export interface LinkEvidence {
  device: string;
  /** Id of the file of shows; missing for the configuration of the device. */
  file?: string;
  src: Src;
}

export interface LinkSource {
  kind: SourceKind;
  /** The device whose files say it. */
  device: string;
  /** The description of the port, the name and port seen by the neighbour. */
  text?: string;
  evidence: LinkEvidence[];
}

/** One side of a link. */
export interface LinkEnd {
  /** Key of a device, or id of an external node. */
  node: string;
  /** Logical context (VDOM) of the side. */
  context?: string;
  /** Interface of the side: port, port-channel, VLAN interface, WAN, tunnel interface. */
  interface?: string;
  /** The interface named by a description or a neighbour is not in the configuration. */
  unknownInterface?: boolean;
  ip?: string;
  /** IPsec: name of the phase 1 (or of the dial-up instance, for a shortcut). */
  tunnel?: string;
  /** BGP: the neighbour of this side, as written: an address, or a neighbour range. */
  neighbor?: string;
  /** BGP: the neighbour range of this side that accepts the other side, and its group. */
  range?: { prefix: string; group: string };
  /** BGP: the autonomous system of this side. */
  asn?: string;
  /** OSPF: area of the interface of this side. */
  area?: string;
}

export type EndStatus = 'up' | 'down' | 'partial';

/** What the shows of one side say about the link. */
export interface EndState {
  status: EndStatus;
  /** "connected", "Established", "1/1 selettori"... as the device shows it. */
  text?: string;
  /** BGP: prefixes received. */
  prefixes?: number;
  evidence: LinkEvidence[];
}

/** An IPsec tunnel that is a member of an SD-WAN zone, with its health checks. */
export interface OverlayUse {
  zone?: string;
  seq: number;
  sla: { healthCheck: string; alive: boolean; met?: boolean; evidence: LinkEvidence[] }[];
}

export interface Link {
  /** Stable id: kind and the two sides, so that the same link keeps its id across loads. */
  id: string;
  kind: LinkKind;
  a: LinkEnd;
  b: LinkEnd;
  sources: LinkSource[];
  /** At least one show confirms the link. */
  verified: boolean;
  /** LAG: the cables between the member ports (the other member is unknown without a source). */
  cables?: { a: string; b?: string; verified: boolean }[];
  /** Shared subnet, OSPF: the network. */
  subnet?: string;
  /** IPsec: the side b accepts dial-up peers. */
  dialup?: boolean;
  /** IPsec: SD-WAN overlay on each side. */
  overlay?: { a?: OverlayUse; b?: OverlayUse };
  /** BGP: iBGP (same AS) or eBGP. */
  ibgp?: boolean;
  /** BGP: the IPsec link that carries the session. */
  via?: string;
  /** Internet: the next hop of the side a. */
  gateway?: string;
  state?: { a?: EndState; b?: EndState };
}

export interface Infrastructure {
  devices: InfraDevice[];
  sites: Site[];
  externals: ExternalNode[];
  links: Link[];
}

/** Id of the only Internet node. */
export const INTERNET = 'internet';

// FortiOS 7.0–8.0 driver: reads the "config / edit / set" tree into the neutral model.
// Global settings (interfaces, HA, SD-WAN in single-VDOM mode) and the content of every VDOM
// (objects, policies, routing, VPN) go to the logical context of their VDOM.

import { ipToInt, isIpv4, maskToPrefix, parsePrefix, wildcardMatches } from '../model/ip';
import { vlanSetFrom } from '../model/vlans';
import {
  emptyContext,
  type AddressGroup,
  type AddressObject,
  type Bgp,
  type BgpNeighbor,
  type DeviceModel,
  type FeatureCode,
  type FirewallPolicy,
  type Interface,
  type InterfaceKind,
  type IpPool,
  type IpsecPhase2,
  type IpsecTunnel,
  type LogicalContext,
  type ManagedSwitch,
  type ModelWarning,
  type Ospf,
  type PolicyRoute,
  type PortRange,
  type PrefixList,
  type RouteMap,
  type Sdwan,
  type SdwanHealthCheck,
  type SdwanRule,
  type ServiceGroup,
  type ServiceObject,
  type ServicePorts,
  type StaticRoute,
  type Vip,
  type WirelessController,
  type Zone,
} from '../model/types';
import type { SyntaxNode } from '../syntax/types';
import type { DriverInput } from './cisco';
import { DriverContext, nodeSrc, type SymbolKind } from './context';
import { FORTIOS_DEFAULTS, fortiosDefaultIkeVersion } from './defaults';
import { builtinAddresses, builtinServices } from './fortios-builtins';

/** A value of a "set" line, without its quotes, with its columns in the original line. */
export interface Token {
  value: string;
  from: number;
  to: number;
}

/** Splits a FortiOS line into values: quoted values may contain spaces and backslash escapes. */
export function tokenize(raw: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t')) i++;
    if (i >= raw.length) break;
    if (raw[i] === '"') {
      const from = i + 1;
      let value = '';
      i++;
      while (i < raw.length && raw[i] !== '"') {
        if (raw[i] === '\\' && i + 1 < raw.length) {
          value += raw[i + 1];
          i += 2;
        } else {
          value += raw[i];
          i++;
        }
      }
      out.push({ value, from, to: i });
      i++;
    } else {
      const from = i;
      while (i < raw.length && raw[i] !== ' ' && raw[i] !== '\t') i++;
      out.push({ value: raw.slice(from, i), from, to: i });
    }
  }
  return out;
}

interface SetLine {
  node: SyntaxNode;
  values: Token[];
}

/** The "set" lines and the nested "config" blocks of an entry. */
class Entry {
  readonly sets = new Map<string, SetLine>();
  readonly configs = new Map<string, SyntaxNode>();

  constructor(
    readonly node: SyntaxNode,
    readonly name: string,
    lines: string[],
  ) {
    for (const child of node.children) {
      if (child.kind === 'comment') continue;
      const raw = lines[child.line - 1] ?? '';
      if (child.text.startsWith('set ')) {
        const tokens = tokenize(raw);
        const key = tokens[1]?.value;
        if (key) this.sets.set(key, { node: child, values: tokens.slice(2) });
      } else if (child.text.startsWith('config ')) {
        this.configs.set(child.text.slice('config '.length).trim(), child);
      }
    }
  }
}

const MANAGEMENT_SERVICES = ['SSH', 'TELNET', 'SNMP', 'RDP', 'VNC'];

/** Reads a FortiOS configuration into the neutral model. */
export function buildFortiosModel(input: DriverInput): DeviceModel {
  return new FortiosReader(input).read();
}

class FortiosReader {
  private readonly ctx: DriverContext;
  private readonly lines: string[];
  private readonly interfaces = new Map<string, Interface>();
  private readonly contexts = new Map<string, LogicalContext>();
  private readonly features = new Set<FeatureCode>();
  private readonly sections = new Map<number, string>();
  private readonly warnings: ModelWarning[] = [];
  private readonly switchMembers = new Map<string, string[]>();
  private readonly ddns: NonNullable<DeviceModel['ddns']> = [];
  /** FortiSwitches and FortiAPs managed by the FortiGate (#15, part 4). */
  private readonly managedSwitches: ManagedSwitch[] = [];
  private readonly wireless: WirelessController = { ssids: [], profiles: [], accessPoints: [] };
  /** The VLANs of the ports of the managed switches, by name: numbers once the interfaces are known. */
  private readonly switchVlans: {
    port: ManagedSwitch['ports'][number];
    vlan?: string;
    allowed: string[];
    untagged: string[];
    all: boolean;
  }[] = [];
  private hostname?: string;
  private location?: DeviceModel['location'];
  private discovery?: DeviceModel['discovery'];
  private multiVdom = false;

  constructor(private readonly input: DriverInput) {
    this.lines = input.lines;
    this.ctx = new DriverContext(input.lines);
  }

  read(): DeviceModel {
    const top = this.input.tree.nodes;
    this.assignSections(top, '');
    this.multiVdom = top.some((n) => n.text === 'config global');
    for (const node of top) this.readTop(node);
    this.finishInterfaces();
    this.finishManagedSwitches();
    for (const context of this.contexts.values()) this.finishContext(context);
    if (this.contexts.size === 0) this.context('root');
    if (this.multiVdom) this.features.add('vdom');
    return {
      vendor: 'fortinet',
      os: this.input.os,
      ...(this.input.version ? { version: this.input.version } : {}),
      ...(this.input.model ? { model: this.input.model } : {}),
      ...((this.hostname ?? this.input.hostname)
        ? { hostname: this.hostname ?? this.input.hostname }
        : {}),
      stack: [{ member: 1, ...(this.input.model ? { model: this.input.model } : {}), src: [] }],
      interfaces: [...this.interfaces.values()],
      vlans: [],
      contexts: [...this.contexts.values()],
      ...this.management(),
      ...(this.location ? { location: this.location } : {}),
      ...(this.ddns.length > 0 ? { ddns: this.ddns } : {}),
      discovery: this.discovery ?? { lldp: false, cdp: false, src: [], defaults: ['lldp'] },
      ...(this.managedSwitches.length > 0 ? { managedSwitches: this.managedSwitches } : {}),
      ...(this.wireless.ssids.length + this.wireless.accessPoints.length > 0
        ? { wireless: this.wireless }
        : {}),
      features: [...this.features].sort(),
      references: this.ctx.references(),
      coverage: this.ctx.coverage((line) => this.sections.get(line) ?? 'other'),
      warnings: this.warnings,
    };
  }

  // ---- structure ------------------------------------------------------------------

  /**
   * Unknown lines are grouped by the "config" block they are in. "config global", "config
   * vdom" and the VDOM entries only hold the other blocks, so they are not part of the name.
   */
  private assignSections(nodes: SyntaxNode[], parent: string) {
    for (const node of nodes) {
      const container =
        parent === '' && (node.text === 'config global' || node.text === 'config vdom');
      const vdomEntry = parent === '#vdom';
      let key = parent;
      if (container) key = node.text === 'config vdom' ? '#vdom' : '';
      else if (vdomEntry) key = '';
      else if (node.text.startsWith('config '))
        key = parent ? `${parent} › ${node.text}` : node.text;
      const own = container || vdomEntry ? node.text : key || node.text;
      for (let l = node.line; l <= node.endLine; l++) this.sections.set(l, own);
      if (node.children.length > 0) this.assignSections(node.children, key);
    }
  }

  private context(name: string): LogicalContext {
    let c = this.contexts.get(name);
    if (!c) {
      c = emptyContext(name);
      this.contexts.set(name, c);
    }
    return c;
  }

  private readTop(node: SyntaxNode) {
    if (node.kind === 'comment') return this.ctx.ignoredAll(node);
    if (node.text === 'config global') {
      this.structure(node);
      for (const child of node.children) this.readConfig(child, 'root');
      return;
    }
    if (node.text === 'config vdom') {
      this.structure(node);
      for (const edit of node.children) {
        const name = this.editName(edit);
        if (name === null) continue;
        this.structure(edit);
        this.context(name);
        for (const child of edit.children) this.readConfig(child, name);
      }
      return;
    }
    // Single VDOM: everything belongs to "root".
    this.readConfig(node, 'root');
  }

  /** Lines that only open and close the global section, the VDOMs or a table. */
  private structure(node: SyntaxNode) {
    this.ctx.understood(node);
    this.ctx.understoodClosing(node);
  }

  private editName(node: SyntaxNode): string | null {
    if (!node.text.startsWith('edit ')) return null;
    const tokens = tokenize(this.lines[node.line - 1] ?? '');
    return tokens[1]?.value ?? null;
  }

  private entries(table: SyntaxNode): Entry[] {
    const out: Entry[] = [];
    for (const child of table.children) {
      const name = this.editName(child);
      if (name !== null) out.push(new Entry(child, name, this.lines));
    }
    return out;
  }

  /** The settings of a "config" block that has no entries ("config system global"). */
  private settings(node: SyntaxNode): Entry {
    return new Entry(node, '', this.lines);
  }

  /** Values of a setting, marking its line as understood; undefined when it is not written. */
  private get(entry: Entry, key: string): string[] | undefined {
    const set = entry.sets.get(key);
    if (!set) return undefined;
    this.ctx.understoodAll(set.node);
    return set.values.map((v) => v.value);
  }

  private one(entry: Entry, key: string): string | undefined {
    return this.get(entry, key)?.[0];
  }

  private flag(entry: Entry, key: string): boolean | undefined {
    const v = this.one(entry, key);
    return v === undefined ? undefined : v === 'enable';
  }

  /** Settings read on purpose and left out of the model (secrets, internal indexes). */
  private skip(entry: Entry, ...keys: string[]) {
    for (const key of keys) {
      const set = entry.sets.get(key);
      if (set) for (let l = set.node.line; l <= set.node.endLine; l++) this.ctx.ignored(l);
    }
  }

  /** References from the values of a setting to the definitions of their names. */
  private refs(entry: Entry, key: string, kind: SymbolKind | SymbolKind[], context: string) {
    const set = entry.sets.get(key);
    if (!set) return;
    for (const token of set.values) {
      this.ctx.refAt(set.node.line, token.from, token.to, kind, token.value, context);
    }
  }

  private begin(entry: Entry) {
    this.ctx.understood(entry.node);
    this.ctx.understoodClosing(entry.node);
  }

  private readConfig(node: SyntaxNode, vdom: string) {
    if (node.kind === 'comment') return this.ctx.ignoredAll(node);
    if (!node.text.startsWith('config ')) return;
    const path = node.text.slice('config '.length).trim();
    if (/^(vpn certificate |system replacemsg)/.test(path)) return this.ctx.ignoredAll(node);
    const handlers: Record<string, () => void> = {
      'system global': () => this.readSystemGlobal(node),
      'system snmp sysinfo': () => this.readSnmpSysinfo(node),
      'system ddns': () => this.readDdns(node),
      'system interface': () => this.readInterfaces(node),
      'system virtual-switch': () => this.readVirtualSwitch(node),
      'system zone': () => this.readZones(node, vdom),
      'system ha': () => this.readHa(node),
      'system vdom-link': () => this.ctx.understoodAll(node),
      'system sdwan': () => this.readSdwan(node, vdom),
      'system virtual-wan-link': () => this.readSdwan(node, vdom),
      'firewall address': () => this.readAddresses(node, vdom),
      'firewall addrgrp': () => this.readAddressGroups(node, vdom),
      'firewall service custom': () => this.readServices(node, vdom),
      'firewall service group': () => this.readServiceGroups(node, vdom),
      'firewall policy': () => this.readPolicies(node, vdom),
      'firewall vip': () => this.readVips(node, vdom),
      'firewall ippool': () => this.readIpPools(node, vdom),
      'router static': () => this.readStatics(node, vdom),
      'router policy': () => this.readPolicyRoutes(node, vdom),
      'router bgp': () => this.readBgp(node, vdom),
      'router ospf': () => this.readOspf(node, vdom),
      'router route-map': () => this.readRouteMaps(node, vdom),
      'router prefix-list': () => this.readPrefixLists(node, vdom),
      'vpn ipsec phase1-interface': () => this.readPhase1(node, vdom),
      'vpn ipsec phase2-interface': () => this.readPhase2(node, vdom),
      'switch-controller managed-switch': () => this.readManagedSwitches(node),
      'wireless-controller vap': () => this.readVaps(node),
      'wireless-controller wtp-profile': () => this.readWtpProfiles(node),
      'wireless-controller wtp': () => this.readWtps(node),
    };
    handlers[path]?.();
  }

  // ---- system ---------------------------------------------------------------------

  private readSystemGlobal(node: SyntaxNode) {
    this.structure(node);
    const s = this.settings(node);
    const hostname = this.one(s, 'hostname');
    if (hostname) this.hostname = hostname;
    this.get(s, 'alias');
    this.get(s, 'vdom-mode');
    // LLDP of the whole device: off unless enabled (#15). FortiOS has no CDP.
    const transmission = this.one(s, 'lldp-transmission');
    this.get(s, 'lldp-reception');
    this.discovery = {
      lldp: transmission === 'enable',
      cdp: false,
      src: [],
      ...(transmission === undefined ? { defaults: ['lldp'] } : {}),
    };
  }

  /** The SNMP location: the first hint of the site of the device (#15). */
  private readSnmpSysinfo(node: SyntaxNode) {
    const s = this.settings(node);
    const set = s.sets.get('location');
    const text = this.one(s, 'location')?.trim();
    if (!set || !text) return;
    this.structure(node);
    this.get(s, 'status');
    this.location = { text, src: nodeSrc(set.node) };
  }

  /** Dynamic DNS names: a peer may use one of them as its IPsec remote gateway (#15). */
  private readDdns(node: SyntaxNode) {
    this.structure(node);
    for (const e of this.entries(node)) {
      this.begin(e);
      const domain = this.one(e, 'ddns-domain');
      this.get(e, 'ddns-server');
      const monitor = this.one(e, 'monitor-interface');
      if (!domain) continue;
      this.ddns.push({ domain, ...(monitor ? { interface: monitor } : {}), src: nodeSrc(e.node) });
    }
  }

  private readHa(node: SyntaxNode) {
    const s = this.settings(node);
    const mode = this.one(s, 'mode');
    if (mode && mode !== 'standalone') {
      this.structure(node);
      this.features.add('ha');
      this.get(s, 'group-name');
      this.get(s, 'priority');
      this.get(s, 'monitor');
      this.get(s, 'hbdev');
      this.skip(s, 'password');
    }
  }

  private readInterfaces(node: SyntaxNode) {
    this.structure(node);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('interface', e.name, e.node.line);
      const type = this.one(e, 'type');
      const parent = this.one(e, 'interface');
      const vlanId = this.one(e, 'vlanid');
      const iface: Interface = {
        name: e.name,
        kind: interfaceKind(type, parent, vlanId, e.name),
        shutdown: this.one(e, 'status') === 'down',
        ipv4: [],
        src: nodeSrc(e.node),
      };
      if (!e.sets.has('status')) iface.defaults = ['status'];
      const vdom = this.one(e, 'vdom');
      if (vdom) iface.context = vdom;
      const ip = this.get(e, 'ip');
      if (ip && ip.length >= 2 && ip[0] !== '0.0.0.0') {
        const prefix = maskToPrefix(ip[1]!);
        if (isIpv4(ip[0]!) && prefix !== null) iface.ipv4.push({ ip: ip[0]!, prefix });
      }
      const secondary = e.configs.get('secondaryip');
      if (secondary && this.flag(e, 'secondary-IP')) {
        this.structure(secondary);
        for (const s of this.entries(secondary)) {
          this.begin(s);
          const sip = this.get(s, 'ip');
          const prefix = sip?.[1] ? maskToPrefix(sip[1]) : null;
          if (sip && prefix !== null && isIpv4(sip[0]!)) {
            iface.ipv4.push({ ip: sip[0]!, prefix, secondary: true });
          }
          this.get(s, 'allowaccess');
        }
      }
      const mode = this.one(e, 'mode');
      if (mode) {
        iface.addressingMode = mode;
        if (mode === 'dhcp' || mode === 'pppoe') iface.dhcpClient = true;
      }
      const access = this.get(e, 'allowaccess');
      if (access) iface.allowAccess = access;
      const role = this.one(e, 'role');
      if (role) iface.role = role;
      const alias = this.one(e, 'alias');
      if (alias) iface.alias = alias;
      const description = this.one(e, 'description');
      if (description) iface.description = description;
      if (parent) {
        iface.parent = parent;
        this.refs(e, 'interface', 'interface', '');
      }
      if (vlanId) iface.vlanId = Number(vlanId);
      const members = this.get(e, 'member');
      if (members) {
        iface.members = members;
        this.refs(e, 'member', 'interface', '');
        const lacp = this.one(e, 'lacp-mode') ?? 'active';
        for (const m of members) this.lagOf.set(m, { group: e.name, mode: lacp });
        if (iface.kind === 'lag') this.features.add('lag');
      }
      const remote = this.get(e, 'remote-ip');
      if (remote?.[0] && isIpv4(remote[0])) {
        const prefix = remote[1] ? maskToPrefix(remote[1]) : 32;
        iface.remoteIp = { ip: remote[0], prefix: prefix ?? 32 };
      }
      const speed = this.one(e, 'speed');
      if (speed) iface.speed = speed;
      if (this.flag(e, 'mtu-override')) {
        const mtu = this.one(e, 'mtu');
        if (mtu) iface.mtu = Number(mtu);
      }
      // LLDP on the port: "vdom" (the default) follows the setting of the device (#15).
      const lldpTx = this.one(e, 'lldp-transmission');
      const lldpRx = this.one(e, 'lldp-reception');
      if ((lldpTx && lldpTx !== 'vdom') || (lldpRx && lldpRx !== 'vdom')) {
        iface.discovery = {
          ...(lldpTx && lldpTx !== 'vdom' ? { lldpTransmit: lldpTx === 'enable' } : {}),
          ...(lldpRx && lldpRx !== 'vdom' ? { lldpReceive: lldpRx === 'enable' } : {}),
        };
      }
      if (this.one(e, 'dedicated-to') === 'management') iface.kind = 'management';
      this.skip(e, 'snmp-index', 'estimated-upstream-bandwidth', 'estimated-downstream-bandwidth');
      this.interfaces.set(e.name, iface);
    }
  }

  private readonly lagOf = new Map<string, { group: string; mode: string }>();

  /** Hardware switches ("internal" on small models): the ports that form them. */
  private readVirtualSwitch(node: SyntaxNode) {
    this.structure(node);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.get(e, 'physical-switch');
      const ports = e.configs.get('port');
      if (!ports) continue;
      this.structure(ports);
      const members: string[] = [];
      for (const p of this.entries(ports)) {
        this.begin(p);
        members.push(p.name);
      }
      this.switchMembers.set(e.name, members);
    }
  }

  private readZones(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('zone', e.name, e.node.line, vdom);
      const zone: Zone = {
        name: e.name,
        interfaces: this.get(e, 'interface') ?? [],
        src: nodeSrc(e.node),
      };
      this.refs(e, 'interface', 'interface', '');
      const intrazone = this.one(e, 'intrazone');
      zone.intrazone = intrazone ?? 'deny';
      if (!intrazone) zone.defaults = ['intrazone'];
      this.get(e, 'description');
      ctx.zones.push(zone);
    }
  }

  // ---- devices managed by the FortiGate (#15, part 4) -------------------------------

  /**
   * FortiSwitches managed through FortiLink: their ports, with the VLANs named after the VLAN
   * interfaces of the FortiGate, and their trunks (MCLAG, FortiLink).
   */
  private readManagedSwitches(node: SyntaxNode) {
    this.structure(node);
    for (const e of this.entries(node)) {
      this.begin(e);
      const name = this.one(e, 'name') ?? e.name;
      const fortilink = this.one(e, 'fsw-wan1-peer');
      this.refs(e, 'fsw-wan1-peer', 'interface', '');
      for (const key of [
        'fsw-wan1-admin',
        'poe-detection-type',
        'version',
        'max-allowed-trunk-members',
        'description',
        'owner-vdom',
        'switch-profile',
        'access-profile',
        'pre-provisioned',
        'directly-connected',
        'mclag-igmp-snooping-aware',
        'l3-discovered',
      ]) {
        this.get(e, key);
      }
      const ports: ManagedSwitch['ports'] = [];
      // The LACP mode of every trunk: its members have it, as the members of an aggregate.
      const modes = new Map<string, string>();
      const table = e.configs.get('ports');
      const downlinks = switchDownlinks(e.name);
      if (table) {
        this.structure(table);
        for (const p of this.entries(table)) {
          this.begin(p);
          ports.push(this.readSwitchPort(p, downlinks, modes));
        }
      }
      // Members of a trunk: the trunk they are in, as for an aggregate.
      for (const trunk of ports.filter((p) => p.kind === 'lag')) {
        const mode = modes.get(trunk.name);
        for (const member of trunk.members ?? []) {
          const port = ports.find((p) => p.name === member);
          if (port) port.lag = { group: trunk.name, ...(mode ? { mode } : {}) };
        }
      }
      this.managedSwitches.push({
        serial: e.name,
        name,
        ...(fortiswitchModel(e.name) ? { model: fortiswitchModel(e.name)! } : {}),
        ...(fortilink ? { fortilink } : {}),
        ports,
        src: nodeSrc(e.node),
      });
      this.features.add('fortiswitch');
      if (ports.some((p) => p.trunkRole === 'icl')) this.features.add('mclag');
      if (ports.some((p) => p.poe)) this.features.add('poe');
    }
  }

  private readSwitchPort(
    p: Entry,
    downlinks: number,
    modes: Map<string, string>,
  ): ManagedSwitch['ports'][number] {
    const trunk = this.one(p, 'type') === 'trunk';
    const vlan = this.one(p, 'vlan');
    this.refs(p, 'vlan', 'interface', '');
    const allowed = this.get(p, 'allowed-vlans') ?? [];
    this.refs(p, 'allowed-vlans', 'interface', '');
    const untagged = this.get(p, 'untagged-vlans') ?? [];
    this.refs(p, 'untagged-vlans', 'interface', '');
    const all = this.one(p, 'allowed-vlans-all') === 'enable';
    const description = this.one(p, 'description');
    const poe = this.one(p, 'poe-status');
    const members = this.get(p, 'members');
    // "lacp-active" and "lacp-passive" as the LACP modes of the FortiGate aggregates.
    const mode = this.one(p, 'mode')?.replace(/^lacp-/, '');
    // All three are read: a FortiLink trunk is an MCLAG trunk too.
    const icl = this.flag(p, 'mclag-icl-port');
    const fortilinkPort = this.flag(p, 'fortilink-port');
    const mclag = this.flag(p, 'mclag');
    const role = icl ? 'icl' : fortilinkPort ? 'fortilink' : mclag ? 'mclag' : undefined;
    for (const key of [
      'speed',
      'stp-state',
      'edge-port',
      'loop-guard',
      'lldp-status',
      'lldp-profile',
      'export-to',
      'qos-policy',
      'access-mode',
      'arp-inspection-trust',
      'igmp-snooping',
      'learning-limit',
      'sticky-mac',
      'dhcp-snooping',
    ]) {
      this.get(p, key);
    }
    if (trunk && mode) modes.set(p.name, mode);
    const number = /^port(\d+)$/.exec(p.name)?.[1];
    const port: ManagedSwitch['ports'][number] = {
      name: p.name,
      kind: trunk ? 'lag' : 'physical',
      shutdown: this.one(p, 'status') === 'down',
      ipv4: [],
      src: nodeSrc(p.node),
      ...(description ? { description } : {}),
      ...(poe ? { poe: { mode: poe === 'enable' ? 'auto' : 'never' } } : {}),
      ...(members ? { members } : {}),
      ...(role ? { trunkRole: role } : {}),
      ...(number
        ? {
            position: {
              member: 1,
              slot: 0,
              port: Number(number),
              uplink: Number(number) > downlinks,
            },
          }
        : {}),
    };
    // Member ports of a trunk follow the trunk; the others have their VLANs.
    if (vlan || allowed.length > 0 || untagged.length > 0 || all) {
      this.switchVlans.push({ port, ...(vlan ? { vlan } : {}), allowed, untagged, all });
    }
    return port;
  }

  /** The names of the VLANs of the managed switches as numbers: the VLAN interfaces of the FortiGate. */
  private finishManagedSwitches() {
    const ids = new Map<string, number>(Object.entries(FORTISWITCH_VLANS));
    for (const i of this.interfaces.values()) if (i.vlanId !== undefined) ids.set(i.name, i.vlanId);
    const id = (name: string) => ids.get(name);
    for (const { port, vlan, allowed, untagged, all } of this.switchVlans) {
      const native = vlan ? id(vlan) : undefined;
      const tagged = allowed.map(id).filter((v): v is number => v !== undefined);
      const plain = untagged.map(id).filter((v): v is number => v !== undefined);
      const ranges = (list: number[]) => list.map((v) => ({ from: v, to: v }));
      // A trunk carries another VLAN than its native one: a port that allows only its native
      // VLAN carries that VLAN alone, untagged, as an access port.
      const others = [...tagged, ...plain].some((v) => v !== native);
      port.switchport =
        all || others
          ? {
              mode: 'trunk',
              ...(native !== undefined ? { nativeVlan: native } : {}),
              allowed: all ? { all: true, ranges: [] } : vlanSetFrom(ranges(tagged)),
              ...(plain.length > 0 ? { untagged: vlanSetFrom(ranges(plain)) } : {}),
            }
          : { mode: 'access', ...(native !== undefined ? { accessVlan: native } : {}) };
    }
  }

  /** The SSIDs: virtual access points of the wireless controller. */
  private readVaps(node: SyntaxNode) {
    this.structure(node);
    for (const e of this.entries(node)) {
      this.begin(e);
      // A virtual access point is an interface of the FortiGate: policies use its name.
      this.ctx.define('interface', e.name, e.node.line);
      const security = this.one(e, 'security');
      const radius = this.one(e, 'radius-server');
      const vlan = num(this.one(e, 'vlanid'));
      for (const key of [
        'auth',
        'schedule',
        'broadcast-ssid',
        'max-clients',
        'pmf',
        'intra-vap-privacy',
        'captive-portal',
        'portal-type',
        'selected-usergroups',
        'local-standalone',
        'ip',
        'vlan-pooling',
        'multicast-enhance',
        'quarantine',
      ]) {
        this.get(e, key);
      }
      this.skip(e, 'passphrase', 'sae-password');
      this.wireless.ssids.push({
        name: e.name,
        ssid: this.one(e, 'ssid') ?? e.name,
        ...(security ? { security } : {}),
        ...(radius ? { radiusServer: radius } : {}),
        ...(vlan !== undefined ? { vlanId: vlan } : {}),
        localBridging: this.one(e, 'local-bridging') === 'enable',
        src: nodeSrc(e.node),
      });
      this.features.add('fortiap');
    }
  }

  private readWtpProfiles(node: SyntaxNode) {
    this.structure(node);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('wtp-profile', e.name, e.node.line);
      const platformNode = e.configs.get('platform');
      let platform: string | undefined;
      if (platformNode) {
        this.structure(platformNode);
        const s = this.settings(platformNode);
        platform = this.one(s, 'type');
        this.get(s, 'mode');
        this.get(s, 'ddscan');
      }
      for (const key of [
        'handoff-sta-thresh',
        'comment',
        'ap-country',
        'led-state',
        'allowaccess',
      ]) {
        this.get(e, key);
      }
      const radios: WirelessController['profiles'][number]['radios'] = [];
      for (const n of [1, 2, 3, 4]) {
        const radioNode = e.configs.get(`radio-${n}`);
        if (!radioNode) continue;
        this.structure(radioNode);
        const s = this.settings(radioNode);
        const band = this.one(s, 'band');
        const mode = this.one(s, 'mode');
        const ssids = this.get(s, 'vaps') ?? [];
        this.refs(s, 'vaps', 'interface', '');
        for (const key of [
          'vap-all',
          'channel',
          'power-level',
          'channel-bonding',
          'auto-power-level',
        ]) {
          this.get(s, key);
        }
        radios.push({ radio: n, ...(band ? { band } : {}), ...(mode ? { mode } : {}), ssids });
      }
      this.wireless.profiles.push({
        name: e.name,
        ...(platform ? { platform } : {}),
        radios,
        src: nodeSrc(e.node),
      });
      this.features.add('fortiap');
    }
  }

  private readWtps(node: SyntaxNode) {
    this.structure(node);
    for (const e of this.entries(node)) {
      this.begin(e);
      const profile = this.one(e, 'wtp-profile');
      this.refs(e, 'wtp-profile', 'wtp-profile', '');
      for (const key of ['location', 'region', 'override-led-state', 'firmware-provision']) {
        this.get(e, key);
      }
      this.wireless.accessPoints.push({
        serial: e.name,
        name: this.one(e, 'name') ?? e.name,
        ...(fortiapModel(e.name) ? { model: fortiapModel(e.name)! } : {}),
        ...(profile ? { profile } : {}),
        enabled: this.one(e, 'admin') !== 'disable',
        src: nodeSrc(e.node),
      });
      this.features.add('fortiap');
    }
  }

  // ---- objects --------------------------------------------------------------------

  private readAddresses(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('address', e.name, e.node.line, vdom);
      const type = this.one(e, 'type') ?? 'ipmask';
      const address: AddressObject = {
        name: e.name,
        type: type === 'ipmask' ? 'subnet' : type,
        src: nodeSrc(e.node),
      };
      const subnet = this.get(e, 'subnet');
      if (subnet) {
        const p = parsePrefix(subnet.join(' '));
        if (p) address.subnet = p;
      } else if (type === 'ipmask') {
        address.subnet = { ip: '0.0.0.0', prefix: 0 };
        address.defaults = ['subnet'];
      }
      const start = this.one(e, 'start-ip');
      const end = this.one(e, 'end-ip');
      if (start && end) address.range = { start, end };
      const fqdn = this.one(e, 'fqdn');
      if (fqdn) address.fqdn = fqdn;
      const country = this.one(e, 'country');
      if (country) address.country = country;
      const wildcard = this.get(e, 'wildcard');
      if (wildcard?.length === 2) address.wildcard = { ip: wildcard[0]!, wildcard: wildcard[1]! };
      const intf = this.one(e, 'interface') ?? this.one(e, 'associated-interface');
      if (intf) {
        address.interface = intf;
        this.refs(e, 'interface', ['zone', 'interface'], vdom);
        this.refs(e, 'associated-interface', ['zone', 'interface'], vdom);
      }
      const comment = this.one(e, 'comment');
      if (comment) address.comment = comment;
      this.skip(e, 'uuid', 'color');
      ctx.addresses.push(address);
    }
  }

  private readAddressGroups(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('address', e.name, e.node.line, vdom);
      const group: AddressGroup = {
        name: e.name,
        members: this.get(e, 'member') ?? [],
        exclude: this.flag(e, 'exclude') ? (this.get(e, 'exclude-member') ?? []) : [],
        src: nodeSrc(e.node),
      };
      this.refs(e, 'member', ['address', 'vip'], vdom);
      this.refs(e, 'exclude-member', 'address', vdom);
      const comment = this.one(e, 'comment');
      if (comment) group.comment = comment;
      this.skip(e, 'uuid', 'color');
      ctx.addressGroups.push(group);
    }
  }

  private readServices(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('service', e.name, e.node.line, vdom);
      const protocol = this.one(e, 'protocol') ?? 'TCP/UDP/SCTP';
      const service: ServiceObject = {
        name: e.name,
        protocol,
        tcp: parsePortRanges(this.get(e, 'tcp-portrange')),
        udp: parsePortRanges(this.get(e, 'udp-portrange')),
        sctp: parsePortRanges(this.get(e, 'sctp-portrange')),
        src: nodeSrc(e.node),
      };
      if (!e.sets.has('protocol')) service.defaults = ['protocol'];
      const icmpType = this.one(e, 'icmptype');
      if (icmpType !== undefined) service.icmpType = Number(icmpType);
      const icmpCode = this.one(e, 'icmpcode');
      if (icmpCode !== undefined) service.icmpCode = Number(icmpCode);
      const number = this.one(e, 'protocol-number');
      if (number !== undefined) service.protocolNumber = Number(number);
      const category = this.one(e, 'category');
      if (category) service.category = category;
      const comment = this.one(e, 'comment');
      if (comment) service.comment = comment;
      this.skip(e, 'uuid', 'color', 'visibility');
      ctx.services.push(service);
    }
  }

  private readServiceGroups(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('service', e.name, e.node.line, vdom);
      const group: ServiceGroup = {
        name: e.name,
        members: this.get(e, 'member') ?? [],
        src: nodeSrc(e.node),
      };
      this.refs(e, 'member', 'service', vdom);
      const comment = this.one(e, 'comment');
      if (comment) group.comment = comment;
      this.skip(e, 'uuid', 'color');
      ctx.serviceGroups.push(group);
    }
  }

  private readVips(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('vip', e.name, e.node.line, vdom);
      const vip: Vip = {
        name: e.name,
        mappedip: this.get(e, 'mappedip') ?? [],
        portforward: this.flag(e, 'portforward') ?? false,
        src: nodeSrc(e.node),
      };
      const type = this.one(e, 'type');
      vip.type = type ?? 'static-nat';
      if (!type) vip.defaults = ['type'];
      const extip = this.one(e, 'extip');
      if (extip) vip.extip = extip;
      const extintf = this.one(e, 'extintf');
      if (extintf) {
        vip.extintf = extintf;
        this.refs(e, 'extintf', ['zone', 'interface'], vdom);
      }
      if (vip.portforward) {
        vip.protocol = this.one(e, 'protocol') ?? 'tcp';
        if (!e.sets.has('protocol')) vip.defaults = [...(vip.defaults ?? []), 'protocol'];
      }
      const extport = this.one(e, 'extport');
      if (extport) vip.extport = extport;
      const mappedport = this.one(e, 'mappedport');
      if (mappedport) vip.mappedport = mappedport;
      const comment = this.one(e, 'comment');
      if (comment) vip.comment = comment;
      this.skip(e, 'uuid', 'color');
      ctx.vips.push(vip);
      this.features.add('vip');
    }
  }

  private readIpPools(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('ippool', e.name, e.node.line, vdom);
      const type = this.one(e, 'type');
      const pool: IpPool = { name: e.name, type: type ?? 'overload', src: nodeSrc(e.node) };
      if (!type) pool.defaults = ['type'];
      const start = this.one(e, 'startip');
      if (start) pool.startip = start;
      const end = this.one(e, 'endip');
      if (end) pool.endip = end;
      const comment = this.one(e, 'comments');
      if (comment) pool.comment = comment;
      ctx.ippools.push(pool);
      this.features.add('nat');
    }
  }

  // ---- policies -------------------------------------------------------------------

  private readPolicies(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    const d = FORTIOS_DEFAULTS.policy;
    let order = 0;
    for (const e of this.entries(node)) {
      this.begin(e);
      order++;
      const defaults: string[] = [];
      const value = (key: string, fallback: string) => {
        const v = this.one(e, key);
        if (v === undefined) defaults.push(key);
        return v ?? fallback;
      };
      const policy: FirewallPolicy = {
        id: Number(e.name),
        order,
        enabled: value('status', d.status) === 'enable',
        srcintf: this.get(e, 'srcintf') ?? [],
        dstintf: this.get(e, 'dstintf') ?? [],
        srcaddr: this.get(e, 'srcaddr') ?? [],
        dstaddr: this.get(e, 'dstaddr') ?? [],
        srcaddrNegate: this.flag(e, 'srcaddr-negate') ?? false,
        dstaddrNegate: this.flag(e, 'dstaddr-negate') ?? false,
        service: this.get(e, 'service') ?? [],
        serviceNegate: this.flag(e, 'service-negate') ?? false,
        action: value('action', d.action),
        nat: value('nat', d.nat) === 'enable',
        ippool: this.flag(e, 'ippool') ?? false,
        poolname: this.get(e, 'poolname') ?? [],
        logtraffic: value('logtraffic', d.logtraffic),
        profiles: {},
        users: this.get(e, 'users') ?? [],
        groups: this.get(e, 'groups') ?? [],
        internetService: [
          ...(this.flag(e, 'internet-service') ? (this.get(e, 'internet-service-name') ?? []) : []),
        ],
        src: nodeSrc(e.node),
      };
      if (defaults.length > 0) policy.defaults = defaults;
      const name = this.one(e, 'name');
      if (name) policy.name = name;
      const uuid = this.one(e, 'uuid');
      if (uuid) policy.uuid = uuid;
      const schedule = this.one(e, 'schedule');
      if (schedule) policy.schedule = schedule;
      const comments = this.one(e, 'comments');
      if (comments) policy.comments = comments;
      for (const key of PROFILE_KEYS) {
        const v = this.one(e, key);
        if (v !== undefined) policy.profiles[key] = v;
      }
      this.refs(e, 'srcintf', ['zone', 'sdwan-zone', 'interface'], vdom);
      this.refs(e, 'dstintf', ['zone', 'sdwan-zone', 'interface'], vdom);
      this.refs(e, 'srcaddr', ['address', 'vip'], vdom);
      this.refs(e, 'dstaddr', ['address', 'vip'], vdom);
      this.refs(e, 'service', 'service', vdom);
      this.refs(e, 'poolname', 'ippool', vdom);
      if (policy.nat || policy.ippool) this.features.add('nat');
      ctx.policies.push(policy);
    }
  }

  // ---- routing --------------------------------------------------------------------

  private readStatics(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      const defaults: string[] = [];
      const dst = this.get(e, 'dst');
      const route: StaticRoute = {
        dst: (dst && parsePrefix(dst.join(' '))) || { ip: '0.0.0.0', prefix: 0 },
        enabled: this.one(e, 'status') !== 'disable',
        kind: 'route',
        src: nodeSrc(e.node),
      };
      if (!dst) defaults.push('dst');
      const gateway = this.one(e, 'gateway');
      if (gateway) route.gateway = gateway;
      const device = this.one(e, 'device');
      if (device) {
        route.device = device;
        this.refs(e, 'device', 'interface', '');
      }
      const distance = this.one(e, 'distance');
      route.distance = distance ? Number(distance) : FORTIOS_STATIC_DISTANCE;
      if (!distance) defaults.push('distance');
      if (this.flag(e, 'blackhole')) route.blackhole = true;
      const zones = this.get(e, 'sdwan-zone');
      if (zones) {
        route.sdwanZones = zones;
        this.refs(e, 'sdwan-zone', 'sdwan-zone', vdom);
      } else if (this.flag(e, 'sdwan') || this.flag(e, 'virtual-wan-link')) {
        route.sdwanZones = ['virtual-wan-link'];
      }
      const dstaddr = this.one(e, 'dstaddr');
      if (dstaddr) {
        route.name = dstaddr;
        this.refs(e, 'dstaddr', 'address', vdom);
      }
      const comment = this.one(e, 'comment');
      if (comment) route.name = comment;
      this.get(e, 'priority');
      if (defaults.length > 0) route.defaults = defaults;
      ctx.routing.statics.push(route);
      this.features.add('static-routes');
    }
  }

  private readPolicyRoutes(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      const route: PolicyRoute = {
        id: e.name,
        inputDevices: this.get(e, 'input-device') ?? [],
        srcaddr: [
          ...(this.get(e, 'src') ?? []).map(slashPrefix),
          ...(this.get(e, 'srcaddr') ?? []),
        ],
        dstaddr: [
          ...(this.get(e, 'dst') ?? []).map(slashPrefix),
          ...(this.get(e, 'dstaddr') ?? []),
        ],
        src: nodeSrc(e.node),
      };
      this.refs(e, 'input-device', 'interface', '');
      this.refs(e, 'srcaddr', 'address', vdom);
      this.refs(e, 'dstaddr', 'address', vdom);
      const protocol = this.one(e, 'protocol');
      if (protocol) route.protocol = Number(protocol);
      const gateway = this.one(e, 'gateway');
      if (gateway) route.gateway = gateway;
      const output = this.one(e, 'output-device');
      if (output) {
        route.outputDevice = output;
        this.refs(e, 'output-device', 'interface', '');
      }
      route.action = this.one(e, 'action') ?? 'permit';
      route.enabled = this.one(e, 'status') !== 'disable';
      const comment = this.one(e, 'comments');
      if (comment) route.comment = comment;
      ctx.routing.policyRoutes.push(route);
      this.features.add('pbr');
    }
  }

  private bgpNeighbor(e: Entry, vdom: string): BgpNeighbor {
    const n: BgpNeighbor = { address: e.name, src: nodeSrc(e.node) };
    const remoteAs = this.one(e, 'remote-as');
    if (remoteAs) n.remoteAs = remoteAs;
    const intf = this.one(e, 'interface');
    if (intf) {
      n.interface = intf;
      this.refs(e, 'interface', 'interface', '');
    }
    const source = this.one(e, 'update-source');
    if (source) {
      n.updateSource = source;
      this.refs(e, 'update-source', 'interface', '');
    }
    const description = this.one(e, 'description');
    if (description) n.description = description;
    const rmIn = this.one(e, 'route-map-in');
    if (rmIn) n.routeMapIn = rmIn;
    const rmOut = this.one(e, 'route-map-out');
    if (rmOut) n.routeMapOut = rmOut;
    const plIn = this.one(e, 'prefix-list-in');
    if (plIn) n.prefixListIn = plIn;
    const plOut = this.one(e, 'prefix-list-out');
    if (plOut) n.prefixListOut = plOut;
    this.refs(e, 'route-map-in', 'route-map', vdom);
    this.refs(e, 'route-map-out', 'route-map', vdom);
    this.refs(e, 'prefix-list-in', 'prefix-list', vdom);
    this.refs(e, 'prefix-list-out', 'prefix-list', vdom);
    if (this.flag(e, 'route-reflector-client')) n.routeReflectorClient = true;
    if (this.flag(e, 'next-hop-self')) n.nextHopSelf = true;
    if (this.flag(e, 'shutdown')) n.shutdown = true;
    this.get(e, 'advertisement-interval');
    this.get(e, 'link-down-failover');
    this.get(e, 'additional-path');
    this.get(e, 'soft-reconfiguration');
    this.get(e, 'capability-graceful-restart');
    this.get(e, 'ebgp-enforce-multihop');
    this.skip(e, 'password');
    return n;
  }

  private readBgp(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    const s = this.settings(node);
    const bgp: Bgp = {
      asn: this.one(s, 'as') ?? '',
      neighbors: [],
      groups: [],
      ranges: [],
      networks: [],
      redistribute: [],
      src: nodeSrc(node),
    };
    const routerId = this.one(s, 'router-id');
    if (routerId) bgp.routerId = routerId;
    this.get(s, 'ibgp-multipath');
    this.get(s, 'ebgp-multipath');
    this.get(s, 'additional-path');
    this.get(s, 'graceful-restart');
    const neighbors = s.configs.get('neighbor');
    if (neighbors) {
      this.structure(neighbors);
      for (const e of this.entries(neighbors)) {
        this.begin(e);
        bgp.neighbors.push(this.bgpNeighbor(e, vdom));
      }
    }
    const groups = s.configs.get('neighbor-group');
    if (groups) {
      this.structure(groups);
      for (const e of this.entries(groups)) {
        this.begin(e);
        this.ctx.define('peer-group', e.name, e.node.line, vdom);
        bgp.groups.push(this.bgpNeighbor(e, vdom));
      }
    }
    const ranges = s.configs.get('neighbor-range');
    if (ranges) {
      this.structure(ranges);
      for (const e of this.entries(ranges)) {
        this.begin(e);
        const prefix = this.get(e, 'prefix');
        const group = this.one(e, 'neighbor-group') ?? '';
        this.refs(e, 'neighbor-group', 'peer-group', vdom);
        const p = prefix ? parsePrefix(prefix.join(' ')) : null;
        bgp.ranges.push({
          prefix: p ? `${p.ip}/${p.prefix}` : (prefix ?? []).join(' '),
          group,
          src: nodeSrc(e.node),
        });
      }
    }
    const networks = s.configs.get('network');
    if (networks) {
      this.structure(networks);
      for (const e of this.entries(networks)) {
        this.begin(e);
        const prefix = this.get(e, 'prefix');
        const p = prefix ? parsePrefix(prefix.join(' ')) : null;
        const routeMap = this.one(e, 'route-map');
        this.refs(e, 'route-map', 'route-map', vdom);
        bgp.networks.push({
          prefix: p ? `${p.ip}/${p.prefix}` : (prefix ?? []).join(' '),
          ...(routeMap ? { routeMap } : {}),
          src: nodeSrc(e.node),
        });
      }
    }
    for (const [path, child] of s.configs) {
      const m = /^redistribute\s+"?([^"]+)"?$/.exec(path);
      if (!m) continue;
      const r = this.settings(child);
      // A redistribution written without "status enable" is off: understood, not kept.
      this.structure(child);
      if (this.one(r, 'status') !== 'enable') continue;
      const routeMap = this.one(r, 'route-map');
      this.refs(r, 'route-map', 'route-map', vdom);
      bgp.redistribute.push({
        protocol: m[1]!,
        ...(routeMap ? { routeMap } : {}),
        src: nodeSrc(child),
      });
    }
    ctx.routing.bgp = bgp;
    this.features.add('bgp');
  }

  private readOspf(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    const s = this.settings(node);
    const ospf: Ospf = {
      networks: [],
      areas: [],
      interfaces: [],
      passiveDefault: false,
      passive: this.get(s, 'passive-interface') ?? [],
      notPassive: [],
      redistribute: [],
      src: nodeSrc(node),
    };
    this.refs(s, 'passive-interface', 'interface', '');
    const routerId = this.one(s, 'router-id');
    if (routerId) ospf.routerId = routerId;
    const originate = this.one(s, 'default-information-originate');
    if (originate && originate !== 'disable') ospf.defaultOriginate = true;
    const areas = s.configs.get('area');
    if (areas) {
      this.structure(areas);
      for (const e of this.entries(areas)) {
        this.begin(e);
        const type = this.one(e, 'type');
        ospf.areas.push({ id: e.name, ...(type ? { type } : {}), src: nodeSrc(e.node) });
      }
    }
    const explicit = new Map<string, { area?: string; cost?: number; src: SyntaxNode }>();
    const ifaces = s.configs.get('ospf-interface');
    if (ifaces) {
      this.structure(ifaces);
      for (const e of this.entries(ifaces)) {
        this.begin(e);
        const name = this.one(e, 'interface');
        this.refs(e, 'interface', 'interface', '');
        const cost = this.one(e, 'cost');
        this.get(e, 'network-type');
        this.get(e, 'dead-interval');
        this.get(e, 'hello-interval');
        this.skip(e, 'authentication-key', 'md5-keys');
        if (name) explicit.set(name, { ...(cost ? { cost: Number(cost) } : {}), src: e.node });
      }
    }
    const nets: { ip: string; mask: string; area: string }[] = [];
    const networks = s.configs.get('network');
    if (networks) {
      this.structure(networks);
      for (const e of this.entries(networks)) {
        this.begin(e);
        const prefix = this.get(e, 'prefix');
        const area = this.one(e, 'area') ?? '0.0.0.0';
        const p = prefix ? parsePrefix(prefix.join(' ')) : null;
        if (p) {
          ospf.networks.push({ prefix: `${p.ip}/${p.prefix}`, area, src: nodeSrc(e.node) });
          nets.push({ ip: p.ip, mask: prefix![1] ?? '255.255.255.255', area });
        }
      }
    }
    for (const [path, child] of s.configs) {
      const m = /^redistribute\s+"?([^"]+)"?$/.exec(path);
      if (!m) continue;
      const r = this.settings(child);
      // A redistribution written without "status enable" is off: understood, not kept.
      this.structure(child);
      if (this.one(r, 'status') !== 'enable') continue;
      const routeMap = this.one(r, 'routemap') ?? this.one(r, 'route-map');
      this.refs(r, 'routemap', 'route-map', vdom);
      this.refs(r, 'route-map', 'route-map', vdom);
      ospf.redistribute.push({
        protocol: m[1]!,
        ...(routeMap ? { routeMap } : {}),
        src: nodeSrc(child),
      });
    }
    this.ospfPending.push({ ospf, nets, explicit, vdom });
    ctx.routing.ospf.push(ospf);
    this.features.add('ospf');
  }

  /** Interfaces in OSPF are known only after all interfaces have been read. */
  private readonly ospfPending: {
    ospf: Ospf;
    nets: { ip: string; mask: string; area: string }[];
    explicit: Map<string, { area?: string; cost?: number; src: SyntaxNode }>;
    vdom: string;
  }[] = [];

  private readRouteMaps(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('route-map', e.name, e.node.line, vdom);
      const rm: RouteMap = { name: e.name, entries: [], src: nodeSrc(e.node) };
      const rules = e.configs.get('rule');
      if (rules) {
        this.structure(rules);
        for (const r of this.entries(rules)) {
          this.begin(r);
          const match: string[] = [];
          const set: string[] = [];
          for (const [key, line] of r.sets) {
            const text =
              `${key.replace(/^(match|set)-/, '')} ${line.values.map((v) => v.value).join(' ')}`.trim();
            if (key.startsWith('match-')) match.push(text);
            else if (key.startsWith('set-')) set.push(text);
            else continue;
            this.ctx.understoodAll(line.node);
          }
          this.refs(r, 'match-ip-address', ['prefix-list', 'acl'], vdom);
          rm.entries.push({
            seq: Number(r.name),
            action: (this.one(r, 'action') as 'permit' | 'deny' | undefined) ?? 'permit',
            match,
            set,
            src: nodeSrc(r.node),
          });
        }
      }
      ctx.routing.routeMaps.push(rm);
    }
  }

  private readPrefixLists(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('prefix-list', e.name, e.node.line, vdom);
      const pl: PrefixList = { name: e.name, entries: [], src: nodeSrc(e.node) };
      const rules = e.configs.get('rule');
      if (rules) {
        this.structure(rules);
        for (const r of this.entries(rules)) {
          this.begin(r);
          const prefix = this.get(r, 'prefix') ?? ['any'];
          const p = prefix[0] === 'any' ? null : parsePrefix(prefix.join(' '));
          const ge = this.one(r, 'ge');
          const le = this.one(r, 'le');
          pl.entries.push({
            seq: Number(r.name),
            action: (this.one(r, 'action') as 'permit' | 'deny' | undefined) ?? 'permit',
            prefix: p ? `${p.ip}/${p.prefix}` : prefix.join(' '),
            ...(ge ? { ge: Number(ge) } : {}),
            ...(le ? { le: Number(le) } : {}),
            src: nodeSrc(r.node),
          });
        }
      }
      ctx.routing.prefixLists.push(pl);
    }
  }

  // ---- IPsec and SD-WAN -----------------------------------------------------------

  private readPhase1(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    const d = FORTIOS_DEFAULTS.phase1;
    for (const e of this.entries(node)) {
      this.begin(e);
      this.ctx.define('phase1', e.name, e.node.line, vdom);
      const defaults: string[] = [];
      const unverified: string[] = [];
      const value = <T>(
        read: () => T | undefined,
        fallback: T,
        field: string,
        uncertain = false,
      ): T => {
        const v = read();
        if (v !== undefined) return v;
        defaults.push(field);
        if (uncertain) unverified.push(field);
        return fallback;
      };
      const ike = value(
        () => num(this.one(e, 'ike-version')),
        fortiosDefaultIkeVersion(this.input.version),
        'ikeVersion',
        true,
      );
      const tunnel: IpsecTunnel = {
        name: e.name,
        type: value(() => this.one(e, 'type'), d.type, 'type'),
        ikeVersion: ike,
        proposals: value(() => this.get(e, 'proposal'), d.proposal, 'proposals', true),
        dhgrp: value(() => this.get(e, 'dhgrp')?.map(Number), d.dhgrp, 'dhgrp', true),
        peertype: value(() => this.one(e, 'peertype'), d.peertype, 'peertype'),
        netDevice: value(() => this.one(e, 'net-device'), d.netDevice, 'netDevice') === 'enable',
        addRoute: value(() => this.one(e, 'add-route'), d.addRoute, 'addRoute') === 'enable',
        dpd: value(() => this.one(e, 'dpd'), d.dpd, 'dpd'),
        phase2: [],
        src: nodeSrc(e.node),
      };
      const intf = this.one(e, 'interface');
      if (intf) {
        tunnel.interface = intf;
        this.refs(e, 'interface', 'interface', '');
      }
      const gw = this.one(e, 'remote-gw');
      if (gw) tunnel.remoteGw = gw;
      const ddns = this.one(e, 'remotegw-ddns');
      if (ddns) tunnel.remoteGwDdns = ddns;
      if (this.flag(e, 'auto-discovery-sender')) tunnel.advpn = 'sender';
      else if (this.flag(e, 'auto-discovery-receiver')) tunnel.advpn = 'receiver';
      this.get(e, 'tunnel-search');
      this.get(e, 'dpd-retryinterval');
      this.get(e, 'mode-cfg');
      this.get(e, 'exchange-interface-ip');
      // What the two sides of a tunnel must agree on, besides proposals and DH groups (#15).
      tunnel.mode = value(() => this.one(e, 'mode'), d.mode, 'mode');
      tunnel.authMethod = value(() => this.one(e, 'authmethod'), d.authMethod, 'authMethod');
      tunnel.natTraversal = value(
        () => this.one(e, 'nattraversal'),
        d.natTraversal,
        'natTraversal',
      );
      tunnel.keylife = value(() => num(this.one(e, 'keylife')), d.keylife, 'keylife');
      const localId = this.one(e, 'localid');
      if (localId) tunnel.localId = localId;
      const peerId = this.one(e, 'peerid');
      if (peerId) tunnel.peerId = peerId;
      this.get(e, 'network-overlay');
      const networkId = num(this.one(e, 'network-id'));
      if (networkId !== undefined) tunnel.networkId = networkId;
      this.skip(e, 'psksecret', 'psksecret-remote', 'ppk-secret');
      if (defaults.length > 0) tunnel.defaults = defaults;
      if (unverified.length > 0) tunnel.unverified = unverified;
      if (tunnel.advpn) this.features.add('advpn');
      ctx.ipsec.push(tunnel);
      this.features.add('ipsec');
    }
  }

  private readPhase2(node: SyntaxNode, vdom: string) {
    this.structure(node);
    const ctx = this.context(vdom);
    const d = FORTIOS_DEFAULTS.phase2;
    for (const e of this.entries(node)) {
      this.begin(e);
      const defaults: string[] = [];
      const phase1 = this.one(e, 'phase1name');
      this.refs(e, 'phase1name', 'phase1', vdom);
      const or = <T>(v: T | undefined, fallback: T, field: string): T => {
        if (v !== undefined) return v;
        defaults.push(field);
        return fallback;
      };
      const p2: IpsecPhase2 = {
        name: e.name,
        proposals: or(this.get(e, 'proposal'), d.proposal, 'proposals'),
        dhgrp: or(this.get(e, 'dhgrp')?.map(Number), d.dhgrp, 'dhgrp'),
        pfs: or(this.one(e, 'pfs'), d.pfs, 'pfs') === 'enable',
        autoNegotiate:
          or(this.one(e, 'auto-negotiate'), d.autoNegotiate, 'autoNegotiate') === 'enable',
        keylifeSeconds: Number(
          or(this.one(e, 'keylifeseconds'), String(d.keylifeSeconds), 'keylifeSeconds'),
        ),
        src: nodeSrc(e.node),
      };
      const srcSubnet = this.get(e, 'src-subnet');
      if (srcSubnet) p2.srcSubnet = prefixText(srcSubnet);
      const dstSubnet = this.get(e, 'dst-subnet');
      if (dstSubnet) p2.dstSubnet = prefixText(dstSubnet);
      if (defaults.length > 0) p2.defaults = defaults;
      const tunnel = ctx.ipsec.find((t) => t.name === phase1);
      if (tunnel) tunnel.phase2.push(p2);
      else this.orphanPhase2.push({ vdom, phase1: phase1 ?? '', p2 });
    }
  }

  private readonly orphanPhase2: { vdom: string; phase1: string; p2: IpsecPhase2 }[] = [];

  private readSdwan(node: SyntaxNode, vdom: string) {
    const s = this.settings(node);
    const status = this.one(s, 'status');
    this.structure(node);
    const ctx = this.context(vdom);
    const sdwan: Sdwan = {
      enabled: status === 'enable',
      zones: [],
      members: [],
      healthChecks: [],
      rules: [],
      src: nodeSrc(node),
    };
    const zones = s.configs.get('zone');
    if (zones) {
      this.structure(zones);
      for (const e of this.entries(zones)) {
        this.begin(e);
        this.ctx.define('sdwan-zone', e.name, e.node.line, vdom);
        sdwan.zones.push({ name: e.name, src: nodeSrc(e.node) });
      }
    }
    const members = s.configs.get('members');
    if (members) {
      this.structure(members);
      for (const e of this.entries(members)) {
        this.begin(e);
        const intf = this.one(e, 'interface') ?? '';
        this.refs(e, 'interface', 'interface', '');
        this.refs(e, 'zone', 'sdwan-zone', vdom);
        const zone = this.one(e, 'zone');
        const member: SdwanMember = {
          seq: Number(e.name),
          interface: intf,
          zone: zone ?? 'virtual-wan-link',
          enabled: this.one(e, 'status') !== 'disable',
          src: nodeSrc(e.node),
        };
        if (!zone) member.defaults = ['zone'];
        const gateway = this.one(e, 'gateway');
        if (gateway) member.gateway = gateway;
        const cost = this.one(e, 'cost');
        if (cost) member.cost = Number(cost);
        const priority = this.one(e, 'priority');
        if (priority) member.priority = Number(priority);
        const weight = this.one(e, 'weight');
        if (weight) member.weight = Number(weight);
        this.get(e, 'source');
        sdwan.members.push(member);
      }
    }
    const checks = s.configs.get('health-check');
    if (checks) {
      this.structure(checks);
      for (const e of this.entries(checks)) {
        this.begin(e);
        this.ctx.define('health-check', e.name, e.node.line, vdom);
        const protocol = this.one(e, 'protocol');
        const check: SdwanHealthCheck = {
          name: e.name,
          servers: this.get(e, 'server') ?? [],
          protocol: protocol ?? FORTIOS_DEFAULTS.healthCheck.protocol,
          members: (this.get(e, 'members') ?? []).map(Number),
          sla: [],
          src: nodeSrc(e.node),
        };
        if (!protocol) check.defaults = ['protocol'];
        this.get(e, 'source');
        this.get(e, 'interval');
        this.get(e, 'failtime');
        this.get(e, 'recoverytime');
        this.get(e, 'update-static-route');
        const slas = e.configs.get('sla');
        if (slas) {
          this.structure(slas);
          for (const sl of this.entries(slas)) {
            this.begin(sl);
            const sla: SdwanHealthCheck['sla'][number] = {
              id: Number(sl.name),
              src: nodeSrc(sl.node),
            };
            const latency = this.one(sl, 'latency-threshold');
            const jitter = this.one(sl, 'jitter-threshold');
            const loss = this.one(sl, 'packetloss-threshold');
            const hc = FORTIOS_DEFAULTS.healthCheck;
            sla.latency = latency ? Number(latency) : hc.latency;
            sla.jitter = jitter ? Number(jitter) : hc.jitter;
            sla.packetloss = loss ? Number(loss) : hc.packetloss;
            const missing = [
              !latency && 'latency',
              !jitter && 'jitter',
              !loss && 'packetloss',
            ].filter((x): x is string => typeof x === 'string');
            if (missing.length > 0) sla.defaults = missing;
            this.get(sl, 'link-cost-factor');
            check.sla.push(sla);
          }
        }
        sdwan.healthChecks.push(check);
      }
    }
    const services = s.configs.get('service');
    if (services) {
      this.structure(services);
      for (const e of this.entries(services)) {
        this.begin(e);
        const mode = this.one(e, 'mode');
        const rule: SdwanRule = {
          id: Number(e.name),
          mode: mode ?? FORTIOS_DEFAULTS.sdwanRule.mode,
          dstaddr: this.get(e, 'dst') ?? [],
          srcaddr: this.get(e, 'src') ?? [],
          internetService: this.flag(e, 'internet-service')
            ? (this.get(e, 'internet-service-name') ?? [])
            : [],
          application: this.get(e, 'internet-service-app-ctrl') ?? [],
          sla: [],
          priorityMembers: (this.get(e, 'priority-members') ?? []).map(Number),
          priorityZones: this.get(e, 'priority-zone') ?? [],
          enabled: this.one(e, 'status') !== 'disable',
          src: nodeSrc(e.node),
        };
        if (!mode) rule.defaults = ['mode'];
        const name = this.one(e, 'name');
        if (name) rule.name = name;
        const hc = this.one(e, 'health-check');
        if (hc) rule.healthCheck = hc;
        this.refs(e, 'dst', ['address', 'vip'], vdom);
        this.refs(e, 'src', ['address', 'vip'], vdom);
        this.refs(e, 'health-check', 'health-check', vdom);
        this.refs(e, 'priority-zone', 'sdwan-zone', vdom);
        const slas = e.configs.get('sla');
        if (slas) {
          this.structure(slas);
          for (const sl of this.entries(slas)) {
            this.begin(sl);
            const id = this.one(sl, 'id');
            this.ctx.refAt(
              sl.node.line,
              ...nameColumns(this.lines[sl.node.line - 1] ?? '', sl.name),
              'health-check',
              sl.name,
              vdom,
            );
            rule.sla.push({ healthCheck: sl.name, ...(id ? { id: Number(id) } : {}) });
          }
        }
        sdwan.rules.push(rule);
      }
    }
    ctx.sdwan = sdwan;
    if (sdwan.enabled) this.features.add('sdwan');
  }

  // ---- after reading ----------------------------------------------------------------

  private finishInterfaces() {
    for (const [name, lag] of this.lagOf) {
      const iface = this.interfaces.get(name);
      if (iface) iface.lag = lag;
    }
    for (const [name, members] of this.switchMembers) {
      const iface = this.interfaces.get(name);
      if (iface) {
        iface.kind = 'hard-switch';
        iface.members = members;
      }
    }
    for (const p of this.ospfPending) {
      const passive = (name: string) => p.ospf.passive.includes(name);
      const seen = new Set<string>();
      for (const [name, x] of p.explicit) {
        seen.add(name);
        const iface = this.interfaces.get(name);
        const area = x.area ?? this.areaOf(iface, p.nets);
        p.ospf.interfaces.push({
          name,
          ...(area !== undefined ? { area } : {}),
          ...(x.cost !== undefined ? { cost: x.cost } : {}),
          passive: passive(name),
          src: nodeSrc(x.src),
        });
      }
      for (const iface of this.interfaces.values()) {
        if (seen.has(iface.name) || (iface.context ?? 'root') !== p.vdom) continue;
        const area = this.areaOf(iface, p.nets);
        if (area === undefined) continue;
        p.ospf.interfaces.push({
          name: iface.name,
          area,
          passive: passive(iface.name),
          src: iface.src,
        });
      }
    }
    for (const o of this.orphanPhase2) {
      this.context(o.vdom)
        .ipsec.find((t) => t.name === o.phase1)
        ?.phase2.push(o.p2);
    }
  }

  private areaOf(
    iface: Interface | undefined,
    nets: { ip: string; mask: string; area: string }[],
  ): string | undefined {
    if (!iface) return undefined;
    for (const a of iface.ipv4) {
      const ip = ipToInt(a.ip);
      if (ip === null) continue;
      // FortiOS writes a netmask: the inverse is the wildcard.
      const net = nets.find((n) => {
        const mask = ipToInt(n.mask);
        if (mask === null) return false;
        const wildcard = [24, 16, 8, 0]
          .map((sh) => 255 - (Math.floor(mask / 2 ** sh) % 256))
          .join('.');
        return wildcardMatches(n.ip, wildcard, ip);
      });
      if (net) return net.area;
    }
    return undefined;
  }

  /** Built-in objects that policies use without defining them, and the policy warnings. */
  private finishContext(context: LogicalContext) {
    const used = new Set(context.policies.flatMap((p) => [...p.srcaddr, ...p.dstaddr]));
    for (const sdwan of context.sdwan ? [context.sdwan] : []) {
      for (const r of sdwan.rules) for (const n of [...r.srcaddr, ...r.dstaddr]) used.add(n);
    }
    for (const builtin of builtinAddresses()) {
      if (!context.addresses.some((a) => a.name === builtin.name) && used.has(builtin.name)) {
        context.addresses.push(builtin);
      }
    }
    const usedServices = new Set(context.policies.flatMap((p) => p.service));
    for (const group of context.serviceGroups) for (const m of group.members) usedServices.add(m);
    for (const builtin of builtinServices()) {
      if (
        !context.services.some((s) => s.name === builtin.name) &&
        usedServices.has(builtin.name)
      ) {
        context.services.push(builtin);
      }
    }
    for (const p of context.policies) {
      if (!p.enabled)
        this.warnings.push({ code: 'policy-disabled', line: p.src[0]![0], context: context.name });
      if (p.action === 'accept' && p.logtraffic === 'disable') {
        this.warnings.push({ code: 'policy-no-log', line: p.src[0]![0], context: context.name });
      }
      if (
        p.action === 'accept' &&
        p.srcaddr.includes('all') &&
        p.dstaddr.includes('all') &&
        p.service.includes('ALL')
      ) {
        this.warnings.push({ code: 'policy-any-any', line: p.src[0]![0], context: context.name });
      }
      if (
        p.action === 'accept' &&
        p.srcaddr.includes('all') &&
        p.service.some((s) => MANAGEMENT_SERVICES.includes(s))
      ) {
        this.warnings.push({
          code: 'policy-all-management',
          line: p.src[0]![0],
          context: context.name,
        });
      }
    }
  }

  private management(): { management?: { ip: string; interface?: string } } {
    const all = [...this.interfaces.values()].filter((i) => i.ipv4.length > 0 && !i.shutdown);
    const pick =
      all.find((i) => i.kind === 'management') ??
      all.find(
        (i) =>
          /mgmt|manag|gest/i.test(`${i.name} ${i.alias ?? ''}`) &&
          (i.allowAccess ?? []).some((a) => a === 'https' || a === 'ssh'),
      ) ??
      all.find(
        (i) => i.role === 'lan' && (i.allowAccess ?? []).some((a) => a === 'https' || a === 'ssh'),
      );
    return pick ? { management: { ip: pick.ipv4[0]!.ip, interface: pick.name } } : {};
  }
}

type SdwanMember = Sdwan['members'][number];

/** Profiles of a policy kept in the model, by FortiOS setting name. */
const PROFILE_KEYS = [
  'utm-status',
  'inspection-mode',
  'ssl-ssh-profile',
  'av-profile',
  'webfilter-profile',
  'dnsfilter-profile',
  'emailfilter-profile',
  'application-list',
  'ips-sensor',
  'file-filter-profile',
  'waf-profile',
  'voip-profile',
  'profile-protocol-options',
];

/** Default administrative distance of a FortiOS static route. */
const FORTIOS_STATIC_DISTANCE = 10;

function interfaceKind(
  type: string | undefined,
  parent: string | undefined,
  vlanId: string | undefined,
  name: string,
): InterfaceKind {
  switch (type) {
    case 'physical':
      return 'physical';
    case 'aggregate':
    case 'redundant':
      return 'lag';
    case 'tunnel':
      return 'tunnel';
    case 'loopback':
      return 'loopback';
    case 'vdom-link':
      return 'vdom-link';
    case 'hard-switch':
    case 'switch':
      return 'hard-switch';
    case 'vlan':
      return 'subinterface';
    case undefined:
      if (parent && vlanId) return 'subinterface';
      return /^(port|wan|internal|dmz|lan|x|a|b|ha|mgmt)\d*$/.test(name) ? 'physical' : 'other';
    default:
      return 'other';
  }
}

/** "80 443 1000-2000:1024-65535" → destination and source port ranges. */
export function parsePortRanges(values: string[] | undefined): ServicePorts[] {
  if (!values) return [];
  const out: ServicePorts[] = [];
  for (const v of values) {
    const [dst, src] = v.split(':');
    const d = range(dst ?? '');
    if (!d) continue;
    const s = src ? range(src) : null;
    out.push(s ? { dst: d, src: s } : { dst: d });
  }
  return out;
}

function range(text: string): PortRange | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(text.trim());
  if (!m) return null;
  return { low: Number(m[1]), high: Number(m[2] ?? m[1]) };
}

/** "10.0.0.0/255.255.255.0" (policy routes) → "10.0.0.0/24". */
function slashPrefix(value: string): string {
  const p = parsePrefix(value.replace('/', ' '));
  return p ? `${p.ip}/${p.prefix}` : value;
}

/** The VLANs that every managed FortiSwitch has, besides the VLAN interfaces of the FortiGate. */
const FORTISWITCH_VLANS: Record<string, number> = {
  _default: 1,
  quarantine: 4093,
  rspan: 4092,
  onboarding: 4094,
};

/** "S248EPTF20000001" → "FortiSwitch 248E-POE": the model is in the serial number. */
function fortiswitchModel(serial: string): string | undefined {
  const m = /^S(\d{3}[A-Z])([PF])?/.exec(serial);
  if (!m) return undefined;
  return `FortiSwitch ${m[1]}${m[2] === 'P' ? '-POE' : m[2] === 'F' ? '-FPOE' : ''}`;
}

/** Front ports of a FortiSwitch, from its model: 248 → 48, 124 → 24, 108 → 8. */
function switchDownlinks(serial: string): number {
  const m = /^S\d(\d{2})/.exec(serial);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** "FP231FTF20000001" → "FortiAP 231F". */
function fortiapModel(serial: string): string | undefined {
  const m = /^FP(\d{3}[A-Z])/.exec(serial);
  return m ? `FortiAP ${m[1]}` : undefined;
}

function num(v: string | undefined): number | undefined {
  return v === undefined ? undefined : Number(v);
}

function prefixText(values: string[]): string {
  const p = parsePrefix(values.join(' '));
  return p ? `${p.ip}/${p.prefix}` : values.join(' ');
}

/** Columns of a quoted or bare name in an "edit" line. */
function nameColumns(raw: string, name: string): [number, number] {
  const tokens = tokenize(raw);
  const t = tokens.find((x, i) => i > 0 && x.value === name);
  return t ? [t.from, t.to] : [-1, -1];
}

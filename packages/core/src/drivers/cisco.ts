import type { OsId } from '../detect/types';
import { ipToInt, isIpv4, maskToPrefix, wildcardMatches, wildcardToPrefix } from '../model/ip';
import {
  ciscoInterfaceKind,
  normalizeInterfaceName,
  normalizeMac,
  parsePortNumbers,
  speedClass,
} from '../model/names';
import {
  emptyContext,
  type Acl,
  type AclBinding,
  type AclEntry,
  type AddressMatch,
  type Bgp,
  type BgpNeighbor,
  type DeviceModel,
  type FeatureCode,
  type Interface,
  type LogicalContext,
  type ModelWarning,
  type ObjectGroup,
  type ObjectGroupEntry,
  type Ospf,
  type PortMatch,
  type PortSecurityMac,
  type StackMember,
  type StaticRoute,
  type Switchport,
  type SwitchportMode,
  type Vlan,
  type VlanSet,
} from '../model/types';
import {
  parseVlanList,
  vlanSetAdd,
  vlanSetAll,
  vlanSetExcept,
  vlanSetFrom,
  vlanSetNone,
  vlanSetRemove,
} from '../model/vlans';
import type { SyntaxNode, SyntaxTree } from '../syntax/types';
import { DriverContext, findWord, lineSrc, nodeSrc } from './context';
import { CISCO_IOS_DEFAULTS, CISCO_SB_DEFAULTS, type SwitchDefaults } from './defaults';

export interface DriverInput {
  lines: string[];
  tree: SyntaxTree;
  os: OsId;
  version?: string;
  model?: string;
  hostname?: string;
}

const IGNORED_TOP = [
  /^Building configuration/,
  /^Current configuration\s*:/,
  /^end$/,
  /^exit$/,
  /^boot-start-marker$/,
  /^boot-end-marker$/,
  /^config-file-header$/,
  /^ssd-control-start$/,
  /^unit-type-control-start$/,
  /^banner\s/,
  /^crypto pki certificate chain\s/,
];

/** Reads a Cisco IOS, IOS-XE or Small Business configuration into the neutral model. */
export function buildCiscoModel(input: DriverInput): DeviceModel {
  return new CiscoReader(input).read();
}

interface PendingBinding {
  acl: string;
  binding: AclBinding;
}

class CiscoReader {
  private readonly ctx: DriverContext;
  private readonly sb: boolean;
  private readonly defaults: SwitchDefaults;
  private readonly interfaces = new Map<string, Interface>();
  private readonly vlans = new Map<number, Vlan>();
  private readonly sviNames = new Map<number, { name: string; line: number }>();
  private readonly context: LogicalContext = emptyContext('default');
  private readonly provision: StackMember[] = [];
  private readonly bindings: PendingBinding[] = [];
  private readonly snmpAcls: { acl: string; line: number }[] = [];
  private readonly sourceInterfaces: string[] = [];
  private readonly features = new Set<FeatureCode>();
  private readonly sections = new Map<number, { key: string; parent?: number }>();
  private readonly ospfNetworks: { ospf: Ospf; ip: string; wildcard: string; area: string }[] = [];
  private hostname?: string;
  private vtpMode?: string;
  private vtpLine?: number;
  private voiceVlanGlobal?: number;

  constructor(private readonly input: DriverInput) {
    this.ctx = new DriverContext(input.lines);
    this.sb = input.os === 'cisco-sb';
    this.defaults = this.sb ? CISCO_SB_DEFAULTS : CISCO_IOS_DEFAULTS;
  }

  read(): DeviceModel {
    this.assignSections(this.input.tree.nodes);
    for (const node of this.input.tree.nodes) this.readTop(node);
    this.ignoreComments(this.input.tree.nodes);
    this.finishInterfaces();
    this.finishOspf();
    this.attachBindings();
    const stack = this.stackMembers();
    const vlans = this.finishVlans();
    const warnings: ModelWarning[] = [];
    if (
      this.vtpMode === 'server' ||
      this.vtpMode === 'client' ||
      (vlans.every((v) => v.implicit) && vlans.length > 1)
    ) {
      warnings.push({
        code: 'vtp-vlans-not-in-config',
        ...(this.vtpLine ? { line: this.vtpLine } : {}),
      });
      this.features.add('vtp');
    }
    const interfaces = [...this.interfaces.values()];
    if (interfaces.some((i) => i.unverified && i.unverified.length > 0)) {
      warnings.push({ code: 'unverified-defaults' });
    }
    if (stack.length > 1) this.features.add('stack');
    return {
      vendor: 'cisco',
      os: this.input.os,
      ...(this.input.version ? { version: this.input.version } : {}),
      ...(this.input.model ? { model: this.input.model } : {}),
      ...((this.hostname ?? this.input.hostname)
        ? { hostname: this.hostname ?? this.input.hostname }
        : {}),
      stack,
      interfaces,
      vlans,
      contexts: [this.context],
      ...this.management(),
      ...(this.vtpMode ? { vtpMode: this.vtpMode } : {}),
      features: [...this.features].sort(),
      references: this.ctx.references(),
      coverage: this.ctx.coverage((line) => this.sectionOf(line)),
      warnings,
    };
  }

  /** Comments ("!") are ignored on purpose everywhere, also inside blocks nobody reads. */
  private ignoreComments(nodes: SyntaxNode[]) {
    for (const node of nodes) {
      if (node.kind === 'comment') this.ctx.ignoredAll(node);
      else if (node.children.length > 0) this.ignoreComments(node.children);
    }
  }

  /**
   * Lines not understood are grouped by command: "snmp-server location", "aaa". Inside a block
   * that is understood the group names the block too ("interface › storm-control"); inside a
   * block that is not, the lines count for the block.
   */
  private assignSections(nodes: SyntaxNode[], parent?: SyntaxNode, top?: string) {
    for (const node of nodes) {
      const key = top ? `${top} › ${commandKey(node.text)}` : commandKey(node.text);
      const entry = { key, ...(parent ? { parent: parent.line } : {}) };
      for (let l = node.line; l <= node.endLine; l++) {
        if (!this.sections.has(l) || l === node.line) this.sections.set(l, entry);
      }
      if (node.children.length > 0)
        this.assignSections(node.children, node, top ?? commandKey(node.text));
    }
  }

  private sectionOf(line: number): string {
    const entry = this.sections.get(line);
    if (!entry) return 'other';
    if (entry.parent !== undefined && this.ctx.lineStatus(entry.parent) === 'unknown')
      return this.sectionOf(entry.parent);
    return entry.key;
  }

  private readTop(node: SyntaxNode) {
    const t = node.text;
    let m: RegExpExecArray | null;
    if (node.kind === 'comment') return this.ctx.ignoredAll(node);
    if (IGNORED_TOP.some((re) => re.test(t))) return this.ctx.ignoredAll(node);

    if ((m = /^hostname\s+(\S+)$/.exec(t))) {
      this.hostname = m[1]!;
      this.ctx.understood(node);
    } else if (/^version\s+\S+/.test(t)) {
      this.ctx.understood(node);
    } else if ((m = /^switch\s+(\d+)\s+provision\s+(\S+)$/.exec(t))) {
      this.provision.push({ member: Number(m[1]), model: m[2]!.toUpperCase(), src: nodeSrc(node) });
      this.ctx.understood(node);
    } else if ((m = /^vlan\s+([\d,\s-]+)$/.exec(t))) {
      this.readVlanBlock(node, m[1]!);
    } else if (this.sb && t === 'vlan database') {
      this.readVlanDatabase(node);
    } else if ((m = /^vtp\s+mode\s+(\S+)$/.exec(t))) {
      this.vtpMode = m[1]!;
      this.vtpLine = node.line;
      this.ctx.understood(node);
    } else if (/^vtp\s+(domain|version|pruning|password)\b/.test(t)) {
      this.ctx.understood(node);
    } else if ((m = /^voice vlan id (\d+)$/.exec(t))) {
      this.voiceVlanGlobal = Number(m[1]);
      this.ctx.understood(node);
    } else if ((m = /^interface\s+(.+)$/.exec(t))) {
      this.readInterface(node, m[1]!);
    } else if (/^ip route\s/.test(t)) {
      this.readStaticRoute(node);
    } else if ((m = /^ip default-gateway\s+(\S+)$/.exec(t))) {
      this.context.routing.statics.push({
        dst: { ip: '0.0.0.0', prefix: 0 },
        gateway: m[1]!,
        enabled: true,
        kind: 'default-gateway',
        src: nodeSrc(node),
      });
      this.features.add('static-routes');
      this.ctx.understood(node);
    } else if (t === 'ip routing') {
      this.features.add('ip-routing');
      this.ctx.understood(node);
    } else if (t === 'no ip routing') {
      this.ctx.understood(node);
    } else if ((m = /^router ospf\s+(\S+)(?:\s+vrf\s+(\S+))?$/.exec(t))) {
      this.readOspf(node, m[1]!);
    } else if ((m = /^router bgp\s+(\S+)$/.exec(t))) {
      this.readBgp(node, m[1]!);
    } else if ((m = /^ip access-list\s+(standard|extended)\s+(\S+)$/.exec(t))) {
      this.readNamedAcl(node, m[2]!, m[1] as 'standard' | 'extended');
    } else if ((m = /^ipv6 access-list\s+(\S+)$/.exec(t))) {
      this.readNamedAcl(node, m[1]!, 'ipv6');
    } else if ((m = /^mac access-list extended\s+(\S+)$/.exec(t))) {
      this.readNamedAcl(node, m[1]!, 'mac');
    } else if ((m = /^access-list\s+(\d+)\s+(.+)$/.exec(t))) {
      this.readNumberedAcl(node, m[1]!, m[2]!);
    } else if (this.sb && (m = /^management access-list\s+(\S+)$/.exec(t))) {
      this.readNamedAcl(node, m[1]!, 'management');
    } else if (this.sb && (m = /^management access-class\s+(\S+)$/.exec(t))) {
      this.bindings.push({ acl: m[1]!, binding: { kind: 'management', src: nodeSrc(node) } });
      this.ctx.understood(node);
      this.ctx.ref(node.line, m[1]!, 'acl', 'management access-class'.length);
    } else if ((m = /^object-group\s+(network|service)\s+(\S+)$/.exec(t))) {
      this.readObjectGroup(node, m[2]!, m[1] as 'network' | 'service');
    } else if ((m = /^route-map\s+(\S+)(?:\s+(permit|deny))?(?:\s+(\d+))?$/.exec(t))) {
      this.readRouteMap(
        node,
        m[1]!,
        (m[2] as 'permit' | 'deny') ?? 'permit',
        m[3] ? Number(m[3]) : undefined,
      );
    } else if ((m = /^ip prefix-list\s+(\S+)\s+(.+)$/.exec(t))) {
      this.readPrefixList(node, m[1]!, m[2]!);
    } else if ((m = /^line\s+(vty|con|console|aux)\s*(.*)$/.exec(t))) {
      this.readLine(node, `${m[1]} ${m[2]}`.trim());
    } else if ((m = /^snmp-server community\s+\S+\s+(.+)$/.exec(t))) {
      const last = m[1]!.split(/\s+/).at(-1)!;
      if (!/^(RO|RW|ro|rw)$/.test(last)) this.snmpAcls.push({ acl: last, line: node.line });
    } else if (
      (m =
        /^(?:ip ssh source-interface|logging source-interface|ntp source|snmp-server trap-source|ip tacacs source-interface|ip radius source-interface)\s+(\S+)/.exec(
          t,
        ))
    ) {
      this.sourceInterfaces.push(normalizeInterfaceName(m[1]!));
      this.refInterfaceName(node.line, m[1]!);
    }
  }

  // ---- VLANs ----------------------------------------------------------------------

  private readVlanBlock(node: SyntaxNode, list: string) {
    const ranges = parseVlanList(list);
    if (!ranges) return;
    this.ctx.understood(node);
    let name: string | undefined;
    for (const child of node.children) {
      const m = /^name\s+(.+)$/.exec(child.text);
      if (m) {
        name = m[1]!.trim();
        this.ctx.understood(child);
      }
    }
    for (const r of ranges) {
      for (let id = r.from; id <= r.to; id++) {
        this.vlans.set(id, {
          id,
          ...(name && r.from === r.to ? { name } : {}),
          src: nodeSrc(node),
        });
        this.ctx.define('vlan', String(id), node.line);
      }
    }
  }

  private readVlanDatabase(node: SyntaxNode) {
    this.ctx.understood(node);
    this.ctx.understoodClosing(node);
    for (const child of node.children) {
      const m = /^vlan\s+([\d,\s-]+)$/.exec(child.text);
      if (!m) continue;
      const ranges = parseVlanList(m[1]!);
      if (!ranges) continue;
      this.ctx.understood(child);
      for (const r of ranges) {
        for (let id = r.from; id <= r.to; id++) {
          this.vlans.set(id, { id, src: lineSrc(child.line) });
          this.ctx.define('vlan', String(id), child.line);
        }
      }
    }
  }

  private finishVlans(): Vlan[] {
    for (const [id, svi] of this.sviNames) {
      const vlan = this.vlans.get(id);
      if (vlan && !vlan.name) vlan.name = svi.name;
      else if (!vlan) this.vlans.set(id, { id, name: svi.name, src: lineSrc(svi.line) });
    }
    // VLANs used by ports but not defined: VTP server/client keeps them out of the config.
    const used = new Set<number>();
    for (const iface of this.interfaces.values()) {
      if (iface.kind === 'svi' && iface.vlanId !== undefined) used.add(iface.vlanId);
      const sp = iface.switchport;
      if (!sp) continue;
      for (const v of [sp.accessVlan, sp.voiceVlan, sp.nativeVlan])
        if (v !== undefined) used.add(v);
    }
    if (!this.vlans.has(1)) {
      this.vlans.set(1, { id: 1, name: 'default', implicit: true, src: [], defaults: ['name'] });
    }
    for (const id of used) {
      if (!this.vlans.has(id)) this.vlans.set(id, { id, implicit: true, src: [] });
    }
    const voice = new Set<number>(this.voiceVlanGlobal !== undefined ? [this.voiceVlanGlobal] : []);
    for (const iface of this.interfaces.values()) {
      if (iface.switchport?.voiceVlan !== undefined) voice.add(iface.switchport.voiceVlan);
    }
    for (const id of voice) {
      const vlan = this.vlans.get(id);
      if (vlan) vlan.voice = true;
    }
    if (voice.size > 0) this.features.add('voice-vlan');
    return [...this.vlans.values()].sort((a, b) => a.id - b.id);
  }

  // ---- interfaces -----------------------------------------------------------------

  private readInterface(node: SyntaxNode, rawName: string) {
    const name = normalizeInterfaceName(rawName);
    this.ctx.understood(node);
    this.ctx.define('interface', name, node.line);
    const iface: Interface = {
      name,
      kind: ciscoInterfaceKind(name),
      shutdown: false,
      ipv4: [],
      src: nodeSrc(node),
    };
    if (iface.kind === 'svi') iface.vlanId = Number(/\d+$/.exec(name)![0]);
    const sp: {
      mode?: SwitchportMode;
      access?: number;
      voice?: number;
      native?: number;
      nonegotiate?: boolean;
    } = {};
    let routed = false;
    let allowed: VlanSet | undefined;
    let tagged: VlanSet | undefined;
    let untagged: VlanSet | undefined;
    let pvid: number | undefined;
    const portSecurity = {
      enabled: false,
      sticky: false,
      macs: [] as PortSecurityMac[],
      maximum: undefined as number | undefined,
    };

    for (const child of node.children) {
      const t = child.text;
      const ok = () => this.ctx.understood(child);
      const vlanRef = (id: string) =>
        this.ctx.ref(child.line, id, 'vlan', t.lastIndexOf(id) - 1 + this.indent(child));
      let m: RegExpExecArray | null;
      if (child.kind === 'comment') {
        this.ctx.ignoredAll(child);
      } else if ((m = /^description\s+(.*)$/.exec(t))) {
        iface.description = m[1]!.trim();
        ok();
      } else if (t === 'switchport') {
        ok();
      } else if (t === 'no switchport') {
        routed = true;
        ok();
      } else if (
        (m = /^switchport mode\s+(access|trunk|general|dynamic auto|dynamic desirable)$/.exec(t))
      ) {
        sp.mode =
          m[1] === 'dynamic auto'
            ? 'dynamic-auto'
            : m[1] === 'dynamic desirable'
              ? 'dynamic-desirable'
              : (m[1] as SwitchportMode);
        ok();
      } else if ((m = /^switchport access vlan\s+(\d+)$/.exec(t))) {
        sp.access = Number(m[1]);
        vlanRef(m[1]!);
        ok();
      } else if ((m = /^switchport voice vlan\s+(\d+)$/.exec(t))) {
        sp.voice = Number(m[1]);
        vlanRef(m[1]!);
        ok();
      } else if ((m = /^switchport trunk native vlan\s+(\d+)$/.exec(t))) {
        sp.native = Number(m[1]);
        vlanRef(m[1]!);
        ok();
      } else if (
        (m = /^switchport trunk allowed vlan\s+(?:(add|remove|except)\s+)?(.+)$/.exec(t))
      ) {
        const arg = m[2]!.trim();
        if (arg === 'all') allowed = vlanSetAll();
        else if (arg === 'none') allowed = vlanSetNone();
        else {
          const list = parseVlanList(arg);
          if (!list) continue;
          const base = allowed ?? this.defaultAllowed();
          allowed =
            m[1] === 'add'
              ? vlanSetAdd(base, list)
              : m[1] === 'remove'
                ? vlanSetRemove(base, list)
                : m[1] === 'except'
                  ? vlanSetExcept(list)
                  : vlanSetFrom(list);
        }
        ok();
      } else if (
        (m =
          /^switchport general allowed vlan\s+(add|remove)\s+(\S+)(?:\s+(tagged|untagged))?$/.exec(
            t,
          ))
      ) {
        const list = parseVlanList(m[2]!);
        if (!list) continue;
        if (m[3] === 'untagged')
          untagged =
            m[1] === 'add'
              ? vlanSetAdd(untagged ?? vlanSetNone(), list)
              : vlanSetRemove(untagged ?? vlanSetNone(), list);
        else
          tagged =
            m[1] === 'add'
              ? vlanSetAdd(tagged ?? vlanSetNone(), list)
              : vlanSetRemove(tagged ?? vlanSetNone(), list);
        ok();
      } else if ((m = /^switchport general pvid\s+(\d+)$/.exec(t))) {
        pvid = Number(m[1]);
        ok();
      } else if (/^switchport general acceptable-frame-type\b/.test(t)) {
        ok();
      } else if (t === 'switchport nonegotiate') {
        sp.nonegotiate = true;
        ok();
      } else if (t === 'switchport port-security') {
        portSecurity.enabled = true;
        ok();
      } else if ((m = /^switchport port-security maximum\s+(\d+)/.exec(t))) {
        portSecurity.maximum = Number(m[1]);
        ok();
      } else if (t === 'switchport port-security mac-address sticky') {
        portSecurity.sticky = true;
        ok();
      } else if (
        (m =
          /^switchport port-security mac-address\s+(sticky\s+)?(\S+)(?:\s+vlan\s+(?:voice|access|(\d+)))?/.exec(
            t,
          ))
      ) {
        const mac = normalizeMac(m[2]!);
        if (mac) {
          portSecurity.macs.push({ mac, sticky: !!m[1], ...(m[3] ? { vlan: Number(m[3]) } : {}) });
          ok();
        }
      } else if (/^switchport port-security (violation|aging)\b/.test(t)) {
        ok();
      } else if (t === 'shutdown') {
        iface.shutdown = true;
        ok();
      } else if (t === 'no shutdown') {
        ok();
      } else if ((m = /^ip address\s+(\S+)\s+(\S+)(\s+secondary)?$/.exec(t))) {
        const prefix = maskToPrefix(m[2]!);
        if (isIpv4(m[1]!) && prefix !== null) {
          iface.ipv4.push({ ip: m[1]!, prefix, ...(m[3] ? { secondary: true } : {}) });
          ok();
        }
      } else if (t === 'ip address dhcp') {
        iface.dhcpClient = true;
        ok();
      } else if (t === 'no ip address' || t === 'no ip address dhcp') {
        ok();
      } else if ((m = /^(?:ip )?vrf forwarding\s+(\S+)$/.exec(t))) {
        iface.vrf = m[1]!;
        ok();
      } else if ((m = /^ip helper-address\s+(\S+)$/.exec(t))) {
        (iface.helperAddresses ??= []).push(m[1]!);
        ok();
      } else if ((m = /^ip access-group\s+(\S+)\s+(in|out)$/.exec(t))) {
        this.bindInterface(iface, m[1]!, m[2] as 'in' | 'out', child);
        ok();
      } else if (this.sb && (m = /^service-acl input\s+(\S+)$/.exec(t))) {
        this.bindInterface(iface, m[1]!, 'in', child);
        ok();
      } else if ((m = /^ip policy route-map\s+(\S+)$/.exec(t))) {
        iface.policyRouteMap = m[1]!;
        this.context.routing.policyRoutes.push({
          inputDevices: [name],
          srcaddr: [],
          dstaddr: [],
          routeMap: m[1]!,
          interface: name,
          src: lineSrc(child.line),
        });
        this.features.add('pbr');
        this.ctx.ref(
          child.line,
          m[1]!,
          'route-map',
          this.indent(child) + 'ip policy route-map'.length,
        );
        ok();
      } else if ((m = /^ip ospf\s+(\S+)\s+area\s+(\S+)$/.exec(t))) {
        iface.ospf = { ...iface.ospf, process: m[1]!, area: m[2]! };
        ok();
      } else if ((m = /^ip ospf cost\s+(\d+)$/.exec(t))) {
        iface.ospf = { ...iface.ospf, cost: Number(m[1]) };
        ok();
      } else if ((m = /^channel-group\s+(\d+)(?:\s+mode\s+(\S+))?$/.exec(t))) {
        const group = `Port-channel${m[1]}`;
        iface.lag = { group, mode: m[2] ?? 'on' };
        this.refInterface(child.line, m[1]!, group);
        ok();
      } else if (/^spanning-tree portfast(?:\s+(?:edge|trunk|edge trunk|disable))?$/.test(t)) {
        iface.stp = { ...iface.stp, portfast: !/disable$/.test(t) };
        ok();
      } else if (t === 'spanning-tree bpduguard enable') {
        iface.stp = { ...iface.stp, bpduguard: true };
        ok();
      } else if ((m = /^power inline\s+(never|auto|static|consumption|max|port)\b/.exec(t))) {
        iface.poe = { mode: m[1]! };
        ok();
      } else if (
        /^(authentication port-control auto|access-session port-control auto|dot1x pae authenticator|dot1x port-control auto)$/.test(
          t,
        )
      ) {
        iface.dot1x = { dot1x: true, mab: iface.dot1x?.mab ?? false };
        ok();
      } else if (t === 'mab' || /^dot1x authentication\b.*\bmac\b/.test(t)) {
        iface.dot1x = { dot1x: iface.dot1x?.dot1x ?? false, mab: true };
        ok();
      } else if (
        /^(authentication (host-mode|order|priority|periodic|timer)|access-session (host-mode|closed)|dot1x timeout|service-policy type control subscriber)\b/.test(
          t,
        )
      ) {
        ok();
      } else if ((m = /^speed\s+(\S+)$/.exec(t))) {
        iface.speed = m[1]!;
        ok();
      } else if ((m = /^duplex\s+(\S+)$/.exec(t))) {
        iface.duplex = m[1]!;
        ok();
      } else if ((m = /^mtu\s+(\d+)$/.exec(t))) {
        iface.mtu = Number(m[1]);
        ok();
      } else if (t === 'negotiation auto') {
        ok();
      } else if ((m = /^name\s+(.+)$/.exec(t)) && iface.kind === 'svi') {
        const id = Number(/\d+$/.exec(name)?.[0]);
        this.sviNames.set(id, { name: m[1]!.trim(), line: child.line });
        ok();
      }
    }

    if ((iface.kind === 'physical' || iface.kind === 'lag') && !routed) {
      iface.switchport = this.switchport(iface, sp, allowed, tagged, untagged, pvid);
    } else if (routed) {
      iface.switchport = { mode: 'routed' };
    }
    if (portSecurity.enabled || portSecurity.macs.length > 0) {
      iface.portSecurity = {
        enabled: portSecurity.enabled,
        sticky: portSecurity.sticky || portSecurity.macs.some((mm) => mm.sticky),
        macs: portSecurity.macs,
        ...(portSecurity.maximum !== undefined ? { maximum: portSecurity.maximum } : {}),
      };
      this.features.add('port-security');
    }
    if (iface.kind === 'svi' && iface.ipv4.length > 0) this.features.add('svi');
    if (iface.dot1x) this.features.add('dot1x');
    if (iface.switchport?.voiceVlan !== undefined) this.features.add('voice-vlan');
    this.interfaces.set(name, iface);
  }

  private indent(node: SyntaxNode): number {
    const raw = this.input.lines[node.line - 1] ?? '';
    return raw.length - raw.trimStart().length;
  }

  /** An interface name as written ("Gi1/0/1", "vlan 10") that points to its "interface" block. */
  private refInterfaceName(line: number, raw: string) {
    const text = this.input.lines[line - 1] ?? '';
    const from = text.lastIndexOf(raw);
    if (from >= 0)
      this.ctx.refAt(line, from, from + raw.length, 'interface', normalizeInterfaceName(raw));
  }

  private refInterface(line: number, token: string, target: string) {
    // Rewrite the pending reference so that "channel-group 1" points to "interface Port-channel1".
    const raw = this.input.lines[line - 1] ?? '';
    const from = findWord(raw, token, raw.indexOf('channel-group'));
    if (from >= 0) this.ctx.refAt(line, from, from + token.length, 'interface', target);
  }

  private defaultAllowed(): VlanSet {
    return this.defaults.trunkAllowed === 'all' ? vlanSetAll() : vlanSetNone();
  }

  private switchport(
    iface: Interface,
    sp: {
      mode?: SwitchportMode;
      access?: number;
      voice?: number;
      native?: number;
      nonegotiate?: boolean;
    },
    allowed: VlanSet | undefined,
    tagged: VlanSet | undefined,
    untagged: VlanSet | undefined,
    pvid: number | undefined,
  ): Switchport {
    const defaults: string[] = [];
    const unverified: string[] = [];
    const markDefault = (field: string) => {
      defaults.push(field);
      if (this.defaults.unverified.includes(field)) unverified.push(field);
    };
    let mode = sp.mode;
    if (!mode) {
      mode = this.defaults.switchportMode;
      markDefault('switchport.mode');
    }
    const result: Switchport = { mode };
    if (mode === 'access' || mode === 'dynamic-auto' || mode === 'dynamic-desirable') {
      result.accessVlan = sp.access ?? this.defaults.accessVlan;
      if (sp.access === undefined) markDefault('switchport.accessVlan');
    }
    if (mode === 'trunk' || mode === 'dynamic-auto' || mode === 'dynamic-desirable') {
      result.nativeVlan = sp.native ?? this.defaults.nativeVlan;
      if (sp.native === undefined) markDefault('switchport.nativeVlan');
      result.allowed = allowed ?? this.defaultAllowed();
      if (!allowed) markDefault('switchport.allowed');
    }
    if (mode === 'general') {
      result.allowed = tagged ?? vlanSetNone();
      result.untagged = untagged ?? vlanSetNone();
      result.nativeVlan = pvid ?? this.defaults.accessVlan;
      if (pvid === undefined) markDefault('switchport.nativeVlan');
    }
    if (sp.voice !== undefined) result.voiceVlan = sp.voice;
    if (sp.nonegotiate) result.nonegotiate = true;
    if (defaults.length > 0) iface.defaults = [...(iface.defaults ?? []), ...defaults];
    if (unverified.length > 0) iface.unverified = [...(iface.unverified ?? []), ...unverified];
    return result;
  }

  private bindInterface(iface: Interface, acl: string, direction: 'in' | 'out', child: SyntaxNode) {
    if (direction === 'in') iface.aclIn = acl;
    else iface.aclOut = acl;
    this.bindings.push({
      acl,
      binding: { kind: 'interface', interface: iface.name, direction, src: lineSrc(child.line) },
    });
    this.ctx.ref(child.line, acl, 'acl', this.indent(child) + child.text.indexOf(acl) - 1);
  }

  private finishInterfaces() {
    const all = [...this.interfaces.values()];
    // Port-channels created by "channel-group" always exist, even without their own block.
    for (const iface of all) {
      if (iface.lag && !this.interfaces.has(iface.lag.group)) {
        this.interfaces.set(iface.lag.group, {
          name: iface.lag.group,
          kind: 'lag',
          shutdown: false,
          ipv4: [],
          src: [],
          defaults: ['name'],
        });
      }
    }
    for (const lag of this.interfaces.values()) {
      if (lag.kind !== 'lag') continue;
      lag.members = all.filter((i) => i.lag?.group === lag.name).map((i) => i.name);
      if (lag.members.length > 0) this.features.add('lag');
    }

    // Positions on the front panel: stack member, slot, port; uplinks are on slot 1 or faster.
    const physical = all.filter((i) => i.kind === 'physical');
    const dominant = new Map<number, number>();
    for (const member of new Set(physical.map((i) => parsePortNumbers(i.name)?.member ?? 1))) {
      const counts = new Map<number, number>();
      for (const i of physical) {
        const pos = parsePortNumbers(i.name);
        if (!pos || pos.member !== member || pos.slot !== 0) continue;
        const cls = speedClass(i.name);
        counts.set(cls, (counts.get(cls) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) dominant.set(member, top[0]);
    }
    for (const i of physical) {
      const pos = parsePortNumbers(i.name);
      if (!pos) continue;
      const uplink = pos.slot >= 1 || speedClass(i.name) > (dominant.get(pos.member) ?? 0);
      i.position = { ...pos, uplink };
    }

    // PoE: capable front ports without "power inline" use the default.
    if (poeCapable(this.input.model ?? this.provision[0]?.model)) {
      this.features.add('poe');
      for (const i of physical) {
        if (i.position && !i.position.uplink && !i.poe) {
          i.poe = { mode: this.defaults.poe };
          i.defaults = [...(i.defaults ?? []), 'poe.mode'];
        }
      }
    } else if (physical.some((i) => i.poe && i.poe.mode !== 'never')) {
      this.features.add('poe');
    }
  }

  /** Interfaces of each OSPF process, with area, cost and passive state. */
  private finishOspf() {
    for (const ospf of this.context.routing.ospf) {
      const isPassive = (name: string) =>
        ospf.passiveDefault ? !ospf.notPassive.includes(name) : ospf.passive.includes(name);
      for (const iface of this.interfaces.values()) {
        let area = iface.ospf?.process === ospf.process ? iface.ospf?.area : undefined;
        if (area === undefined) {
          for (const addr of iface.ipv4) {
            const ip = ipToInt(addr.ip);
            const net = this.ospfNetworks.find(
              (n) => n.ospf === ospf && ip !== null && wildcardMatches(n.ip, n.wildcard, ip),
            );
            if (net) {
              area = net.area;
              break;
            }
          }
        }
        if (area === undefined) continue;
        ospf.interfaces.push({
          name: iface.name,
          area,
          passive: isPassive(iface.name),
          ...(iface.ospf?.cost !== undefined ? { cost: iface.ospf.cost } : {}),
          src: iface.src,
        });
      }
    }
  }

  private stackMembers(): StackMember[] {
    if (this.provision.length > 0) return [...this.provision].sort((a, b) => a.member - b.member);
    const members = new Set<number>();
    for (const i of this.interfaces.values()) {
      if (i.kind === 'physical' && i.position) members.add(i.position.member);
    }
    const sorted = [...members].sort((a, b) => a - b);
    return sorted.map((member) => ({
      member,
      ...(member === sorted[0] && this.input.model && !/\//.test(this.input.model)
        ? { model: this.input.model }
        : {}),
      src: [],
    }));
  }

  private management(): { management?: { ip: string; interface?: string } } {
    const candidates = [...this.interfaces.values()].filter(
      (i) =>
        (i.kind === 'svi' || i.kind === 'management' || i.kind === 'loopback') &&
        i.ipv4.length > 0 &&
        !i.shutdown,
    );
    const pick =
      candidates.find((i) => this.sourceInterfaces.includes(i.name)) ??
      candidates.find((i) => {
        const id = Number(/\d+$/.exec(i.name)?.[0]);
        const vlanName = this.vlans.get(id)?.name ?? this.sviNames.get(id)?.name ?? '';
        return /gest|mgmt|manag/i.test(`${vlanName} ${i.description ?? ''}`);
      }) ??
      candidates.find((i) => i.kind === 'svi') ??
      candidates[0];
    if (!pick) return {};
    return { management: { ip: pick.ipv4[0]!.ip, interface: pick.name } };
  }

  // ---- routing --------------------------------------------------------------------

  private readStaticRoute(node: SyntaxNode) {
    const toks = node.text.split(/\s+/);
    let i = 2;
    let vrf: string | undefined;
    if (toks[i] === 'vrf') {
      vrf = toks[i + 1];
      i += 2;
    }
    const prefix = maskToPrefix(toks[i + 1] ?? '');
    if (!isIpv4(toks[i] ?? '') || prefix === null) return;
    const route: StaticRoute = {
      dst: { ip: toks[i]!, prefix },
      enabled: true,
      kind: 'route',
      src: nodeSrc(node),
    };
    if (vrf) route.vrf = vrf;
    i += 2;
    if (toks[i] && isIpv4(toks[i]!)) route.gateway = toks[i++]!;
    else if (
      toks[i] &&
      /^[A-Za-z]/.test(toks[i]!) &&
      !['name', 'tag', 'permanent', 'track', 'metric', 'global'].includes(toks[i]!)
    ) {
      this.refInterfaceName(node.line, toks[i]!);
      route.device = normalizeInterfaceName(toks[i++]!);
      if (/^Null0$/i.test(route.device)) route.blackhole = true;
      if (toks[i] && isIpv4(toks[i]!)) route.gateway = toks[i++]!;
    }
    while (i < toks.length) {
      const tok = toks[i]!;
      if (/^\d+$/.test(tok)) route.distance = Number(tok);
      else if (tok === 'name') route.name = toks[++i];
      else if (tok === 'metric' && toks[i + 1]) route.distance = Number(toks[++i]);
      else if (tok === 'tag' || tok === 'track') i++;
      i++;
    }
    this.context.routing.statics.push(route);
    this.features.add('static-routes');
    this.ctx.understood(node);
  }

  private readOspf(node: SyntaxNode, process: string) {
    const ospf: Ospf = {
      process,
      networks: [],
      areas: [],
      interfaces: [],
      passiveDefault: false,
      passive: [],
      notPassive: [],
      redistribute: [],
      src: nodeSrc(node),
    };
    this.ctx.understood(node);
    for (const child of node.children) {
      const t = child.text;
      let m: RegExpExecArray | null;
      if ((m = /^router-id\s+(\S+)$/.exec(t))) ospf.routerId = m[1]!;
      else if ((m = /^network\s+(\S+)\s+(\S+)\s+area\s+(\S+)$/.exec(t))) {
        ospf.networks.push({
          prefix: wildcardText(m[1]!, m[2]!),
          area: m[3]!,
          src: lineSrc(child.line),
        });
        this.ospfNetworks.push({ ospf, ip: m[1]!, wildcard: m[2]!, area: m[3]! });
      } else if (t === 'passive-interface default') ospf.passiveDefault = true;
      else if ((m = /^passive-interface\s+(\S+)$/.exec(t))) {
        ospf.passive.push(normalizeInterfaceName(m[1]!));
        this.refInterfaceName(child.line, m[1]!);
      } else if ((m = /^no passive-interface\s+(\S+)$/.exec(t))) {
        ospf.notPassive.push(normalizeInterfaceName(m[1]!));
        this.refInterfaceName(child.line, m[1]!);
      } else if ((m = /^redistribute\s+(\S+(?:\s+\d+)?)(?:.*\broute-map\s+(\S+))?/.exec(t))) {
        ospf.redistribute.push({
          protocol: m[1]!,
          ...(m[2] ? { routeMap: m[2] } : {}),
          src: lineSrc(child.line),
        });
        if (m[2])
          this.ctx.ref(child.line, m[2], 'route-map', t.indexOf('route-map') + this.indent(child));
      } else if ((m = /^area\s+(\S+)\s+(stub|nssa|range|authentication)\b/.exec(t))) {
        ospf.areas.push({ id: m[1]!, type: m[2]!, src: lineSrc(child.line) });
      } else if (
        /^(log-adjacency-changes|default-information originate|auto-cost reference-bandwidth)\b/.test(
          t,
        )
      ) {
        // known commands, kept as understood
      } else continue;
      this.ctx.understood(child);
    }
    this.context.routing.ospf.push(ospf);
    this.features.add('ospf');
  }

  private readBgp(node: SyntaxNode, asn: string) {
    const bgp: Bgp = {
      asn,
      neighbors: [],
      groups: [],
      ranges: [],
      networks: [],
      redistribute: [],
      src: nodeSrc(node),
    };
    this.ctx.understood(node);
    const neighbor = (address: string, line: number, vrf?: string): BgpNeighbor => {
      const isGroup = !isIpv4(address);
      const list = isGroup ? bgp.groups : bgp.neighbors;
      let n = list.find((x) => x.address === address && x.vrf === vrf);
      if (!n) {
        n = { address, src: lineSrc(line), ...(vrf ? { vrf } : {}) };
        list.push(n);
      } else {
        n.src = [...n.src, [line, line]];
      }
      return n;
    };
    const readChildren = (children: SyntaxNode[], vrf?: string) => {
      for (const child of children) {
        const t = child.text;
        let m: RegExpExecArray | null;
        if ((m = /^address-family\s+ipv4(?:\s+unicast)?(?:\s+vrf\s+(\S+))?$/.exec(t))) {
          this.ctx.understood(child);
          readChildren(child.children, m[1]);
          continue;
        }
        if (t === 'exit-address-family' || /^bgp log-neighbor-changes$/.test(t)) {
          this.ctx.understood(child);
          continue;
        }
        if ((m = /^bgp router-id\s+(\S+)$/.exec(t))) bgp.routerId = m[1]!;
        else if ((m = /^neighbor\s+(\S+)\s+peer-group$/.exec(t))) {
          neighbor(m[1]!, child.line, vrf);
          this.ctx.define('peer-group', m[1]!, child.line);
        } else if ((m = /^neighbor\s+(\S+)\s+peer-group\s+(\S+)$/.exec(t))) {
          neighbor(m[1]!, child.line, vrf).group = m[2]!;
          this.ctx.ref(
            child.line,
            m[2]!,
            'peer-group',
            t.indexOf('peer-group') + this.indent(child),
          );
        } else if ((m = /^neighbor\s+(\S+)\s+remote-as\s+(\S+)$/.exec(t)))
          neighbor(m[1]!, child.line, vrf).remoteAs = m[2]!;
        else if ((m = /^neighbor\s+(\S+)\s+description\s+(.+)$/.exec(t)))
          neighbor(m[1]!, child.line, vrf).description = m[2]!;
        else if ((m = /^neighbor\s+(\S+)\s+update-source\s+(\S+)$/.exec(t))) {
          neighbor(m[1]!, child.line, vrf).updateSource = normalizeInterfaceName(m[2]!);
        } else if ((m = /^neighbor\s+(\S+)\s+route-map\s+(\S+)\s+(in|out)$/.exec(t))) {
          const n = neighbor(m[1]!, child.line, vrf);
          if (m[3] === 'in') n.routeMapIn = m[2]!;
          else n.routeMapOut = m[2]!;
          this.ctx.ref(child.line, m[2]!, 'route-map', t.indexOf('route-map') + this.indent(child));
        } else if ((m = /^neighbor\s+(\S+)\s+prefix-list\s+(\S+)\s+(in|out)$/.exec(t))) {
          const n = neighbor(m[1]!, child.line, vrf);
          if (m[3] === 'in') n.prefixListIn = m[2]!;
          else n.prefixListOut = m[2]!;
          this.ctx.ref(
            child.line,
            m[2]!,
            'prefix-list',
            t.indexOf('prefix-list') + this.indent(child),
          );
        } else if ((m = /^neighbor\s+(\S+)\s+route-reflector-client$/.exec(t)))
          neighbor(m[1]!, child.line, vrf).routeReflectorClient = true;
        else if ((m = /^neighbor\s+(\S+)\s+next-hop-self\b/.exec(t)))
          neighbor(m[1]!, child.line, vrf).nextHopSelf = true;
        else if ((m = /^neighbor\s+(\S+)\s+shutdown$/.exec(t)))
          neighbor(m[1]!, child.line, vrf).shutdown = true;
        else if (
          (m =
            /^neighbor\s+(\S+)\s+(activate|send-community.*|soft-reconfiguration.*|password.*|timers.*|ebgp-multihop.*)$/.exec(
              t,
            ))
        ) {
          neighbor(m[1]!, child.line, vrf);
        } else if ((m = /^network\s+(\S+)(?:\s+mask\s+(\S+))?(?:\s+route-map\s+(\S+))?$/.exec(t))) {
          const len = m[2] ? maskToPrefix(m[2]) : null;
          const prefix = m[2] ? (len !== null ? `${m[1]}/${len}` : `${m[1]} ${m[2]}`) : m[1]!;
          bgp.networks.push({
            prefix,
            ...(m[3] ? { routeMap: m[3] } : {}),
            src: lineSrc(child.line),
          });
          if (m[3])
            this.ctx.ref(
              child.line,
              m[3],
              'route-map',
              t.indexOf('route-map') + this.indent(child),
            );
        } else if ((m = /^redistribute\s+(\S+(?:\s+\d+)?)(?:.*\broute-map\s+(\S+))?/.exec(t))) {
          bgp.redistribute.push({
            protocol: m[1]!,
            ...(m[2] ? { routeMap: m[2] } : {}),
            src: lineSrc(child.line),
          });
          if (m[2])
            this.ctx.ref(
              child.line,
              m[2],
              'route-map',
              t.indexOf('route-map') + this.indent(child),
            );
        } else continue;
        this.ctx.understood(child);
      }
    };
    readChildren(node.children);
    this.context.routing.bgp = bgp;
    this.features.add('bgp');
  }

  private readRouteMap(node: SyntaxNode, name: string, action: 'permit' | 'deny', seq?: number) {
    let rm = this.context.routing.routeMaps.find((r) => r.name === name);
    if (!rm) {
      rm = { name, entries: [], src: [] };
      this.context.routing.routeMaps.push(rm);
      this.ctx.define('route-map', name, node.line);
    }
    rm.src.push([node.line, node.endLine]);
    const entry = {
      action,
      match: [] as string[],
      set: [] as string[],
      src: nodeSrc(node),
      ...(seq !== undefined ? { seq } : {}),
    };
    this.ctx.understood(node);
    for (const child of node.children) {
      const t = child.text;
      let m: RegExpExecArray | null;
      if ((m = /^match\s+(.+)$/.exec(t))) {
        entry.match.push(m[1]!);
        const pl = /prefix-list\s+(\S+)/.exec(t);
        if (pl)
          this.ctx.ref(
            child.line,
            pl[1]!,
            'prefix-list',
            t.indexOf('prefix-list') + this.indent(child),
          );
        const acls = /^ip address\s+(.+)$/.exec(m[1]!);
        if (acls && !/prefix-list/.test(m[1]!)) {
          for (const acl of acls[1]!.trim().split(/\s+/)) {
            this.bindings.push({
              acl,
              binding: { kind: 'route-map', name, src: lineSrc(child.line) },
            });
            this.ctx.ref(child.line, acl, 'acl', t.indexOf('address') + this.indent(child));
          }
        }
      } else if ((m = /^set\s+(.+)$/.exec(t))) entry.set.push(m[1]!);
      else if (!/^description\s/.test(t)) continue;
      this.ctx.understood(child);
    }
    rm.entries.push(entry);
  }

  private readPrefixList(node: SyntaxNode, name: string, rest: string) {
    let pl = this.context.routing.prefixLists.find((p) => p.name === name);
    if (!pl) {
      pl = { name, entries: [], src: [] };
      this.context.routing.prefixLists.push(pl);
      this.ctx.define('prefix-list', name, node.line);
    }
    pl.src.push([node.line, node.line]);
    const m = /^(?:seq\s+(\d+)\s+)?(permit|deny)\s+(\S+)(?:\s+ge\s+(\d+))?(?:\s+le\s+(\d+))?$/.exec(
      rest,
    );
    if (m) {
      pl.entries.push({
        action: m[2] as 'permit' | 'deny',
        prefix: m[3]!,
        ...(m[1] ? { seq: Number(m[1]) } : {}),
        ...(m[4] ? { ge: Number(m[4]) } : {}),
        ...(m[5] ? { le: Number(m[5]) } : {}),
        src: nodeSrc(node),
      });
    } else if (!/^description\s/.test(rest)) {
      return;
    }
    this.ctx.understood(node);
  }

  // ---- access lists ---------------------------------------------------------------

  private aclFor(name: string, type: Acl['type'], line: number): Acl {
    let acl = this.context.acls.find((a) => a.name === name);
    if (!acl) {
      acl = { name, type, entries: [], bindings: [], src: [] };
      this.context.acls.push(acl);
      this.ctx.define('acl', name, line);
      this.features.add('acl');
    }
    return acl;
  }

  private readNamedAcl(node: SyntaxNode, name: string, type: Acl['type']) {
    const acl = this.aclFor(name, type, node.line);
    acl.src.push([node.line, node.endLine]);
    this.ctx.understood(node);
    this.ctx.understoodClosing(node);
    for (const child of node.children) {
      const entry = parseAclEntry(child.text, type, this.sb);
      if (!entry) continue;
      acl.entries.push({ ...entry, src: lineSrc(child.line) });
      this.ctx.understood(child);
      this.refObjectGroups(child, entry);
    }
  }

  private readNumberedAcl(node: SyntaxNode, number: string, rest: string) {
    const n = Number(number);
    const type = (n >= 100 && n <= 199) || (n >= 2000 && n <= 2699) ? 'extended' : 'standard';
    const acl = this.aclFor(number, type, node.line);
    acl.src.push([node.line, node.line]);
    const entry = parseAclEntry(rest, type, false);
    if (!entry) return;
    acl.entries.push({ ...entry, src: nodeSrc(node) });
    this.ctx.understood(node);
  }

  private refObjectGroups(child: SyntaxNode, entry: Omit<AclEntry, 'src'>) {
    for (const match of [entry.source, entry.destination]) {
      if (match?.kind === 'object-group') this.ctx.ref(child.line, match.name, 'object-group');
    }
    if (entry.protocol?.startsWith('object-group:')) {
      this.ctx.ref(child.line, entry.protocol.slice('object-group:'.length), 'object-group');
    }
  }

  private readObjectGroup(node: SyntaxNode, name: string, type: 'network' | 'service') {
    const group: ObjectGroup = { name, type, entries: [], src: nodeSrc(node) };
    this.ctx.define('object-group', name, node.line);
    this.ctx.understood(node);
    for (const child of node.children) {
      const t = child.text;
      let m: RegExpExecArray | null;
      let entry: ObjectGroupEntry | null = null;
      if ((m = /^host\s+(\S+)$/.exec(t))) entry = { kind: 'host', ip: m[1]! };
      else if ((m = /^range\s+(\S+)\s+(\S+)$/.exec(t)) && type === 'network')
        entry = { kind: 'range', from: m[1]!, to: m[2]! };
      else if ((m = /^group-object\s+(\S+)$/.exec(t))) {
        entry = { kind: 'group', name: m[1]! };
        this.ctx.ref(child.line, m[1]!, 'object-group');
      } else if ((m = /^(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)$/.exec(t))) {
        const prefix = maskToPrefix(m[2]!);
        if (prefix !== null) entry = { kind: 'subnet', ip: m[1]!, prefix };
      } else if ((m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(t)))
        entry = { kind: 'subnet', ip: m[1]!, prefix: Number(m[2]) };
      else if (
        (m = /^(tcp|udp|tcp-udp|icmp|ip|esp|gre)(?:\s+(.+))?$/.exec(t)) &&
        type === 'service'
      ) {
        const port = m[2] ? parsePortMatch(m[2].split(/\s+/), 0)?.match : undefined;
        entry = { kind: 'service', protocol: m[1]!, ...(port ? { port } : {}) };
      } else if (/^description\s/.test(t)) {
        this.ctx.understood(child);
        continue;
      }
      if (!entry) continue;
      group.entries.push({ ...entry, src: lineSrc(child.line) });
      this.ctx.understood(child);
    }
    this.context.objectGroups.push(group);
  }

  private readLine(node: SyntaxNode, name: string) {
    let used = false;
    for (const child of node.children) {
      const m = /^access-class\s+(\S+)\s+(in|out)\b/.exec(child.text);
      if (!m) continue;
      this.bindings.push({
        acl: m[1]!,
        binding: {
          kind: 'line',
          line: name,
          direction: m[2] as 'in' | 'out',
          src: lineSrc(child.line),
        },
      });
      this.ctx.ref(child.line, m[1]!, 'acl', this.indent(child) + 'access-class'.length);
      this.ctx.understood(child);
      used = true;
    }
    if (used) this.ctx.understood(node);
  }

  private attachBindings() {
    for (const { acl, line } of this.snmpAcls) {
      if (this.context.acls.some((a) => a.name === acl)) {
        this.bindings.push({ acl, binding: { kind: 'snmp', src: lineSrc(line) } });
        this.ctx.understood(line);
        this.ctx.ref(line, acl, 'acl', (this.input.lines[line - 1] ?? '').lastIndexOf(acl) - 1);
      }
    }
    for (const { acl, binding } of this.bindings) {
      this.context.acls.find((a) => a.name === acl)?.bindings.push(binding);
    }
  }
}

/** "10.0.0.0 0.0.0.255" → "10.0.0.0/24"; kept as written when the wildcard is not contiguous. */
function wildcardText(ip: string, wildcard: string): string {
  const len = wildcardToPrefix(wildcard);
  return len === null ? `${ip} ${wildcard}` : `${ip}/${len}`;
}

function commandKey(text: string): string {
  const words = text.trim().split(/\s+/);
  const first = words[0] ?? '';
  if (
    [
      'ip',
      'ipv6',
      'no',
      'snmp-server',
      'spanning-tree',
      'crypto',
      'vtp',
      'switchport',
      'voice',
      'management',
    ].includes(first)
  ) {
    return words.slice(0, 2).join(' ');
  }
  return first;
}

/** Small Business and IOS models whose name says they have PoE (P, U, FPD, LP...). */
export function poeCapable(model?: string): boolean {
  if (!model) return false;
  const segment = model.split('-').find((s) => /^\d+/.test(s));
  if (!segment) return false;
  return /[PU]/i.test(segment.replace(/^\d+/, ''));
}

// ---- ACL entry parsing ------------------------------------------------------------------

export function parseAclEntry(
  text: string,
  type: Acl['type'],
  sb: boolean,
): Omit<AclEntry, 'src'> | null {
  let toks = text.trim().split(/\s+/);
  let seq: number | undefined;
  if (/^\d+$/.test(toks[0] ?? '')) {
    seq = Number(toks[0]);
    toks = toks.slice(1);
  }
  const action = toks[0];
  if (action === 'remark') {
    return {
      action: 'remark',
      remark: toks.slice(1).join(' '),
      options: [],
      text,
      ...(seq !== undefined ? { seq } : {}),
    };
  }
  if (action !== 'permit' && action !== 'deny') return null;
  // Small Business: "permit ip any any ace-priority 20".
  const ace = toks.indexOf('ace-priority');
  if (sb && ace > 0) {
    seq = Number(toks[ace + 1]);
    toks = [...toks.slice(0, ace), ...toks.slice(ace + 2)];
  }
  if (type === 'management') {
    const entry: Omit<AclEntry, 'src'> = {
      action,
      options: [],
      text,
      services: [],
      ...(seq !== undefined ? { seq } : {}),
    };
    for (let i = 1; i < toks.length; i++) {
      if (toks[i] === 'ip-source') {
        const ip = toks[i + 1]!;
        if (toks[i + 2] === 'mask') {
          const prefix = maskToPrefix(toks[i + 3] ?? '');
          entry.source =
            prefix !== null ? { kind: 'subnet', ip, prefix } : { kind: 'other', text: ip };
          i += 3;
        } else {
          entry.source = { kind: 'host', ip };
          i += 1;
        }
      } else if (toks[i] === 'service') {
        entry.services!.push(toks[++i]!);
      } else {
        entry.options.push(toks[i]!);
      }
    }
    entry.source ??= { kind: 'any' };
    return entry;
  }
  if (type === 'mac' || type === 'ipv6') {
    return { action, options: toks.slice(1), text, ...(seq !== undefined ? { seq } : {}) };
  }
  if (type === 'standard') {
    const parsed = parseAddress(toks, 1, true);
    if (!parsed) return null;
    return {
      action,
      source: parsed.match,
      options: toks.slice(parsed.next),
      text,
      ...(seq !== undefined ? { seq } : {}),
    };
  }
  // Extended: action protocol src [port] dst [port] [options]
  let i = 1;
  let protocol = toks[i++];
  if (protocol === 'object-group') protocol = `object-group:${toks[i++]}`;
  if (!protocol) return null;
  const src = parseAddress(toks, i, false);
  if (!src) return null;
  i = src.next;
  const srcPort = parsePortMatch(toks, i);
  if (srcPort) i = srcPort.next;
  const dst = parseAddress(toks, i, false);
  if (!dst) return null;
  i = dst.next;
  const dstPort = parsePortMatch(toks, i);
  if (dstPort) i = dstPort.next;
  return {
    action,
    protocol,
    source: src.match,
    destination: dst.match,
    ...(srcPort ? { sourcePort: srcPort.match } : {}),
    ...(dstPort ? { destinationPort: dstPort.match } : {}),
    options: toks.slice(i),
    text,
    ...(seq !== undefined ? { seq } : {}),
  };
}

function parseAddress(
  toks: string[],
  i: number,
  standard: boolean,
): { match: AddressMatch; next: number } | null {
  const tok = toks[i];
  if (!tok) return null;
  if (tok === 'any') return { match: { kind: 'any' }, next: i + 1 };
  if (tok === 'host' && toks[i + 1])
    return { match: { kind: 'host', ip: toks[i + 1]! }, next: i + 2 };
  if ((tok === 'object-group' || tok === 'addrgroup') && toks[i + 1]) {
    return { match: { kind: 'object-group', name: toks[i + 1]! }, next: i + 2 };
  }
  if (isIpv4(tok)) {
    if (toks[i + 1] && isIpv4(toks[i + 1]!))
      return { match: { kind: 'wildcard', ip: tok, wildcard: toks[i + 1]! }, next: i + 2 };
    if (standard) return { match: { kind: 'host', ip: tok }, next: i + 1 };
    return { match: { kind: 'host', ip: tok }, next: i + 1 };
  }
  const prefix = /^(\S+)\/(\d+)$/.exec(tok);
  if (prefix && isIpv4(prefix[1]!))
    return { match: { kind: 'subnet', ip: prefix[1]!, prefix: Number(prefix[2]) }, next: i + 1 };
  return null;
}

function parsePortMatch(toks: string[], i: number): { match: PortMatch; next: number } | null {
  const op = toks[i];
  if (op === 'range' && toks[i + 1] && toks[i + 2])
    return { match: { op: 'range', ports: [toks[i + 1]!, toks[i + 2]!] }, next: i + 3 };
  if (op === 'eq' || op === 'neq' || op === 'lt' || op === 'gt') {
    const ports: string[] = [];
    let j = i + 1;
    // "eq 80 443": ports until the next keyword or address.
    while (
      toks[j] &&
      (/^\d+$/.test(toks[j]!) || (/^[a-z][a-z0-9-]*$/.test(toks[j]!) && !KEYWORDS.has(toks[j]!)))
    ) {
      ports.push(toks[j]!);
      j++;
      if (op !== 'eq') break;
    }
    if (ports.length === 0) return null;
    return { match: { op, ports }, next: j };
  }
  return null;
}

const KEYWORDS = new Set([
  'any',
  'host',
  'object-group',
  'log',
  'log-input',
  'established',
  'eq',
  'neq',
  'lt',
  'gt',
  'range',
  'time-range',
  'dscp',
  'precedence',
  'tos',
  'fragments',
  'reflect',
  'ttl',
]);

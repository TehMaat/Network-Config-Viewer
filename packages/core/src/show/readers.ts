// One reader for every command and format. Readers are tolerant: a line they do not
// recognise is skipped, never guessed. Values keep the lines of the show they come from.

import { isIpv4 } from '../model/ip';
import { normalizeInterfaceName, normalizeMac } from '../model/names';
import type {
  DeviceState,
  MacType,
  PortStatus,
  ShowCommandId,
  ShowOutput,
  StackUnit,
} from './types';

interface Reader {
  lines: string[];
  out: ShowOutput;
  state: DeviceState;
}

type ReadFn = (r: Reader) => boolean;

const iface = (name: string) => normalizeInterfaceName(name);
const at = (i: number) => [[i + 1, i + 1] as const];
const span = (a: number, b: number) => [[a + 1, b + 1] as const];

/** 0-based indexes of the output lines. */
function range(r: Reader): [number, number] {
  return [r.out.from - 1, Math.min(r.out.to, r.lines.length) - 1];
}

function unit(state: DeviceState, member: number): StackUnit {
  let u = state.units.find((x) => x.member === member);
  if (!u) {
    u = { member, src: [] };
    state.units.push(u);
    state.units.sort((a, b) => a.member - b.member);
  }
  return u;
}

// ---- Cisco ---------------------------------------------------------------------------

const ciscoVersion: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let currentMember = 0;
  let inTable = false;
  let boardId: string | undefined;
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    let m: RegExpExecArray | null;
    // Stack table: "*    1 52    WS-C2960X-48FPD-L   15.2(7)E10   C2960X-UNIVERSALK9-M [INSTALL]"
    if (/^Switch\s+Ports\s+Model/.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (/^-+\s/.test(line)) continue;
      m = /^(\*?)\s+(\d+)\s+\d+\s+(\S+)\s+(\S+)\s+\S+/.exec(line);
      if (m) {
        const u = unit(r.state, Number(m[2]));
        u.model = m[3]!;
        u.version = m[4]!;
        u.src = at(i);
        read = true;
        continue;
      }
      inTable = false;
    }
    if ((m = /^(\S+) uptime is (.+)$/.exec(line))) {
      r.state.hostname ??= m[1]!;
      r.state.uptime ??= m[2]!.trim();
      read = true;
    } else if ((m = /^Cisco IOS XE Software, Version\s+(\S+)/.exec(line))) {
      r.state.version ??= m[1]!;
      read = true;
    } else if ((m = /^Cisco IOS Software\b.*?Version\s+([^,\s]+)/.exec(line))) {
      r.state.version ??= m[1]!;
      read = true;
    } else if ((m = /^\s*(?:SW version|Version:)\s+(\d+(?:\.\d+)+)/.exec(line))) {
      // Small Business: "Version: 3.4.1.03" under "Active-image", or "SW version 2.5.9.54".
      r.state.version ??= m[1]!;
      read = true;
    } else if ((m = /^Switch 0?(\d+)\s*$/.exec(line))) {
      currentMember = Number(m[1]);
    } else if ((m = /^System Serial Number\s*:\s*(\S+)/.exec(line))) {
      unit(r.state, currentMember || 1).serial = m[1]!;
      if (!r.state.serials.includes(m[1]!)) r.state.serials.push(m[1]!);
      read = true;
    } else if ((m = /^Processor board ID\s+(\S+)/.exec(line))) {
      boardId = m[1]!;
      if (!r.state.serials.includes(m[1]!)) r.state.serials.push(m[1]!);
      read = true;
    } else if ((m = /^Model [Nn]umber\s*:\s*(\S+)/.exec(line))) {
      unit(r.state, currentMember || 1).model ??= m[1]!;
      r.state.model ??= m[1]!;
      read = true;
    }
  }
  // On the classic Catalysts the first member's serial is the "Processor board ID".
  if (boardId && r.state.units.length > 0) {
    const first = r.state.units.find((u) => u.member === 1);
    if (first && !first.serial) first.serial = boardId;
  }
  r.state.model ??= r.state.units[0]?.model;
  return read;
};

const ciscoInventory: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  for (let i = a; i <= b; i++) {
    const name = /^NAME:\s*"([^"]*)"/.exec(r.lines[i]!);
    if (!name) continue;
    const pidLine = r.lines[i + 1] ?? '';
    const pid = /PID:\s*([^,\s]+)/.exec(pidLine);
    const sn = /SN:\s*([^,\s]+)/.exec(pidLine);
    const member = /^(?:Switch\s+)?(\d+)$/.exec(name[1]!.trim());
    if (member && pid) {
      const u = unit(r.state, Number(member[1]));
      u.model = pid[1]!;
      if (sn) u.serial = sn[1]!;
      u.src = span(i, i + 1);
      read = true;
    }
    if (sn && !r.state.serials.includes(sn[1]!) && member) r.state.serials.push(sn[1]!);
  }
  return read;
};

const IOS_STATUS =
  /^(\S+)\s+(.*?)\s*\b(connected|notconnect|disabled|err-disabled|inactive|monitoring|suspended|sfpAbsent|xcvrAbsen|noOperMem|faulty)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/;

const ciscoInterfacesStatus: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  const sb = r.lines.slice(a, b + 1).some((l) => /^Port\s+Type\s+Duplex\s+Speed\s+Neg/.test(l));
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    if (sb) {
      // gi1/0/1  1G-Copper    Full    1000  Enabled  Off  Up          Disabled On
      // Po1      1G      Full    1000   Enabled  Off      Up
      const m =
        /^((?:gi|te|fa|Po|po|tw|xe)\S*)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(Up|Down|Not Present)\b/.exec(
          line,
        );
      if (!m) continue;
      const state = m[7]!;
      const status: PortStatus = state === 'Up' ? 'up' : state === 'Down' ? 'down' : 'not-present';
      r.state.ports.push({
        name: iface(m[1]!),
        status,
        statusText: state,
        type: m[2]!,
        ...(m[3] !== '--' ? { duplex: m[3]! } : {}),
        ...(m[4] !== '--' ? { speed: m[4]! } : {}),
        src: at(i),
      });
      read = true;
      continue;
    }
    const m = IOS_STATUS.exec(line);
    if (!m || /^Port\b/.test(line)) continue;
    const text = m[3]!;
    const known: PortStatus[] = [
      'connected',
      'notconnect',
      'disabled',
      'err-disabled',
      'inactive',
      'monitoring',
      'suspended',
    ];
    r.state.ports.push({
      name: iface(m[1]!),
      status: (known as string[]).includes(text) ? (text as PortStatus) : 'other',
      statusText: text,
      vlan: m[4]!,
      duplex: m[5]!,
      speed: m[6]!,
      ...(m[7]!.trim() ? { type: m[7]!.trim() } : {}),
      ...(m[2]!.trim() ? { description: m[2]!.trim() } : {}),
      src: at(i),
    });
    read = true;
  }
  return read;
};

const ciscoVlanBrief: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let current: DeviceState['vlans'][number] | null = null;
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    const m =
      /^(\d+)\s+(\S+)\s+(active|act\/lshut|sus\/lshut|act\/ishut|suspended|act\/unsup)\s*(.*)$/.exec(
        line,
      );
    if (m) {
      current = {
        id: Number(m[1]),
        name: m[2]!,
        status: m[3]!,
        ports: splitPorts(m[4]!),
        src: at(i),
      };
      r.state.vlans.push(current);
      read = true;
    } else if (current && /^\s{20,}\S/.test(line)) {
      current.ports.push(...splitPorts(line));
      current.src = [[current.src[0]![0], i + 1]];
    } else if (!/^\s*$/.test(line)) {
      current = null;
    }
  }
  return read;
};

/** Small Business "show vlan": ID and name; the port columns use ranges. */
const sbVlan: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  for (let i = a; i <= b; i++) {
    const m = /^\s*(\d{1,4})\s+(\S+)\s+(.*?)\s+([DSGRV]+)\s*$/.exec(r.lines[i]!);
    if (!m) continue;
    r.state.vlans.push({ id: Number(m[1]), name: m[2]!, ports: [], src: at(i) });
    read = true;
  }
  return read;
};

function splitPorts(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter((p) => /^[A-Za-z]/.test(p))
    .map(iface);
}

const ciscoEtherchannel: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let current: DeviceState['etherchannels'][number] | null = null;
  const member = /([A-Za-z]+[\d/]+)\(([A-Za-z]+)\)/g;
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    const m = /^(\d+)\s+(Po\d+)\(([A-Za-z]+)\)\s+(\S+)?\s*(.*)$/.exec(line);
    if (m) {
      current = {
        group: Number(m[1]),
        name: iface(m[2]!),
        flags: m[3]!,
        ...(m[4] && m[4] !== '-' ? { protocol: m[4] } : {}),
        members: [...(m[5] ?? '').matchAll(member)].map((x) => ({
          name: iface(x[1]!),
          flags: x[2]!,
        })),
        src: at(i),
      };
      r.state.etherchannels.push(current);
      read = true;
    } else if (current && /^\s+\S+\(/.test(line)) {
      current.members.push(
        ...[...line.matchAll(member)].map((x) => ({ name: iface(x[1]!), flags: x[2]! })),
      );
      current.src = [[current.src[0]![0], i + 1]];
    } else {
      current = null;
    }
  }
  return read;
};

const ciscoCdp: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const block = r.lines.slice(start, end);
    const device = /^Device ID:\s*(.+)$/.exec(block[0]!)?.[1]?.trim();
    const intf = block
      .map((l) => /^Interface:\s*([^,]+),\s*Port ID \(outgoing port\):\s*(.+)$/.exec(l))
      .find(Boolean);
    if (device && intf) {
      const ip = block.map((l) => /^\s*IP(?:v4)? address:\s*(\S+)/.exec(l)).find(Boolean)?.[1];
      const platform = block
        .map((l) => /^Platform:\s*([^,]+)/.exec(l))
        .find(Boolean)?.[1]
        ?.trim();
      r.state.neighbors.push({
        protocol: 'cdp',
        local: iface(intf[1]!.trim()),
        device: device.replace(/\..*$/, (d) => (isIpv4(device) ? d : '')),
        port: intf[2]!.trim(),
        ...(ip ? { ip } : {}),
        ...(platform ? { platform: platform.replace(/^cisco\s+/i, '') } : {}),
        src: span(start, end - 1),
      });
      read = true;
    }
    start = -1;
  };
  for (let i = a; i <= b; i++) {
    if (/^Device ID:/.test(r.lines[i]!)) {
      flush(i);
      start = i;
    }
  }
  flush(b + 1);
  return read;
};

const ciscoLldpDetail: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const block = r.lines.slice(start, end);
    const get = (re: RegExp) =>
      block
        .map((l) => re.exec(l))
        .find(Boolean)?.[1]
        ?.trim();
    const local = get(/^Local Intf:\s*(\S+)/);
    const device = get(/^System Name:\s*(.+)$/) ?? get(/^Chassis id:\s*(\S+)/);
    if (local && device) {
      const descIndex = block.findIndex((l) => /^System Description:/.test(l));
      const description = descIndex >= 0 ? block[descIndex + 1]?.trim() : undefined;
      const ip = get(/^\s+IP:\s*(\S+)/);
      const port = get(/^Port id:\s*(\S+)/);
      const caps = get(/^Enabled Capabilities:\s*(.+)$/);
      r.state.neighbors.push({
        protocol: 'lldp',
        local: iface(local),
        device: device.replace(/\.[a-z].*$/i, ''),
        ...(port ? { port } : {}),
        ...(ip ? { ip } : {}),
        ...(description ? { description } : {}),
        ...(caps ? { capabilities: caps } : {}),
        src: span(start, end - 1),
      });
      read = true;
    }
    start = -1;
  };
  for (let i = a; i <= b; i++) {
    if (/^Local Intf:/.test(r.lines[i]!)) {
      flush(i);
      start = i;
    } else if (/^Total entries displayed/.test(r.lines[i]!)) {
      flush(i);
    }
  }
  flush(b + 1);
  return read;
};

/** Small Business "show lldp neighbors": one line per neighbour. */
const sbLldp: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  for (let i = a; i <= b; i++) {
    const m = /^((?:gi|te|fa|Po)\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*?)\s+(\d+)\s*$/.exec(r.lines[i]!);
    if (!m) continue;
    r.state.neighbors.push({
      protocol: 'lldp',
      local: iface(m[1]!),
      device: m[4]!,
      port: m[3]!,
      capabilities: m[5]!.trim(),
      src: at(i),
    });
    read = true;
  }
  return read;
};

const ciscoMacTable: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    // IOS:  "  10    0000.5e00.5301    DYNAMIC     Gi1/0/30"
    // SB:   "     10        00:00:5e:00:53:20    gi1/0/5    dynamic"
    let m =
      /^\s*(\d+)\s+([0-9a-fA-F.:-]{12,17})\s+(DYNAMIC|STATIC|SECURE\w*|dynamic|static|secure|self|management|\S+)\s+(\S+)\s*$/.exec(
        line,
      );
    let vlan: string, mac: string, type: string, port: string;
    if (m && /\./.test(m[2]!)) {
      [, vlan, mac, type, port] = m as unknown as [string, string, string, string, string];
    } else {
      m = /^\s*(\d+)\s+([0-9a-fA-F:]{17})\s+(\S+)\s+(\S+)\s*$/.exec(line);
      if (!m) continue;
      [, vlan, mac, port, type] = m as unknown as [string, string, string, string, string];
    }
    const normalized = normalizeMac(mac);
    if (!normalized || /^(CPU|self|0)$/i.test(port) || /^(self|management)$/i.test(type)) continue;
    const t = type.toLowerCase();
    const macType: MacType = t.startsWith('dyn')
      ? 'dynamic'
      : t.startsWith('stat')
        ? 'static'
        : t.startsWith('secure')
          ? 'secure'
          : 'other';
    r.state.macs.push({
      mac: normalized,
      vlan: Number(vlan),
      type: macType,
      port: iface(port),
      src: at(i),
    });
    read = true;
  }
  return read;
};

const ciscoArp: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    // IOS: "Internet  10.10.99.250           12   0000.5e00.53f1  ARPA   Vlan99"
    let m = /^Internet\s+(\S+)\s+(\S+)\s+(\S+)\s+ARPA\s+(\S+)/.exec(line);
    if (m) {
      const mac = normalizeMac(m[3]!);
      r.state.arp.push({
        ip: m[1]!,
        ...(mac ? { mac } : {}),
        age: m[2]!,
        interface: iface(m[4]!),
        src: at(i),
      });
      read = true;
      continue;
    }
    // SB: "vlan 99    gi1/0/48     10.23.99.1        00:00:5e:00:53:f2   dynamic"
    m = /^\s*(vlan \d+)\s+(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:]{17})\s+(\S+)/.exec(line);
    if (m) {
      r.state.arp.push({
        ip: m[3]!,
        mac: normalizeMac(m[4]!)!,
        interface: iface(m[1]!.replace(' ', '')),
        src: at(i),
      });
      read = true;
    }
  }
  return read;
};

const ciscoPower: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    // IOS: "Gi1/0/1   auto   on         6.1     IP Phone 8845       2     30.0"
    let m =
      /^((?:Gi|Te|Fa|Tw|Mu)\S+)\s+(auto|static|off|never|consumption)\s+(on|off|faulty|power-deny|err-disable)\s+([\d.]+)\s+(.*?)\s+(\S+)\s+([\d.]+)\s*$/.exec(
        line,
      );
    if (m) {
      const device = m[5]!.trim();
      r.state.poe.push({
        port: iface(m[1]!),
        admin: m[2]!,
        oper: m[3]!,
        watts: Number(m[4]),
        ...(device && device !== 'n/a' ? { device } : {}),
        ...(m[6] !== 'n/a' ? { class: m[6]! } : {}),
        maxWatts: Number(m[7]),
        src: at(i),
      });
      read = true;
      continue;
    }
    // SB: "gi1/0/1        IP Phone              Auto           On          low       class2"
    m =
      /^((?:gi|te|fa)\S+)\s+(.*?)\s*(Auto|Never)\s+(On|Off|Searching|Fault|Test|Delivering Power|Disabled)\s+(\S+)\s+(\S+)\s*$/.exec(
        line,
      );
    if (m) {
      const device = m[2]!.trim();
      r.state.poe.push({
        port: iface(m[1]!),
        admin: m[3]!.toLowerCase(),
        oper: m[4]!.toLowerCase(),
        ...(device ? { device } : {}),
        class: m[6]!,
        src: at(i),
      });
      read = true;
    }
  }
  return read;
};

// ---- FortiOS ---------------------------------------------------------------------------

const fortiStatus: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    let m: RegExpExecArray | null;
    if ((m = /^Version:\s+(\S+)\s+v(\d+\.\d+\.\d+)/.exec(line))) {
      r.state.model ??= m[1]!;
      r.state.version ??= m[2]!;
      read = true;
    } else if ((m = /^Serial-Number:\s+(\S+)/.exec(line))) {
      if (!r.state.serials.includes(m[1]!)) r.state.serials.push(m[1]!);
      read = true;
    } else if ((m = /^Hostname:\s+(\S+)/.exec(line))) {
      r.state.hostname ??= m[1]!;
      read = true;
    } else if ((m = /^(?:Cluster )?[Uu]ptime:\s+(.+)$/.exec(line))) {
      r.state.uptime ??= m[1]!.trim();
    }
  }
  return read;
};

const fortiInterfacePhysical: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let name: string | null = null;
  let start = -1;
  let status = '';
  let speed = '';
  const flush = (end: number) => {
    if (name && status) {
      r.state.ports.push({
        name,
        status: status === 'up' ? 'up' : 'down',
        statusText: status,
        ...(speed && speed !== 'n/a' ? { speed } : {}),
        src: span(start, end - 1),
      });
      read = true;
    }
    name = null;
    status = '';
    speed = '';
  };
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    const head = /^\s+==\[(.+)\]\s*$/.exec(line);
    if (head) {
      flush(i);
      name = head[1]!;
      start = i;
      continue;
    }
    const s = /^\s+status:\s*(\S+)/.exec(line);
    if (s) status = s[1]!;
    const sp = /^\s+speed:\s*(\S+)/.exec(line);
    if (sp) speed = sp[1]!;
  }
  flush(b + 1);
  return read;
};

const fortiTunnelSummary: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  for (let i = a; i <= b; i++) {
    const m =
      /^'([^']+)'\s+(\S+?):\d+\s+selectors\(total,up\):\s*(\d+)\/(\d+)\s+rx\(pkt,err\):\s*(\d+)\/\d+\s+tx\(pkt,err\):\s*(\d+)/.exec(
        r.lines[i]!,
      );
    if (!m) continue;
    r.state.tunnels.push({
      name: m[1]!.replace(/_\d+$/, ''),
      instance: m[1]!,
      remote: m[2]!,
      selectorsTotal: Number(m[3]),
      selectorsUp: Number(m[4]),
      rxPackets: Number(m[5]),
      txPackets: Number(m[6]),
      ...(r.out.context ? { context: r.out.context } : {}),
      src: at(i),
    });
    read = true;
  }
  return read;
};

const fortiIkeGateways: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let start = -1;
  let name = '';
  let version: number | undefined;
  let established: boolean | undefined;
  let remote: string | undefined;
  let vdom: string | undefined;
  const flush = (end: number) => {
    if (name) {
      const existing = r.state.tunnels.find((t) => t.instance === name);
      if (existing) {
        if (version !== undefined) existing.ikeVersion = version;
        if (established !== undefined) existing.ikeEstablished = established;
      } else {
        r.state.tunnels.push({
          name: name.replace(/_\d+$/, ''),
          instance: name,
          ...(remote ? { remote } : {}),
          selectorsTotal: 0,
          selectorsUp: 0,
          ...(version !== undefined ? { ikeVersion: version } : {}),
          ...(established !== undefined ? { ikeEstablished: established } : {}),
          ...((vdom ?? r.out.context) ? { context: vdom ?? r.out.context } : {}),
          src: span(start, end - 1),
        });
      }
      read = true;
    }
    name = '';
    version = undefined;
    established = undefined;
    remote = undefined;
  };
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    let m: RegExpExecArray | null;
    if ((m = /^vd:\s*([^/\s]+)/.exec(line))) {
      flush(i);
      vdom = m[1]!;
      start = i;
    } else if ((m = /^name:\s*(\S+)/.exec(line))) {
      if (name) flush(i);
      if (start < 0 || start < i - 2) start = i;
      name = m[1]!;
    } else if ((m = /^version:\s*(\d)/.exec(line))) version = Number(m[1]);
    else if ((m = /^addr:\s*\S+\s*->\s*(\S+?):\d+/.exec(line))) remote = m[1]!;
    else if ((m = /^IKE SA:.*established\s+(\d+)\/(\d+)/.exec(line)))
      established = Number(m[1]) > 0;
  }
  flush(b + 1);
  return read;
};

const fortiRoutes: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let last: { code: string; prefix: string } | null = null;
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    // "S*      0.0.0.0/0 [10/0] via 203.0.113.1, wan1, [1/0]"
    // "C       10.10.10.0/24 is directly connected, VL10-DATA"
    // "                  [20/0] via 198.51.100.9, wan2, [1/0]"  (another path)
    let m = /^([A-Z][A-Z0-9 ]{0,4}?)\*?\s+(\d+\.\d+\.\d+\.\d+\/\d+)\s+(.*)$/.exec(line);
    let code: string;
    let prefix: string;
    let rest: string;
    if (m && !/^Codes/.test(line)) {
      code = m[1]!.trim();
      prefix = m[2]!;
      rest = m[3]!;
      last = { code, prefix };
    } else if (last && (m = /^\s{8,}(\[.*)$/.exec(line))) {
      ({ code, prefix } = last);
      rest = m[1]!;
    } else {
      continue;
    }
    const metric = /\[(\d+)\/(\d+)\]/.exec(rest);
    // "via 10.255.1.21 (recursive is directly connected, ADVPN-WAN1), 2d03h, [1/0]":
    // the interface of a recursive route is inside the parentheses.
    const recursive = /\(recursive (?:is directly connected|via \S+),\s*([^)]+)\)/.exec(rest);
    const via = /via\s+(\d+\.\d+\.\d+\.\d+)(?:\s+\([^)]*\))?(?:,\s*([A-Za-z][^,\s]*))?/.exec(rest);
    const direct = /^is directly connected,\s*([^,\s]+)/.exec(rest);
    const age = /,\s*(\d+[dhms][\w:]*)/.exec(rest);
    r.state.routes.push({
      code,
      prefix,
      ...(metric ? { distance: Number(metric[1]), metric: Number(metric[2]) } : {}),
      ...(via ? { gateway: via[1]! } : {}),
      ...(recursive
        ? { interface: recursive[1]!.trim() }
        : via?.[2] && !/^\d+[dhms]/.test(via[2])
          ? { interface: via[2] }
          : direct
            ? { interface: direct[1]! }
            : {}),
      ...(age ? { age: age[1]! } : {}),
      selected: true,
      ...(r.out.context ? { context: r.out.context } : {}),
      src: at(i),
    });
    read = true;
  }
  return read;
};

const fortiBgpSummary: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  for (let i = a; i <= b; i++) {
    // "10.255.1.21     4      65000      5432      5440        11    0    0 2d03h12m        1"
    const m =
      /^(\d+\.\d+\.\d+\.\d+)\s+4\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s*$/.exec(
        r.lines[i]!,
      );
    if (!m) continue;
    const established = /^\d+$/.test(m[4]!);
    r.state.bgp.push({
      neighbor: m[1]!,
      remoteAs: m[2]!,
      upDown: m[3]!,
      state: established ? 'Established' : m[4]!,
      ...(established ? { prefixes: Number(m[4]) } : {}),
      ...(r.out.context ? { context: r.out.context } : {}),
      src: at(i),
    });
    read = true;
  }
  return read;
};

const fortiHealthCheck: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let check = '';
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    const head = /^Health Check\((.+)\):\s*$/.exec(line);
    if (head) {
      check = head[1]!;
      continue;
    }
    const m = /^Seq\((\d+)\s+([^)]+)\):\s*state\((\w+)\)(.*)$/.exec(line);
    if (!m || !check) continue;
    const rest = m[4]!;
    const num = (re: RegExp) => {
      const x = re.exec(rest);
      return x ? Number(x[1]) : undefined;
    };
    const loss = num(/packet-loss\(([\d.]+)%\)/);
    const latency = num(/latency\(([\d.]+)\)/);
    const jitter = num(/jitter\(([\d.]+)\)/);
    const map = /sla_map=0x([0-9a-f]+)/i.exec(rest);
    r.state.sla.push({
      healthCheck: check,
      seq: Number(m[1]),
      member: m[2]!.trim(),
      alive: m[3] === 'alive',
      ...(loss !== undefined ? { packetLoss: loss } : {}),
      ...(latency !== undefined ? { latency } : {}),
      ...(jitter !== undefined ? { jitter } : {}),
      ...(map ? { slaMap: parseInt(map[1]!, 16) } : {}),
      ...(r.out.context ? { context: r.out.context } : {}),
      src: at(i),
    });
    read = true;
  }
  return read;
};

const fortiSdwanService: ReadFn = (r) => {
  const [a, b] = range(r);
  let read = false;
  let current: DeviceState['sdwanServices'][number] | null = null;
  for (let i = a; i <= b; i++) {
    const line = r.lines[i]!;
    const head = /^Service\((\d+)\):/.exec(line);
    if (head) {
      current = {
        id: Number(head[1]),
        members: [],
        ...(r.out.context ? { context: r.out.context } : {}),
        src: at(i),
      };
      r.state.sdwanServices.push(current);
      read = true;
      continue;
    }
    const m = /^\s+\d+:\s*Seq_num\((\d+)\s+(\S+)[^)]*\),\s*(alive|dead)(.*)$/.exec(line);
    if (m && current) {
      const sla = /sla\(0x([0-9a-f]+)\)/i.exec(m[4]!);
      current.members.push({
        seq: Number(m[1]),
        interface: m[2]!,
        alive: m[3] === 'alive',
        selected: /\bselected\b/.test(m[4]!),
        ...(sla ? { sla: parseInt(sla[1]!, 16) } : {}),
      });
      current.src = [[current.src[0]![0], i + 1]];
    }
  }
  return read;
};

const READERS: Partial<Record<ShowCommandId, ReadFn>> = {
  'show version': ciscoVersion,
  'show inventory': ciscoInventory,
  'show interfaces status': ciscoInterfacesStatus,
  'show vlan brief': ciscoVlanBrief,
  'show vlan': sbVlan,
  'show etherchannel summary': ciscoEtherchannel,
  'show cdp neighbors detail': ciscoCdp,
  'show lldp neighbors detail': ciscoLldpDetail,
  'show lldp neighbors': sbLldp,
  'show mac address-table': ciscoMacTable,
  'show ip arp': ciscoArp,
  'show arp': ciscoArp,
  'show power inline': ciscoPower,
  'get system status': fortiStatus,
  'get system interface physical': fortiInterfacePhysical,
  'get vpn ipsec tunnel summary': fortiTunnelSummary,
  'diagnose vpn ike gateway list': fortiIkeGateways,
  'get router info routing-table all': fortiRoutes,
  'get router info bgp summary': fortiBgpSummary,
  'diagnose sys sdwan health-check': fortiHealthCheck,
  'diagnose sys sdwan service': fortiSdwanService,
};

/** Reads one output into the state; returns whether anything was read. */
export function readOutput(lines: string[], out: ShowOutput, state: DeviceState): boolean {
  const reader = out.id ? READERS[out.id] : undefined;
  if (!reader) return false;
  const read = reader({ lines, out, state });
  if (read && out.id) {
    state.commands.push({
      id: out.id,
      line: out.line,
      ...(out.context ? { context: out.context } : {}),
    });
  }
  return read;
}

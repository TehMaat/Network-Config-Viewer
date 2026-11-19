import type { Detected, Detection } from './types';
import { detected, findLine, findLines, firstNonEmpty } from './util';

const HOSTNAME = /^hostname\s+(\S+)\s*$/;
const STACK_INTERFACE =
  /^interface\s+(?:GigabitEthernet|TenGigabitEthernet|TwoGigabitEthernet|FiveGigabitEthernet|FastEthernet|gi|te|fa)\s*(\d+)\/\d+\/\d+\s*$/i;

function hostname(lines: string[]): Detected<string> | undefined {
  const m = findLine(lines, HOSTNAME);
  return m ? detected(m.match[1]!, 'cisco.hostname', m.index, lines) : undefined;
}

/** Stack members from interface numbering (unit/slot/port), when no other source says it. */
function stackFromInterfaces(lines: string[]): Detected<number> | undefined {
  const units = new Map<number, number>();
  for (const m of findLines(lines, STACK_INTERFACE)) {
    const unit = Number(m.match[1]);
    if (!units.has(unit)) units.set(unit, m.index);
  }
  if (units.size < 2) return undefined;
  const second = [...units.entries()].sort((a, b) => a[0] - b[0])[1]!;
  return detected(units.size, 'cisco.stack-interfaces', second[1], lines);
}

const SB_FAMILIES: Record<string, string> = {
  '1': 'Sx300/Sx500',
  '2': 'Sx250/Sx350/Sx550X',
  '3': 'CBS250/CBS350',
  '4': 'Catalyst 1200/1300',
};

/**
 * Cisco Small Business switches (Sx300 to Catalyst 1300) start with "config-file-header",
 * followed by the host name and the firmware version.
 */
export function detectCiscoSb(lines: string[]): Detection | null {
  const first = firstNonEmpty(lines);
  if (first === -1 || lines[first]!.trim() !== 'config-file-header') return null;
  const result: Detection = {
    kind: detected('config', 'sb.header', first, lines),
    vendor: detected('cisco', 'sb.header', first, lines),
    os: detected('cisco-sb', 'sb.header', first, lines),
    syntax: 'indent',
  };
  const nameIndex = firstNonEmpty(lines, first + 1);
  const versionLine = findLine(
    lines,
    /^v(\d+)\.(\d+\.\d+\.\d+)\s*\/\s*(\S+)/,
    first + 1,
    first + 6,
  );
  if (versionLine) {
    const [, major, rest, build] = versionLine.match;
    result.version = detected(`${major}.${rest}`, 'sb.version', versionLine.index, lines);
    result.build = detected(build!, 'sb.version', versionLine.index, lines);
    const family = SB_FAMILIES[major!];
    if (family) result.model = detected(family, 'sb.family', versionLine.index, lines);
  }
  const host = hostname(lines);
  if (host) {
    result.hostname = host;
  } else if (nameIndex !== -1 && (!versionLine || nameIndex < versionLine.index)) {
    result.hostname = detected(lines[nameIndex]!.trim(), 'sb.header', nameIndex, lines);
  }
  const stack = stackFromInterfaces(lines);
  if (stack) result.stack = stack;
  return result;
}

/** Cisco ASA: "ASA Version 9.16(4)" near the top, hardware in the ": Hardware:" comment. */
export function detectAsa(lines: string[]): Detection | null {
  const version = findLine(lines, /^ASA Version\s+(\S+)/, 0, 30);
  if (!version) return null;
  const result: Detection = {
    kind: detected('config', 'asa.version', version.index, lines),
    vendor: detected('cisco', 'asa.version', version.index, lines),
    os: detected('asa', 'asa.version', version.index, lines),
    version: detected(version.match[1]!, 'asa.version', version.index, lines),
    syntax: 'indent',
  };
  const hardware = findLine(lines, /^:\s*Hardware:\s+([^,\s]+)/, 0, 30);
  if (hardware) result.model = detected(hardware.match[1]!, 'asa.hardware', hardware.index, lines);
  const host = hostname(lines);
  if (host) result.hostname = host;
  return result;
}

/** Cisco NX-OS: "!Command: show running-config" header or "version 9.3(8)" with "feature" lines. */
export function detectNxos(lines: string[]): Detection | null {
  const header = findLine(lines, /^!Command: show (running|startup)-config/, 0, 10);
  const version = findLine(lines, /^version\s+(\d+\.\d+\(\w+\))/, 0, 200);
  const feature = header ? null : findLine(lines, /^feature\s+\S+/, 0, 500);
  if (!header && !(version && feature)) return null;
  const anchor = header ?? version!;
  const result: Detection = {
    kind: detected('config', 'nxos.header', anchor.index, lines),
    vendor: detected('cisco', 'nxos.header', anchor.index, lines),
    os: detected('nx-os', header ? 'nxos.header' : 'nxos.version', anchor.index, lines),
    syntax: 'indent',
  };
  if (version) result.version = detected(version.match[1]!, 'nxos.version', version.index, lines);
  const host = findLine(lines, /^(?:hostname|switchname)\s+(\S+)\s*$/);
  if (host) result.hostname = detected(host.match[1]!, 'cisco.hostname', host.index, lines);
  return result;
}

/** Cisco IOS and IOS-XE: "version 15.2" (IOS) or "version 16.x / 17.x" (IOS-XE). */
export function detectIos(lines: string[]): Detection | null {
  const version = findLine(lines, /^version\s+(\d+)\.(\d+)\s*$/, 0, 500);
  if (!version) return null;
  const major = Number(version.match[1]);
  const rule = major >= 16 ? 'cisco.version-xe' : 'cisco.version-ios';
  const result: Detection = {
    kind: detected('config', rule, version.index, lines),
    vendor: detected('cisco', rule, version.index, lines),
    os: detected(major >= 16 ? 'ios-xe' : 'ios', rule, version.index, lines),
    version: detected(`${version.match[1]}.${version.match[2]}`, rule, version.index, lines),
    syntax: 'indent',
  };
  const provision = findLines(lines, /^switch\s+(\d+)\s+provision\s+(\S+)/, 0, 2000);
  if (provision.length > 0) {
    const first = provision[0]!;
    result.model = detected(first.match[2]!.toUpperCase(), 'cisco.provision', first.index, lines);
    if (provision.length > 1) {
      result.stack = detected(provision.length, 'cisco.provision', provision[1]!.index, lines);
    }
  } else {
    const udi = findLine(lines, /^license udi pid\s+(\S+)\s+sn\s+(\S+)/);
    if (udi) result.model = detected(udi.match[1]!, 'cisco.license-udi', udi.index, lines);
    const stack = stackFromInterfaces(lines);
    if (stack) result.stack = stack;
  }
  const host = hostname(lines);
  if (host) result.hostname = host;
  return result;
}

/** Cisco-like syntax without a version line: interfaces, "!" separators, hostname or end. */
export function detectCiscoSyntax(lines: string[]): Detection | null {
  const limit = Math.min(lines.length, 5000);
  const iface = findLine(lines, /^interface\s+\S+/, 0, limit);
  if (!iface) return null;
  const bang = findLine(lines, /^!/, 0, limit);
  const end = findLine(lines, /^(hostname\s+\S+|end)\s*$/);
  if (!bang || !end) return null;
  const result: Detection = {
    kind: detected('config', 'cisco.syntax', iface.index, lines),
    vendor: detected('cisco', 'cisco.syntax', iface.index, lines),
    syntax: 'indent',
  };
  const host = hostname(lines);
  if (host) result.hostname = host;
  const stack = stackFromInterfaces(lines);
  if (stack) result.stack = stack;
  return result;
}

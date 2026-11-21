import type { Detected, Detection, OsId, ShowCommand, Vendor } from './types';
import { detected, findLine, firstNonEmpty } from './util';

export interface Prompt {
  /** 0-based line index. */
  index: number;
  vendor: Vendor;
  hostname: string;
  command: string;
  /** FortiOS: the VDOM, or "global", written in the prompt. */
  context?: string;
}

// FGT-HQ # get system status   |   FGT-HQ (global) # show   |   FGT-HQ (root) $ diagnose ...
const FORTI_PROMPT =
  /^([A-Za-z0-9][\w.-]*)(?: \(([^)\s]+)\))? [#$] ((?:get|show|diagnose|diag|execute|exec|fnsysctl|config|edit|end|next)\b.*?)\s*$/;
// SW-CORE#show version   |   SW-CORE>show ip interface brief   |   SW(config)#do show run
const CISCO_PROMPT =
  /^([A-Za-z0-9][\w.\-/:]*?)(?:\([^)]*\))?[#>]\s?((?:show|sh|sho|terminal|term|more|dir|ping|traceroute|do)\b.*?)\s*$/;

/** Finds the lines where a command was typed after a device prompt. */
export function findPrompts(lines: string[]): Prompt[] {
  const prompts: Prompt[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0 || line.length > 300) continue;
    const c = line.charCodeAt(0);
    // Prompts start with a letter or a digit: skip indented and comment lines quickly.
    if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) continue;
    if (!line.includes('#') && !line.includes('>') && !line.includes('$')) continue;
    let m = FORTI_PROMPT.exec(line);
    if (m) {
      prompts.push({
        index: i,
        vendor: 'fortinet',
        hostname: m[1]!,
        command: normalize(m[3]!),
        ...(m[2] ? { context: m[2] } : {}),
      });
      continue;
    }
    m = CISCO_PROMPT.exec(line);
    if (m) {
      prompts.push({ index: i, vendor: 'cisco', hostname: m[1]!, command: normalize(m[2]!) });
    }
  }
  return prompts;
}

function normalize(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

/** Commands whose output is the configuration itself. */
export function isConfigDump(prompt: Prompt): boolean {
  const cmd = prompt.command.toLowerCase();
  if (prompt.vendor === 'fortinet') return /^show(\s|$)/.test(cmd);
  return /^(do\s+)?(show|sh|sho)\s+(run|runn|runni|runnin|running|running-config|start|startup|startup-config)\b/.test(
    cmd,
  );
}

/** Detection for a file containing commands typed after a prompt and their output. */
export function detectShowWithPrompts(lines: string[], prompts: Prompt[]): Detection {
  const first = prompts[0]!;
  const result: Detection = {
    kind: detected('show', 'show.prompt', first.index, lines),
    vendor: detected(first.vendor, 'show.prompt', first.index, lines),
    hostname: detected(first.hostname, 'show.prompt', first.index, lines),
    commands: prompts.map((p) => ({ command: p.command, line: p.index + 1, inferred: false })),
    syntax: 'show',
  };
  prompts.forEach((prompt, n) => {
    const end = prompts[n + 1]?.index ?? lines.length;
    if (isVersionCommand(prompt)) {
      Object.assign(result, versionInfo(lines, prompt.index + 1, end));
    }
  });
  return result;
}

function isVersionCommand(prompt: Prompt): boolean {
  const cmd = prompt.command.toLowerCase();
  if (prompt.vendor === 'fortinet') return /^get\s+sys(tem)?\s+stat(us)?\b/.test(cmd);
  return /^(do\s+)?(show|sh|sho)\s+ver(s|si|sio|sion)?\b/.test(cmd);
}

interface Signature {
  re: RegExp;
  command: string;
  vendor: Vendor;
  /** The output describes the device itself (version, model): parse it. */
  version?: boolean;
}

const SIGNATURES: Signature[] = [
  {
    re: /^Cisco IOS XE Software, Version/,
    command: 'show version',
    vendor: 'cisco',
    version: true,
  },
  { re: /^Cisco IOS Software\b.*Version/, command: 'show version', vendor: 'cisco', version: true },
  {
    re: /^Cisco Nexus Operating System \(NX-OS\) Software/,
    command: 'show version',
    vendor: 'cisco',
    version: true,
  },
  {
    re: /^Cisco Adaptive Security Appliance Software Version/,
    command: 'show version',
    vendor: 'cisco',
    version: true,
  },
  {
    re: /^Version: (FortiGate|FortiWiFi|FortiGateRugged)-/,
    command: 'get system status',
    vendor: 'fortinet',
    version: true,
  },
  { re: /^Device ID: /, command: 'show cdp neighbors detail', vendor: 'cisco' },
  { re: /^Device ID\s+Local Intrfce\s+Holdtme/, command: 'show cdp neighbors', vendor: 'cisco' },
  { re: /^Chassis id: /, command: 'show lldp neighbors detail', vendor: 'cisco' },
  {
    re: /^Port\s+Name\s+Status\s+Vlan\s+Duplex\s+Speed\s+Type/,
    command: 'show interfaces status',
    vendor: 'cisco',
  },
  { re: /^VLAN\s+Name\s+Status\s+Ports/, command: 'show vlan brief', vendor: 'cisco' },
  {
    re: /^Group\s+Port-channel\s+Protocol\s+Ports/,
    command: 'show etherchannel summary',
    vendor: 'cisco',
  },
  { re: /^\s*Mac Address Table\s*$/, command: 'show mac address-table', vendor: 'cisco' },
  {
    re: /^Protocol\s+Address\s+Age \(min\)\s+Hardware Addr\s+Type\s+Interface/,
    command: 'show ip arp',
    vendor: 'cisco',
  },
  { re: /^NAME: ".*", DESCR: "/, command: 'show inventory', vendor: 'cisco' },
  { re: /^Interface\s+Admin\s+Oper\s+Power/, command: 'show power inline', vendor: 'cisco' },
  // Cisco Small Business.
  {
    re: /^Port\s+Type\s+Duplex\s+Speed\s+Neg\s+ctrl\s+State/,
    command: 'show interfaces status',
    vendor: 'cisco',
  },
  {
    re: /^\s+Vlan\s+Mac Address\s+Port\s+Type\s*$/,
    command: 'show mac address-table',
    vendor: 'cisco',
  },
  {
    re: /^\s*Port\s+Device ID\s+Port ID\s+System Name\s+Capabilities/,
    command: 'show lldp neighbors',
    vendor: 'cisco',
  },
  {
    re: /^\s*Port\s+Powered Device\s+State\s+Status\s+Priority\s+Class/,
    command: 'show power inline',
    vendor: 'cisco',
  },
  // FortiOS.
  {
    re: /^Codes: K - kernel, C - connected, S - static/,
    command: 'get router info routing-table all',
    vendor: 'fortinet',
  },
  {
    re: /^'[^']+' \S+:\d+\s+selectors\(total,up\):/,
    command: 'get vpn ipsec tunnel summary',
    vendor: 'fortinet',
  },
  {
    re: /^Health Check\(.+\):\s*$/,
    command: 'diagnose sys sdwan health-check',
    vendor: 'fortinet',
  },
  {
    re: /^Service\(\d+\): Address Mode/,
    command: 'diagnose sys sdwan service',
    vendor: 'fortinet',
  },
  { re: /^== \[onboard\]\s*$/, command: 'get system interface physical', vendor: 'fortinet' },
];

/** Where each output recognised from its shape begins, in a file without prompts. */
export function signatureStarts(lines: string[]): { index: number; command: string }[] {
  const out: { index: number; command: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0 || line.length > 300) continue;
    const sig = SIGNATURES.find((s) => s.re.test(line));
    if (!sig) continue;
    // The same command matches only once in a row (CDP has one block per neighbour).
    if (out.at(-1)?.command === sig.command) continue;
    out.push({ index: i, command: sig.command });
  }
  return out;
}

/** Detection for command output without prompts, from the shape of the output. */
export function detectShowSignature(lines: string[]): Detection | null {
  const limit = Math.min(lines.length, 300);
  const commands: ShowCommand[] = [];
  let vendor: Vendor | null = null;
  let anchor = -1;
  for (let i = 0; i < limit; i++) {
    const line = lines[i]!;
    for (const sig of SIGNATURES) {
      if (!sig.re.test(line)) continue;
      if (commands.some((c) => c.command === sig.command)) break;
      commands.push({ command: sig.command, line: i + 1, inferred: true });
      vendor ??= sig.vendor;
      if (anchor === -1) anchor = i;
      break;
    }
  }
  if (commands.length === 0 || vendor === null) return null;
  const result: Detection = {
    kind: detected('show', 'show.signature', anchor, lines),
    vendor: detected(vendor, 'show.signature', anchor, lines),
    commands,
    syntax: 'show',
  };
  // Only a file that starts with "show version" describes the device itself: other outputs
  // (CDP, LLDP) also contain software versions, but of the neighbours.
  const first = firstNonEmpty(lines);
  if (first !== -1 && SIGNATURES.some((s) => s.version && s.re.test(lines[first]!))) {
    Object.assign(result, versionInfo(lines, first, lines.length));
  }
  return result;
}

type VersionInfo = Partial<
  Pick<Detection, 'os' | 'version' | 'build' | 'model' | 'hostname' | 'stack'>
>;

/** Device details from the output of "show version" or "get system status". */
function versionInfo(lines: string[], from: number, to: number): VersionInfo {
  const info: VersionInfo = {};
  const set = <K extends keyof VersionInfo>(key: K, value: VersionInfo[K]) => {
    if (value && !info[key]) info[key] = value;
  };
  const rule = 'show.version-output' as const;

  const forti = findLine(
    lines,
    /^Version: (FortiGate|FortiWiFi|FortiGateRugged)-(\S+) v(\d+\.\d+\.\d+),build(\d+)/,
    from,
    to,
  );
  if (forti) {
    const [, family, model, version, build] = forti.match;
    set('os', detected<OsId>('fortios', rule, forti.index, lines));
    set('version', detected(version!, rule, forti.index, lines));
    set('build', detected(build!, rule, forti.index, lines));
    set('model', detected(`${family}-${model}`, rule, forti.index, lines));
    const host = findLine(lines, /^Hostname:\s+(\S+)/, from, to);
    if (host) set('hostname', detected(host.match[1]!, rule, host.index, lines));
    return info;
  }

  const xe = findLine(lines, /^Cisco IOS XE Software, Version\s+(\S+)/, from, to);
  const ios = findLine(lines, /^Cisco IOS Software\b.*?Version\s+([^,\s]+)/, from, to);
  const nxos = findLine(lines, /^\s*(?:NXOS|system):\s+version\s+(\S+)/, from, to);
  const asa = findLine(
    lines,
    /^Cisco Adaptive Security Appliance Software Version\s+(\S+)/,
    from,
    to,
  );
  const os: [OsId, typeof xe] | null = xe
    ? ['ios-xe', xe]
    : asa
      ? ['asa', asa]
      : nxos
        ? ['nx-os', nxos]
        : ios
          ? ['ios', ios]
          : null;
  if (!os) return info;
  const [osId, match] = os;
  set('os', detected(osId, rule, match!.index, lines));
  set('version', detected(match!.match[1]!, rule, match!.index, lines));

  const model =
    findLine(lines, /^Model [Nn]umber\s*:\s*(\S+)/, from, to) ??
    findLine(lines, /^Hardware:\s+([^,\s]+)/, from, to) ??
    findLine(lines, /^cisco\s+(\S+)\s.*processor/, from, to);
  if (model) set('model', detected(model.match[1]!, rule, model.index, lines));

  const host = findLine(lines, /^(\S+) uptime is /, from, to);
  if (host) set('hostname', detected(host.match[1]!, rule, host.index, lines));

  const table = findLine(lines, /^Switch\s+Ports\s+Model\s+SW Version/, from, to);
  if (table) {
    let members = 0;
    let second = -1;
    for (let i = table.index + 2; i < to; i++) {
      if (!/^\*?\s+\d+\s+\d+\s+\S+/.test(lines[i]!)) break;
      members++;
      if (members === 2) second = i;
    }
    if (members > 1) set('stack', detected(members, rule, second, lines) as Detected<number>);
  }
  return info;
}

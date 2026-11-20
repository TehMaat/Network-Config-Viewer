import type { InterfaceKind } from './types';

// Cisco interface names appear abbreviated in many places: "Gi1/0/1" in show commands,
// "gi1/0/1" on Small Business switches, "Po1" for port-channels. Everything is converted to
// the full name used in IOS running-configs, so that config and show data line up.

const FULL_NAMES: [RegExp, string][] = [
  [/^(?:hundredgige|hundredgigabitethernet|hu)(?=\d)/i, 'HundredGigE'],
  [/^(?:fortygigabitethernet|fortygige|fo)(?=\d)/i, 'FortyGigabitEthernet'],
  [/^(?:twentyfivegige|twentyfivegigabitethernet|twe)(?=\d)/i, 'TwentyFiveGigE'],
  [/^(?:tengigabitethernet|tengige|te|xe)(?=\d)/i, 'TenGigabitEthernet'],
  [/^(?:fivegigabitethernet|fi)(?=\d)/i, 'FiveGigabitEthernet'],
  [/^(?:twogigabitethernet|tw)(?=\d)/i, 'TwoGigabitEthernet'],
  [/^(?:appgigabitethernet|ap)(?=\d)/i, 'AppGigabitEthernet'],
  [/^(?:gigabitethernet|gige|gi|ge)(?=\d)/i, 'GigabitEthernet'],
  [/^(?:fastethernet|fa)(?=\d)/i, 'FastEthernet'],
  [/^(?:port-channel|portchannel|po)(?=\d)/i, 'Port-channel'],
  [/^(?:loopback|lo)(?=\d)/i, 'Loopback'],
  [/^(?:tunnel|tu)(?=\d)/i, 'Tunnel'],
  [/^(?:vlan|vl)(?=\d)/i, 'Vlan'],
  [/^(?:ethernet|eth|et)(?=\d)/i, 'Ethernet'],
  [/^(?:oob|mgmt)(?=\d)/i, 'mgmt'],
];

/** Full Cisco interface name: "Gi1/0/1", "gi1/0/1" → "GigabitEthernet1/0/1"; "vlan 10" → "Vlan10". */
export function normalizeInterfaceName(name: string): string {
  const compact = name.trim().replace(/^([A-Za-z-]+)\s+(?=\d)/, '$1');
  for (const [re, full] of FULL_NAMES) {
    if (re.test(compact)) return compact.replace(re, full);
  }
  return compact;
}

/** Short form used in tables: "GigabitEthernet1/0/1" → "Gi1/0/1". */
export function shortInterfaceName(name: string): string {
  const shorts: [RegExp, string][] = [
    [/^HundredGigE/, 'Hu'],
    [/^FortyGigabitEthernet/, 'Fo'],
    [/^TwentyFiveGigE/, 'Twe'],
    [/^TenGigabitEthernet/, 'Te'],
    [/^FiveGigabitEthernet/, 'Fi'],
    [/^TwoGigabitEthernet/, 'Tw'],
    [/^AppGigabitEthernet/, 'Ap'],
    [/^GigabitEthernet/, 'Gi'],
    [/^FastEthernet/, 'Fa'],
    [/^Port-channel/, 'Po'],
    [/^Loopback/, 'Lo'],
    [/^Tunnel/, 'Tu'],
  ];
  for (const [re, short] of shorts) {
    if (re.test(name)) return name.replace(re, short);
  }
  return name;
}

/** Relative speed class of an interface type, used to tell uplinks from access ports. */
export function speedClass(name: string): number {
  if (/^HundredGigE/.test(name)) return 100;
  if (/^FortyGigabitEthernet/.test(name)) return 40;
  if (/^TwentyFiveGigE/.test(name)) return 25;
  if (/^TenGigabitEthernet/.test(name)) return 10;
  if (/^FiveGigabitEthernet/.test(name)) return 5;
  if (/^TwoGigabitEthernet/.test(name)) return 2.5;
  if (/^GigabitEthernet/.test(name)) return 1;
  if (/^FastEthernet/.test(name)) return 0.1;
  return 0;
}

/** Kind of a Cisco interface from its (normalized) name. */
export function ciscoInterfaceKind(name: string): InterfaceKind {
  if (/^Vlan\d+$/.test(name)) return 'svi';
  if (/^Port-channel\d+$/.test(name)) return 'lag';
  if (/^Loopback\d+$/.test(name)) return 'loopback';
  if (/^Tunnel\d+$/.test(name)) return 'tunnel';
  if (/^AppGigabitEthernet/.test(name)) return 'virtual';
  if (/\.\d+$/.test(name)) return 'subinterface';
  if (
    /^FastEthernet0$/.test(name) ||
    /^(Gigabit|Fast)Ethernet0\/0$/.test(name) ||
    /^mgmt\d/.test(name)
  ) {
    return 'management';
  }
  return 'physical';
}

/** "GigabitEthernet2/0/17" → member 2, slot 0, port 17. "GigabitEthernet0/5" → member 1, slot 0, port 5. */
export function parsePortNumbers(
  name: string,
): { member: number; slot: number; port: number } | null {
  let m = /^[A-Za-z-]+(\d+)\/(\d+)\/(\d+)$/.exec(name);
  if (m) return { member: Number(m[1]), slot: Number(m[2]), port: Number(m[3]) };
  m = /^[A-Za-z-]+(\d+)\/(\d+)$/.exec(name);
  if (m) return { member: Math.max(1, Number(m[1])), slot: 0, port: Number(m[2]) };
  return null;
}

/** MAC address in a single format: "aaaa.bbbb.cccc", "AA-BB-..." → "aa:bb:cc:dd:ee:ff". */
export function normalizeMac(text: string): string | null {
  const hex = text.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  if (!/^[0-9a-f.:-]+$/i.test(text.trim())) return null;
  return hex.match(/.{2}/g)!.join(':');
}

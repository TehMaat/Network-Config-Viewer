import type { Prefix } from './types';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isIpv4(text: string): boolean {
  const m = IPV4.exec(text);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

/** IPv4 address as an unsigned 32-bit number, or null. */
export function ipToInt(text: string): number | null {
  const m = IPV4.exec(text);
  if (!m) return null;
  let value = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

/** 255.255.255.0 → 24. Null when the mask is not contiguous. */
export function maskToPrefix(mask: string): number | null {
  const value = ipToInt(mask);
  if (value === null) return null;
  let prefix = 0;
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit--) {
    const one = Math.floor(value / 2 ** bit) % 2 === 1;
    if (one && seenZero) return null;
    if (one) prefix++;
    else seenZero = true;
  }
  return prefix;
}

/** Cisco wildcard 0.0.0.255 → 24. Null when not contiguous. */
export function wildcardToPrefix(wildcard: string): number | null {
  const value = ipToInt(wildcard);
  if (value === null) return null;
  return maskToPrefix(intToIp(0xffffffff - value));
}

export function prefixToMask(prefix: number): string {
  if (prefix <= 0) return '0.0.0.0';
  return intToIp(0xffffffff - (2 ** (32 - prefix) - 1));
}

/** "10.0.0.0 255.0.0.0", "10.0.0.0/8" or "10.0.0.1" (host) → prefix. */
export function parsePrefix(text: string): Prefix | null {
  const t = text.trim().replace(/^"|"$/g, '');
  let m = /^(\S+)\s+(\S+)$/.exec(t);
  if (m && isIpv4(m[1]!) && isIpv4(m[2]!)) {
    const prefix = maskToPrefix(m[2]!);
    return prefix === null ? null : { ip: m[1]!, prefix };
  }
  m = /^(\S+)\/(\d{1,2})$/.exec(t);
  if (m && isIpv4(m[1]!) && Number(m[2]) <= 32) return { ip: m[1]!, prefix: Number(m[2]) };
  if (isIpv4(t)) return { ip: t, prefix: 32 };
  return null;
}

export function formatPrefix(p: Prefix): string {
  return `${p.ip}/${p.prefix}`;
}

/** First and last address of a prefix. */
export function prefixBounds(p: Prefix): [number, number] {
  const ip = ipToInt(p.ip) ?? 0;
  const size = 2 ** (32 - p.prefix);
  const first = Math.floor(ip / size) * size;
  return [first, first + size - 1];
}

export function prefixContains(p: Prefix, ip: number): boolean {
  const [first, last] = prefixBounds(p);
  return ip >= first && ip <= last;
}

/** Network address of an interface IP: 10.0.0.1/24 → 10.0.0.0/24. */
export function networkOf(p: Prefix): Prefix {
  return { ip: intToIp(prefixBounds(p)[0]), prefix: p.prefix };
}

/** True when an IP matches "ip wildcard" (also non-contiguous wildcards). */
export function wildcardMatches(base: string, wildcard: string, ip: number): boolean {
  const b = ipToInt(base);
  const w = ipToInt(wildcard);
  if (b === null || w === null) return false;
  for (let bit = 31; bit >= 0; bit--) {
    const weight = 2 ** bit;
    const careBit = Math.floor(w / weight) % 2 === 0;
    if (careBit && Math.floor(b / weight) % 2 !== Math.floor(ip / weight) % 2) return false;
  }
  return true;
}

import type { VlanRange, VlanSet } from './types';

export const MAX_VLAN = 4094;

export function vlanSetAll(): VlanSet {
  return { all: true, ranges: [{ from: 1, to: MAX_VLAN }] };
}

export function vlanSetNone(): VlanSet {
  return { all: false, ranges: [] };
}

/** "1-10,20,30-32" (also with spaces) → ranges. Returns null when the text is not a VLAN list. */
export function parseVlanList(text: string): VlanRange[] | null {
  const ranges: VlanRange[] = [];
  for (const part of text.split(',')) {
    const p = part.trim();
    if (p === '') continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(p);
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (from < 1 || to > MAX_VLAN || from > to) return null;
    ranges.push({ from, to });
  }
  return normalize(ranges);
}

function normalize(ranges: VlanRange[]): VlanRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const out: VlanRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to + 1) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

function make(ranges: VlanRange[]): VlanSet {
  const normalized = normalize(ranges);
  const all =
    normalized.length === 1 && normalized[0]!.from === 1 && normalized[0]!.to === MAX_VLAN;
  return { all, ranges: normalized };
}

export function vlanSetFrom(ranges: VlanRange[]): VlanSet {
  return make(ranges);
}

export function vlanSetAdd(set: VlanSet, ranges: VlanRange[]): VlanSet {
  return make([...set.ranges, ...ranges]);
}

export function vlanSetRemove(set: VlanSet, ranges: VlanRange[]): VlanSet {
  let current = set.ranges.map((r) => ({ ...r }));
  for (const rem of ranges) {
    const next: VlanRange[] = [];
    for (const r of current) {
      if (rem.to < r.from || rem.from > r.to) {
        next.push(r);
        continue;
      }
      if (rem.from > r.from) next.push({ from: r.from, to: rem.from - 1 });
      if (rem.to < r.to) next.push({ from: rem.to + 1, to: r.to });
    }
    current = next;
  }
  return make(current);
}

/** All VLANs except the given ones ("switchport trunk allowed vlan except ..."). */
export function vlanSetExcept(ranges: VlanRange[]): VlanSet {
  return vlanSetRemove(vlanSetAll(), ranges);
}

export function vlanSetHas(set: VlanSet | undefined, vlan: number): boolean {
  if (!set) return false;
  return set.ranges.some((r) => vlan >= r.from && vlan <= r.to);
}

export function vlanSetCount(set: VlanSet): number {
  return set.ranges.reduce((n, r) => n + (r.to - r.from + 1), 0);
}

/** "1-10,20" — the usual compact notation. */
export function formatVlanSet(set: VlanSet): string {
  return set.ranges.map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`)).join(',');
}

/** The single VLAN IDs of a set, up to a limit (for drawing trunk stripes). */
export function vlanSetIds(set: VlanSet, limit = MAX_VLAN): number[] {
  const out: number[] = [];
  for (const r of set.ranges) {
    for (let v = r.from; v <= r.to && out.length < limit; v++) out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

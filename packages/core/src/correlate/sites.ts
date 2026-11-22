// Sites of the devices (#15): from the SNMP location ("Sede - CED piano terra" → "Sede"), then
// from the code in the hostname ("FGT-BR1", "SW-BR1-ACC" → "BR1"), then from the cables: two
// devices joined by a cable are in the same site. The user corrects them later (part 3).

import type { Site, SiteSource } from './types';

export interface SiteInput {
  /** A device or an external node that can sit in a site (a neighbour not loaded). */
  key: string;
  hostname: string;
  location?: string;
}

/** Words of a hostname that tell the kind of device, not the site. */
const TYPE_WORD =
  /^(fgt|fg|fw|fwl|firewall|sw|swi|switch|rtr|rt|router|r|ap|fap|fsw|asa|core|acc|access|dist|stack|cs|as|ds|wlc|lb)\d*$/i;

/** "Sede - CED piano terra" → "Sede"; "Milano, Via Roma 1" → "Milano". */
export function siteFromLocation(location: string | undefined): string | undefined {
  const first = location?.split(/\s[-–—]\s|[,;|]/)[0]?.trim();
  return first || undefined;
}

/**
 * The first word of a hostname that is not a kind of device: "SW-BR1-ACC" → "BR1". A number
 * or a single letter tells a device apart, not a site: "CORE-1" and "R-A" have no code.
 */
export function siteCode(hostname: string): string | undefined {
  for (const word of hostname.split(/[-_.\s]+/)) {
    if (!word || TYPE_WORD.test(word)) continue;
    if (/^\d+$/.test(word) || word.length === 1) return undefined;
    return word.toUpperCase();
  }
  return undefined;
}

export function slug(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'site';
}

export const NO_SITE = '';

export interface SiteAssignment {
  sites: Site[];
  siteOf: Map<string, string>;
}

export function assignSites(
  nodes: readonly SiteInput[],
  cables: readonly [string, string][],
): SiteAssignment {
  const name = new Map<string, { site: string; source: SiteSource }>();
  // 1. SNMP location.
  for (const n of nodes) {
    const site = siteFromLocation(n.location);
    if (site) name.set(n.key, { site, source: 'snmp' });
  }
  // 2. The code in the hostname, named after the location of the devices that share it.
  const codes = new Map<string, string>();
  for (const n of nodes) {
    const code = siteCode(n.hostname);
    if (code) codes.set(n.key, code);
  }
  const votes = new Map<string, Map<string, number>>();
  for (const n of nodes) {
    const code = codes.get(n.key);
    const site = name.get(n.key)?.site;
    if (!code || !site) continue;
    const count = votes.get(code) ?? new Map<string, number>();
    count.set(site, (count.get(site) ?? 0) + 1);
    votes.set(code, count);
  }
  const siteOfCode = new Map<string, string>();
  for (const [code, count] of votes) {
    const best = [...count].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
    if (best) siteOfCode.set(code, best[0]);
  }
  for (const n of nodes) {
    if (name.has(n.key)) continue;
    const site = siteOfCode.get(codes.get(n.key) ?? '');
    if (site) name.set(n.key, { site, source: 'hostname' });
  }
  // 3. Cables: the site goes along the cables to the devices that still have none.
  const neighbors = new Map<string, string[]>();
  for (const [a, b] of cables) {
    neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
    neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
  }
  const queue = nodes.filter((n) => name.has(n.key)).map((n) => n.key);
  while (queue.length > 0) {
    const key = queue.shift()!;
    const site = name.get(key)!.site;
    for (const next of neighbors.get(key) ?? []) {
      if (name.has(next)) continue;
      name.set(next, { site, source: 'cables' });
      queue.push(next);
    }
  }
  // 4. The code alone names a site; the others stay without a site.
  for (const n of nodes) {
    if (name.has(n.key)) continue;
    const code = codes.get(n.key);
    if (code) name.set(n.key, { site: code, source: 'hostname' });
  }

  const sites = new Map<string, Site>();
  const siteOf = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const n of nodes) {
    const found = name.get(n.key);
    const label = found?.site ?? NO_SITE;
    let id = ids.get(label.toLowerCase());
    if (!id) {
      const base = label ? slug(label) : 'no-site';
      id = base;
      for (let i = 2; [...ids.values()].includes(id); i++) id = `${base}-${i}`;
      ids.set(label.toLowerCase(), id);
      sites.set(id, { id, name: label, source: found?.source ?? 'none', devices: [] });
    }
    sites.get(id)!.devices.push(n.key);
    siteOf.set(n.key, id);
    // A site found by its location wins over the weaker sources of the same name.
    const site = sites.get(id)!;
    if (found && rank(found.source) < rank(site.source)) site.source = found.source;
  }
  return { sites: [...sites.values()], siteOf };
}

const rank = (source: SiteSource) => ['snmp', 'hostname', 'cables', 'none'].indexOf(source);

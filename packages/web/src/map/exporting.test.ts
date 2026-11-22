import type { Infrastructure, Link } from '@ncv/core';
import { describe, expect, it } from 'vitest';
import { drawioXml, drawnBounds } from './exporting';
import { computeLayout, DEFAULT_LAYERS, visibleExternals, visibleLinks } from './layout';

// The map as a draw.io file (#15, part 3), on a small synthetic client.

const link = (id: string, kind: Link['kind'], a: string, b: string): Link => ({
  id,
  kind,
  a: { node: a },
  b: { node: b },
  sources: [],
  verified: false,
});

const infra: Infrastructure = {
  devices: [
    {
      key: 'fgt-a',
      hostname: 'FGT-A',
      file: 'a',
      type: 'firewall',
      vendor: 'fortinet',
      os: 'fortios',
      model: 'FortiGate-60F',
      site: 'r-d',
      ha: false,
      contexts: [],
    },
    {
      key: 'sw-a',
      hostname: 'SW-A',
      file: 'b',
      type: 'switch',
      vendor: 'cisco',
      os: 'ios-xe',
      site: 'r-d',
      ha: false,
      contexts: [],
    },
  ],
  sites: [{ id: 'r-d', name: 'R&D <lab>', source: 'manual', devices: ['fgt-a', 'sw-a'] }],
  externals: [
    { id: 'internet', kind: 'internet', label: 'Internet' },
    { id: 'manual:nas', kind: 'manual', label: 'NAS "backup"', site: 'r-d' },
  ],
  links: [
    link('cable:a|b', 'cable', 'fgt-a', 'sw-a'),
    link('internet:a', 'internet', 'fgt-a', 'internet'),
    link('manual:nas', 'cable', 'sw-a', 'manual:nas'),
    link('subnet:a|b', 'subnet', 'fgt-a', 'sw-a'),
  ],
  problems: [],
  advpn: { hubs: [], spokes: [], pairs: [] },
  discarded: [],
};

describe('draw.io', () => {
  const layers = new Set(DEFAULT_LAYERS);
  const layout = computeLayout(infra, layers);
  const links = visibleLinks(infra.links, layers);
  const text = drawioXml({
    infra,
    layout,
    links,
    externals: visibleExternals(infra, links),
    labels: new Map([['internet:a', 'wan1']]),
    title: 'Cliente & figli',
    deviceDetail: (d) => d.model ?? '',
    externalDetail: (e) => e.kind,
    noSite: 'Senza sito',
  });
  const cells = [...text.matchAll(/<mxCell id="([^"]+)"([^>]*)>/g)].map((m) => ({
    id: m[1]!,
    attrs: m[2]!,
  }));
  const attr = (cell: { attrs: string }, name: string) =>
    new RegExp(`${name}="([^"]*)"`).exec(cell.attrs)?.[1];

  it('has the sites as containers, with their devices and nodes in them', () => {
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<mxfile')).toBe(true);
    expect(text).toContain('<diagram id="map" name="Cliente &amp; figli">');
    const site = cells.find((c) => attr(c, 'value')?.includes('R&amp;amp;D'))!;
    expect(attr(site, 'style')).toContain('container=1');
    const inSite = cells.filter((c) => attr(c, 'parent') === site.id);
    expect(inSite.map((c) => attr(c, 'value'))).toEqual([
      expect.stringContaining('FGT-A'),
      expect.stringContaining('SW-A'),
      expect.stringContaining('NAS &quot;backup&quot;'),
    ]);
    // Internet is outside the sites.
    const internet = cells.find((c) => attr(c, 'value')?.includes('Internet'))!;
    expect(attr(internet, 'parent')).toBe('1');
  });

  it('draws the links of the layers shown, with their labels, between the nodes', () => {
    const edges = cells.filter((c) => c.attrs.includes('edge="1"'));
    // The shared subnet is on a layer that is off.
    expect(edges).toHaveLength(3);
    const ids = new Set(cells.map((c) => c.id));
    for (const e of edges) {
      expect(ids.has(attr(e, 'source')!)).toBe(true);
      expect(ids.has(attr(e, 'target')!)).toBe(true);
    }
    expect(edges.map((e) => attr(e, 'value'))).toContain('wan1');
  });

  it('knows how large the drawing is', () => {
    const bounds = drawnBounds(layout);
    for (const box of [...layout.sites.values(), ...layout.nodes.values()]) {
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }
  });
});

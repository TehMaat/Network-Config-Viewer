// Where every node of the map goes (#15): inside each site the devices from the top down
// (firewall, core, access), laid out by dagre along their cables; the sites around the
// Internet node. The layout does not depend on the layers shown, so turning a layer on or off
// moves nothing: only the segments of the shared subnets take room when their layer is on.

import dagre from '@dagrejs/dagre';
import type { ExternalNode, Infrastructure, Link, LinkKind, MapEdits } from '@ncv/core';

export type Layer = 'cables' | 'vpn' | 'shortcuts' | 'routing' | 'subnets';

export const LAYERS: readonly Layer[] = ['cables', 'vpn', 'shortcuts', 'routing', 'subnets'];
export const DEFAULT_LAYERS: readonly Layer[] = ['cables', 'vpn', 'shortcuts', 'routing'];

export const LAYER_OF: Record<LinkKind, Layer> = {
  cable: 'cables',
  lag: 'cables',
  wan: 'cables',
  internet: 'cables',
  subnet: 'subnets',
  ipsec: 'vpn',
  shortcut: 'shortcuts',
  bgp: 'routing',
  ospf: 'routing',
};

export const DEVICE_SIZE = { width: 196, height: 60 };
export const EXTERNAL_SIZE = { width: 156, height: 44 };
const PADDING = 28;
const HEADER = 34;
const SEGMENT_GAP = 26;
/** Free space between the sites, and between the sites and the nodes in the middle. */
const GAP = 48;
/** The ring is wider than tall, like the screens it is shown on. */
const STRETCH = 1.1;

function touch(a: Box, b: Box, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

/** React Flow ids: devices and external nodes can never clash. */
export const deviceNodeId = (key: string) => `device:${key}`;
export const externalNodeId = (id: string) => `ext:${id}`;
export const siteNodeId = (id: string) => `site:${id}`;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapLayout {
  /** Boxes of the sites, absolute. */
  sites: Map<string, Box>;
  /** Boxes of the devices and of the external nodes, absolute. */
  nodes: Map<string, Box>;
  /**
   * Where every site starts in the automatic layout: the positions moved by hand are kept from
   * there, so that they follow their site when the rest of the map changes.
   */
  origins: Map<string, { x: number; y: number }>;
  /** The site of every node drawn in a site. */
  siteOfNode: Map<string, string>;
}

/** The positions moved by hand, by node id of the map. */
export function savedPositions(
  infra: Infrastructure,
  positions: MapEdits['positions'],
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const byHost = new Map(infra.devices.map((d) => [d.hostname.toLowerCase(), d.key]));
  for (const [host, p] of Object.entries(positions?.devices ?? {})) {
    const key = byHost.get(host.toLowerCase());
    if (key) out.set(deviceNodeId(key), p);
  }
  for (const [id, p] of Object.entries(positions?.externals ?? {})) {
    if (infra.externals.some((e) => e.id === id)) out.set(externalNodeId(id), p);
  }
  return out;
}

/** The node id of a side of a link. */
export function endNodeId(infra: Infrastructure, node: string): string {
  return infra.devices.some((d) => d.key === node) ? deviceNodeId(node) : externalNodeId(node);
}

/** Links of the layers shown. */
export function visibleLinks(links: readonly Link[], layers: ReadonlySet<Layer>): Link[] {
  return links.filter((l) => layers.has(LAYER_OF[l.kind]));
}

/**
 * External nodes with at least one link shown: the others are not drawn. A node added by hand
 * is always drawn, also before it has a link.
 */
export function visibleExternals(infra: Infrastructure, links: readonly Link[]): ExternalNode[] {
  const used = new Set(links.flatMap((l) => [l.a.node, l.b.node]));
  return infra.externals.filter((e) => used.has(e.id) || e.kind === 'manual');
}

const CABLE: ReadonlySet<LinkKind> = new Set(['cable', 'lag']);

export function computeLayout(
  infra: Infrastructure,
  layers: ReadonlySet<Layer>,
  moved: ReadonlyMap<string, { x: number; y: number }> = new Map(),
): MapLayout {
  const nodes = new Map<string, Box>();
  const sites = new Map<string, Box>();
  const siteOfNode = new Map<string, string>();
  const siteNodes = new Map<string, { id: string; width: number; height: number }[]>();
  const segments = new Map<string, ExternalNode[]>();
  const free: ExternalNode[] = [];
  for (const site of infra.sites) siteNodes.set(site.id, []);
  for (const d of infra.devices) {
    siteNodes.get(d.site)?.push({ id: deviceNodeId(d.key), ...DEVICE_SIZE });
  }
  for (const e of infra.externals) {
    if (e.kind === 'segment' && e.site && siteNodes.has(e.site)) {
      segments.set(e.site, [...(segments.get(e.site) ?? []), e]);
    } else if ((e.kind === 'neighbor' || e.kind === 'manual') && e.site && siteNodes.has(e.site)) {
      // Neighbours that were not loaded, and nodes added by hand in a site, are drawn in it.
      siteNodes.get(e.site)!.push({ id: externalNodeId(e.id), ...EXTERNAL_SIZE });
    } else {
      free.push(e);
    }
  }

  // Depth of every node from the firewalls along the cables: firewalls first, then the core.
  const cables = infra.links.filter((l) => CABLE.has(l.kind));
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const d of infra.devices) {
    if (d.type === 'firewall') {
      depth.set(deviceNodeId(d.key), 0);
      queue.push(deviceNodeId(d.key));
    }
  }
  const neighbours = new Map<string, string[]>();
  for (const l of cables) {
    const a = endNodeId(infra, l.a.node);
    const b = endNodeId(infra, l.b.node);
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const next of neighbours.get(n) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(n)! + 1);
      queue.push(next);
    }
  }
  const depthOf = (id: string) => depth.get(id) ?? (id.startsWith('ext:') ? 0 : 1);

  // Inside each site: dagre from the top down along the cables.
  const local = new Map<string, Map<string, Box>>();
  const sizes = new Map<string, { width: number; height: number }>();
  for (const [siteId, members] of siteNodes) {
    if (members.length === 0) continue;
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 64, marginx: 0, marginy: 0 });
    g.setDefaultEdgeLabel(() => ({}));
    const inside = new Set(members.map((m) => m.id));
    for (const m of [...members].sort((x, y) => x.id.localeCompare(y.id))) {
      g.setNode(m.id, { width: m.width, height: m.height });
    }
    for (const l of cables) {
      const a = endNodeId(infra, l.a.node);
      const b = endNodeId(infra, l.b.node);
      if (!inside.has(a) || !inside.has(b) || a === b) continue;
      const [from, to] = depthOf(a) <= depthOf(b) ? [a, b] : [b, a];
      g.setEdge(from, to);
    }
    dagre.layout(g);
    const boxes = new Map<string, Box>();
    let width = 0;
    let height = 0;
    for (const m of members) {
      const n = g.node(m.id);
      const box = {
        x: (n.x ?? 0) - m.width / 2,
        y: (n.y ?? 0) - m.height / 2,
        width: m.width,
        height: m.height,
      };
      boxes.set(m.id, box);
      width = Math.max(width, box.x + box.width);
      height = Math.max(height, box.y + box.height);
    }
    // The segments of the shared subnets, in a row under the devices, when their layer is on.
    const rows = layers.has('subnets') ? (segments.get(siteId) ?? []) : [];
    if (rows.length > 0) {
      let x = 0;
      const y = height + SEGMENT_GAP;
      for (const s of rows) {
        boxes.set(externalNodeId(s.id), { x, y, ...EXTERNAL_SIZE });
        x += EXTERNAL_SIZE.width + 24;
      }
      width = Math.max(width, x - 24);
      height = y + EXTERNAL_SIZE.height;
    }
    local.set(siteId, boxes);
    sizes.set(siteId, { width: width + PADDING * 2, height: height + PADDING * 2 + HEADER });
  }

  // The Internet in the middle; providers, peers and the rest close around it.
  const internet = free.find((e) => e.kind === 'internet');
  if (internet) {
    nodes.set(externalNodeId(internet.id), {
      x: -EXTERNAL_SIZE.width / 2,
      y: -EXTERNAL_SIZE.height / 2,
      ...EXTERNAL_SIZE,
    });
  }
  const others = free.filter((e) => e.kind !== 'internet').sort((a, b) => a.id.localeCompare(b.id));
  const ring = others.length <= 2 ? 90 : 90 + others.length * 12;
  others.forEach((e, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / others.length;
    nodes.set(externalNodeId(e.id), {
      x: ring * Math.cos(angle) * 1.4 - EXTERNAL_SIZE.width / 2,
      y: ring * Math.sin(angle) - EXTERNAL_SIZE.height / 2,
      ...EXTERNAL_SIZE,
    });
  });
  const middle = [...nodes.values()];

  // The sites on a ring around them, the largest first, from the left: the ring is as tight
  // as it can be without boxes touching each other or the nodes in the middle.
  const order = [...sizes.keys()].sort(
    (a, b) =>
      (siteNodes.get(b)?.length ?? 0) - (siteNodes.get(a)?.length ?? 0) || a.localeCompare(b),
  );
  const place = (radius: number) =>
    order.map((id, i) => {
      const size = sizes.get(id)!;
      const angle = Math.PI + (i * 2 * Math.PI) / order.length;
      const cx = radius * Math.cos(angle) * STRETCH;
      const cy = radius * Math.sin(angle);
      return { x: cx - size.width / 2, y: cy - size.height / 2, ...size };
    });
  let boxes = place(0);
  for (let radius = 0; radius < 20_000; radius += 10) {
    boxes = place(radius);
    const clear =
      boxes.every((b, i) => boxes.every((c, j) => j <= i || !touch(b, c, GAP))) &&
      boxes.every((b) => middle.every((m) => !touch(b, m, GAP)));
    if (clear) break;
  }
  const origins = new Map<string, { x: number; y: number }>();
  order.forEach((id, i) => {
    const box = boxes[i]!;
    sites.set(id, box);
    origins.set(id, { x: box.x, y: box.y });
    for (const [nodeId, b] of local.get(id)!) {
      siteOfNode.set(nodeId, id);
      nodes.set(nodeId, {
        ...b,
        x: box.x + PADDING + b.x,
        y: box.y + PADDING + HEADER + b.y,
      });
    }
  });

  // The nodes moved by hand: from the corner of their site, or from the middle of the map.
  if (moved.size > 0) {
    for (const [nodeId, p] of moved) {
      const box = nodes.get(nodeId);
      if (!box) continue;
      const origin = origins.get(siteOfNode.get(nodeId) ?? '') ?? { x: 0, y: 0 };
      nodes.set(nodeId, { ...box, x: origin.x + p.x, y: origin.y + p.y });
    }
    // Every site around its nodes again: it grows with a node moved out of it.
    for (const id of sites.keys()) {
      const members = [...siteOfNode].filter(([, s]) => s === id).map(([n]) => nodes.get(n)!);
      if (members.length === 0) continue;
      const minX = Math.min(...members.map((b) => b.x));
      const minY = Math.min(...members.map((b) => b.y));
      const maxX = Math.max(...members.map((b) => b.x + b.width));
      const maxY = Math.max(...members.map((b) => b.y + b.height));
      sites.set(id, {
        x: minX - PADDING,
        y: minY - PADDING - HEADER,
        width: maxX - minX + PADDING * 2,
        height: maxY - minY + PADDING * 2 + HEADER,
      });
    }
  }
  return { sites, nodes, origins, siteOfNode };
}

/**
 * Bend of every link drawn between the same two nodes, so that they do not overlap:
 * 0 for a single link, then -1, +1, -2, +2...
 */
export function parallelOffsets(
  infra: Infrastructure,
  links: readonly Link[],
): Map<string, number> {
  const groups = new Map<string, Link[]>();
  for (const l of links) {
    const ends = [endNodeId(infra, l.a.node), endNodeId(infra, l.b.node)].sort().join('|');
    groups.set(ends, [...(groups.get(ends) ?? []), l]);
  }
  const out = new Map<string, number>();
  for (const list of groups.values()) {
    const n = list.length;
    list.forEach((l, i) => {
      const offset = n === 1 ? 0 : i - (n - 1) / 2;
      // The bend is drawn from the source to the target: the same side for both directions.
      const forward = endNodeId(infra, l.a.node) <= endNodeId(infra, l.b.node);
      out.set(l.id, forward ? offset : -offset);
    });
  }
  return out;
}

// The map as a file (#15, part 3): a draw.io file, to open in draw.io and retouch, written here
// without libraries; PNG and SVG pictures of the map as it is drawn, made with html-to-image,
// loaded only when they are asked for. Everything is made in the browser: nothing leaves the
// computer.

import type { ExternalNode, InfraDevice, Infrastructure, Link, LinkKind } from '@ncv/core';
import { deviceNodeId, externalNodeId, type MapLayout } from './layout';

/** How every kind of link is drawn in draw.io: the colours of the map in the light theme. */
const EDGE: Record<LinkKind, { color: string; width: number; dash?: string }> = {
  cable: { color: '#6b7280', width: 2 },
  lag: { color: '#6b7280', width: 4 },
  wan: { color: '#64748b', width: 2.5, dash: '12 4' },
  internet: { color: '#94a3b8', width: 1.5 },
  subnet: { color: '#9ca3af', width: 1.5, dash: '2 3' },
  ipsec: { color: '#0d9488', width: 2, dash: '7 4' },
  shortcut: { color: '#db2777', width: 2, dash: '9 3 2 3' },
  bgp: { color: '#7c3aed', width: 2, dash: '1 4' },
  ospf: { color: '#2563eb', width: 2, dash: '1 4' },
};
const DOWN = '#dc2626';

/** Text for an attribute of XML. */
const xml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;');

/** Text inside the HTML label of a cell. */
const html = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const round = (n: number) => Math.round(n * 10) / 10;

export interface DrawioInput {
  infra: Infrastructure;
  layout: MapLayout;
  /** The links of the layers shown. */
  links: readonly Link[];
  /** The external nodes with a link shown. */
  externals: readonly ExternalNode[];
  /** Labels of the links, as on the map. */
  labels: ReadonlyMap<string, string>;
  /** The name of the map in draw.io. */
  title: string;
  /** Second line of a device and of a node: model, HA, VDOMs; the kind of node. */
  deviceDetail(device: InfraDevice): string;
  externalDetail(external: ExternalNode): string;
  noSite: string;
}

/**
 * The map as a draw.io file: the sites as containers, the devices and the nodes in them where
 * the map has them, the links of the layers shown with their labels.
 */
export function drawioXml(input: DrawioInput): string {
  const { infra, layout } = input;
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const ids = new Map<string, string>();
  let n = 0;
  const next = (prefix: string) => `${prefix}${++n}`;

  const siteOf = new Map<string, string>();
  for (const site of infra.sites) {
    const box = layout.sites.get(site.id);
    if (!box) continue;
    const id = next('site-');
    siteOf.set(site.id, id);
    const style =
      'rounded=1;arcSize=4;whiteSpace=wrap;html=1;dashed=1;fillColor=#F5F7FF;strokeColor=#9AA5C8;' +
      'verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;fontStyle=1;fontColor=#495057;' +
      'container=1;collapsible=0;';
    cells.push(
      `<mxCell id="${id}" value="${xml(html(site.name || input.noSite))}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}" as="geometry"/></mxCell>`,
    );
  }

  /** A node in its site, with its position from the corner of the site, as draw.io wants it. */
  const vertex = (nodeId: string, site: string | undefined, value: string, style: string) => {
    const box = layout.nodes.get(nodeId);
    if (!box) return;
    const parentBox = site ? layout.sites.get(site) : undefined;
    const parent = parentBox && site ? siteOf.get(site) : undefined;
    const x = parentBox && parent ? box.x - parentBox.x : box.x;
    const y = parentBox && parent ? box.y - parentBox.y : box.y;
    const id = next('node-');
    ids.set(nodeId, id);
    cells.push(
      `<mxCell id="${id}" value="${xml(value)}" style="${style}" vertex="1" parent="${parent ?? '1'}">` +
        `<mxGeometry x="${round(x)}" y="${round(y)}" width="${box.width}" height="${box.height}" as="geometry"/></mxCell>`,
    );
  };

  for (const d of infra.devices) {
    const stroke = d.type === 'firewall' ? '#E03131' : '#4C6EF5';
    const detail = input.deviceDetail(d);
    vertex(
      deviceNodeId(d.key),
      d.site,
      `<b>${html(d.hostname)}</b>${detail ? `<br><font style="font-size:10px" color="#868E96">${html(detail)}</font>` : ''}`,
      `rounded=1;arcSize=12;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=${stroke};strokeWidth=1.5;fontSize=12;`,
    );
  }
  for (const e of input.externals) {
    const missing = e.kind === 'missing';
    const style =
      `rounded=1;arcSize=50;whiteSpace=wrap;html=1;fontSize=11;fillColor=${e.kind === 'internet' ? '#F1F3F5' : '#FFFFFF'};` +
      `strokeColor=${missing ? '#E8590C' : e.kind === 'manual' ? '#AE3EC9' : '#ADB5BD'};` +
      (missing || e.kind === 'neighbor' || e.kind === 'peer' ? 'dashed=1;' : '');
    const detail = input.externalDetail(e);
    const site = e.site && layout.sites.has(e.site) ? e.site : undefined;
    vertex(
      externalNodeId(e.id),
      site,
      `<b>${html(e.label)}</b>${detail ? `<br><font style="font-size:10px" color="#868E96">${html(detail)}</font>` : ''}`,
      style,
    );
  }

  for (const link of input.links) {
    const source = ids.get(deviceOrExternal(infra, link.a.node));
    const target = ids.get(deviceOrExternal(infra, link.b.node));
    if (!source || !target) continue;
    const look = EDGE[link.kind];
    const down = [link.state?.a?.status, link.state?.b?.status].includes('down');
    const style =
      `endArrow=none;startArrow=none;html=1;rounded=0;strokeColor=${down ? DOWN : look.color};` +
      `strokeWidth=${look.width};fontSize=10;labelBackgroundColor=#FFFFFF;` +
      (look.dash ? `dashed=1;dashPattern=${look.dash};` : '');
    const label = input.labels.get(link.id) ?? '';
    cells.push(
      `<mxCell id="${next('link-')}" value="${xml(html(label))}" style="${style}" edge="1" parent="1" source="${source}" target="${target}">` +
        '<mxGeometry relative="1" as="geometry"/></mxCell>',
    );
  }

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<mxfile host="Network Config Viewer" type="device">\n' +
    `  <diagram id="map" name="${xml(input.title)}">\n` +
    '    <mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" math="0" shadow="0">\n' +
    `      <root>\n${cells.map((c) => `        ${c}`).join('\n')}\n      </root>\n` +
    '    </mxGraphModel>\n' +
    '  </diagram>\n' +
    '</mxfile>\n'
  );
}

function deviceOrExternal(infra: Infrastructure, node: string): string {
  return infra.devices.some((d) => d.key === node) ? deviceNodeId(node) : externalNodeId(node);
}

/** The bounds of the nodes drawn, with a margin. */
export function drawnBounds(layout: MapLayout, margin = 40) {
  const boxes = [...layout.sites.values(), ...layout.nodes.values()];
  if (boxes.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...boxes.map((b) => b.x)) - margin;
  const minY = Math.min(...boxes.map((b) => b.y)) - margin;
  const maxX = Math.max(...boxes.map((b) => b.x + b.width)) + margin;
  const maxY = Math.max(...boxes.map((b) => b.y + b.height)) + margin;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A picture of the whole map, as it is drawn: the viewport of React Flow, moved so that every
 * node is in it. html-to-image is loaded only now.
 */
export async function mapPicture(
  viewport: HTMLElement,
  layout: MapLayout,
  format: 'png' | 'svg',
  background: string,
): Promise<Blob> {
  const { toBlob, toSvg } = await import('html-to-image');
  const bounds = drawnBounds(layout);
  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  const options = {
    backgroundColor: background,
    width,
    height,
    // The fonts of the app are the ones of the system: nothing to fetch.
    skipFonts: true,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)`,
    },
  };
  if (format === 'png') {
    const blob = await toBlob(viewport, { ...options, pixelRatio: 2 });
    if (!blob) throw new Error('picture');
    return blob;
  }
  // A data URL, read here: the policy of the page does not let fetch() read it.
  const url = await toSvg(viewport, options);
  const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
  return new Blob([svg], { type: 'image/svg+xml' });
}

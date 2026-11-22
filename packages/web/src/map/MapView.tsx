// The map of the infrastructure of a client (#15, chapter 5.1 of the study): sites, devices
// and the links between them, in layers, with the two sides of every link a click away.
// Loaded only when the map is opened, with React Flow and dagre.

import '@xyflow/react/dist/style.css';
import {
  Badge,
  Box,
  Button,
  Chip,
  Group,
  Menu,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
  useComputedColorScheme,
} from '@mantine/core';
import { IconBox, IconDownload, IconLayoutGrid, IconMapPin, IconPlus } from '@tabler/icons-react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import type {
  Infrastructure,
  Link,
  ManualExternal,
  ManualLink,
  MapEdits,
  Problem,
  Severity,
} from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MapSaveState } from '../archive/useMapEdits';
import { safeFileName, saveBlob } from '../export/download';
import type { MapFocus } from '../state/infra';
import { withoutPositions, withPosition } from '../state/mapEdits';
import { DataTable } from '../views/DataTable';
import {
  problemsSummary,
  problemText,
  SEVERITIES,
  SEVERITY_COLOR,
  SeverityBadge,
} from '../views/problems';
import { DeviceViewContext, type DeviceViewApi } from '../views/source';
import { endLabel, kindLabel, linkTitle, side, type ModelOf } from './details';
import {
  DiscardedLinks,
  ExternalForm,
  LinkForm,
  SitesForm,
  type EditMap,
  type MapEditing,
} from './editing';
import { drawioXml, mapPicture } from './exporting';
import {
  EDGE_TYPES,
  linkStyle,
  NODE_TYPES,
  type MapEdge,
  type MapNode,
  type ProblemMark,
} from './elements';
import {
  computeLayout,
  DEFAULT_LAYERS,
  deviceNodeId,
  endNodeId,
  externalNodeId,
  LAYER_OF,
  LAYERS,
  parallelOffsets,
  savedPositions,
  siteNodeId,
  visibleExternals,
  visibleLinks,
  type Layer,
  type MapLayout,
} from './layout';
import { LinkPanel, NodePanel } from './panels';

export interface MapViewProps {
  infra: Infrastructure;
  modelOf: ModelOf;
  onOpenFile(id: string, line?: number): void;
  /** Base of the names of the exported files. */
  exportName: string;
  /** What to show when the map opens: a link or a device, from a problem elsewhere. */
  focus?: MapFocus | null;
  /** The changes made by hand (#15, part 3); without them the map can only be looked at. */
  edits?: MapEdits;
  onEdit?: EditMap;
  saveState?: MapSaveState;
}

/** Where the changes made by hand are: in the client, being written, or only in this tab. */
function SaveState({ state }: { state: MapSaveState }) {
  const { t } = useTranslation();
  const color = { tab: 'orange', loading: 'dimmed', saving: 'dimmed', saved: 'teal', error: 'red' };
  return (
    <Text size="xs" c={color[state]} data-testid="map-save-state" data-state={state}>
      {t(`mapEdit.save.${state}`)}
    </Text>
  );
}

type Selection = MapFocus | null;

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** The problems of every device and link: how many, and the most serious (they come first). */
function problemMarks(problems: readonly Problem[]) {
  const devices = new Map<string, ProblemMark>();
  const links = new Map<string, ProblemMark>();
  const add = (map: Map<string, ProblemMark>, key: string, p: Problem) => {
    const mark = map.get(key);
    if (mark) mark.count++;
    else map.set(key, { severity: p.severity, count: 1 });
  };
  for (const p of problems) {
    for (const d of new Set(p.devices)) add(devices, d, p);
    if (p.link) add(links, p.link, p);
  }
  return { devices, links };
}

const LAYERS_KEY = 'ncv.map.layers';

function savedLayers(): Set<Layer> {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null') as unknown;
    if (Array.isArray(saved)) return new Set(saved.filter((l): l is Layer => LAYERS.includes(l)));
  } catch {
    // No storage, or something else in it: the default layers.
  }
  return new Set(DEFAULT_LAYERS);
}

/** Short labels on the links that need one: tunnels, AS numbers, WAN interfaces, cables of a LAG. */
function edgeLabel(link: Link, t: ReturnType<typeof useTranslation>['t']): string | undefined {
  switch (link.kind) {
    case 'lag':
      return t('map.edge.lag', { count: Math.max(link.cables?.length ?? 0, 1) });
    case 'wan':
      return t('map.kind.wan');
    case 'fortilink':
      return t('map.kind.fortilink');
    case 'ipsec':
      return [link.a.tunnel, link.b.tunnel].filter(Boolean).join(' ↔ ') || undefined;
    case 'bgp':
      return link.ibgp ? `iBGP ${link.a.asn ?? ''}`.trim() : `eBGP ${link.b.asn ?? ''}`.trim();
    case 'internet':
      return link.a.interface;
    case 'shortcut':
      return 'ADVPN';
    default:
      return undefined;
  }
}

function Canvas({
  infra,
  layers,
  selection,
  onSelect,
  positions,
  onMove,
  onLayout,
}: {
  infra: Infrastructure;
  layers: ReadonlySet<Layer>;
  selection: Selection;
  onSelect(selection: Selection): void;
  /** The positions moved by hand (#15, part 3). */
  positions: MapEdits['positions'];
  /** A node moved by hand: its position from the corner of its site, or from the middle. */
  onMove?(node: { kind: 'devices' | 'externals'; key: string }, at: { x: number; y: number }): void;
  /** The layout drawn, for the exports. */
  onLayout?(layout: MapLayout): void;
}) {
  const marks = useMemo(() => problemMarks(infra.problems), [infra.problems]);
  const { t } = useTranslation();
  const scheme = useComputedColorScheme('light');
  const { fitView } = useReactFlow();
  const shown = useMemo(() => visibleLinks(infra.links, layers), [infra.links, layers]);
  const moved = useMemo(() => savedPositions(infra, positions), [infra, positions]);
  const layout = useMemo(() => computeLayout(infra, layers, moved), [infra, layers, moved]);
  useEffect(() => onLayout?.(layout), [layout, onLayout]);

  const built = useMemo(() => {
    const externals = visibleExternals(infra, shown);
    const nodes: MapNode[] = [];
    const activeNode = selection?.kind === 'node' ? selection.id : null;
    const activeLink =
      selection?.kind === 'link' ? infra.links.find((l) => l.id === selection.id) : undefined;
    const related = new Set(activeLink ? [activeLink.a.node, activeLink.b.node] : []);
    for (const site of infra.sites) {
      const box = layout.sites.get(site.id);
      if (!box) continue;
      nodes.push({
        id: siteNodeId(site.id),
        type: 'site',
        position: { x: box.x, y: box.y },
        data: { label: site.name || t('map.noSite') },
        style: { width: box.width, height: box.height },
        selectable: false,
        draggable: false,
        focusable: false,
        zIndex: -1,
      });
    }
    const placed = (id: string, site?: string) => {
      const box = layout.nodes.get(id);
      if (!box) return null;
      const parent = site ? layout.sites.get(site) : undefined;
      // Not kept inside the box of the site: moved out of it, the site grows to take it in.
      return {
        position: parent ? { x: box.x - parent.x, y: box.y - parent.y } : { x: box.x, y: box.y },
        ...(parent ? { parentId: siteNodeId(site!) } : {}),
      };
    };
    for (const d of infra.devices) {
      const at = placed(deviceNodeId(d.key), d.site);
      if (!at) continue;
      nodes.push({
        id: deviceNodeId(d.key),
        type: 'device',
        ...at,
        data: {
          device: d,
          active: activeNode === d.key || related.has(d.key),
          ...(marks.devices.has(d.key) ? { problems: marks.devices.get(d.key)! } : {}),
        },
        ariaLabel: d.hostname,
      });
    }
    for (const e of externals) {
      const inSite = e.site && layout.sites.has(e.site) ? e.site : undefined;
      const at = placed(externalNodeId(e.id), inSite);
      if (!at) continue;
      nodes.push({
        id: externalNodeId(e.id),
        type: 'external',
        ...at,
        data: { external: e, active: activeNode === e.id || related.has(e.id) },
        ariaLabel: e.label,
      });
    }
    const offsets = parallelOffsets(infra, shown);
    const edges: MapEdge[] = shown.map((link) => {
      const label = edgeLabel(link, t);
      return {
        id: link.id,
        type: 'link',
        source: endNodeId(infra, link.a.node),
        target: endNodeId(infra, link.b.node),
        data: {
          link,
          offset: offsets.get(link.id) ?? 0,
          ...(label ? { label } : {}),
          active: activeLink?.id === link.id,
          dim: !!activeLink && activeLink.id !== link.id,
          ...(marks.links.has(link.id) ? { problems: marks.links.get(link.id)! } : {}),
        },
        ariaLabel: `${kindLabel(link.kind, t)}: ${side(infra, link.a, () => null).name} ↔ ${side(infra, link.b, () => null).name}`,
      };
    });
    return { nodes, edges };
  }, [infra, layout, shown, selection, t, marks]);

  const [nodes, setNodes, onNodesChange] = useNodesState<MapNode>(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<MapEdge>(built.edges);
  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);
  // A new drawing (other layers, other nodes) is shown whole; a node moved by hand moves nothing
  // else.
  const drawing = `${[...layers].join()}|${[...layout.nodes.keys()].sort().join()}`;
  useEffect(() => {
    const frame = requestAnimationFrame(() => void fitView({ padding: 0.12, duration: 0 }));
    return () => cancelAnimationFrame(frame);
  }, [drawing, fitView]);

  const dropped = (node: MapNode) => {
    if (!onMove || node.type === 'site') return;
    const parent = node.parentId
      ? layout.sites.get(node.parentId.slice('site:'.length))
      : undefined;
    const abs = parent
      ? { x: parent.x + node.position.x, y: parent.y + node.position.y }
      : node.position;
    const origin = layout.origins.get(layout.siteOfNode.get(node.id) ?? '') ?? { x: 0, y: 0 };
    const at = { x: abs.x - origin.x, y: abs.y - origin.y };
    if (node.type === 'device') onMove({ kind: 'devices', key: node.data.device.hostname }, at);
    else onMove({ kind: 'externals', key: node.data.external.id }, at);
  };

  return (
    <ReactFlow<MapNode, MapEdge>
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      colorMode={scheme}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      minZoom={0.1}
      maxZoom={2.5}
      nodesDraggable={!!onMove}
      nodeDragThreshold={4}
      onNodeDragStop={(_, node) => dropped(node)}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      onEdgeClick={(_, edge) => onSelect({ kind: 'link', id: edge.id })}
      onNodeClick={(_, node) => {
        if (node.type === 'device') onSelect({ kind: 'node', id: node.id.slice('device:'.length) });
        else if (node.type === 'external')
          onSelect({ kind: 'node', id: node.id.slice('ext:'.length) });
      }}
      onPaneClick={() => onSelect(null)}
      data-testid="map-canvas"
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

function LinksTable({
  infra,
  modelOf,
  selected,
  onSelect,
}: {
  infra: Infrastructure;
  modelOf: ModelOf;
  selected: string | null;
  onSelect(id: string): void;
}) {
  const { t } = useTranslation();
  const columns = useMemo<ColumnDef<Link, unknown>[]>(() => {
    const end = (which: 'a' | 'b') => (l: Link) => {
      const s = side(infra, l[which], modelOf);
      return [s.name, endLabel(s.end)].filter(Boolean).join(' · ');
    };
    const state = (l: Link) =>
      [l.state?.a, l.state?.b].map((s) => (s ? t(`map.state.${s.status}`) : '—')).join(' / ');
    const problems = new Map<string, Problem[]>();
    for (const p of infra.problems) {
      if (p.link) problems.set(p.link, [...(problems.get(p.link) ?? []), p]);
    }
    return [
      { id: 'kind', header: t('map.col.kind'), accessorFn: (l) => kindLabel(l.kind, t) },
      { id: 'a', header: t('map.col.a'), accessorFn: end('a') },
      { id: 'b', header: t('map.col.b'), accessorFn: end('b') },
      {
        id: 'source',
        header: t('map.col.source'),
        accessorFn: (l) =>
          l.manual
            ? t('map.manual')
            : `${l.verified ? t('map.verified') : t('map.inferred')}${l.confirmed ? `, ${t('map.confirmed')}` : ''} (${[...new Set(l.sources.map((s) => t(`map.sourceKind.${s.kind}`)))].join(', ')})`,
      },
      {
        id: 'state',
        header: t('map.col.state'),
        accessorFn: (l) => (l.state ? state(l) : ''),
      },
      {
        id: 'problems',
        header: t('map.col.problems'),
        accessorFn: (l) => problemsSummary(problems.get(l.id) ?? [], t),
        cell: (c) => {
          const list = problems.get(c.row.original.id) ?? [];
          return list.length === 0 ? null : (
            <Text span size="sm" c={SEVERITY_COLOR[list[0]!.severity]} fw={600}>
              {c.getValue<string>()}
            </Text>
          );
        },
      },
    ];
  }, [infra, modelOf, t]);
  return (
    <DataTable
      name="links"
      data={infra.links}
      columns={columns}
      getRowId={(l) => l.id}
      selectedId={selected}
      onRowClick={(l) => onSelect(l.id)}
      height={360}
    />
  );
}

function ProblemsTable({
  infra,
  modelOf,
  selected,
  onSelect,
}: {
  infra: Infrastructure;
  modelOf: ModelOf;
  selected: string | null;
  onSelect(problem: Problem): void;
}) {
  const { t } = useTranslation();
  const columns = useMemo<ColumnDef<Problem, unknown>[]>(() => {
    const host = (key: string) => infra.devices.find((d) => d.key === key)?.hostname ?? key;
    const link = (p: Problem) => {
      const l = p.link ? infra.links.find((x) => x.id === p.link) : undefined;
      return l ? `${kindLabel(l.kind, t)}: ${linkTitle(l, infra, modelOf)}` : '';
    };
    return [
      {
        id: 'severity',
        header: t('problems.col.severity'),
        accessorFn: (p) =>
          p.unverified
            ? `${t(`problems.severity.${p.severity}`)} (${t('source.toCheck')})`
            : t(`problems.severity.${p.severity}`),
        sortingFn: (a, b) => RANK[a.original.severity] - RANK[b.original.severity],
        cell: (c) => <SeverityBadge problem={c.row.original} size="xs" />,
      },
      {
        id: 'problem',
        header: t('problems.col.problem'),
        accessorFn: (p) => problemText(p, t).title,
      },
      {
        id: 'devices',
        header: t('problems.col.devices'),
        accessorFn: (p) => [...new Set(p.devices)].map(host).join(', '),
      },
      { id: 'link', header: t('problems.col.link'), accessorFn: link },
      // The explanation and the fix go in the Excel file; on screen they are in the detail.
      {
        id: 'why',
        header: t('problems.col.why'),
        accessorFn: (p) => problemText(p, t).why,
        meta: { exportOnly: true },
      },
      {
        id: 'fix',
        header: t('problems.col.fix'),
        accessorFn: (p) => problemText(p, t).fix,
        meta: { exportOnly: true },
      },
    ];
  }, [infra, modelOf, t]);
  return (
    <DataTable
      name="problems"
      data={infra.problems}
      columns={columns}
      getRowId={(p) => p.id}
      selectedId={selected}
      onRowClick={onSelect}
      height={300}
      empty={t('problems.none')}
    />
  );
}

export default function MapView({
  infra,
  modelOf,
  onOpenFile,
  exportName,
  focus = null,
  edits,
  onEdit,
  saveState,
}: MapViewProps) {
  const { t } = useTranslation();
  // The forms of the changes made by hand.
  const [linkForm, setLinkForm] = useState<ManualLink | null>(null);
  const [externalForm, setExternalForm] = useState<ManualExternal | 'new' | null>(null);
  const [sitesOpen, setSitesOpen] = useState(false);
  const editing = useMemo<MapEditing | undefined>(
    () =>
      edits && onEdit
        ? {
            edits,
            onEdit,
            openLink: (link) =>
              setLinkForm(link ?? { id: '', kind: 'cable', a: { device: '' }, b: { device: '' } }),
            openExternal: (external) => setExternalForm(external ?? 'new'),
          }
        : undefined,
    [edits, onEdit],
  );
  const onMove = useCallback(
    (n: { kind: 'devices' | 'externals'; key: string }, at: { x: number; y: number }) =>
      onEdit?.((e) => withPosition(e, n.kind, n.key, at)),
    [onEdit],
  );
  /** The layout drawn, for the exports of the map. */
  const drawn = useRef<MapLayout | null>(null);
  const onLayout = useCallback((layout: MapLayout) => {
    drawn.current = layout;
  }, []);
  const moved =
    Object.keys(edits?.positions?.devices ?? {}).length +
      Object.keys(edits?.positions?.externals ?? {}).length >
    0;

  // The map as a file: draw.io, PNG and SVG, with the layers shown (#15, part 3).
  const canvas = useRef<HTMLDivElement>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const fileBase = `${safeFileName(exportName)}-map`;
  const exportDrawio = () => {
    const layout = drawn.current;
    if (!layout) return;
    const links = visibleLinks(infra.links, layers);
    const labels = new Map<string, string>();
    for (const l of links) {
      const label = edgeLabel(l, t);
      if (label) labels.set(l.id, label);
    }
    const text = drawioXml({
      infra,
      layout,
      links,
      externals: visibleExternals(infra, links),
      labels,
      title: exportName,
      deviceDetail: (d) =>
        [
          d.model,
          d.ha ? 'HA' : '',
          d.contexts.length > 1 ? t('map.vdoms', { count: d.contexts.length }) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      externalDetail: (e) => e.detail ?? t(`map.external.${e.kind}`),
      noSite: t('map.noSite'),
    });
    saveBlob(new Blob([text], { type: 'application/xml' }), `${fileBase}.drawio`);
  };
  const exportPicture = async (format: 'png' | 'svg') => {
    const layout = drawn.current;
    const viewport = canvas.current?.querySelector<HTMLElement>('.react-flow__viewport');
    if (!layout || !viewport || !canvas.current) return;
    setExportFailed(false);
    try {
      const background = getComputedStyle(canvas.current).backgroundColor;
      saveBlob(await mapPicture(viewport, layout, format, background), `${fileBase}.${format}`);
    } catch {
      setExportFailed(true);
    }
  };
  // Opened on a link of a hidden layer: its layer is turned on.
  const [layers, setLayers] = useState<Set<Layer>>(() => {
    const saved = savedLayers();
    const link = focus?.kind === 'link' ? infra.links.find((l) => l.id === focus.id) : undefined;
    if (link) saved.add(LAYER_OF[link.kind]);
    return saved;
  });
  const [selection, setSelection] = useState<Selection>(focus);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify([...layers]));
    } catch {
      // The choice is only kept for this page.
    }
  }, [layers]);
  // A link or a node that is no longer there (files removed) is no longer selected.
  const current =
    selection?.kind === 'link' ? infra.links.find((l) => l.id === selection.id) : undefined;
  const node =
    selection?.kind === 'node' &&
    (infra.devices.some((d) => d.key === selection.id) ||
      infra.externals.some((e) => e.id === selection.id))
      ? selection.id
      : null;
  const api = useMemo<DeviceViewApi>(
    () => ({
      showSource: () => undefined,
      state: null,
      openFile: onOpenFile,
      fileName: (id) => id,
      exportName,
      peers: [],
      infra,
      gatewaysOf: () => [],
      openMap: setSelection,
    }),
    [onOpenFile, exportName, infra],
  );
  const top = useRef<HTMLDivElement>(null);
  const selectLink = (id: string, reveal = false) => {
    const link = infra.links.find((l) => l.id === id);
    if (!link) return;
    // Chosen in the list under the map: the page goes back up to the map.
    if (reveal) top.current?.scrollIntoView({ block: 'start' });
    // A link of a hidden layer: its layer is turned on to show it.
    if (!layers.has(LAYER_OF[link.kind])) setLayers(new Set([...layers, LAYER_OF[link.kind]]));
    setSelection({ kind: 'link', id });
  };
  // A problem chosen in the list: its link, or its first device, on the map above.
  const selectProblem = (p: Problem) => {
    setProblem(p.id);
    if (p.link && infra.links.some((l) => l.id === p.link)) {
      selectLink(p.link, true);
    } else {
      top.current?.scrollIntoView({ block: 'start' });
      setSelection({ kind: 'node', id: p.devices[0]! });
    }
  };
  const panelProps = {
    infra,
    modelOf,
    onOpenFile,
    onSelectLink: selectLink,
    ...(editing ? { editing } : {}),
  };
  const devices = infra.devices.length;
  const sites = infra.sites.filter((s) => s.name).length;

  return (
    <DeviceViewContext.Provider value={api}>
      <ScrollArea h="calc(100dvh - var(--app-shell-header-height, 56px))" type="auto">
        <Stack p="md" gap="sm" data-testid="map-view" ref={top}>
          <Group justify="space-between" align="flex-end" gap="xs">
            <Box>
              <Title order={3}>{t('map.title')}</Title>
              <Text size="sm" c="dimmed" data-testid="map-summary">
                {t('map.summary', {
                  devices: t('map.devices', { count: devices }),
                  sites: t('map.sites', { count: sites }),
                  links: t('map.links', { count: infra.links.length }),
                })}
              </Text>
              {infra.problems.length > 0 && (
                <Text
                  size="sm"
                  fw={600}
                  c={SEVERITY_COLOR[infra.problems[0]!.severity]}
                  data-testid="map-problems-summary"
                >
                  {problemsSummary(infra.problems, t)}
                </Text>
              )}
            </Box>
            <Chip.Group
              multiple
              value={[...layers]}
              onChange={(value) => setLayers(new Set(value as Layer[]))}
            >
              <Group gap={6} data-testid="map-layers">
                {LAYERS.map((layer) => (
                  <Chip
                    key={layer}
                    value={layer}
                    size="xs"
                    data-testid="map-layer"
                    data-layer={layer}
                  >
                    {t(`map.layer.${layer}`)}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Group>
          {devices > 0 && (
            <Group justify="space-between" gap="xs" data-testid="map-tools">
              <Group gap={6}>
                {editing && (
                  <>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconPlus size={14} />}
                      onClick={() => editing.openLink()}
                      data-testid="btn-map-add-link"
                    >
                      {t('mapEdit.tools.addLink')}
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconBox size={14} />}
                      onClick={() => editing.openExternal()}
                      data-testid="btn-map-add-node"
                    >
                      {t('mapEdit.tools.addNode')}
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconMapPin size={14} />}
                      onClick={() => setSitesOpen(true)}
                      data-testid="btn-map-sites"
                    >
                      {t('mapEdit.tools.sites')}
                    </Button>
                    {moved && (
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<IconLayoutGrid size={14} />}
                        onClick={() => onEdit?.(withoutPositions)}
                        data-testid="btn-map-reset-layout"
                      >
                        {t('mapEdit.tools.resetLayout')}
                      </Button>
                    )}
                  </>
                )}
                <Menu position="bottom-start" withinPortal>
                  <Menu.Target>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconDownload size={14} />}
                      data-testid="btn-map-export"
                    >
                      {t('mapEdit.tools.export')}
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item onClick={exportDrawio} data-testid="btn-export-drawio">
                      {t('mapEdit.export.drawio')}
                    </Menu.Item>
                    <Menu.Item
                      onClick={() => void exportPicture('png')}
                      data-testid="btn-export-png"
                    >
                      {t('mapEdit.export.png')}
                    </Menu.Item>
                    <Menu.Item
                      onClick={() => void exportPicture('svg')}
                      data-testid="btn-export-svg"
                    >
                      {t('mapEdit.export.svg')}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
                {exportFailed && (
                  <Text size="xs" c="red" data-testid="map-export-error">
                    {t('mapEdit.export.error')}
                  </Text>
                )}
              </Group>
              {saveState && <SaveState state={saveState} />}
            </Group>
          )}
          {devices === 0 ? (
            <Text c="dimmed" data-testid="map-empty">
              {t('map.empty')}
            </Text>
          ) : (
            <Box className="ncv-map-layout">
              <Paper withBorder className="ncv-map-canvas" ref={canvas}>
                <ReactFlowProvider>
                  <Canvas
                    infra={infra}
                    layers={layers}
                    selection={selection}
                    onSelect={(s) => (s?.kind === 'link' ? selectLink(s.id) : setSelection(s))}
                    positions={edits?.positions}
                    {...(onEdit ? { onMove } : {})}
                    onLayout={onLayout}
                  />
                </ReactFlowProvider>
              </Paper>
              <Paper withBorder p="sm" className="ncv-map-panel" data-testid="map-panel">
                {current ? (
                  <LinkPanel link={current} {...panelProps} />
                ) : node ? (
                  <NodePanel node={node} {...panelProps} />
                ) : (
                  <Legend />
                )}
              </Paper>
            </Box>
          )}
          {devices > 0 && (
            <Box data-testid="map-problems">
              <Title order={5} mb={4}>
                {t('problems.listTitle')}
              </Title>
              <ProblemsTable
                infra={infra}
                modelOf={modelOf}
                selected={problem}
                onSelect={selectProblem}
              />
            </Box>
          )}
          {devices > 0 && (
            <Box>
              <Title order={5} mb={4}>
                {t('map.listTitle')}
              </Title>
              <LinksTable
                infra={infra}
                modelOf={modelOf}
                selected={current?.id ?? null}
                onSelect={(id) => selectLink(id, true)}
              />
              {onEdit && (
                <Box mt="sm">
                  <DiscardedLinks
                    infra={infra}
                    title={(l) => `${kindLabel(l.kind, t)}: ${linkTitle(l, infra, modelOf)}`}
                    onEdit={onEdit}
                  />
                </Box>
              )}
            </Box>
          )}
        </Stack>
      </ScrollArea>
      {linkForm && onEdit && (
        <LinkForm
          link={linkForm}
          infra={infra}
          modelOf={modelOf}
          onClose={() => setLinkForm(null)}
          onEdit={onEdit}
        />
      )}
      {externalForm && onEdit && (
        <ExternalForm
          {...(externalForm === 'new' ? {} : { external: externalForm })}
          infra={infra}
          onClose={() => setExternalForm(null)}
          onEdit={onEdit}
        />
      )}
      {sitesOpen && onEdit && (
        <SitesForm infra={infra} onClose={() => setSitesOpen(false)} onEdit={onEdit} />
      )}
    </DeviceViewContext.Provider>
  );
}

function Legend() {
  const { t } = useTranslation();
  const kinds = [
    'lag',
    'cable',
    'wan',
    'fortilink',
    'capwap',
    'internet',
    'ipsec',
    'shortcut',
    'bgp',
    'ospf',
    'subnet',
  ] as const;
  return (
    <Stack gap="xs" data-testid="map-legend">
      <Title order={5}>{t('map.legend.title')}</Title>
      <Text size="sm">{t('map.legend.intro')}</Text>
      <Stack gap={4}>
        {kinds.map((kind) => {
          const style = linkStyle(kind);
          return (
            <Group key={kind} gap={8} wrap="nowrap">
              <svg width="40" height="10" aria-hidden>
                <line
                  x1="0"
                  y1="5"
                  x2="40"
                  y2="5"
                  stroke={style.color}
                  strokeWidth={style.width}
                  strokeDasharray={style.dash}
                />
              </svg>
              <Text size="xs">{t(`map.kind.${kind}`)}</Text>
            </Group>
          );
        })}
      </Stack>
      <Group gap={6}>
        <Badge color="teal" variant="light" tt="none">
          {t('map.verified')}
        </Badge>
        <Text size="xs">{t('map.legend.verified')}</Text>
      </Group>
      <Group gap={6}>
        <Badge color="gray" variant="light" tt="none">
          {t('map.inferred')}
        </Badge>
        <Text size="xs">{t('map.legend.inferred')}</Text>
      </Group>
      <Group gap={6} wrap="nowrap">
        <Badge color="grape" variant="light" tt="none" style={{ flexShrink: 0 }}>
          {t('map.manual')}
        </Badge>
        <Text size="xs">{t('map.legend.manual')}</Text>
      </Group>
      <Group gap={6} wrap="nowrap">
        {SEVERITIES.map((s) => (
          <span key={s} className={`ncv-map-problem ncv-map-problem-${s}`}>
            1
          </span>
        ))}
        <Text size="xs">{t('map.legend.problems')}</Text>
      </Group>
      <Text size="xs" c="dimmed">
        {t('map.legend.state')}
      </Text>
      <Text size="xs" c="dimmed">
        {t('map.legend.click')}
      </Text>
      <Text size="xs" c="dimmed">
        {t('map.legend.move')}
      </Text>
    </Stack>
  );
}

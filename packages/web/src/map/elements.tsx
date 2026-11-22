// The pieces of the map drawn by React Flow (#15): sites, devices, external nodes and links.

import { Badge, Group, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBox,
  IconBuildingBroadcastTower,
  IconNetwork,
  IconPlugConnected,
  IconQuestionMark,
  IconWorld,
} from '@tabler/icons-react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  useStore,
} from '@xyflow/react';
import type { ExternalNode, InfraDevice, Link, LinkKind, Severity } from '@ncv/core';
import { useTranslation } from 'react-i18next';

/** The problems of a device or a link on the map: how many, and the most serious. */
export interface ProblemMark {
  severity: Severity;
  count: number;
}

export type SiteNode = Node<{ label: string }, 'site'>;
export type DeviceNode = Node<
  { device: InfraDevice; active: boolean; problems?: ProblemMark },
  'device'
>;
export type ExternalMapNode = Node<{ external: ExternalNode; active: boolean }, 'external'>;
export type MapNode = SiteNode | DeviceNode | ExternalMapNode;
export type MapEdge = Edge<
  {
    link: Link;
    offset: number;
    label?: string;
    active: boolean;
    dim: boolean;
    problems?: ProblemMark;
  },
  'link'
>;

/** A round mark with the number of problems, in the colour of the most serious one. */
function ProblemDot({ mark, testId }: { mark: ProblemMark; testId: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`ncv-map-problem ncv-map-problem-${mark.severity}`}
      data-testid={testId}
      data-severity={mark.severity}
      data-count={mark.count}
      title={t('problems.mark', {
        count: mark.count,
        severity: t(`problems.severity.${mark.severity}`),
      })}
    >
      {mark.count}
    </span>
  );
}

/** Edges start and end in the middle of the nodes, which are drawn over them. */
function CenterHandles() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        className="ncv-map-handle"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Top}
        className="ncv-map-handle"
        isConnectable={false}
      />
    </>
  );
}

function SiteBox({ data }: NodeProps<SiteNode>) {
  return (
    <div className="ncv-map-site" data-testid="map-site" data-site={data.label}>
      <Text className="ncv-map-site-label" size="xs" fw={700} tt="uppercase" c="dimmed">
        {data.label}
      </Text>
    </div>
  );
}

function DeviceBox({ data }: NodeProps<DeviceNode>) {
  const { t } = useTranslation();
  const d = data.device;
  return (
    <div
      className={`ncv-map-device${data.active ? ' ncv-map-active' : ''}`}
      data-testid="map-device"
      data-device={d.hostname}
      data-problems={data.problems?.severity}
    >
      <CenterHandles />
      {data.problems && <ProblemDot mark={data.problems} testId="map-device-problems" />}
      <Group gap={8} wrap="nowrap" align="center">
        <Badge
          variant="light"
          color={d.type === 'firewall' ? 'red' : 'indigo'}
          radius="sm"
          size="sm"
          className="ncv-map-type"
        >
          {t(`map.type.${d.type}`)}
        </Badge>
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={700} truncate="end">
            {d.hostname}
          </Text>
          <Text size="xs" c="dimmed" truncate="end">
            {[
              d.model,
              d.ha ? 'HA' : '',
              d.contexts.length > 1 ? t('map.vdoms', { count: d.contexts.length }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </div>
      </Group>
    </div>
  );
}

const EXTERNAL_ICON = {
  internet: IconWorld,
  provider: IconBuildingBroadcastTower,
  peer: IconPlugConnected,
  neighbor: IconQuestionMark,
  segment: IconNetwork,
  manual: IconBox,
  missing: IconAlertTriangle,
} as const;

function ExternalBox({ data }: NodeProps<ExternalMapNode>) {
  const { t } = useTranslation();
  const e = data.external;
  const Icon = EXTERNAL_ICON[e.kind];
  return (
    <div
      className={`ncv-map-external ncv-map-external-${e.kind}${data.active ? ' ncv-map-active' : ''}`}
      data-testid="map-external"
      data-external={e.id}
    >
      <CenterHandles />
      <Group gap={6} wrap="nowrap">
        <Icon size={18} aria-hidden />
        <div style={{ minWidth: 0 }}>
          <Text size="xs" fw={700} truncate="end">
            {e.label}
          </Text>
          <Text size="xs" c="dimmed" truncate="end">
            {e.detail ?? t(`map.external.${e.kind}`)}
          </Text>
        </div>
      </Group>
    </div>
  );
}

export const NODE_TYPES = { site: SiteBox, device: DeviceBox, external: ExternalBox };

/** How every kind of link is drawn: colour, dashes and width. */
const STYLE: Record<LinkKind, { color: string; dash?: string; width: number }> = {
  cable: { color: 'var(--ncv-map-cable)', width: 1.6 },
  lag: { color: 'var(--ncv-map-cable)', width: 3.2 },
  wan: { color: 'var(--ncv-map-wan)', dash: '12 4', width: 2.4 },
  internet: { color: 'var(--ncv-map-wan)', width: 1.4 },
  subnet: { color: 'var(--ncv-map-subnet)', dash: '2 3', width: 1.2 },
  ipsec: { color: 'var(--ncv-map-vpn)', dash: '7 4', width: 1.8 },
  shortcut: { color: 'var(--ncv-map-shortcut)', dash: '9 3 2 3', width: 1.8 },
  bgp: { color: 'var(--ncv-map-bgp)', dash: '1.5 3.5', width: 2.2 },
  ospf: { color: 'var(--ncv-map-ospf)', dash: '1.5 3.5', width: 2.2 },
};

export function linkStyle(kind: LinkKind) {
  return STYLE[kind];
}

/** Down on a side (from the shows): red; partly down: orange. */
function stateColor(link: Link): string | undefined {
  const states = [link.state?.a?.status, link.state?.b?.status];
  if (states.includes('down')) return 'var(--ncv-map-down)';
  if (states.includes('partial')) return 'var(--ncv-map-partial)';
  return undefined;
}

/** Labels are read only from close enough: zoomed out they would cover the drawing. */
const LABEL_ZOOM = 0.6;

function LinkEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<MapEdge>) {
  const zoom = useStore((s) => s.transform[2]);
  if (!data) return null;
  const { link, offset, label, active, dim, problems } = data;
  const style = STYLE[link.kind];
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.hypot(dx, dy) || 1;
  const bend = offset * 28;
  const cx = (sourceX + targetX) / 2 - (dy / length) * bend;
  const cy = (sourceY + targetY) / 2 + (dx / length) * bend;
  const path = `M ${sourceX},${sourceY} Q ${cx},${cy} ${targetX},${targetY}`;
  const lx = 0.25 * sourceX + 0.5 * cx + 0.25 * targetX;
  const ly = 0.25 * sourceY + 0.5 * cy + 0.25 * targetY;
  const color = stateColor(link) ?? style.color;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        style={{
          stroke: color,
          strokeWidth: active ? style.width + 2 : style.width,
          strokeDasharray: style.dash,
          // Inferred cables are lighter than the verified ones.
          opacity: dim ? 0.25 : link.verified || link.kind !== 'cable' ? 1 : 0.7,
        }}
      />
      {/* The problems of a link are always shown; its label only from close enough. */}
      {((label && (zoom >= LABEL_ZOOM || active)) || problems) && (
        <EdgeLabelRenderer>
          <div
            className={`ncv-map-edge-label nodrag nopan${active ? ' ncv-map-active' : ''}${label && (zoom >= LABEL_ZOOM || active) ? '' : ' ncv-map-edge-mark'}`}
            style={{
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              opacity: dim ? 0.3 : 1,
            }}
            data-testid="map-edge-label"
            data-link={link.id}
          >
            {problems && <ProblemDot mark={problems} testId="map-edge-problems" />}
            {label && (zoom >= LABEL_ZOOM || active) ? label : null}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const EDGE_TYPES = { link: LinkEdge };

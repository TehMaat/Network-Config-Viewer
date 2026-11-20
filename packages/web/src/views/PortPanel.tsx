import { Paper, Text } from '@mantine/core';
import { portVlanRole, type Interface, type StackMember } from '@ncv/core';
import { useTranslation } from 'react-i18next';
import { NEUTRAL } from './colors';

// Generic front panel: front ports in two rows (odd on top, even below, as on most
// switches), in groups of twelve, and the uplinks apart on the right.

const W = 28;
const H = 22;
const GAP = 4;
const GROUP_GAP = 10;
const BLOCK_GAP = 22;
const PAD = 8;

interface Props {
  member: StackMember;
  ports: Interface[];
  colors: Map<number, string>;
  selected: string | null;
  vlanFilter: number | null;
  onSelect(name: string): void;
}

interface Placed {
  port: Interface;
  x: number;
  y: number;
}

function layout(ports: Interface[], x0: number): { placed: Placed[]; width: number } {
  const sorted = [...ports].sort(
    (a, b) => a.position!.slot - b.position!.slot || a.position!.port - b.position!.port,
  );
  const placed: Placed[] = [];
  let maxX = x0;
  sorted.forEach((port, index) => {
    const column = Math.floor(index / 2);
    const x = x0 + column * (W + GAP) + Math.floor(column / 6) * GROUP_GAP;
    const y = PAD + (index % 2) * (H + GAP);
    placed.push({ port, x, y });
    maxX = Math.max(maxX, x + W);
  });
  return { placed, width: maxX - x0 };
}

/** The VLANs a port carries, for the stripes of a trunk: native first, at most four. */
function stripeColors(port: Interface, colors: Map<number, string>): string[] {
  const sp = port.switchport!;
  const out: string[] = [];
  if (sp.nativeVlan !== undefined && colors.has(sp.nativeVlan))
    out.push(colors.get(sp.nativeVlan)!);
  for (const [id, color] of colors) {
    if (out.length >= 4) break;
    if (id !== sp.nativeVlan && portVlanRole(port, id) === 'tagged') out.push(color);
  }
  if (out.length < 2) out.push('var(--ncv-port-stripe)');
  return out;
}

export function PortPanel({ member, ports, colors, selected, vlanFilter, onSelect }: Props) {
  const { t } = useTranslation();
  const front = ports.filter((p) => !p.position!.uplink);
  const uplinks = ports.filter((p) => p.position!.uplink);
  const a = layout(front, PAD);
  const b = layout(
    uplinks,
    PAD + a.width + (front.length > 0 && uplinks.length > 0 ? BLOCK_GAP : 0),
  );
  const width = PAD * 2 + a.width + (uplinks.length > 0 ? BLOCK_GAP + b.width : 0);
  const height = PAD * 2 + H * 2 + GAP;
  const placed = [...a.placed, ...b.placed];

  const fillOf = (port: Interface): string => {
    if (port.shutdown) return 'var(--ncv-port-down)';
    const sp = port.switchport;
    if (!sp) return NEUTRAL;
    if (sp.mode === 'routed') return 'var(--ncv-port-l3)';
    if (sp.mode === 'trunk' || sp.mode === 'general')
      return `url(#stripes-${member.member}-${idOf(port)})`;
    return colors.get(sp.accessVlan ?? 1) ?? NEUTRAL;
  };

  const describe = (port: Interface) => {
    const parts = [port.name];
    if (port.description) parts.push(port.description);
    const sp = port.switchport;
    if (port.shutdown) parts.push(t('ports.state.down'));
    if (sp?.mode === 'routed') parts.push(t('ports.mode.routed'));
    else if (sp?.mode === 'trunk' || sp?.mode === 'general') parts.push(t(`ports.mode.${sp.mode}`));
    else if (sp?.accessVlan !== undefined)
      parts.push(t('ports.vlanShort', { vlan: sp.accessVlan }));
    if (sp?.voiceVlan !== undefined) parts.push(t('ports.voiceShort', { vlan: sp.voiceVlan }));
    if (port.lag) parts.push(port.lag.group);
    return parts.join(' · ');
  };

  return (
    <Paper withBorder p="xs" data-testid="port-panel" data-member={member.member}>
      <Text size="sm" fw={600} mb={4}>
        {t('ports.member', { member: member.member })}
        {member.model ? ` · ${member.model}` : ''}
      </Text>
      <div className="ncv-panel-scroll">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={t('ports.member', { member: member.member })}
          className="ncv-panel"
        >
          <defs>
            {placed
              .filter(
                ({ port }) =>
                  port.switchport?.mode === 'trunk' || port.switchport?.mode === 'general',
              )
              .map(({ port }) => {
                const stripes = stripeColors(port, colors);
                const size = 4 * stripes.length;
                return (
                  <pattern
                    key={port.name}
                    id={`stripes-${member.member}-${idOf(port)}`}
                    patternUnits="userSpaceOnUse"
                    width={size}
                    height={size}
                    patternTransform="rotate(45)"
                  >
                    {stripes.map((color, i) => (
                      <rect key={i} x={i * 4} y={0} width={4} height={size} fill={color} />
                    ))}
                  </pattern>
                );
              })}
          </defs>
          <rect
            x={0.5}
            y={0.5}
            width={width - 1}
            height={height - 1}
            rx={6}
            className="ncv-panel-body"
          />
          {placed.map(({ port, x, y }) => {
            const sp = port.switchport;
            const dimmed = vlanFilter !== null && portVlanRole(port, vlanFilter) === null;
            const isSelected = port.name === selected;
            const poe = port.poe && port.poe.mode !== 'never' && !port.shutdown;
            return (
              <g
                key={port.name}
                transform={`translate(${x} ${y})`}
                role="button"
                tabIndex={0}
                aria-label={describe(port)}
                aria-pressed={isSelected}
                data-testid="port"
                data-name={port.name}
                data-dimmed={dimmed || undefined}
                className="ncv-port"
                opacity={dimmed ? 0.2 : 1}
                onClick={() => onSelect(port.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(port.name);
                  }
                }}
              >
                <title>{describe(port)}</title>
                <rect
                  width={W}
                  height={H}
                  rx={3}
                  fill={fillOf(port)}
                  className={isSelected ? 'ncv-port-box ncv-port-selected' : 'ncv-port-box'}
                />
                {port.shutdown && (
                  <line x1={3} y1={H - 3} x2={W - 3} y2={3} className="ncv-port-cross" />
                )}
                <text
                  x={W / 2}
                  y={H / 2 + 3.5}
                  textAnchor="middle"
                  className={
                    port.shutdown
                      ? 'ncv-port-label ncv-port-label-down'
                      : sp?.mode === 'routed'
                        ? 'ncv-port-label ncv-port-label-l3'
                        : 'ncv-port-label'
                  }
                >
                  {port.position!.port}
                </text>
                {poe && <circle cx={4} cy={4} r={2.6} className="ncv-mark-poe" />}
                {port.dot1x && <circle cx={W - 4} cy={4} r={2.6} className="ncv-mark-dot1x" />}
                {sp?.voiceVlan !== undefined && (
                  <circle cx={4} cy={H - 4} r={2.6} className="ncv-mark-voice" />
                )}
                {port.lag && <circle cx={W - 4} cy={H - 4} r={2.6} className="ncv-mark-lag" />}
              </g>
            );
          })}
        </svg>
      </div>
    </Paper>
  );
}

const idOf = (port: Interface) => port.name.replace(/[^A-Za-z0-9]/g, '_');

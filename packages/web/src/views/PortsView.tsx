import {
  Badge,
  Box,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { portVlanRole, type DeviceModel, type Interface } from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { vlanColors } from './colors';
import { DataTable } from './DataTable';
import { PortPanel } from './PortPanel';
import { SourceButton, Value } from './source';
import { formatVlans, shortInterfaceName } from './values';

export function PortsView({ model }: { model: DeviceModel }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [vlanFilter, setVlanFilter] = useState<number | null>(null);
  const colors = useMemo(() => vlanColors(model.vlans.map((v) => v.id)), [model]);
  const placed = model.interfaces.filter((i) => i.kind === 'physical' && i.position);
  const members = model.stack.length > 0 ? model.stack : [{ member: 1, src: [] }];
  const port = model.interfaces.find((i) => i.name === selected) ?? null;

  const columns = useMemo<ColumnDef<Interface, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('ports.col.port'),
        accessorFn: (i) => shortInterfaceName(i.name),
        cell: (c) => (
          <Text span size="sm" ff="monospace">
            {c.getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'description',
        header: t('ports.col.description'),
        accessorFn: (i) => i.description ?? '',
      },
      {
        id: 'state',
        header: t('ports.col.state'),
        accessorFn: (i) => (i.shutdown ? t('ports.state.down') : t('ports.state.up')),
        cell: (c) => (
          <Badge
            size="sm"
            variant="light"
            color={c.row.original.shutdown ? 'gray' : 'teal'}
            tt="none"
          >
            {c.getValue<string>()}
          </Badge>
        ),
      },
      {
        id: 'mode',
        header: t('ports.col.mode'),
        accessorFn: (i) =>
          i.switchport ? t(`ports.mode.${i.switchport.mode}`) : t(`ports.kind.${i.kind}`),
        cell: (c) => (
          <Value element={c.row.original} field="switchport.mode">
            {c.getValue<string>()}
          </Value>
        ),
      },
      {
        id: 'vlan',
        header: t('ports.col.vlan'),
        accessorFn: (i) => vlanText(i, t),
        cell: (c) => {
          const i = c.row.original;
          const field = i.switchport?.allowed ? 'switchport.allowed' : 'switchport.accessVlan';
          return (
            <Value element={i} field={field}>
              {c.getValue<string>()}
            </Value>
          );
        },
      },
      {
        id: 'voice',
        header: t('ports.col.voice'),
        accessorFn: (i) => i.switchport?.voiceVlan ?? '',
      },
      {
        id: 'lag',
        header: t('ports.col.lag'),
        accessorFn: (i) =>
          i.lag
            ? shortInterfaceName(i.lag.group)
            : (i.members?.map(shortInterfaceName).join(' ') ?? ''),
      },
      {
        id: 'poe',
        header: t('ports.col.poe'),
        accessorFn: (i) => i.poe?.mode ?? '',
        cell: (c) => (
          <Value element={c.row.original} field="poe.mode">
            {c.getValue<string>()}
          </Value>
        ),
      },
      {
        id: 'dot1x',
        header: t('ports.col.dot1x'),
        accessorFn: (i) =>
          i.dot1x
            ? [i.dot1x.dot1x ? '802.1X' : '', i.dot1x.mab ? 'MAB' : ''].filter(Boolean).join(' + ')
            : '',
      },
      {
        id: 'ip',
        header: t('ports.col.ip'),
        accessorFn: (i) =>
          i.ipv4.map((a) => `${a.ip}/${a.prefix}`).join(' ') || (i.dhcpClient ? 'DHCP' : ''),
      },
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.src} />,
      },
    ],
    [t],
  );

  const vlanOptions = model.vlans.map((v) => ({
    value: String(v.id),
    label: v.name ? `${v.id} · ${v.name}` : String(v.id),
  }));

  return (
    <Stack gap="md" p="md" data-testid="view-ports">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <Select
          size="xs"
          w={220}
          label={t('ports.filterVlan')}
          placeholder={t('ports.allVlans')}
          data={vlanOptions}
          value={vlanFilter === null ? null : String(vlanFilter)}
          onChange={(v) => setVlanFilter(v === null ? null : Number(v))}
          clearable
          searchable
          data-testid="filter-vlan"
        />
        <Legend colors={colors} model={model} />
      </Group>

      {placed.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('ports.noPanel')}
        </Text>
      ) : (
        <Stack gap="sm">
          {members.map((m) => (
            <PortPanel
              key={m.member}
              member={m}
              ports={placed.filter((p) => p.position!.member === m.member)}
              colors={colors}
              selected={selected}
              vlanFilter={vlanFilter}
              onSelect={setSelected}
            />
          ))}
        </Stack>
      )}

      {port && <PortDetail port={port} />}

      <Box>
        <Title order={5} mb="xs">
          {t('ports.table')}
        </Title>
        <DataTable
          name="ports"
          data={model.interfaces}
          columns={columns}
          getRowId={(i) => i.name}
          selectedId={selected}
          onRowClick={(i) => setSelected(i.name)}
          rowState={(i) =>
            vlanFilter === null ? null : portVlanRole(i, vlanFilter) ? 'match' : 'dim'
          }
        />
      </Box>
    </Stack>
  );
}

function vlanText(i: Interface, t: TFunction): string {
  const sp = i.switchport;
  if (!sp || sp.mode === 'routed') return '';
  if (sp.mode === 'trunk') {
    const allowed = formatVlans(sp.allowed) || t('ports.detail.none');
    return sp.nativeVlan !== undefined
      ? t('ports.trunkVlans', { vlans: allowed, native: sp.nativeVlan })
      : allowed;
  }
  if (sp.mode === 'general') {
    return [
      formatVlans(sp.untagged) && t('ports.untaggedShort', { vlans: formatVlans(sp.untagged) }),
      formatVlans(sp.allowed) && t('ports.taggedShort', { vlans: formatVlans(sp.allowed) }),
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return String(sp.accessVlan ?? '');
}

/** Small marks on the ports: CSS class and text of the legend. */
const MARKS: [string, string][] = [
  ['ncv-mark-poe', 'ports.legend.poe'],
  ['ncv-mark-dot1x', 'ports.legend.dot1x'],
  ['ncv-mark-voice', 'ports.legend.voice'],
  ['ncv-mark-lag', 'ports.legend.lag'],
];

function Legend({ colors, model }: { colors: Map<number, string>; model: DeviceModel }) {
  const { t } = useTranslation();
  const used = model.vlans.filter((v) => colors.has(v.id)).slice(0, 14);
  const mark = (cls: string, label: string) => (
    <Group gap={4} wrap="nowrap" key={cls}>
      <svg width={10} height={10} aria-hidden>
        <circle cx={5} cy={5} r={4} className={cls} />
      </svg>
      <Text size="xs">{label}</Text>
    </Group>
  );
  return (
    <Group gap="sm" wrap="wrap" data-testid="port-legend">
      {used.map((v) => (
        <Group gap={4} wrap="nowrap" key={v.id}>
          <Box w={12} h={12} style={{ background: colors.get(v.id), borderRadius: 3 }} />
          <Text size="xs">{v.name ? `${v.id} ${v.name}` : v.id}</Text>
        </Group>
      ))}
      <Group gap={4} wrap="nowrap">
        <Box w={12} h={12} className="ncv-legend-trunk" />
        <Text size="xs">{t('ports.legend.trunk')}</Text>
      </Group>
      <Group gap={4} wrap="nowrap">
        <Box w={12} h={12} style={{ background: 'var(--ncv-port-l3)', borderRadius: 3 }} />
        <Text size="xs">{t('ports.legend.l3')}</Text>
      </Group>
      <Group gap={4} wrap="nowrap">
        <Box w={12} h={12} style={{ background: 'var(--ncv-port-down)', borderRadius: 3 }} />
        <Text size="xs">{t('ports.legend.down')}</Text>
      </Group>
      {MARKS.map(([cls, key]) => mark(cls, t(key)))}
    </Group>
  );
}

function PortDetail({ port }: { port: Interface }) {
  const { t } = useTranslation();
  const sp = port.switchport;
  const rows: [string, ReactNode][] = [];
  const add = (label: string, value: ReactNode) => {
    if (value !== undefined && value !== null && value !== '') rows.push([label, value]);
  };
  add(t('ports.col.description'), port.description);
  add(t('ports.col.state'), port.shutdown ? t('ports.state.down') : t('ports.state.up'));
  if (sp) {
    add(
      t('ports.col.mode'),
      <Value element={port} field="switchport.mode">
        {t(`ports.mode.${sp.mode}`)}
      </Value>,
    );
    if (sp.accessVlan !== undefined) {
      add(
        t('ports.detail.accessVlan'),
        <Value element={port} field="switchport.accessVlan">
          {sp.accessVlan}
        </Value>,
      );
    }
    add(t('ports.col.voice'), sp.voiceVlan);
    if (sp.nativeVlan !== undefined) {
      add(
        t('ports.detail.nativeVlan'),
        <Value element={port} field="switchport.nativeVlan">
          {sp.nativeVlan}
        </Value>,
      );
    }
    if (sp.allowed) {
      add(
        t('ports.detail.allowed'),
        <Value element={port} field="switchport.allowed">
          {formatVlans(sp.allowed) || t('ports.detail.none')}
        </Value>,
      );
    }
    if (sp.untagged)
      add(t('ports.detail.untagged'), formatVlans(sp.untagged) || t('ports.detail.none'));
    if (sp.nonegotiate) add(t('ports.detail.dtp'), t('ports.detail.nonegotiate'));
  } else {
    add(t('ports.col.mode'), t(`ports.kind.${port.kind}`));
  }
  if (port.lag) add(t('ports.col.lag'), `${port.lag.group} (${port.lag.mode ?? ''})`);
  if (port.members) add(t('ports.detail.members'), port.members.join(', '));
  if (port.poe) {
    add(
      t('ports.col.poe'),
      <Value element={port} field="poe.mode">
        {port.poe.mode}
      </Value>,
    );
  }
  if (port.dot1x) {
    add(
      t('ports.col.dot1x'),
      [port.dot1x.dot1x ? '802.1X' : '', port.dot1x.mab ? 'MAB' : ''].filter(Boolean).join(' + '),
    );
  }
  if (port.portSecurity) {
    const ps = port.portSecurity;
    add(
      t('ports.detail.portSecurity'),
      <Stack gap={0}>
        <Text span size="sm">
          {t('ports.detail.portSecurityMax', { count: ps.maximum ?? 1 })}
          {ps.sticky ? ` · ${t('ports.detail.sticky')}` : ''}
        </Text>
        {ps.macs.map((m) => (
          <Text key={m.mac} span size="sm" ff="monospace">
            {m.mac}
            {m.vlan !== undefined ? ` (VLAN ${m.vlan})` : ''}
          </Text>
        ))}
      </Stack>,
    );
  }
  if (port.stp) {
    add(
      t('ports.detail.stp'),
      [port.stp.portfast ? 'portfast' : '', port.stp.bpduguard ? 'bpduguard' : '']
        .filter(Boolean)
        .join(' · '),
    );
  }
  add(t('ports.detail.speed'), [port.speed, port.duplex].filter(Boolean).join(' / '));
  add(
    t('ports.col.ip'),
    port.ipv4
      .map((a) =>
        a.secondary
          ? t('ports.detail.secondary', { ip: `${a.ip}/${a.prefix}` })
          : `${a.ip}/${a.prefix}`,
      )
      .join(', '),
  );
  if (port.dhcpClient) add(t('ports.col.ip'), 'DHCP');
  add('VRF', port.vrf);
  add(t('ports.detail.aclIn'), port.aclIn);
  add(t('ports.detail.aclOut'), port.aclOut);
  add(t('ports.detail.helper'), port.helperAddresses?.join(', '));
  add(t('ports.detail.pbr'), port.policyRouteMap);
  if (port.ospf) {
    add(
      'OSPF',
      [
        port.ospf.process && t('routing.ospf.process', { process: port.ospf.process }),
        port.ospf.area && t('routing.ospf.area', { area: port.ospf.area }),
        port.ospf.cost !== undefined && t('routing.ospf.cost', { cost: port.ospf.cost }),
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }

  return (
    <Paper withBorder p="sm" data-testid="port-detail" data-name={port.name}>
      <Group justify="space-between" mb="xs">
        <Title order={5} ff="monospace">
          {port.name}
        </Title>
        <SourceButton src={port.src} testId="port-source" />
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={4}>
        <Table fz="sm" verticalSpacing={2} withRowBorders={false}>
          <Table.Tbody>
            {rows.map(([label, value]) => (
              <Table.Tr key={label}>
                <Table.Td c="dimmed" w={170} style={{ verticalAlign: 'top' }}>
                  {label}
                </Table.Td>
                <Table.Td>{value}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </SimpleGrid>
    </Paper>
  );
}

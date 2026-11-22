// What a FortiGate manages (#15, part 4): its FortiSwitches, with the MCLAG pair, and its
// FortiAPs with their profiles and SSIDs. Everything comes from the configuration of the
// FortiGate, and from its shows for the state of the switches.

import { Badge, Box, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type {
  AccessPoint,
  ApProfile,
  DeviceModel,
  Interface,
  ManagedSwitch,
  WifiSsid,
} from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from './DataTable';
import { ShowSourceButton, SourceButton, useDeviceView } from './source';
import { shortList } from './values';

/** The pair of switches with an inter-chassis trunk, and the trunks spread on both. */
function mclagPair(switches: readonly ManagedSwitch[]) {
  const pair = switches.filter((s) => s.ports.some((p) => p.trunkRole === 'icl'));
  if (pair.length !== 2) return null;
  const trunks = new Map<string, { sw: ManagedSwitch; trunk: Interface }[]>();
  for (const sw of pair) {
    for (const trunk of sw.ports.filter(
      (p) => p.trunkRole === 'mclag' || p.trunkRole === 'fortilink',
    )) {
      trunks.set(trunk.name, [...(trunks.get(trunk.name) ?? []), { sw, trunk }]);
    }
  }
  return { pair, trunks: [...trunks] };
}

export function FortiSwitchView({
  model,
  onOpenSwitch,
}: {
  model: DeviceModel;
  /** Opens the views of a managed switch: its ports and VLANs. */
  onOpenSwitch(serial: string): void;
}) {
  const { t } = useTranslation();
  const { state } = useDeviceView();
  const switches = model.managedSwitches ?? [];
  const status = (serial: string) => state?.managedSwitches.find((s) => s.serial === serial);
  const columns = useMemo<ColumnDef<ManagedSwitch, unknown>[]>(
    () => [
      { id: 'name', header: t('managed.col.name'), accessorFn: (s) => s.name },
      { id: 'serial', header: t('managed.col.serial'), accessorFn: (s) => s.serial },
      { id: 'model', header: t('managed.col.model'), accessorFn: (s) => s.model ?? '' },
      { id: 'fortilink', header: t('managed.col.fortilink'), accessorFn: (s) => s.fortilink ?? '' },
      {
        id: 'ports',
        header: t('managed.col.ports'),
        accessorFn: (s) => s.ports.filter((p) => p.kind === 'physical').length,
      },
      {
        id: 'poe',
        header: t('managed.col.poe'),
        accessorFn: (s) => s.ports.filter((p) => p.poe && p.poe.mode !== 'never').length,
      },
      {
        id: 'mclag',
        header: t('managed.col.role'),
        accessorFn: (s) =>
          s.ports.some((p) => p.trunkRole === 'icl') ? t('managed.mclagMember') : '',
      },
      {
        id: 'status',
        header: t('managed.col.status'),
        accessorFn: (s) => status(s.serial)?.statusText ?? '',
        cell: (c) => {
          const live = status(c.row.original.serial);
          return live ? (
            <Group gap={4} wrap="nowrap">
              <Badge
                size="sm"
                variant="light"
                tt="none"
                color={live.status === 'up' ? 'teal' : 'red'}
                data-testid="managed-status"
              >
                {live.statusText}
              </Badge>
              <ShowSourceButton item={live} />
            </Group>
          ) : null;
        },
      },
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.src} />,
      },
    ],
    // status reads only the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, state],
  );
  const mclag = mclagPair(switches);
  const trunkText = (trunk: Interface) => shortList(trunk.members ?? [], 80);
  return (
    <Stack gap="md" p="md" data-testid="view-fortiswitch">
      <Text size="sm" c="dimmed">
        {t('managed.intro')}
      </Text>
      <DataTable
        name="managed-switches"
        data={switches}
        columns={columns}
        getRowId={(s) => s.serial}
        onRowClick={(s) => onOpenSwitch(s.serial)}
        height={260}
      />
      {mclag && (
        <Paper withBorder p="sm" data-testid="mclag">
          <Title order={5} mb={4}>
            {t('managed.mclag.title')}
          </Title>
          <Text size="sm" mb="xs">
            {t('managed.mclag.intro', { a: mclag.pair[0]!.name, b: mclag.pair[1]!.name })}
          </Text>
          <Table withTableBorder fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('managed.mclag.trunk')}</Table.Th>
                <Table.Th>{t('managed.mclag.kind')}</Table.Th>
                {mclag.pair.map((sw) => (
                  <Table.Th key={sw.serial}>{sw.name}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {mclag.pair[0]!.ports.filter((p) => p.trunkRole === 'icl').map((icl) => (
                <Table.Tr key={icl.name} data-testid="mclag-trunk" data-role="icl">
                  <Table.Td fw={600}>{icl.name}</Table.Td>
                  <Table.Td>{t('managed.mclag.icl')}</Table.Td>
                  {mclag.pair.map((sw) => {
                    const own = sw.ports.find((p) => p.trunkRole === 'icl');
                    return <Table.Td key={sw.serial}>{own ? trunkText(own) : '—'}</Table.Td>;
                  })}
                </Table.Tr>
              ))}
              {mclag.trunks.map(([name, sides]) => (
                <Table.Tr
                  key={name}
                  data-testid="mclag-trunk"
                  data-role={sides[0]!.trunk.trunkRole}
                >
                  <Table.Td fw={600}>
                    {name}
                    {sides[0]!.trunk.description && (
                      <Text span size="xs" c="dimmed" ml={6}>
                        {sides[0]!.trunk.description}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{t(`managed.mclag.${sides[0]!.trunk.trunkRole}`)}</Table.Td>
                  {mclag.pair.map((sw) => {
                    const own = sides.find((x) => x.sw.serial === sw.serial);
                    return <Table.Td key={sw.serial}>{own ? trunkText(own.trunk) : '—'}</Table.Td>;
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}

const SECURITY_COLOR: Record<string, string> = { open: 'red', captive: 'orange' };

export function WifiView({ model }: { model: DeviceModel }) {
  const { t } = useTranslation();
  const wireless = model.wireless ?? { ssids: [], profiles: [], accessPoints: [] };
  const profileOf = (name: string | undefined) => wireless.profiles.find((p) => p.name === name);
  const ssidColumns = useMemo<ColumnDef<WifiSsid, unknown>[]>(
    () => [
      { id: 'ssid', header: t('wifi.col.ssid'), accessorFn: (s) => s.ssid },
      { id: 'name', header: t('wifi.col.name'), accessorFn: (s) => s.name },
      {
        id: 'security',
        header: t('wifi.col.security'),
        accessorFn: (s) => s.security ?? '',
        cell: (c) => {
          const security = c.getValue<string>();
          return security ? (
            <Badge size="sm" variant="light" tt="none" color={SECURITY_COLOR[security] ?? 'gray'}>
              {security}
            </Badge>
          ) : null;
        },
      },
      { id: 'radius', header: t('wifi.col.radius'), accessorFn: (s) => s.radiusServer ?? '' },
      { id: 'vlan', header: t('wifi.col.vlan'), accessorFn: (s) => s.vlanId ?? '' },
      {
        id: 'bridging',
        header: t('wifi.col.bridging'),
        accessorFn: (s) => (s.localBridging ? t('wifi.bridging') : t('wifi.tunnel')),
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
  const apColumns = useMemo<ColumnDef<AccessPoint, unknown>[]>(
    () => [
      { id: 'name', header: t('wifi.col.ap'), accessorFn: (a) => a.name },
      { id: 'serial', header: t('managed.col.serial'), accessorFn: (a) => a.serial },
      { id: 'model', header: t('managed.col.model'), accessorFn: (a) => a.model ?? '' },
      { id: 'profile', header: t('wifi.col.profile'), accessorFn: (a) => a.profile ?? '' },
      {
        id: 'ssids',
        header: t('wifi.col.ssids'),
        accessorFn: (a) =>
          [...new Set(profileOf(a.profile)?.radios.flatMap((r) => r.ssids) ?? [])].join(', '),
      },
      {
        id: 'enabled',
        header: t('wifi.col.enabled'),
        accessorFn: (a) => (a.enabled ? t('map.value.yes') : t('map.value.no')),
      },
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.src} />,
      },
    ],
    // profileOf reads only the model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, model],
  );
  const radios = (p: ApProfile) =>
    p.radios
      .map((r) =>
        [
          t('wifi.radio', { n: r.radio }),
          r.band ?? (r.mode ? t(`wifi.mode.${r.mode}`, { defaultValue: r.mode }) : ''),
          r.ssids.join(', '),
        ]
          .filter(Boolean)
          .join(' · '),
      )
      .join('; ');
  return (
    <Stack gap="md" p="md" data-testid="view-wifi">
      <Box>
        <Title order={5} mb={4}>
          {t('wifi.ssids')}
        </Title>
        <DataTable
          name="ssids"
          data={wireless.ssids}
          columns={ssidColumns}
          getRowId={(s) => s.name}
          height={220}
        />
      </Box>
      <Box>
        <Title order={5} mb={4}>
          {t('wifi.accessPoints')}
        </Title>
        <DataTable
          name="access-points"
          data={wireless.accessPoints}
          columns={apColumns}
          getRowId={(a) => a.serial}
          height={260}
        />
      </Box>
      <Paper withBorder p="sm" data-testid="ap-profiles">
        <Title order={5} mb={4}>
          {t('wifi.profiles')}
        </Title>
        <Stack gap={6}>
          {wireless.profiles.map((p) => (
            <Group key={p.name} gap="xs" wrap="nowrap" align="flex-start" data-testid="ap-profile">
              <Text size="sm" fw={600}>
                {p.name}
              </Text>
              {p.platform && (
                <Badge size="sm" variant="default" tt="none">
                  {p.platform}
                </Badge>
              )}
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                {radios(p)}
              </Text>
              <SourceButton src={p.src} />
            </Group>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}

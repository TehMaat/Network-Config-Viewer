import { Badge, Box, Group, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { vlanUsage, type DeviceModel, type VlanRole, type VlanUsage } from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { vlanColors } from './colors';
import { DataTable } from './DataTable';
import { SourceButton } from './source';
import { shortInterfaceName, shortList } from './values';

const ROLES: VlanRole[] = ['access', 'voice', 'untagged', 'tagged'];

export function VlansView({ model }: { model: DeviceModel }) {
  const { t } = useTranslation();
  const usage = useMemo(() => vlanUsage(model), [model]);
  const colors = useMemo(() => vlanColors(model.vlans.map((v) => v.id)), [model]);
  const [selected, setSelected] = useState<number | null>(null);
  const current = usage.find((u) => u.vlan.id === selected) ?? null;

  const columns = useMemo<ColumnDef<VlanUsage, unknown>[]>(
    () => [
      {
        id: 'id',
        header: t('vlans.col.id'),
        accessorFn: (u) => u.vlan.id,
        cell: (c) => (
          <Group gap={6} wrap="nowrap">
            <Box
              w={10}
              h={10}
              style={{ background: colors.get(c.row.original.vlan.id), borderRadius: 2 }}
            />
            <Text span size="sm" fw={600}>
              {c.getValue<number>()}
            </Text>
          </Group>
        ),
      },
      {
        id: 'name',
        header: t('vlans.col.name'),
        accessorFn: (u) => u.vlan.name ?? '',
        cell: (c) => {
          const v = c.row.original.vlan;
          return (
            <Group gap={4} wrap="nowrap">
              <Text span size="sm">
                {v.name}
              </Text>
              {v.implicit && (
                <Badge size="xs" variant="light" color="gray" tt="none">
                  {t('vlans.implicit')}
                </Badge>
              )}
              {v.voice && (
                <Badge size="xs" variant="light" color="violet" tt="none">
                  {t('vlans.voice')}
                </Badge>
              )}
            </Group>
          );
        },
      },
      {
        id: 'gateway',
        header: t('vlans.col.gateway'),
        accessorFn: (u) => u.gateways.map((g) => `${g.ip}/${g.prefix}`).join(' '),
      },
      ...ROLES.map<ColumnDef<VlanUsage, unknown>>((role) => ({
        id: role,
        header: t(`vlans.role.${role}`),
        accessorFn: (u) => u.ports[role].length,
        cell: (c) => {
          const names = c.row.original.ports[role];
          return names.length === 0 ? (
            <Text span size="sm" c="dimmed">
              0
            </Text>
          ) : (
            <Text span size="sm" title={names.map(shortInterfaceName).join(', ')}>
              {names.length}
            </Text>
          );
        },
      })),
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.vlan.src} />,
      },
    ],
    [t, colors],
  );

  return (
    <Stack gap="md" p="md" data-testid="view-vlans">
      {model.warnings.some((w) => w.code === 'vtp-vlans-not-in-config') && (
        <Text size="sm" c="orange" data-testid="vlans-vtp">
          {t('warning.vtp-vlans-not-in-config')}
        </Text>
      )}
      <DataTable
        name="vlans"
        data={usage}
        columns={columns}
        getRowId={(u) => String(u.vlan.id)}
        selectedId={selected === null ? null : String(selected)}
        onRowClick={(u) => setSelected(u.vlan.id)}
      />
      {current && (
        <Paper withBorder p="sm" data-testid="vlan-detail" data-vlan={current.vlan.id}>
          <Group justify="space-between" mb="xs">
            <Title order={5}>
              {current.vlan.name
                ? t('vlans.titleNamed', { id: current.vlan.id, name: current.vlan.name })
                : t('vlans.title', { id: current.vlan.id })}
            </Title>
            <SourceButton src={current.vlan.src} />
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            {ROLES.map((role) => (
              <Box key={role}>
                <Text size="xs" c="dimmed">
                  {t(`vlans.role.${role}`)} ({current.ports[role].length})
                </Text>
                <Text size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
                  {current.ports[role].length > 0 ? shortList(current.ports[role], 200) : '—'}
                </Text>
              </Box>
            ))}
          </SimpleGrid>
        </Paper>
      )}
    </Stack>
  );
}

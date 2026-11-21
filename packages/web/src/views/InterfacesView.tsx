import { Badge, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import type { DeviceModel, Interface, LogicalContext } from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from './DataTable';
import { ShowSourceButton, SourceButton, useDeviceView, Value } from './source';
import { FULL_LABEL } from './values';

/** Interfaces of a firewall: physical ports, aggregates, VLANs, tunnels, zones. */
export function InterfacesView({
  model,
  context,
}: {
  model: DeviceModel;
  context: LogicalContext | null;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const zoneOf = useMemo(() => {
    const out = new Map<string, string>();
    for (const c of model.contexts)
      for (const z of c.zones) for (const i of z.interfaces) out.set(i, z.name);
    for (const c of model.contexts) {
      for (const m of c.sdwan?.members ?? []) if (m.zone) out.set(m.interface, `SD-WAN ${m.zone}`);
    }
    return out;
  }, [model]);
  // Interfaces of the chosen VDOM; all of them on a device without VDOMs.
  const data = useMemo(
    () =>
      model.contexts.length > 1 && context
        ? model.interfaces.filter((i) => (i.context ?? 'root') === context.name)
        : model.interfaces,
    [model, context],
  );
  const iface = model.interfaces.find((i) => i.name === selected) ?? null;
  const { state } = useDeviceView();

  const columns = useMemo<ColumnDef<Interface, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('ports.col.port'),
        accessorFn: (i) => i.name,
        cell: (c) => (
          <Text span size="sm" ff="monospace" fw={600}>
            {c.getValue<string>()}
          </Text>
        ),
      },
      { id: 'alias', header: t('interfaces.col.alias'), accessorFn: (i) => i.alias ?? '' },
      {
        id: 'kind',
        header: t('interfaces.col.kind'),
        accessorFn: (i) => t(`ports.kind.${i.kind}`),
      },
      {
        id: 'ip',
        header: t('ports.col.ip'),
        accessorFn: (i) =>
          i.ipv4.map((a) => `${a.ip}/${a.prefix}`).join(' ') ||
          (i.dhcpClient ? (i.addressingMode ?? 'dhcp').toUpperCase() : ''),
        cell: (c) => (
          <Text span size="sm" ff="monospace">
            {c.getValue<string>()}
          </Text>
        ),
      },
      { id: 'role', header: t('interfaces.col.role'), accessorFn: (i) => i.role ?? '' },
      {
        id: 'parent',
        header: t('interfaces.col.parent'),
        accessorFn: (i) =>
          i.parent
            ? `${i.parent}${i.vlanId !== undefined ? ` · VLAN ${i.vlanId}` : ''}`
            : (i.members ?? []).join(' '),
      },
      { id: 'zone', header: t('interfaces.col.zone'), accessorFn: (i) => zoneOf.get(i.name) ?? '' },
      ...(model.contexts.length > 1
        ? [
            {
              id: 'vdom',
              header: 'VDOM',
              accessorFn: (i: Interface) => i.context ?? '',
            } as ColumnDef<Interface, unknown>,
          ]
        : []),
      {
        id: 'access',
        header: t('interfaces.col.access'),
        accessorFn: (i) => (i.allowAccess ?? []).join(' '),
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
      ...(state && state.ports.length > 0
        ? [
            {
              id: 'live',
              header: t('ports.col.live'),
              accessorFn: (i: Interface) =>
                state.ports.find((p) => p.name === i.name)?.statusText ?? '',
              cell: (c: { row: { original: Interface } }) => {
                const live = state.ports.find((p) => p.name === c.row.original.name);
                return live ? (
                  <Group gap={4} wrap="nowrap">
                    <Badge
                      size="sm"
                      variant="dot"
                      color={live.status === 'up' ? 'teal' : 'gray'}
                      tt="none"
                      styles={FULL_LABEL}
                    >
                      {live.statusText}
                    </Badge>
                    {live.speed && (
                      <Text span size="xs" c="dimmed">
                        {live.speed}
                      </Text>
                    )}
                    <ShowSourceButton item={live} />
                  </Group>
                ) : null;
              },
            } as ColumnDef<Interface, unknown>,
          ]
        : []),
      {
        id: 'description',
        header: t('ports.col.description'),
        accessorFn: (i) => i.description ?? '',
      },
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.src} />,
      },
    ],
    [t, zoneOf, model, state],
  );

  return (
    <Stack gap="md" p="md" data-testid="view-interfaces">
      <DataTable
        name="interfaces"
        data={data}
        columns={columns}
        getRowId={(i) => i.name}
        selectedId={selected}
        onRowClick={(i) => setSelected(i.name)}
        height={480}
      />
      {iface && <InterfaceDetail iface={iface} zone={zoneOf.get(iface.name)} />}
      {context && context.zones.length > 0 && (
        <Paper withBorder p="sm" data-testid="zones">
          <Title order={5} mb="xs">
            {t('interfaces.zones')}
          </Title>
          <Table fz="sm" verticalSpacing={2}>
            <Table.Tbody>
              {context.zones.map((z) => (
                <Table.Tr key={z.name}>
                  <Table.Td ff="monospace" fw={600} w={200}>
                    {z.name}
                  </Table.Td>
                  <Table.Td>{z.interfaces.join(', ')}</Table.Td>
                  <Table.Td w={220}>
                    <Value element={z} field="intrazone">
                      {t('interfaces.intrazone', { value: z.intrazone ?? '' })}
                    </Value>
                  </Table.Td>
                  <Table.Td w={40}>
                    <SourceButton src={z.src} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}

function InterfaceDetail({ iface, zone }: { iface: Interface; zone: string | undefined }) {
  const { t } = useTranslation();
  const rows: [string, ReactNode][] = [];
  const add = (label: string, value: ReactNode) => {
    if (value !== undefined && value !== null && value !== '') rows.push([label, value]);
  };
  add(t('interfaces.col.alias'), iface.alias);
  add(t('interfaces.col.kind'), t(`ports.kind.${iface.kind}`));
  add('VDOM', iface.context);
  add(
    t('ports.col.ip'),
    iface.ipv4
      .map((a) =>
        a.secondary
          ? t('ports.detail.secondary', { ip: `${a.ip}/${a.prefix}` })
          : `${a.ip}/${a.prefix}`,
      )
      .join(', '),
  );
  add(t('interfaces.addressing'), iface.addressingMode);
  add(
    t('interfaces.remoteIp'),
    iface.remoteIp ? `${iface.remoteIp.ip}/${iface.remoteIp.prefix}` : undefined,
  );
  add(t('interfaces.col.role'), iface.role);
  add(t('interfaces.col.parent'), iface.parent);
  add('VLAN', iface.vlanId);
  add(t('ports.detail.members'), iface.members?.join(', '));
  add(t('ports.col.lag'), iface.lag ? `${iface.lag.group} (${iface.lag.mode ?? ''})` : undefined);
  add(t('interfaces.col.zone'), zone);
  add(t('interfaces.col.access'), iface.allowAccess?.join(' '));
  add(
    t('ports.col.state'),
    <Value element={iface} field="status">
      {iface.shutdown ? t('ports.state.down') : t('ports.state.up')}
    </Value>,
  );
  add(t('ports.detail.speed'), iface.speed);
  add('MTU', iface.mtu);
  add(t('ports.col.description'), iface.description);
  return (
    <Paper withBorder p="sm" data-testid="interface-detail" data-name={iface.name}>
      <Group justify="space-between" mb="xs">
        <Title order={5} ff="monospace">
          {iface.name}
        </Title>
        <SourceButton src={iface.src} testId="interface-source" />
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Table fz="sm" verticalSpacing={2} withRowBorders={false}>
          <Table.Tbody>
            {rows.map(([label, value]) => (
              <Table.Tr key={label}>
                <Table.Td c="dimmed" w={170}>
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

/** VLAN interfaces of a firewall: ID, parent, address, VDOM. */
export function FirewallVlansView({
  model,
  context,
}: {
  model: DeviceModel;
  context: LogicalContext | null;
}) {
  const { t } = useTranslation();
  const data = model.interfaces.filter(
    (i) =>
      i.vlanId !== undefined &&
      (model.contexts.length <= 1 || !context || (i.context ?? 'root') === context.name),
  );
  const columns: ColumnDef<Interface, unknown>[] = [
    { id: 'id', header: t('vlans.col.id'), accessorFn: (i) => i.vlanId },
    {
      id: 'name',
      header: t('vlans.col.interface'),
      accessorFn: (i) => i.name,
      cell: (c) => (
        <Text span size="sm" ff="monospace" fw={600}>
          {c.getValue<string>()}
        </Text>
      ),
    },
    { id: 'parent', header: t('interfaces.col.parent'), accessorFn: (i) => i.parent ?? '' },
    {
      id: 'ip',
      header: t('vlans.col.gateway'),
      accessorFn: (i) => i.ipv4.map((a) => `${a.ip}/${a.prefix}`).join(' '),
    },
    { id: 'role', header: t('interfaces.col.role'), accessorFn: (i) => i.role ?? '' },
    { id: 'vdom', header: 'VDOM', accessorFn: (i) => i.context ?? '' },
    {
      id: 'description',
      header: t('ports.col.description'),
      accessorFn: (i) => i.description ?? i.alias ?? '',
    },
    {
      id: 'src',
      header: '',
      enableSorting: false,
      cell: (c) => <SourceButton src={c.row.original.src} />,
    },
  ];
  return (
    <Stack gap="md" p="md" data-testid="view-vlans">
      <DataTable name="vlans" data={data} columns={columns} getRowId={(i) => i.name} />
    </Stack>
  );
}

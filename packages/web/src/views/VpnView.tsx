import { Badge, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type { IpsecPhase2, IpsecTunnel, LogicalContext } from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from './DataTable';
import { SourceButton, Value } from './source';

/** IPsec tunnels of a VDOM: phase 1 and its phase 2, with the defaults marked. */
export function VpnView({ context }: { context: LogicalContext }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const tunnel = context.ipsec.find((x) => x.name === selected) ?? null;

  const columns = useMemo<ColumnDef<IpsecTunnel, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('vpn.col.name'),
        accessorFn: (x) => x.name,
        cell: (c) => (
          <Text span size="sm" ff="monospace" fw={600}>
            {c.getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'type',
        header: t('vpn.col.type'),
        accessorFn: (x) => t(`vpn.type.${x.type}`, { defaultValue: x.type }),
        cell: (c) => (
          <Value element={c.row.original} field="type">
            {c.getValue<string>()}
          </Value>
        ),
      },
      { id: 'interface', header: t('vpn.col.interface'), accessorFn: (x) => x.interface ?? '' },
      {
        id: 'remote',
        header: t('vpn.col.remote'),
        accessorFn: (x) =>
          x.remoteGw ?? x.remoteGwDdns ?? (x.type === 'dynamic' ? t('vpn.dialup') : ''),
      },
      {
        id: 'ike',
        header: 'IKE',
        accessorFn: (x) => `v${x.ikeVersion}`,
        cell: (c) => (
          <Value element={c.row.original} field="ikeVersion">
            {c.getValue<string>()}
          </Value>
        ),
      },
      {
        id: 'advpn',
        header: 'ADVPN',
        accessorFn: (x) => (x.advpn ? t(`vpn.advpn.${x.advpn}`) : ''),
      },
      {
        id: 'proposals',
        header: t('vpn.col.proposals'),
        accessorFn: (x) => x.proposals.join(' '),
        cell: (c) => (
          <Value element={c.row.original} field="proposals">
            {c.getValue<string>()}
          </Value>
        ),
      },
      { id: 'phase2', header: t('vpn.col.phase2'), accessorFn: (x) => x.phase2.length },
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.src} />,
      },
    ],
    [t],
  );

  return (
    <Stack gap="md" p="md" data-testid="view-vpn">
      <DataTable
        name="tunnels"
        data={context.ipsec}
        columns={columns}
        getRowId={(x) => x.name}
        selectedId={selected}
        onRowClick={(x) => setSelected(x.name)}
        height={320}
        empty={t('vpn.none')}
      />
      {tunnel && <TunnelDetail tunnel={tunnel} />}
    </Stack>
  );
}

function TunnelDetail({ tunnel }: { tunnel: IpsecTunnel }) {
  const { t } = useTranslation();
  const flag = (value: boolean) => (value ? t('routing.yes') : t('routing.no'));
  const rows: [string, React.ReactNode][] = [
    [
      t('vpn.col.type'),
      <Value key="type" element={tunnel} field="type">
        {t(`vpn.type.${tunnel.type}`, { defaultValue: tunnel.type })}
      </Value>,
    ],
    [t('vpn.col.interface'), tunnel.interface ?? '—'],
    [t('vpn.col.remote'), tunnel.remoteGw ?? tunnel.remoteGwDdns ?? t('vpn.dialup')],
    ['IKE', <Value key="ike" element={tunnel} field="ikeVersion">{`v${tunnel.ikeVersion}`}</Value>],
    [
      t('vpn.col.proposals'),
      <Value key="p" element={tunnel} field="proposals">
        {tunnel.proposals.join(' ')}
      </Value>,
    ],
    [
      t('vpn.dhgrp'),
      <Value key="dh" element={tunnel} field="dhgrp">
        {tunnel.dhgrp.join(' ')}
      </Value>,
    ],
    [
      t('vpn.peertype'),
      <Value key="pt" element={tunnel} field="peertype">
        {tunnel.peertype ?? ''}
      </Value>,
    ],
    [
      t('vpn.netDevice'),
      <Value key="nd" element={tunnel} field="netDevice">
        {flag(tunnel.netDevice)}
      </Value>,
    ],
    [
      t('vpn.addRoute'),
      <Value key="ar" element={tunnel} field="addRoute">
        {flag(tunnel.addRoute)}
      </Value>,
    ],
    [
      'DPD',
      <Value key="dpd" element={tunnel} field="dpd">
        {tunnel.dpd ?? ''}
      </Value>,
    ],
    ['ADVPN', tunnel.advpn ? t(`vpn.advpn.${tunnel.advpn}`) : '—'],
  ];
  return (
    <Paper withBorder p="sm" data-testid="tunnel-detail" data-name={tunnel.name}>
      <Group justify="space-between" mb="xs">
        <Title order={5} ff="monospace">
          {tunnel.name}
        </Title>
        <SourceButton src={tunnel.src} />
      </Group>
      <Table fz="sm" verticalSpacing={2} withRowBorders={false} mb="sm">
        <Table.Tbody>
          {rows.map(([label, value]) => (
            <Table.Tr key={label}>
              <Table.Td c="dimmed" w={190}>
                {label}
              </Table.Td>
              <Table.Td>{value}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="sm" fw={600} mb={4}>
        {t('vpn.phase2Title', { count: tunnel.phase2.length })}
      </Text>
      {tunnel.phase2.length === 0 ? (
        <Text size="sm" c="orange">
          {t('vpn.noPhase2')}
        </Text>
      ) : (
        <Table fz="sm" verticalSpacing={2} withTableBorder data-testid="phase2">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('vpn.col.name')}</Table.Th>
              <Table.Th>{t('vpn.selectors')}</Table.Th>
              <Table.Th>{t('vpn.col.proposals')}</Table.Th>
              <Table.Th>{t('vpn.pfsDh')}</Table.Th>
              <Table.Th>{t('vpn.autoNegotiate')}</Table.Th>
              <Table.Th>{t('vpn.keylife')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tunnel.phase2.map((p: IpsecPhase2) => (
              <Table.Tr key={p.name}>
                <Table.Td ff="monospace">{p.name}</Table.Td>
                <Table.Td ff="monospace">
                  {p.srcSubnet ?? '0.0.0.0/0'} → {p.dstSubnet ?? '0.0.0.0/0'}
                </Table.Td>
                <Table.Td>
                  <Value element={p} field="proposals">
                    {p.proposals.join(' ')}
                  </Value>
                </Table.Td>
                <Table.Td>
                  <Value element={p} field="pfs">
                    {flag(p.pfs)}
                  </Value>{' '}
                  <Value element={p} field="dhgrp">
                    {p.dhgrp.join(' ')}
                  </Value>
                </Table.Td>
                <Table.Td>
                  <Value element={p} field="autoNegotiate">
                    {flag(p.autoNegotiate)}
                  </Value>
                </Table.Td>
                <Table.Td>
                  <Value element={p} field="keylifeSeconds">
                    {p.keylifeSeconds ?? ''}
                  </Value>
                </Table.Td>
                <Table.Td>
                  <SourceButton src={p.src} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {tunnel.unverified && tunnel.unverified.length > 0 && (
        <Badge mt="xs" color="orange" variant="light" tt="none">
          {t('vpn.unverified')}
        </Badge>
      )}
    </Paper>
  );
}

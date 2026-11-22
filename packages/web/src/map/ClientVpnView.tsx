// The VPN of a client (#15, part 2; chapter 5.2 of the study): every IPsec tunnel with its two
// ends, the ADVPN shortcuts seen in the shows, how the two sides compare and, for ADVPN, the
// roles, the checks and every pair of branches. The detail of a tunnel is the one of the map.

import { Badge, Box, Paper, ScrollArea, Stack, Table, Text, Title } from '@mantine/core';
import type { AdvpnPairStatus, Infrastructure, Link, Problem } from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MapFocus } from '../state/infra';
import { DataTable } from '../views/DataTable';
import { problemsSummary, problemText, ProblemItem, SEVERITY_COLOR } from '../views/problems';
import { DeviceViewContext, type DeviceViewApi } from '../views/source';
import { comparisonText, endLabel, side, type ModelOf } from './details';
import { LinkPanel } from './panels';

export interface ClientVpnViewProps {
  infra: Infrastructure;
  modelOf: ModelOf;
  onOpenFile(id: string, line?: number): void;
  /** Opens the map of the client on a link: the BGP session that a tunnel carries. */
  onOpenMap(focus: MapFocus): void;
  /** Base of the names of the exported files. */
  exportName: string;
}

const PAIR_COLOR: Record<AdvpnPairStatus, string> = {
  active: 'teal',
  possible: 'gray',
  impossible: 'red',
};

/** The checks of ADVPN: roles of the tunnels, policies, next hop and route reflection. */
const ADVPN_CODES = new Set<Problem['code']>([
  'ipsec-advpn',
  'advpn-hub-policy',
  'advpn-spoke-policy',
  'advpn-next-hop',
  'advpn-no-rr',
]);

type Pair = Infrastructure['advpn']['pairs'][number];

export default function ClientVpnView({
  infra,
  modelOf,
  onOpenFile,
  onOpenMap,
  exportName,
}: ClientVpnViewProps) {
  const { t } = useTranslation();
  const tunnels = useMemo(
    () => infra.links.filter((l) => l.kind === 'ipsec' || l.kind === 'shortcut'),
    [infra.links],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const current = tunnels.find((l) => l.id === selected);
  // The detail is under the list of the tunnels: chosen from further down, the page goes to it.
  const panel = useRef<HTMLDivElement>(null);
  const host = (key: string) =>
    infra.devices.find((d) => d.key === key)?.hostname ??
    infra.externals.find((e) => e.id === key)?.label ??
    key;
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
      openMap: onOpenMap,
    }),
    [onOpenFile, onOpenMap, exportName, infra],
  );

  const columns = useMemo<ColumnDef<Link, unknown>[]>(() => {
    const problems = new Map<string, Problem[]>();
    for (const p of infra.problems) {
      if (p.link) problems.set(p.link, [...(problems.get(p.link) ?? []), p]);
    }
    const end = (which: 'a' | 'b') => (l: Link) => {
      const s = side(infra, l[which], modelOf);
      return [s.name, endLabel(s.end), s.end.tunnel ? s.end.interface : '']
        .filter(Boolean)
        .join(' · ');
    };
    const type = (l: Link) => {
      if (l.kind === 'shortcut') return t('vpnClient.type.shortcut');
      if (l.dialup) return t('vpnClient.type.dialup');
      const own = modelOf(l.a.node)
        ?.contexts.find((c) => c.name === l.a.context)
        ?.ipsec.find((x) => x.name === l.a.tunnel);
      return own?.type === 'ddns' ? t('vpnClient.type.ddns') : t('vpnClient.type.static');
    };
    return [
      { id: 'type', header: t('vpnClient.col.type'), accessorFn: type },
      { id: 'a', header: t('map.col.a'), accessorFn: end('a') },
      { id: 'b', header: t('map.col.b'), accessorFn: end('b') },
      {
        id: 'state',
        header: t('map.col.state'),
        accessorFn: (l) =>
          l.state
            ? [l.state.a, l.state.b].map((s) => (s ? t(`map.state.${s.status}`) : '—')).join(' / ')
            : '',
      },
      {
        id: 'comparison',
        header: t('vpnClient.col.comparison'),
        accessorFn: (l) => comparisonText(l, infra, t)?.text ?? '',
        cell: (c) => {
          const cmp = comparisonText(c.row.original, infra, t);
          return cmp ? (
            <Badge
              size="sm"
              variant="light"
              tt="none"
              color={cmp.issues ? 'red' : cmp.compared ? 'teal' : 'gray'}
              data-testid="vpn-comparison"
            >
              {cmp.text}
            </Badge>
          ) : null;
        },
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

  const pairColumns = useMemo<ColumnDef<Pair, unknown>[]>(() => {
    const reasons = (p: Pair) =>
      p.reasons
        .map((id) => infra.problems.find((x) => x.id === id))
        .filter((x): x is Problem => !!x)
        .map((x) => problemText(x, t).title)
        .join('; ');
    return [
      { id: 'a', header: t('vpnClient.col.branchA'), accessorFn: (p) => host(p.a) },
      { id: 'b', header: t('vpnClient.col.branchB'), accessorFn: (p) => host(p.b) },
      { id: 'hub', header: t('vpnClient.col.hub'), accessorFn: (p) => host(p.hub) },
      {
        id: 'status',
        header: t('vpnClient.col.shortcut'),
        accessorFn: (p) => t(`vpnClient.pair.${p.status}`),
        cell: (c) => (
          <Badge
            size="sm"
            variant="light"
            tt="none"
            color={PAIR_COLOR[c.row.original.status]}
            data-testid="advpn-pair-status"
            data-status={c.row.original.status}
          >
            {c.getValue<string>()}
          </Badge>
        ),
      },
      {
        id: 'why',
        header: t('vpnClient.col.why'),
        accessorFn: (p) =>
          p.status === 'impossible'
            ? reasons(p) || t('vpnClient.pair.down')
            : p.status === 'possible'
              ? t('vpnClient.pair.possibleWhy')
              : t('vpnClient.pair.activeWhy'),
      },
    ];
    // host reads only infra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infra, t]);

  const shortcutOf = (p: Pair) =>
    tunnels.find(
      (l) =>
        l.kind === 'shortcut' &&
        ((l.a.node === p.a && l.b.node === p.b) || (l.a.node === p.b && l.b.node === p.a)),
    );
  const advpn = infra.advpn;
  const advpnProblems = infra.problems.filter((p) => ADVPN_CODES.has(p.code));
  const ipsec = tunnels.filter((l) => l.kind === 'ipsec').length;
  const select = (id: string) => {
    if (tunnels.some((l) => l.id === id)) setSelected(id);
    else onOpenMap({ kind: 'link', id });
  };

  return (
    <DeviceViewContext.Provider value={api}>
      <ScrollArea h="calc(100dvh - var(--app-shell-header-height, 56px))" type="auto">
        <Stack p="md" gap="sm" data-testid="vpn-view">
          <Box>
            <Title order={3}>{t('vpnClient.title')}</Title>
            <Text size="sm" c="dimmed" data-testid="vpn-summary">
              {t('vpnClient.summary', {
                tunnels: t('vpnClient.tunnels', { count: ipsec }),
                shortcuts: t('vpnClient.shortcuts', { count: tunnels.length - ipsec }),
              })}
            </Text>
          </Box>
          <DataTable
            name="vpn-tunnels"
            data={tunnels}
            columns={columns}
            getRowId={(l) => l.id}
            selectedId={current?.id ?? null}
            onRowClick={(l) => setSelected(l.id)}
            height={360}
            empty={t('vpnClient.none')}
          />
          <Paper withBorder p="sm" data-testid="vpn-panel" ref={panel}>
            {current ? (
              <LinkPanel
                link={current}
                infra={infra}
                modelOf={modelOf}
                onOpenFile={onOpenFile}
                onSelectLink={select}
              />
            ) : (
              <Text size="sm" c="dimmed">
                {t('vpnClient.hint')}
              </Text>
            )}
          </Paper>
          {(advpn.hubs.length > 0 || advpn.spokes.length > 0) && (
            <Stack gap="sm" data-testid="advpn">
              <Title order={4}>{t('vpnClient.advpn.title')}</Title>
              <Text size="sm">{t('vpnClient.advpn.intro')}</Text>
              <Paper withBorder p="sm">
                <Title order={5} mb="xs">
                  {t('vpnClient.advpn.roles')}
                </Title>
                <Table fz="sm" withTableBorder data-testid="advpn-roles">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t('vpnClient.col.device')}</Table.Th>
                      <Table.Th>{t('vpnClient.col.role')}</Table.Th>
                      <Table.Th>{t('vpnClient.col.tunnels')}</Table.Th>
                      <Table.Th>{t('vpnClient.col.hub')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {advpn.hubs.map((h) => (
                      <Table.Tr
                        key={`hub-${h.device}-${h.context}`}
                        data-testid="advpn-role"
                        data-device={host(h.device)}
                        data-role="hub"
                      >
                        <Table.Td fw={600}>
                          {host(h.device)}
                          {modelOf(h.device)?.contexts.length !== 1 ? ` (${h.context})` : ''}
                        </Table.Td>
                        <Table.Td>{t('vpn.advpn.sender')}</Table.Td>
                        <Table.Td ff="monospace">{h.tunnels.join(', ')}</Table.Td>
                        <Table.Td>—</Table.Td>
                      </Table.Tr>
                    ))}
                    {advpn.spokes.map((s) => (
                      <Table.Tr
                        key={`spoke-${s.device}-${s.hub}`}
                        data-testid="advpn-role"
                        data-device={host(s.device)}
                        data-role="spoke"
                      >
                        <Table.Td fw={600}>{host(s.device)}</Table.Td>
                        <Table.Td>{t('vpn.advpn.receiver')}</Table.Td>
                        <Table.Td ff="monospace">{s.tunnels.join(', ')}</Table.Td>
                        <Table.Td>{host(s.hub)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Paper>
              <Paper withBorder p="sm" data-testid="advpn-checks">
                <Title order={5} mb="xs">
                  {t('vpnClient.advpn.checks')}
                </Title>
                {advpnProblems.length === 0 ? (
                  <Text size="sm" c="teal" data-testid="advpn-checks-ok">
                    {t('vpnClient.advpn.checksOk')}
                  </Text>
                ) : (
                  <Stack gap={6}>
                    {advpnProblems.map((p) => (
                      <ProblemItem key={p.id} problem={p} />
                    ))}
                  </Stack>
                )}
              </Paper>
              <Box>
                <Title order={5} mb={4}>
                  {t('vpnClient.advpn.pairs')}
                </Title>
                <DataTable
                  name="advpn-pairs"
                  data={advpn.pairs}
                  columns={pairColumns}
                  getRowId={(p) => `${p.a}|${p.b}|${p.hub}`}
                  onRowClick={(p) => {
                    const shortcut = shortcutOf(p);
                    if (!shortcut) return;
                    setSelected(shortcut.id);
                    panel.current?.scrollIntoView({ block: 'start' });
                  }}
                  height={260}
                  empty={t('vpnClient.advpn.noPairs')}
                />
              </Box>
            </Stack>
          )}
        </Stack>
      </ScrollArea>
    </DeviceViewContext.Provider>
  );
}

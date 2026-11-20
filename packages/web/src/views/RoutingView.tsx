import {
  Badge,
  Box,
  CloseButton,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import {
  configRoutes,
  isIpv4,
  lookupRoute,
  type BgpNeighbor,
  type ConfigRoute,
  type DeviceModel,
  type Ospf,
  type PolicyRoute,
  type PrefixList,
  type PrefixListEntry,
  type RouteMap,
  type RouteMapEntry,
} from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from './DataTable';
import { SourceButton } from './source';
import { formatRoutePrefix, shortInterfaceName } from './values';

export function RoutingView({ model }: { model: DeviceModel }) {
  const { t } = useTranslation();
  const routing = model.contexts[0]!.routing;
  const routes = useMemo(() => configRoutes(model), [model]);
  const [query, setQuery] = useState('');
  const ip = isIpv4(query.trim()) ? query.trim() : null;
  const best = useMemo(() => new Set(ip ? lookupRoute(routes, ip) : []), [ip, routes]);

  const routeColumns = useMemo<ColumnDef<ConfigRoute, unknown>[]>(
    () => [
      {
        id: 'prefix',
        header: t('routing.col.prefix'),
        accessorFn: (r) => formatRoutePrefix(r.prefix),
        cell: (c) => (
          <Text span size="sm" ff="monospace">
            {c.getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'type',
        header: t('routing.col.type'),
        accessorFn: (r) => t(`routing.type.${r.type}`),
        cell: (c) => (
          <Group gap={4} wrap="nowrap">
            <Text span size="sm">
              {c.getValue<string>()}
            </Text>
            {c.row.original.inactive && (
              <Badge size="xs" color="gray" variant="light" tt="none">
                {t('routing.inactive')}
              </Badge>
            )}
          </Group>
        ),
      },
      { id: 'gateway', header: t('routing.col.gateway'), accessorFn: (r) => r.gateway ?? '' },
      {
        id: 'interface',
        header: t('routing.col.interface'),
        accessorFn: (r) => (r.interface ? shortInterfaceName(r.interface) : ''),
      },
      { id: 'distance', header: t('routing.col.distance'), accessorFn: (r) => r.distance },
      { id: 'vrf', header: 'VRF', accessorFn: (r) => r.vrf ?? '' },
      { id: 'name', header: t('routing.col.name'), accessorFn: (r) => r.name ?? '' },
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
    <Stack gap="md" p="md" data-testid="view-routing">
      <Box>
        <Title order={5} mb={4}>
          {t('routing.configRoutes')}
        </Title>
        <Text size="xs" c="dimmed" mb="xs">
          {t('routing.configRoutesHelp')}
        </Text>
        <DataTable
          name="routes"
          data={routes}
          columns={routeColumns}
          getRowId={(r) =>
            `${r.vrf ?? ''}|${formatRoutePrefix(r.prefix)}|${r.type}|${r.interface ?? ''}|${r.gateway ?? ''}`
          }
          rowState={(r) => (ip ? (best.has(r) ? 'match' : 'dim') : null)}
          height={320}
          toolbar={
            <TextInput
              size="xs"
              w={220}
              leftSection={<IconSearch size={14} />}
              placeholder={t('routing.lookup')}
              aria-label={t('routing.lookup')}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              rightSection={
                query ? (
                  <CloseButton
                    size="xs"
                    aria-label={t('viewer.clearFilter')}
                    onClick={() => setQuery('')}
                  />
                ) : null
              }
              data-testid="route-lookup"
            />
          }
        />
        {ip && best.size === 0 && (
          <Text size="sm" c="orange" mt={4} data-testid="route-lookup-none">
            {t('routing.noRoute', { ip })}
          </Text>
        )}
      </Box>

      {routing.policyRoutes.length > 0 && (
        <PolicyRoutes routes={routing.policyRoutes} routeMaps={routing.routeMaps} />
      )}
      {routing.ospf.map((o) => (
        <OspfView key={o.process ?? ''} ospf={o} />
      ))}
      {routing.bgp && <BgpView model={model} />}
      {routing.routeMaps.length > 0 && <RouteMaps routeMaps={routing.routeMaps} />}
      {routing.prefixLists.length > 0 && <PrefixLists lists={routing.prefixLists} />}
    </Stack>
  );
}

function Section({
  title,
  src,
  children,
  testId,
}: {
  title: ReactNode;
  src?: DeviceModel['stack'][number]['src'];
  children: ReactNode;
  testId: string;
}) {
  return (
    <Paper withBorder p="sm" data-testid={testId}>
      <Group justify="space-between" mb="xs">
        <Title order={5}>{title}</Title>
        {src && <SourceButton src={src} />}
      </Group>
      {children}
    </Paper>
  );
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mb="xs">
      {items.map(([label, value]) => (
        <Box key={label}>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
          <Text size="sm">{value ?? '—'}</Text>
        </Box>
      ))}
    </SimpleGrid>
  );
}

function PolicyRoutes({ routes, routeMaps }: { routes: PolicyRoute[]; routeMaps: RouteMap[] }) {
  const { t } = useTranslation();
  const columns: ColumnDef<PolicyRoute, unknown>[] = [
    {
      id: 'interface',
      header: t('routing.col.interface'),
      accessorFn: (p) => (p.interface ? shortInterfaceName(p.interface) : ''),
    },
    { id: 'routeMap', header: t('routing.col.routeMap'), accessorFn: (p) => p.routeMap ?? '' },
    {
      id: 'rules',
      header: t('routing.col.rules'),
      accessorFn: (p) =>
        routeMaps
          .find((r) => r.name === p.routeMap)
          ?.entries.map((e) =>
            [...e.match.map((m) => `match ${m}`), ...e.set.map((s) => `set ${s}`)].join(' · '),
          )
          .join(' | ') ?? '',
    },
    {
      id: 'src',
      header: '',
      enableSorting: false,
      cell: (c) => <SourceButton src={c.row.original.src} />,
    },
  ];
  return (
    <Section title={t('routing.policyRoutes')} testId="policy-routes">
      <DataTable
        name="policy-routes"
        data={routes}
        columns={columns}
        getRowId={(p) => `${p.interface}|${p.routeMap}`}
        filter={false}
        height={200}
      />
    </Section>
  );
}

function OspfView({ ospf }: { ospf: Ospf }) {
  const { t } = useTranslation();
  const interfaces: ColumnDef<Ospf['interfaces'][number], unknown>[] = [
    {
      id: 'name',
      header: t('routing.col.interface'),
      accessorFn: (i) => shortInterfaceName(i.name),
    },
    { id: 'area', header: t('routing.col.area'), accessorFn: (i) => i.area ?? '' },
    {
      id: 'passive',
      header: t('routing.col.passive'),
      accessorFn: (i) => (i.passive ? t('routing.yes') : t('routing.no')),
    },
    { id: 'cost', header: t('routing.col.cost'), accessorFn: (i) => i.cost ?? '' },
    {
      id: 'src',
      header: '',
      enableSorting: false,
      cell: (c) => <SourceButton src={c.row.original.src} />,
    },
  ];
  return (
    <Section
      title={t('routing.ospf.title', { process: ospf.process ?? '' })}
      src={ospf.src}
      testId="ospf"
    >
      <Facts
        items={[
          [t('routing.routerId'), ospf.routerId],
          [
            t('routing.ospf.passiveDefault'),
            ospf.passiveDefault ? t('routing.yes') : t('routing.no'),
          ],
          [
            t('routing.ospf.networks'),
            ospf.networks
              .map((n) => `${n.prefix} (${t('routing.ospf.area', { area: n.area })})`)
              .join(', '),
          ],
          [
            t('routing.redistribute'),
            ospf.redistribute
              .map((r) => (r.routeMap ? `${r.protocol} (${r.routeMap})` : r.protocol))
              .join(', '),
          ],
        ]}
      />
      <DataTable
        name="ospf-interfaces"
        data={ospf.interfaces}
        columns={interfaces}
        getRowId={(i) => i.name}
        filter={false}
        height={240}
      />
    </Section>
  );
}

function BgpView({ model }: { model: DeviceModel }) {
  const { t } = useTranslation();
  const bgp = model.contexts[0]!.routing.bgp!;
  const columns: ColumnDef<BgpNeighbor, unknown>[] = [
    { id: 'address', header: t('routing.bgp.neighbor'), accessorFn: (n) => n.address },
    {
      id: 'remoteAs',
      header: t('routing.bgp.remoteAs'),
      accessorFn: (n) =>
        n.remoteAs ?? bgp.groups.find((g) => g.address === n.group)?.remoteAs ?? '',
    },
    { id: 'group', header: t('routing.bgp.group'), accessorFn: (n) => n.group ?? '' },
    {
      id: 'description',
      header: t('routing.col.description'),
      accessorFn: (n) => n.description ?? '',
    },
    {
      id: 'in',
      header: t('routing.bgp.in'),
      accessorFn: (n) => [n.routeMapIn, n.prefixListIn].filter(Boolean).join(' · '),
    },
    {
      id: 'out',
      header: t('routing.bgp.out'),
      accessorFn: (n) => [n.routeMapOut, n.prefixListOut].filter(Boolean).join(' · '),
    },
    { id: 'vrf', header: 'VRF', accessorFn: (n) => n.vrf ?? '' },
    {
      id: 'state',
      header: t('routing.col.state'),
      accessorFn: (n) => (n.shutdown ? t('routing.bgp.shutdown') : ''),
    },
    {
      id: 'src',
      header: '',
      enableSorting: false,
      cell: (c) => <SourceButton src={c.row.original.src} />,
    },
  ];
  return (
    <Section title={t('routing.bgp.title', { asn: bgp.asn })} src={bgp.src} testId="bgp">
      <Facts
        items={[
          [t('routing.routerId'), bgp.routerId],
          [t('routing.bgp.networks'), bgp.networks.map((n) => n.prefix).join(', ')],
          [
            t('routing.redistribute'),
            bgp.redistribute
              .map((r) => (r.routeMap ? `${r.protocol} (${r.routeMap})` : r.protocol))
              .join(', '),
          ],
          [t('routing.bgp.groups'), bgp.groups.map((g) => g.address).join(', ')],
        ]}
      />
      <DataTable
        name="bgp-neighbors"
        data={[...bgp.groups, ...bgp.neighbors]}
        columns={columns}
        getRowId={(n) => `${n.vrf ?? ''}|${n.address}`}
        height={280}
      />
    </Section>
  );
}

function RouteMaps({ routeMaps }: { routeMaps: RouteMap[] }) {
  const { t } = useTranslation();
  type Row = RouteMapEntry & { name: string };
  const rows: Row[] = routeMaps.flatMap((r) => r.entries.map((e) => ({ ...e, name: r.name })));
  const columns: ColumnDef<Row, unknown>[] = [
    { id: 'name', header: t('routing.col.name'), accessorFn: (e) => e.name },
    { id: 'seq', header: t('routing.col.seq'), accessorFn: (e) => e.seq ?? '' },
    { id: 'action', header: t('routing.col.action'), accessorFn: (e) => e.action },
    { id: 'match', header: t('routing.col.match'), accessorFn: (e) => e.match.join(' · ') },
    { id: 'set', header: t('routing.col.set'), accessorFn: (e) => e.set.join(' · ') },
    {
      id: 'src',
      header: '',
      enableSorting: false,
      cell: (c) => <SourceButton src={c.row.original.src} />,
    },
  ];
  return (
    <Section title={t('routing.routeMaps')} testId="route-maps">
      <DataTable
        name="route-maps"
        data={rows}
        columns={columns}
        getRowId={(e) => `${e.name}|${e.seq ?? e.src[0]?.[0]}`}
        height={260}
      />
    </Section>
  );
}

function PrefixLists({ lists }: { lists: PrefixList[] }) {
  const { t } = useTranslation();
  type Row = PrefixListEntry & { name: string };
  const rows: Row[] = lists.flatMap((l) => l.entries.map((e) => ({ ...e, name: l.name })));
  const columns: ColumnDef<Row, unknown>[] = [
    { id: 'name', header: t('routing.col.name'), accessorFn: (e) => e.name },
    { id: 'seq', header: t('routing.col.seq'), accessorFn: (e) => e.seq ?? '' },
    { id: 'action', header: t('routing.col.action'), accessorFn: (e) => e.action },
    { id: 'prefix', header: t('routing.col.prefix'), accessorFn: (e) => e.prefix },
    { id: 'ge', header: 'ge', accessorFn: (e) => e.ge ?? '' },
    { id: 'le', header: 'le', accessorFn: (e) => e.le ?? '' },
    {
      id: 'src',
      header: '',
      enableSorting: false,
      cell: (c) => <SourceButton src={c.row.original.src} />,
    },
  ];
  return (
    <Section title={t('routing.prefixLists')} testId="prefix-lists">
      <DataTable
        name="prefix-lists"
        data={rows}
        columns={columns}
        getRowId={(e) => `${e.name}|${e.seq ?? e.src[0]?.[0]}`}
        height={260}
      />
    </Section>
  );
}

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
  bgpPeerLive,
  configRoutes,
  ipToInt,
  isIpv4,
  lookupRoute,
  parsePrefix,
  prefixContains,
  type BgpNeighbor,
  type BgpPeerState,
  type ConfigRoute,
  type DeviceModel,
  type LogicalContext,
  type Ospf,
  type PolicyRoute,
  type PrefixList,
  type PrefixListEntry,
  type RouteMap,
  type RouteMapEntry,
  type RouteState,
} from '@ncv/core';
import type { CellContext, ColumnDef } from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Peer } from '../state/infra';
import { DataTable } from './DataTable';
import { PeerLinks } from './peers';
import { ShowSourceButton, SourceButton, useDeviceView } from './source';
import { formatRoutePrefix, FULL_LABEL, shortInterfaceName } from './values';

export function RoutingView({ model, context }: { model: DeviceModel; context: LogicalContext }) {
  const { t } = useTranslation();
  const routing = context.routing;
  const routes = useMemo(() => configRoutes(model, context.name), [model, context]);
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
      {
        id: 'gateway',
        header: t('routing.col.gateway'),
        accessorFn: (r) =>
          r.gateway ?? (r.sdwanZones ? t('routing.sdwan', { zones: r.sdwanZones.join(', ') }) : ''),
      },
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

      <LiveRoutes context={context} />
      {routing.policyRoutes.length > 0 && (
        <PolicyRoutes routes={routing.policyRoutes} routeMaps={routing.routeMaps} />
      )}
      {routing.ospf.map((o) => (
        <OspfView key={o.process ?? ''} ospf={o} />
      ))}
      {routing.bgp && <BgpView context={context} />}
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
  const rules = (p: PolicyRoute) => {
    if (!p.routeMap) {
      const protocol = p.protocol ? ` (${p.protocol})` : '';
      return `${p.srcaddr.join(', ') || 'any'} → ${p.dstaddr.join(', ') || 'any'}${protocol}`;
    }
    const entries = routeMaps
      .find((r) => r.name === p.routeMap)
      ?.entries.map((e) =>
        [...e.match.map((m) => `match ${m}`), ...e.set.map((x) => `set ${x}`)].join(' · '),
      )
      .join(' | ');
    return `${p.routeMap}: ${entries ?? ''}`;
  };
  const columns: ColumnDef<PolicyRoute, unknown>[] = [
    {
      id: 'interface',
      header: t('routing.col.input'),
      accessorFn: (p) =>
        p.interface ? shortInterfaceName(p.interface) : p.inputDevices.join(', '),
    },
    { id: 'rules', header: t('routing.col.rules'), accessorFn: rules },
    {
      id: 'output',
      header: t('routing.col.output'),
      accessorFn: (p) => [p.gateway, p.outputDevice].filter(Boolean).join(' · '),
    },
    {
      id: 'state',
      header: t('routing.col.state'),
      accessorFn: (p) => (p.enabled === false ? t('policies.disabled') : ''),
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
        getRowId={(p) => `${p.id ?? ''}|${p.interface ?? ''}|${p.routeMap ?? ''}|${p.src[0]?.[0]}`}
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

function BgpView({ context }: { context: LogicalContext }) {
  const { t } = useTranslation();
  const bgp = context.routing.bgp!;
  const { state, peers } = useDeviceView();
  // The other side of a session, from the map of the client (#15): a neighbour, or the
  // devices that fall in the neighbour range of a group.
  const session = (n: BgpNeighbor) => (p: Peer) =>
    p.link.kind === 'bgp' &&
    p.here.context === context.name &&
    (p.here.neighbor === n.address || p.here.range?.group === n.address);
  const sessionPeers = (n: BgpNeighbor) => peers.filter(session(n));
  const peerText = (p: BgpPeerState | undefined) =>
    p
      ? p.prefixes !== undefined
        ? t('routing.bgp.established', { count: p.prefixes })
        : p.state
      : '';
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
    ...(peers.some((p) => p.link.kind === 'bgp')
      ? [
          {
            id: 'peer',
            header: t('routing.bgp.peer'),
            accessorFn: (n: BgpNeighbor) =>
              sessionPeers(n)
                .map((p) => p.name)
                .join(', '),
            cell: (c: CellContext<BgpNeighbor, unknown>) => (
              <PeerLinks match={session(c.row.original)} />
            ),
          },
        ]
      : []),
    {
      id: 'state',
      header: t('routing.col.state'),
      accessorFn: (n) =>
        n.shutdown
          ? t('routing.bgp.shutdown')
          : peerText(bgpPeerLive(n.address, state, context.name)),
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
      {state && <BgpPeers context={context} groups={bgp.ranges} />}
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

/** BGP sessions in the shows: also the dynamic neighbours of the ranges of a hub. */
function BgpPeers({
  context,
  groups,
}: {
  context: LogicalContext;
  groups: { prefix: string; group: string }[];
}) {
  const { t } = useTranslation();
  const { state } = useDeviceView();
  const peers = (state?.bgp ?? []).filter((p) => !p.context || p.context === context.name);
  if (peers.length === 0) return null;
  const groupOf = (ip: string) => {
    const value = ipToInt(ip);
    return groups.find((g) => {
      const p = parsePrefix(g.prefix);
      return p && value !== null && prefixContains(p, value);
    })?.group;
  };
  const columns: ColumnDef<BgpPeerState, unknown>[] = [
    { id: 'neighbor', header: t('routing.bgp.neighbor'), accessorFn: (p) => p.neighbor },
    { id: 'as', header: t('routing.bgp.remoteAs'), accessorFn: (p) => p.remoteAs ?? '' },
    { id: 'group', header: t('routing.bgp.group'), accessorFn: (p) => groupOf(p.neighbor) ?? '' },
    {
      id: 'state',
      header: t('routing.col.state'),
      accessorFn: (p) => p.state,
      cell: (c) => {
        const p = c.row.original;
        return (
          <Badge
            size="sm"
            variant="dot"
            color={p.prefixes !== undefined ? 'teal' : 'red'}
            tt="none"
            styles={FULL_LABEL}
            data-testid="bgp-peer-state"
          >
            {p.prefixes !== undefined
              ? t('routing.bgp.established', { count: p.prefixes })
              : p.state}
          </Badge>
        );
      },
    },
    { id: 'upDown', header: t('routing.bgp.upDown'), accessorFn: (p) => p.upDown ?? '' },
    {
      id: 'src',
      header: '',
      enableSorting: false,
      cell: (c) => <ShowSourceButton item={c.row.original} />,
    },
  ];
  return (
    <Box mt="sm" data-testid="bgp-peers">
      <Text size="sm" fw={600} mb={4}>
        {t('routing.bgp.sessions')}
      </Text>
      <DataTable
        name="bgp-peers"
        data={peers}
        columns={columns}
        getRowId={(p) => p.neighbor}
        filter={false}
        height={240}
      />
    </Box>
  );
}

/** The routing table in the shows, with the route used for an IP. */
function LiveRoutes({ context }: { context: LogicalContext }) {
  const { t } = useTranslation();
  const { state } = useDeviceView();
  const [query, setQuery] = useState('');
  const routes = useMemo(
    () => (state?.routes ?? []).filter((r) => !r.context || r.context === context.name),
    [state, context],
  );
  const ip = isIpv4(query.trim()) ? ipToInt(query.trim()) : null;
  const best = useMemo(() => {
    if (ip === null) return new Set<RouteState>();
    let length = -1;
    let found: RouteState[] = [];
    for (const r of routes) {
      const p = parsePrefix(r.prefix);
      if (!p || !prefixContains(p, ip)) continue;
      if (p.prefix > length) {
        length = p.prefix;
        found = [r];
      } else if (p.prefix === length) found.push(r);
    }
    return new Set(found);
  }, [ip, routes]);
  if (routes.length === 0) return null;
  const columns: ColumnDef<RouteState, unknown>[] = [
    { id: 'code', header: t('routing.col.code'), accessorFn: (r) => r.code },
    {
      id: 'prefix',
      header: t('routing.col.prefix'),
      accessorFn: (r) => r.prefix,
      cell: (c) => (
        <Text span size="sm" ff="monospace">
          {c.getValue<string>()}
        </Text>
      ),
    },
    { id: 'gateway', header: t('routing.col.gateway'), accessorFn: (r) => r.gateway ?? '' },
    { id: 'interface', header: t('routing.col.interface'), accessorFn: (r) => r.interface ?? '' },
    {
      id: 'distance',
      header: t('routing.col.distanceMetric'),
      accessorFn: (r) => (r.distance !== undefined ? `${r.distance}/${r.metric ?? 0}` : ''),
    },
    { id: 'age', header: t('routing.col.age'), accessorFn: (r) => r.age ?? '' },
    {
      id: 'src',
      header: '',
      enableSorting: false,
      cell: (c) => <ShowSourceButton item={c.row.original} />,
    },
  ];
  return (
    <Box data-testid="live-routes">
      <Title order={5} mb={4}>
        {t('routing.liveRoutes')}
      </Title>
      <Text size="xs" c="dimmed" mb="xs">
        {t('routing.liveRoutesHelp')}
      </Text>
      <DataTable
        name="live-routes"
        data={routes}
        columns={columns}
        getRowId={(r) => `${r.prefix}|${r.gateway ?? ''}|${r.interface ?? ''}|${r.src[0]?.[0]}`}
        rowState={(r) => (ip !== null ? (best.has(r) ? 'match' : 'dim') : null)}
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
            data-testid="live-route-lookup"
          />
        }
      />
    </Box>
  );
}

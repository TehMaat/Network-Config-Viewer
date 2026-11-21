import {
  Badge,
  Box,
  CloseButton,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import {
  aclEntryMatchesIp,
  expandObjectGroup,
  isIpv4,
  type Acl,
  type AclEntry,
  type DeviceModel,
  type IpMatch,
  type ObjectGroup,
} from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from './DataTable';
import { SourceButton, useDeviceView } from './source';
import { bindingText, formatAddress, formatGroupEntry, formatPorts } from './values';

type EntryMatch = { source: IpMatch | null; destination: IpMatch | null };

/** The IP is in the entry by itself, through a host, a subnet or a group, not only through "any". */
const isSpecific = (m: EntryMatch) =>
  (m.source !== null && m.source !== 'any') || (m.destination !== null && m.destination !== 'any');

export function AclsView({ model }: { model: DeviceModel }) {
  const { t } = useTranslation();
  const ctx = model.contexts[0]!;
  const [query, setQuery] = useState('');
  const ip = isIpv4(query.trim()) ? query.trim() : null;
  const [selected, setSelected] = useState<string | null>(ctx.acls[0]?.name ?? null);

  // Matches of the searched IP, entry by entry.
  const matches = useMemo(() => {
    const out = new Map<AclEntry, EntryMatch>();
    if (!ip) return out;
    for (const acl of ctx.acls) {
      for (const entry of acl.entries) {
        const m = aclEntryMatchesIp(entry, ip, ctx.objectGroups);
        if (m.source || m.destination) out.set(entry, m);
      }
    }
    return out;
  }, [ip, ctx]);

  // Entries that contain the IP itself, not only through "any".
  const matchCount = (acl: Acl) =>
    acl.entries.filter((e) => {
      const m = matches.get(e);
      return m !== undefined && isSpecific(m);
    }).length;
  const acl = ctx.acls.find((a) => a.name === selected) ?? null;

  const aclColumns = useMemo<ColumnDef<Acl, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('acls.col.name'),
        accessorFn: (a) => a.name,
        cell: (c) => (
          <Text span size="sm" ff="monospace" fw={600}>
            {c.getValue<string>()}
          </Text>
        ),
      },
      { id: 'type', header: t('acls.col.type'), accessorFn: (a) => t(`acls.type.${a.type}`) },
      { id: 'entries', header: t('acls.col.entries'), accessorFn: (a) => a.entries.length },
      {
        id: 'applied',
        header: t('acls.col.applied'),
        accessorFn: (a) => a.bindings.map((b) => bindingText(b, t)).join(', '),
        cell: (c) =>
          c.row.original.bindings.length === 0 ? (
            <Text span size="sm" c="orange">
              {t('acls.notApplied')}
            </Text>
          ) : (
            <Text span size="sm">
              {c.getValue<string>()}
            </Text>
          ),
      },
      ...(ip
        ? [
            {
              id: 'matches',
              header: t('acls.col.matches'),
              accessorFn: (a: Acl) => matchCount(a),
            } as ColumnDef<Acl, unknown>,
          ]
        : []),
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.src} />,
      },
    ],
    // matchCount depends on matches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, ip, matches],
  );

  return (
    <Stack gap="md" p="md" data-testid="view-acls">
      <TextInput
        w={320}
        size="sm"
        leftSection={<IconSearch size={16} />}
        label={t('acls.searchIp')}
        description={t('acls.searchIpHelp')}
        placeholder={t('acls.searchIpPlaceholder')}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        error={query.trim() && !ip ? t('acls.notAnIp') : undefined}
        rightSection={
          query ? (
            <CloseButton
              size="sm"
              aria-label={t('viewer.clearFilter')}
              onClick={() => setQuery('')}
            />
          ) : null
        }
        data-testid="acl-ip-search"
      />
      {ctx.acls.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('acls.none')}
        </Text>
      ) : (
        <DataTable
          name="acls"
          data={ctx.acls}
          columns={aclColumns}
          getRowId={(a) => a.name}
          selectedId={selected}
          onRowClick={(a) => setSelected(a.name)}
          rowState={(a) => (ip ? (matchCount(a) > 0 ? 'match' : 'dim') : null)}
          height={260}
        />
      )}
      {acl && <AclDetail acl={acl} matches={matches} searching={ip !== null} />}
      {ctx.objectGroups.length > 0 && <ObjectGroups groups={ctx.objectGroups} acls={ctx.acls} />}
    </Stack>
  );
}

function MatchBadge({ match }: { match: IpMatch | null }) {
  const { t } = useTranslation();
  if (!match) return null;
  return (
    <Badge
      size="xs"
      variant="light"
      color={match === 'any' ? 'gray' : 'teal'}
      tt="none"
      ml={4}
      data-match={match}
    >
      {t(`acls.match.${match}`)}
    </Badge>
  );
}

function AclDetail({
  acl,
  matches,
  searching,
}: {
  acl: Acl;
  matches: Map<AclEntry, EntryMatch>;
  searching: boolean;
}) {
  const { t } = useTranslation();
  const { showSource } = useDeviceView();
  const columns = useMemo<ColumnDef<AclEntry, unknown>[]>(
    () => [
      { id: 'seq', header: t('acls.col.seq'), accessorFn: (e) => e.seq ?? '' },
      {
        id: 'action',
        header: t('acls.col.action'),
        accessorFn: (e) => e.action,
        cell: (c) => {
          const e = c.row.original;
          if (e.action === 'remark') {
            return (
              <Text span size="sm" c="dimmed" fs="italic">
                {e.remark}
              </Text>
            );
          }
          return (
            <Badge
              size="sm"
              variant="light"
              color={e.action === 'permit' ? 'teal' : 'red'}
              tt="none"
            >
              {e.action}
            </Badge>
          );
        },
      },
      {
        id: 'protocol',
        header: t('acls.col.protocol'),
        accessorFn: (e) => e.protocol?.replace(/^object-group:/, '') ?? '',
      },
      {
        id: 'source',
        header: t('acls.col.source'),
        accessorFn: (e) => formatAddress(e.source),
        cell: (c) => (
          <Text span size="sm" ff="monospace">
            {c.getValue<string>()}
            <MatchBadge match={matches.get(c.row.original)?.source ?? null} />
          </Text>
        ),
      },
      {
        id: 'sourcePort',
        header: t('acls.col.sourcePort'),
        accessorFn: (e) => formatPorts(e.sourcePort),
      },
      {
        id: 'destination',
        header: t('acls.col.destination'),
        accessorFn: (e) => formatAddress(e.destination),
        cell: (c) => (
          <Text span size="sm" ff="monospace">
            {c.getValue<string>()}
            <MatchBadge match={matches.get(c.row.original)?.destination ?? null} />
          </Text>
        ),
      },
      {
        id: 'destinationPort',
        header: t('acls.col.destinationPort'),
        accessorFn: (e) => formatPorts(e.destinationPort),
      },
      {
        id: 'options',
        header: t('acls.col.options'),
        accessorFn: (e) => [...(e.services ?? []), ...e.options].join(' '),
      },
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.src} />,
      },
    ],
    [t, matches],
  );
  return (
    <Paper withBorder p="sm" data-testid="acl-detail" data-acl={acl.name}>
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Title order={5} ff="monospace">
          {acl.name}
        </Title>
        <Group gap={6} wrap="wrap">
          {acl.bindings.map((b, i) => (
            <Badge
              key={i}
              variant="outline"
              tt="none"
              style={{ cursor: 'pointer' }}
              onClick={() => showSource(b.src)}
              data-testid="acl-binding"
            >
              {bindingText(b, t)}
            </Badge>
          ))}
        </Group>
      </Group>
      <DataTable
        name="acl-entries"
        data={acl.entries}
        columns={columns}
        getRowId={(e) => String(e.src[0]?.[0] ?? e.text)}
        rowState={(e) => {
          if (!searching) return null;
          const m = matches.get(e);
          if (!m) return 'dim';
          return isSpecific(m) ? 'match' : null;
        }}
        height={360}
      />
    </Paper>
  );
}

function ObjectGroups({ groups, acls }: { groups: ObjectGroup[]; acls: Acl[] }) {
  const { t } = useTranslation();
  const usedBy = (name: string) =>
    acls
      .filter((a) =>
        a.entries.some(
          (e) =>
            (e.source?.kind === 'object-group' && e.source.name === name) ||
            (e.destination?.kind === 'object-group' && e.destination.name === name) ||
            e.protocol === `object-group:${name}`,
        ),
      )
      .map((a) => a.name);
  const columns: ColumnDef<ObjectGroup, unknown>[] = [
    {
      id: 'name',
      header: t('acls.col.name'),
      accessorFn: (g) => g.name,
      cell: (c) => (
        <Text span size="sm" ff="monospace" fw={600}>
          {c.getValue<string>()}
        </Text>
      ),
    },
    { id: 'type', header: t('acls.col.type'), accessorFn: (g) => t(`acls.groupType.${g.type}`) },
    {
      id: 'entries',
      header: t('acls.col.groupEntries'),
      accessorFn: (g) => g.entries.map(formatGroupEntry).join(', '),
    },
    {
      id: 'expanded',
      header: t('acls.col.expanded'),
      accessorFn: (g) =>
        g.type === 'network'
          ? expandObjectGroup(g.name, groups).map(formatGroupEntry).join(', ')
          : '',
    },
    { id: 'usedBy', header: t('acls.col.usedBy'), accessorFn: (g) => usedBy(g.name).join(', ') },
    {
      id: 'src',
      header: '',
      enableSorting: false,
      cell: (c) => <SourceButton src={c.row.original.src} />,
    },
  ];
  return (
    <Box data-testid="object-groups">
      <Title order={5} mb="xs">
        {t('acls.objectGroups')}
      </Title>
      <DataTable
        name="object-groups"
        data={groups}
        columns={columns}
        getRowId={(g) => g.name}
        height={280}
      />
    </Box>
  );
}

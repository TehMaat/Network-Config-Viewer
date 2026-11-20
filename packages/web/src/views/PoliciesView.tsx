import {
  Badge,
  Box,
  Checkbox,
  CloseButton,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import {
  isIpv4,
  policyMatchesIp,
  resolveAddress,
  resolveService,
  serviceText,
  type DeviceModel,
  type FirewallPolicy,
  type IpMatch,
  type LogicalContext,
  type ModelWarningCode,
} from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from './DataTable';
import { SourceButton, Value } from './source';
import { addressText } from './values';

type Match = { source: IpMatch | null; destination: IpMatch | null };
const specific = (m: Match) =>
  (m.source !== null && m.source !== 'any') || (m.destination !== null && m.destination !== 'any');
const pairOf = (p: FirewallPolicy) => `${p.srcintf.join(', ')} → ${p.dstintf.join(', ')}`;

export function PoliciesView({ model, context }: { model: DeviceModel; context: LogicalContext }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query.trim(), 250);
  const ip = isIpv4(debounced) ? debounced : null;
  const [mode, setMode] = useState<'list' | 'pairs'>('list');
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  // Warnings of the policies of this VDOM, by the first line of the policy.
  const warnings = useMemo(() => {
    const out = new Map<number, ModelWarningCode[]>();
    for (const w of model.warnings) {
      if (w.context !== context.name || w.line === undefined) continue;
      out.set(w.line, [...(out.get(w.line) ?? []), w.code]);
    }
    return out;
  }, [model, context]);
  const warningsOf = (p: FirewallPolicy) => warnings.get(p.src[0]?.[0] ?? -1) ?? [];

  const matches = useMemo(() => {
    const out = new Map<FirewallPolicy, Match>();
    if (!ip) return out;
    for (const p of context.policies) {
      const m = policyMatchesIp(p, ip, context, model);
      if (m.source || m.destination) out.set(p, m);
    }
    return out;
  }, [ip, context, model]);

  const data = useMemo(() => {
    let rows = context.policies;
    if (onlyWarnings) rows = rows.filter((p) => warningsOf(p).length > 0);
    if (mode === 'pairs') {
      rows = [...rows].sort((a, b) => pairOf(a).localeCompare(pairOf(b)) || a.order - b.order);
    }
    return rows;
    // warningsOf reads warnings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, onlyWarnings, mode, warnings]);

  const columns = useMemo<ColumnDef<FirewallPolicy, unknown>[]>(
    () => [
      ...(mode === 'pairs'
        ? [
            { id: 'pair', header: t('policies.col.pair'), accessorFn: pairOf } as ColumnDef<
              FirewallPolicy,
              unknown
            >,
          ]
        : []),
      { id: 'order', header: t('policies.col.order'), accessorFn: (p) => p.order },
      { id: 'id', header: 'ID', accessorFn: (p) => p.id },
      { id: 'name', header: t('policies.col.name'), accessorFn: (p) => p.name ?? '' },
      ...(mode === 'list'
        ? [
            {
              id: 'srcintf',
              header: t('policies.col.srcintf'),
              accessorFn: (p: FirewallPolicy) => p.srcintf.join(', '),
            },
            {
              id: 'dstintf',
              header: t('policies.col.dstintf'),
              accessorFn: (p: FirewallPolicy) => p.dstintf.join(', '),
            },
          ]
        : []),
      {
        id: 'srcaddr',
        header: t('policies.col.srcaddr'),
        accessorFn: (p) => `${p.srcaddrNegate ? '!' : ''}${p.srcaddr.join(', ')}`,
        cell: (c) => (
          <AddressCell
            text={c.getValue<string>()}
            match={matches.get(c.row.original)?.source ?? null}
          />
        ),
      },
      {
        id: 'dstaddr',
        header: t('policies.col.dstaddr'),
        accessorFn: (p) => `${p.dstaddrNegate ? '!' : ''}${p.dstaddr.join(', ')}`,
        cell: (c) => (
          <AddressCell
            text={c.getValue<string>()}
            match={matches.get(c.row.original)?.destination ?? null}
          />
        ),
      },
      { id: 'service', header: t('policies.col.service'), accessorFn: (p) => p.service.join(', ') },
      {
        id: 'action',
        header: t('policies.col.action'),
        accessorFn: (p) => p.action,
        cell: (c) => {
          const p = c.row.original;
          return (
            <Group gap={6} wrap="nowrap">
              <Text span size="sm" fw={600} c={p.action === 'accept' ? 'teal' : 'red'}>
                <Value element={p} field="action">
                  {p.action}
                </Value>
              </Text>
              {p.nat && (
                <Text span size="xs" c="dimmed" fw={600}>
                  {t('policies.nat')}
                </Text>
              )}
            </Group>
          );
        },
      },
      {
        id: 'log',
        header: t('policies.col.log'),
        accessorFn: (p) => p.logtraffic,
        cell: (c) => (
          <Value element={c.row.original} field="logtraffic">
            {c.getValue<string>()}
          </Value>
        ),
      },
      {
        id: 'status',
        header: t('policies.col.status'),
        accessorFn: (p) => (p.enabled ? '' : t('policies.disabled')),
        cell: (c) =>
          c.row.original.enabled ? null : (
            <Badge size="sm" variant="light" color="gray" tt="none">
              {t('policies.disabled')}
            </Badge>
          ),
      },
      {
        id: 'warnings',
        header: t('policies.col.warnings'),
        accessorFn: (p) =>
          warningsOf(p)
            .map((w) => t(`policies.warning.${w}`))
            .join(', '),
        cell: (c) => (
          <Group gap={4} wrap="nowrap">
            {warningsOf(c.row.original).map((w) => (
              <Badge key={w} size="xs" color="orange" variant="light" tt="none" data-warning={w}>
                {t(`policies.warning.${w}`)}
              </Badge>
            ))}
          </Group>
        ),
      },
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.src} />,
      },
    ],
    // warningsOf reads warnings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, mode, matches, warnings],
  );

  const policy = context.policies.find((p) => p.id === selected) ?? null;

  return (
    <Stack gap="md" p="md" data-testid="view-policies">
      <Group gap="md" align="flex-end" wrap="wrap">
        <TextInput
          w={300}
          size="sm"
          leftSection={<IconSearch size={16} />}
          label={t('policies.searchIp')}
          description={t('policies.searchIpHelp')}
          placeholder={t('acls.searchIpPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          error={debounced && !ip ? t('acls.notAnIp') : undefined}
          rightSection={
            query ? (
              <CloseButton
                size="sm"
                aria-label={t('viewer.clearFilter')}
                onClick={() => setQuery('')}
              />
            ) : null
          }
          data-testid="policy-ip-search"
        />
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(v) => setMode(v as 'list' | 'pairs')}
          data={[
            { value: 'list', label: t('policies.modeList') },
            { value: 'pairs', label: t('policies.modePairs') },
          ]}
          data-testid="policy-mode"
        />
        <Checkbox
          size="xs"
          label={t('policies.onlyWarnings')}
          checked={onlyWarnings}
          onChange={(e) => setOnlyWarnings(e.currentTarget.checked)}
          data-testid="policy-only-warnings"
        />
      </Group>
      <Text size="xs" c="dimmed">
        {t('policies.orderHelp')}
      </Text>
      <DataTable
        name="policies"
        data={data}
        columns={columns}
        getRowId={(p) => String(p.id)}
        selectedId={selected === null ? null : String(selected)}
        onRowClick={(p) => setSelected(p.id)}
        rowState={(p) => {
          if (!ip) return null;
          const m = matches.get(p);
          if (!m) return 'dim';
          return specific(m) ? 'match' : null;
        }}
        groupStart={
          mode === 'pairs'
            ? (p, prev) => prev !== undefined && pairOf(p) !== pairOf(prev)
            : undefined
        }
        height={520}
        empty={t('policies.none')}
      />
      {policy && <PolicyDetail policy={policy} context={context} warnings={warningsOf(policy)} />}
    </Stack>
  );
}

function AddressCell({ text, match }: { text: string; match: IpMatch | null }) {
  const { t } = useTranslation();
  return (
    <Text span size="sm">
      {text}
      {match && (
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
      )}
    </Text>
  );
}

/** The names of a policy side, each with what it contains down to the addresses. */
function Expanded({ names, context }: { names: string[]; context: LogicalContext }) {
  const { t } = useTranslation();
  return (
    <Stack gap={2}>
      {names.map((name) => {
        const r = resolveAddress(name, context);
        const parts = [
          ...r.addresses.map((a) => `${a.name === name ? '' : `${a.name}: `}${addressText(a, t)}`),
          ...r.vips.map((v) => `${v.name}: ${v.extip ?? ''} → ${v.mappedip.join(', ')}`),
          ...r.unknown.filter((u) => u !== name).map((u) => u),
        ];
        return (
          <Box key={name}>
            <Text span size="sm" fw={600} ff="monospace">
              {name}
            </Text>
            {r.unknown.includes(name) && (
              <Text span size="xs" c="dimmed" ml={6}>
                {t('objects.notDefined')}
              </Text>
            )}
            {parts.length > 0 && (
              <Text size="xs" c="dimmed" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
                {parts.join(' · ')}
              </Text>
            )}
            {r.excluded.length > 0 && (
              <Text size="xs" c="orange" ff="monospace">
                {t('objects.excluded', { names: r.excluded.map((a) => a.name).join(', ') })}
              </Text>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

function PolicyDetail({
  policy,
  context,
  warnings,
}: {
  policy: FirewallPolicy;
  context: LogicalContext;
  warnings: ModelWarningCode[];
}) {
  const { t } = useTranslation();
  const rows: [string, ReactNode][] = [];
  const add = (label: string, value: ReactNode) => {
    if (value !== undefined && value !== null && value !== '') rows.push([label, value]);
  };
  add(t('policies.col.order'), policy.order);
  add(t('policies.col.srcintf'), policy.srcintf.join(', '));
  add(t('policies.col.dstintf'), policy.dstintf.join(', '));
  add(
    policy.srcaddrNegate
      ? t('policies.negated', { field: t('policies.col.srcaddr') })
      : t('policies.col.srcaddr'),
    <Expanded names={policy.srcaddr} context={context} />,
  );
  add(
    policy.dstaddrNegate
      ? t('policies.negated', { field: t('policies.col.dstaddr') })
      : t('policies.col.dstaddr'),
    <Expanded names={policy.dstaddr} context={context} />,
  );
  add(
    t('policies.col.service'),
    <Stack gap={2}>
      {policy.service.map((name) => (
        <Text key={name} size="sm">
          <Text span fw={600} ff="monospace">
            {name}
          </Text>{' '}
          <Text span size="xs" c="dimmed" ff="monospace">
            {resolveService(name, context).flatMap(serviceText).join(' ')}
          </Text>
        </Text>
      ))}
    </Stack>,
  );
  add(
    t('policies.col.action'),
    <Value element={policy} field="action">
      {policy.action}
    </Value>,
  );
  add(
    'NAT',
    <Value element={policy} field="nat">
      {policy.nat
        ? policy.ippool
          ? t('policies.natPool', { pools: policy.poolname.join(', ') })
          : t('policies.natInterface')
        : t('routing.no')}
    </Value>,
  );
  add(
    t('policies.col.log'),
    <Value element={policy} field="logtraffic">
      {policy.logtraffic}
    </Value>,
  );
  add(
    t('policies.col.status'),
    <Value element={policy} field="status">
      {policy.enabled ? t('policies.enabled') : t('policies.disabled')}
    </Value>,
  );
  add(t('policies.schedule'), policy.schedule);
  add(t('policies.users'), [...policy.users, ...policy.groups].join(', '));
  add(t('policies.internetService'), policy.internetService.join(', '));
  add(
    t('policies.profiles'),
    Object.keys(policy.profiles).length > 0 ? (
      <Group gap={4}>
        {Object.entries(policy.profiles).map(([key, value]) => (
          <Badge key={key} size="sm" variant="outline" tt="none">
            {key}: {value}
          </Badge>
        ))}
      </Group>
    ) : undefined,
  );
  add(t('policies.comments'), policy.comments);
  add('UUID', policy.uuid);
  return (
    <Paper withBorder p="sm" data-testid="policy-detail" data-id={policy.id}>
      <Group justify="space-between" mb="xs">
        <Title order={5}>
          {policy.name ? t('policies.title', { id: policy.id, name: policy.name }) : policy.id}
        </Title>
        <SourceButton src={policy.src} testId="policy-source" />
      </Group>
      {warnings.length > 0 && (
        <Group gap={4} mb="xs">
          {warnings.map((w) => (
            <Badge key={w} color="orange" variant="light" tt="none">
              {t(`policies.warning.${w}`)}
            </Badge>
          ))}
        </Group>
      )}
      <SimpleGrid cols={1}>
        <Table fz="sm" verticalSpacing={3} withRowBorders={false}>
          <Table.Tbody>
            {rows.map(([label, value]) => (
              <Table.Tr key={label}>
                <Table.Td c="dimmed" w={190} style={{ verticalAlign: 'top' }}>
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

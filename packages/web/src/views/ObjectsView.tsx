import { Badge, Group, Paper, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import {
  objectUsage,
  resolveAddress,
  resolveService,
  serviceText,
  type AddressGroup,
  type AddressObject,
  type IpPool,
  type LogicalContext,
  type ObjectUse,
  type ServiceGroup,
  type ServiceObject,
  type Src,
  type Vip,
} from '@ncv/core';
import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from './DataTable';
import { SourceButton } from './source';
import { addressText } from './values';

type Kind = 'addresses' | 'groups' | 'services' | 'serviceGroups' | 'vips' | 'ippools';

interface Row {
  name: string;
  type: string;
  value: string;
  comment: string;
  builtin: boolean;
  src: Src;
}

function usageText(use: ObjectUse, t: TFunction): string {
  switch (use.kind) {
    case 'policy':
      return t('objects.use.policy', { id: use.id });
    case 'sdwan-rule':
      return t('objects.use.sdwanRule', { id: use.id });
    default:
      return use.name;
  }
}

/** Addresses, groups, services, VIPs and IP pools of a VDOM, with where they are used. */
export function ObjectsView({ context }: { context: LogicalContext }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>('addresses');
  const [selected, setSelected] = useState<string | null>(null);
  const usage = useMemo(() => objectUsage(context), [context]);

  const rows = useMemo((): Row[] => {
    const row = (
      name: string,
      type: string,
      value: string,
      comment: string | undefined,
      builtin: boolean,
      src: Src,
    ): Row => ({
      name,
      type,
      value,
      comment: comment ?? '',
      builtin,
      src,
    });
    switch (kind) {
      case 'addresses':
        return context.addresses.map((a: AddressObject) =>
          row(
            a.name,
            t(`objects.addressType.${a.type}`, { defaultValue: a.type }),
            addressText(a, t),
            a.comment,
            !!a.builtin,
            a.src,
          ),
        );
      case 'groups':
        return context.addressGroups.map((g: AddressGroup) =>
          row(
            g.name,
            t('objects.group'),
            [
              g.members.join(', '),
              g.exclude.length > 0 ? t('objects.excluded', { names: g.exclude.join(', ') }) : '',
            ]
              .filter(Boolean)
              .join(' · '),
            g.comment,
            false,
            g.src,
          ),
        );
      case 'services':
        return context.services.map((s: ServiceObject) =>
          row(s.name, s.category ?? '', serviceText(s).join(' '), s.comment, !!s.builtin, s.src),
        );
      case 'serviceGroups':
        return context.serviceGroups.map((g: ServiceGroup) =>
          row(g.name, t('objects.group'), g.members.join(', '), g.comment, false, g.src),
        );
      case 'vips':
        return context.vips.map((v: Vip) =>
          row(
            v.name,
            v.type ?? '',
            `${v.extip ?? ''}${v.extport ? `:${v.extport}` : ''} → ${v.mappedip.join(', ')}${v.mappedport ? `:${v.mappedport}` : ''}${v.extintf ? ` (${v.extintf})` : ''}`,
            v.comment,
            false,
            v.src,
          ),
        );
      case 'ippools':
        return context.ippools.map((p: IpPool) =>
          row(p.name, p.type, `${p.startip ?? ''}-${p.endip ?? ''}`, p.comment, false, p.src),
        );
    }
  }, [kind, context, t]);

  const columns = useMemo<ColumnDef<Row, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('objects.col.name'),
        accessorFn: (r) => r.name,
        cell: (c) => (
          <Group gap={4} wrap="nowrap">
            <Text span size="sm" ff="monospace" fw={600}>
              {c.getValue<string>()}
            </Text>
            {c.row.original.builtin && (
              <Badge size="xs" variant="light" color="gray" tt="none">
                {t('objects.builtin')}
              </Badge>
            )}
          </Group>
        ),
      },
      { id: 'type', header: t('objects.col.type'), accessorFn: (r) => r.type },
      {
        id: 'value',
        header: t('objects.col.value'),
        accessorFn: (r) => r.value,
        cell: (c) => (
          <Text span size="sm" ff="monospace" style={{ overflowWrap: 'anywhere' }}>
            {c.getValue<string>()}
          </Text>
        ),
      },
      {
        id: 'used',
        header: t('objects.col.used'),
        accessorFn: (r) => usage.get(r.name)?.length ?? 0,
        cell: (c) => {
          const n = c.getValue<number>();
          return n === 0 ? (
            <Text span size="sm" c="orange">
              {t('objects.unused')}
            </Text>
          ) : (
            <Text span size="sm">
              {n}
            </Text>
          );
        },
      },
      { id: 'comment', header: t('objects.col.comment'), accessorFn: (r) => r.comment },
      {
        id: 'src',
        header: '',
        enableSorting: false,
        cell: (c) => <SourceButton src={c.row.original.src} />,
      },
    ],
    [t, usage],
  );

  const current = rows.find((r) => r.name === selected) ?? null;
  const counts: Record<Kind, number> = {
    addresses: context.addresses.length,
    groups: context.addressGroups.length,
    services: context.services.length,
    serviceGroups: context.serviceGroups.length,
    vips: context.vips.length,
    ippools: context.ippools.length,
  };

  return (
    <Stack gap="md" p="md" data-testid="view-objects">
      <SegmentedControl
        size="xs"
        value={kind}
        onChange={(v) => {
          setKind(v as Kind);
          setSelected(null);
        }}
        data={(Object.keys(counts) as Kind[]).map((k) => ({
          value: k,
          label: t(`objects.kind.${k}`, { count: counts[k] }),
        }))}
        data-testid="objects-kind"
        style={{ alignSelf: 'flex-start' }}
      />
      <DataTable
        name="objects"
        data={rows}
        columns={columns}
        getRowId={(r) => r.name}
        selectedId={selected}
        onRowClick={(r) => setSelected(r.name)}
        height={420}
      />
      {current && (
        <Paper withBorder p="sm" data-testid="object-detail" data-name={current.name}>
          <Group justify="space-between" mb="xs">
            <Title order={5} ff="monospace">
              {current.name}
            </Title>
            <SourceButton src={current.src} />
          </Group>
          {(kind === 'groups' || kind === 'serviceGroups') && (
            <Text
              size="sm"
              mb="xs"
              ff="monospace"
              style={{ overflowWrap: 'anywhere' }}
              data-testid="object-expanded"
            >
              {kind === 'groups'
                ? (() => {
                    const r = resolveAddress(current.name, context);
                    return [
                      ...r.addresses.map((a) => `${a.name}: ${addressText(a, t)}`),
                      ...r.vips.map(
                        (v) => `${v.name}: ${v.extip ?? ''} → ${v.mappedip.join(', ')}`,
                      ),
                    ].join(' · ');
                  })()
                : resolveService(current.name, context)
                    .map((s) => `${s.name}: ${serviceText(s).join(' ')}`)
                    .join(' · ')}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {t('objects.usedBy')}
          </Text>
          <Group gap={4} data-testid="object-usage">
            {(usage.get(current.name) ?? []).map((u, i) => (
              <Badge key={i} variant="outline" tt="none">
                {usageText(u, t)}
              </Badge>
            ))}
            {(usage.get(current.name) ?? []).length === 0 && (
              <Text size="sm" c="orange">
                {t('objects.unused')}
              </Text>
            )}
          </Group>
        </Paper>
      )}
    </Stack>
  );
}

// What the map shows beside the drawing (#15): the two sides of a link, a device or an
// external node, with the lines of the configurations and of the shows they come from.

import { Badge, Box, Button, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import type { Infrastructure, Link, LinkSource, Problem } from '@ncv/core';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { worstSeverity } from '../state/infra';
import { EvidenceButton, ProblemItem, SEVERITY_COLOR } from '../views/problems';
import {
  comparisonText,
  endLabel,
  kindLabel,
  linkRows,
  PROBLEM_ROW,
  side,
  type ModelOf,
} from './details';
import { DeviceSite, ExternalActions, LinkActions, type MapEditing } from './editing';

export interface PanelProps {
  infra: Infrastructure;
  modelOf: ModelOf;
  onOpenFile(id: string, line?: number): void;
  onSelectLink(id: string): void;
  /** The changes made by hand (#15, part 3): missing where the links are only shown. */
  editing?: MapEditing;
}

function sourceText(source: LinkSource, infra: Infrastructure, t: TFunction) {
  const device = infra.devices.find((d) => d.key === source.device)?.hostname ?? source.device;
  return t(`map.source.${source.kind}`, { device, text: source.text ?? '' });
}

/** The problems of a link or a device, most serious first. */
function ProblemsSection({ problems, testId }: { problems: Problem[]; testId: string }) {
  const { t } = useTranslation();
  if (problems.length === 0) return null;
  return (
    <Box data-testid={testId}>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={4}>
        {t('problems.title')} ({problems.length})
      </Text>
      <Stack gap={6}>
        {problems.map((p) => (
          <ProblemItem key={p.id} problem={p} />
        ))}
      </Stack>
    </Box>
  );
}

export function LinkPanel({ link, ...props }: PanelProps & { link: Link }) {
  const { t } = useTranslation();
  const { infra, modelOf, onOpenFile } = props;
  const a = side(infra, link.a, modelOf);
  const b = side(infra, link.b, modelOf);
  const rows = linkRows(link, infra, modelOf, t);
  const problems = infra.problems.filter((p) => p.link === link.id);
  // The rows of the parameters that do not agree, coloured by their most serious problem: the
  // problems come most serious first.
  const flagged = new Map<string, Problem['severity']>();
  for (const p of problems) {
    const row = PROBLEM_ROW[p.code];
    if (row && !flagged.has(row)) flagged.set(row, p.severity);
  }
  const comparison = comparisonText(link, infra, t);
  const head = (s: typeof a) => (
    <Stack gap={2}>
      <Text size="sm" fw={700}>
        {s.name}
      </Text>
      {endLabel(s.end) && (
        <Text size="xs" c="dimmed" ff="monospace">
          {endLabel(s.end)}
        </Text>
      )}
      {s.device && (
        <Button
          size="compact-xs"
          variant="light"
          rightSection={<IconArrowRight size={12} />}
          onClick={() => onOpenFile(s.device!.file)}
          data-testid="map-open-device"
        >
          {t('map.openViews')}
        </Button>
      )}
    </Stack>
  );
  return (
    <Stack gap="sm" data-testid="map-link-panel" data-link={link.id} data-kind={link.kind}>
      <Box>
        <Group gap={6} mb={4}>
          <Badge variant="light" tt="none">
            {kindLabel(link.kind, t)}
          </Badge>
          {link.manual ? (
            <Badge variant="light" color="grape" tt="none" data-testid="map-link-manual">
              {t('map.manual')}
            </Badge>
          ) : (
            <Badge
              variant="light"
              color={link.verified ? 'teal' : 'gray'}
              tt="none"
              data-testid="map-link-verified"
              data-verified={link.verified}
            >
              {link.verified ? t('map.verified') : t('map.inferred')}
            </Badge>
          )}
          {link.confirmed && (
            <Badge variant="light" color="teal" tt="none" data-testid="map-link-confirmed">
              {t('map.confirmed')}
            </Badge>
          )}
          {link.dialup && (
            <Badge variant="light" color="grape" tt="none">
              {t('map.dialup')}
            </Badge>
          )}
          {comparison && (
            <Badge
              variant="light"
              color={comparison.issues ? 'red' : comparison.compared ? 'teal' : 'gray'}
              tt="none"
              data-testid="map-link-comparison"
            >
              {comparison.text}
            </Badge>
          )}
          {problems.length > 0 && (
            <Badge
              variant="filled"
              color={SEVERITY_COLOR[worstSeverity(problems)!]}
              tt="none"
              data-testid="map-link-problems"
              data-count={problems.length}
            >
              {t('problems.count', { count: problems.length })}
            </Badge>
          )}
        </Group>
        <Title order={4} style={{ overflowWrap: 'anywhere' }}>
          {a.name} ↔ {b.name}
        </Title>
      </Box>
      {props.editing && <LinkActions link={link} infra={infra} editing={props.editing} />}
      <Table withTableBorder withColumnBorders fz="xs" data-testid="map-link-rows">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w="28%">{t('map.parameter')}</Table.Th>
            <Table.Th>{head(a)}</Table.Th>
            <Table.Th>{head(b)}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr
              key={r.key}
              data-testid="map-link-row"
              data-row={r.key}
              data-problem={flagged.get(r.key)}
              className={flagged.has(r.key) ? `ncv-compare-${flagged.get(r.key)}` : undefined}
            >
              <Table.Td fw={600}>{r.label}</Table.Td>
              <Table.Td style={{ overflowWrap: 'anywhere' }}>{r.a || '—'}</Table.Td>
              <Table.Td style={{ overflowWrap: 'anywhere' }}>{r.b || '—'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <ProblemsSection problems={problems} testId="map-link-problem-list" />
      <Box>
        <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={4}>
          {t('map.sources')}
        </Text>
        <Stack gap={6}>
          {link.sources.map((s, i) => (
            <Box key={`${s.kind}-${s.device}-${i}`} data-testid="map-source" data-kind={s.kind}>
              <Text size="xs">{sourceText(s, infra, t)}</Text>
              <Group gap={4}>
                {s.evidence.map((e, j) => (
                  <EvidenceButton key={j} evidence={e} />
                ))}
              </Group>
            </Box>
          ))}
        </Stack>
      </Box>
      {link.via && (
        <Button
          size="compact-sm"
          variant="subtle"
          onClick={() => props.onSelectLink(link.via!)}
          data-testid="map-link-via"
        >
          {t('map.via')}
        </Button>
      )}
    </Stack>
  );
}

export function NodePanel({ node, ...props }: PanelProps & { node: string }) {
  const { t } = useTranslation();
  const { infra, onOpenFile } = props;
  const device = infra.devices.find((d) => d.key === node);
  const external = infra.externals.find((e) => e.id === node);
  const links = infra.links.filter((l) => l.a.node === node || l.b.node === node);
  const counts = new Map<string, number>();
  for (const l of links) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
  const site = device ? infra.sites.find((s) => s.id === device.site) : undefined;
  const problems = infra.problems.filter((p) => p.devices.includes(node));
  const rows: [string, string][] = device
    ? [
        [t('map.row.type'), t(`map.typeName.${device.type}`)],
        [t('map.row.model'), device.model ?? ''],
        [t('map.row.os'), [t(`os.${device.os}`), device.version].filter(Boolean).join(' ')],
        [t('map.row.site'), site?.name || t('map.noSite')],
        [t('map.row.location'), device.location ?? ''],
        [t('map.row.management'), device.managementIp ?? ''],
        [t('map.row.vdom'), device.contexts.join(', ')],
        [t('map.row.ha'), device.ha ? t('map.value.yes') : ''],
      ]
    : [
        [t('map.row.type'), external ? t(`map.external.${external.kind}`) : ''],
        [t('map.row.detail'), external?.detail ?? ''],
        [
          t('map.row.site'),
          external?.site ? (infra.sites.find((s) => s.id === external.site)?.name ?? '') : '',
        ],
      ];
  return (
    <Stack gap="sm" data-testid="map-node-panel" data-node={node}>
      <Title order={4} style={{ overflowWrap: 'anywhere' }}>
        {device?.hostname ?? external?.label ?? node}
      </Title>
      <Table fz="xs" withTableBorder>
        <Table.Tbody>
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td fw={600} w="40%">
                  {k}
                </Table.Td>
                <Table.Td>{v}</Table.Td>
              </Table.Tr>
            ))}
        </Table.Tbody>
      </Table>
      <Group gap={6}>
        {[...counts].map(([kind, n]) => (
          <Tooltip key={kind} label={t(`map.kind.${kind}`)}>
            <Badge variant="default" tt="none">
              {t(`map.kind.${kind}`)}: {n}
            </Badge>
          </Tooltip>
        ))}
      </Group>
      {external?.kind === 'missing' && (
        <Text size="sm" c="orange" data-testid="map-node-missing">
          {t('mapEdit.missing')}
        </Text>
      )}
      {device && (
        <Button
          rightSection={<IconArrowRight size={14} />}
          onClick={() => onOpenFile(device.file)}
          data-testid="map-open-device"
        >
          {t('map.openViews')}
        </Button>
      )}
      {device && props.editing && (
        <DeviceSite hostname={device.hostname} infra={infra} editing={props.editing} />
      )}
      {external && props.editing && (
        <ExternalActions externalId={external.id} editing={props.editing} />
      )}
      <ProblemsSection problems={problems} testId="map-node-problem-list" />
      {links.length > 0 && (
        <Stack gap={2}>
          {links.map((l) => (
            <Button
              key={l.id}
              size="compact-xs"
              variant="subtle"
              justify="flex-start"
              onClick={() => props.onSelectLink(l.id)}
              data-testid="map-node-link"
            >
              {kindLabel(l.kind, t)} ·{' '}
              {l.a.node === node
                ? side(infra, l.b, props.modelOf).name
                : side(infra, l.a, props.modelOf).name}
            </Button>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

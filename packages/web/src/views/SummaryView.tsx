import {
  Alert,
  Anchor,
  Badge,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { hasMacTable, portsWithoutMac, type DeviceModel } from '@ncv/core';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LinkedShow } from '../state/devices';
import { problemsOf } from '../state/infra';
import { DeviceProblems, problemsSummary } from './problems';
import { useDeviceView } from './source';

interface Props {
  model: DeviceModel;
  /** The recognition panel, editable, shown at the top of the summary. */
  detection: ReactNode;
  /** Files of shows of the device. */
  shows: LinkedShow[];
}

const SECTIONS_SHOWN = 12;
/** Links to the lines shown for each kind of warning. */
const WARNING_LINKS = 5;

export function SummaryView({ model, detection, shows }: Props) {
  const { t, i18n } = useTranslation();
  const { showSource, state, openFile, infra, deviceKey } = useDeviceView();
  // What does not agree with the other devices of the client (#15, part 2).
  const problems = problemsOf(infra, deviceKey);
  const switchDevice = model.vendor === 'cisco';
  const withoutMac = switchDevice ? portsWithoutMac(model, state) : [];
  // Warnings about the real state of a switch (#6): one per device.
  const stateWarnings = switchDevice
    ? [
        ...(!hasMacTable(state) ? [{ code: 'mac-table-missing', count: 1 }] : []),
        ...(withoutMac.length > 0 ? [{ code: 'ports-without-mac', count: withoutMac.length }] : []),
      ]
    : [];
  const [allSections, setAllSections] = useState(false);
  const ctx = model.contexts[0]!;
  const physical = model.interfaces.filter((i) => i.kind === 'physical');
  const number = (n: number) => n.toLocaleString(i18n.language);
  const percent = (n: number) =>
    model.coverage.total === 0 ? 0 : Math.round((n / model.coverage.total) * 1000) / 10;
  const c = model.coverage;
  const sections = allSections ? c.sections : c.sections.slice(0, SECTIONS_SHOWN);

  const fact = (key: string, label: string, value: ReactNode) => (
    <div key={key} data-testid={`summary-${key}`}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
        {value ?? '—'}
      </Text>
    </div>
  );

  const sum = (f: (c: (typeof model.contexts)[number]) => number) =>
    model.contexts.reduce((n, c) => n + f(c), 0);
  const counts: [string, number][] =
    model.vendor === 'fortinet'
      ? [
          ['interfaces', model.interfaces.length],
          ['vlanInterfaces', model.interfaces.filter((i) => i.vlanId !== undefined).length],
          ['policies', sum((c) => c.policies.length)],
          ['addresses', sum((c) => c.addresses.filter((a) => !a.builtin).length)],
          ['vips', sum((c) => c.vips.length)],
          ['statics', sum((c) => c.routing.statics.length)],
          ['tunnels', sum((c) => c.ipsec.length)],
          [
            'bgpNeighbors',
            sum((c) =>
              c.routing.bgp ? c.routing.bgp.neighbors.length + c.routing.bgp.ranges.length : 0,
            ),
          ],
        ]
      : [
          ['ports', physical.length],
          ['portsDown', physical.filter((i) => i.shutdown).length],
          ['lags', model.interfaces.filter((i) => i.kind === 'lag').length],
          ['svis', model.interfaces.filter((i) => i.kind === 'svi').length],
          ['vlans', model.vlans.length],
          ['acls', ctx.acls.length],
          ['statics', ctx.routing.statics.length],
          ['bgpNeighbors', ctx.routing.bgp?.neighbors.length ?? 0],
        ];
  // Warnings of the same kind together: a firewall can have many policies to check.
  const warningGroups = [...new Set(model.warnings.map((w) => w.code))].map((code) => ({
    code,
    items: model.warnings.filter((w) => w.code === code),
  }));

  const management = model.management
    ? `${model.management.ip}${model.management.interface ? ` (${model.management.interface})` : ''}`
    : null;
  const stack =
    model.stack.length > 0
      ? model.stack.map((s) => (s.model ? `${s.member}: ${s.model}` : String(s.member))).join(' · ')
      : null;
  const facts: [string, string, ReactNode][] = [
    ['management', t('summary.management'), management],
    ...(model.vendor === 'cisco'
      ? [['stack', t('detection.stack'), stack] as [string, string, ReactNode]]
      : []),
    ...(model.contexts.length > 1
      ? [
          ['vdoms', t('detection.vdoms'), model.contexts.map((c) => c.name).join(' · ')] as [
            string,
            string,
            ReactNode,
          ],
        ]
      : []),
    ...(model.vtpMode
      ? [['vtp', t('summary.vtp'), model.vtpMode] as [string, string, ReactNode]]
      : []),
  ];

  return (
    <Stack gap="md" p="md" data-testid="view-summary">
      {detection}

      <Paper withBorder p="sm">
        <Title order={5} mb="xs">
          {t('summary.device')}
        </Title>
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="sm">
          {facts.map(([key, label, value]) => fact(key, label, value))}
        </SimpleGrid>
      </Paper>

      {problems.length > 0 && (
        <Paper withBorder p="sm" data-testid="summary-problems">
          <Group justify="space-between" mb="xs" gap="xs">
            <Title order={5}>{t('problems.deviceTitle')}</Title>
            <Text size="xs" c="dimmed">
              {problemsSummary(problems, t)}
            </Text>
          </Group>
          <DeviceProblems problems={problems} />
        </Paper>
      )}

      <Paper withBorder p="sm">
        <Title order={5} mb="xs">
          {t('summary.counts')}
        </Title>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
          {counts.map(([key, value]) => (
            <div key={key} data-testid={`count-${key}`} data-value={value}>
              <Text size="xl" fw={700} lh={1.1}>
                {number(value)}
              </Text>
              <Text size="xs" c="dimmed">
                {t(`summary.count.${key}`)}
              </Text>
            </div>
          ))}
        </SimpleGrid>
        <Group gap={6} mt="sm" data-testid="features">
          <Text size="xs" c="dimmed">
            {t('summary.features')}:
          </Text>
          {model.features.length === 0 && (
            <Text size="xs" c="dimmed">
              —
            </Text>
          )}
          {model.features.map((f) => (
            <Badge key={f} variant="light" tt="none" data-feature={f}>
              {t(`feature.${f}`)}
            </Badge>
          ))}
        </Group>
      </Paper>

      {(model.warnings.length > 0 || stateWarnings.length > 0) && (
        <Alert
          color="orange"
          icon={<IconAlertTriangle />}
          title={t('summary.warnings')}
          data-testid="warnings"
        >
          <Stack gap={4}>
            {stateWarnings.map(({ code, count }) => (
              <Text key={code} size="sm" data-warning={code} data-count={count}>
                {t(`warning.${code}`, { count })}
              </Text>
            ))}
            {warningGroups.map(({ code, items }) => (
              <Text key={code} size="sm" data-warning={code} data-count={items.length}>
                {t(`warning.${code}`, { count: items.length })}
                {items
                  .filter((w) => w.line !== undefined)
                  .slice(0, WARNING_LINKS)
                  .map((w) => (
                    <Anchor
                      key={`${w.context ?? ''}${w.line}`}
                      component="button"
                      type="button"
                      size="sm"
                      ml={8}
                      onClick={() => showSource([[w.line!, w.line!]])}
                    >
                      {w.context && model.contexts.length > 1
                        ? t('source.lineIn', { line: w.line, context: w.context })
                        : t('source.line', { line: w.line })}
                    </Anchor>
                  ))}
                {items.length > WARNING_LINKS && (
                  <Text span size="sm" c="dimmed" ml={8}>
                    {t('summary.moreWarnings', { count: items.length - WARNING_LINKS })}
                  </Text>
                )}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      <Paper withBorder p="sm" data-testid="summary-shows">
        <Title order={5} mb="xs">
          {t('shows.loaded')}
        </Title>
        {shows.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t('shows.none')}
          </Text>
        ) : (
          <Stack gap={6}>
            {shows.map(({ entry, reason }) => {
              const commands = state?.commands.filter((c) => c.file === entry.id) ?? [];
              return (
                <div key={entry.id} data-testid="summary-show" data-file={entry.name}>
                  <Group gap="xs">
                    <Anchor
                      component="button"
                      type="button"
                      size="sm"
                      onClick={() => openFile(entry.id)}
                    >
                      {entry.name}
                    </Anchor>
                    <Text span size="xs" c="dimmed">
                      {t(`shows.reason.${reason}`)}
                    </Text>
                  </Group>
                  <Group gap={4} mt={2}>
                    {commands.map((c) => (
                      <Badge
                        key={`${c.line}`}
                        component="button"
                        type="button"
                        size="sm"
                        variant="light"
                        color="teal"
                        tt="none"
                        style={{ cursor: 'pointer' }}
                        onClick={() => openFile(entry.id, c.line)}
                        data-testid="summary-show-command"
                      >
                        {c.context ? `${c.id} (${c.context})` : c.id}
                      </Badge>
                    ))}
                  </Group>
                </div>
              );
            })}
          </Stack>
        )}
      </Paper>

      <Paper
        withBorder
        p="sm"
        data-testid="coverage"
        data-understood={c.understood}
        data-unknown={c.unknown}
      >
        <Title order={5} mb={4}>
          {t('coverage.title')}
        </Title>
        <Text size="sm" mb="xs">
          {t('coverage.summary', {
            understood: percent(c.understood),
            ignored: percent(c.ignored),
            unknown: percent(c.unknown),
            total: number(c.total),
          })}
        </Text>
        <Progress.Root size="lg" mb="xs">
          <Tooltip label={t('coverage.understood', { count: c.understood })}>
            <Progress.Section value={percent(c.understood)} color="teal" />
          </Tooltip>
          <Tooltip label={t('coverage.ignored', { count: c.ignored })}>
            <Progress.Section value={percent(c.ignored)} color="gray" />
          </Tooltip>
          <Tooltip label={t('coverage.unknown', { count: c.unknown })}>
            <Progress.Section value={percent(c.unknown)} color="yellow" />
          </Tooltip>
        </Progress.Root>
        <Text size="xs" c="dimmed" mb="xs">
          {t('coverage.explain')}
        </Text>
        {c.sections.length > 0 && (
          <>
            <Text size="sm" fw={500} mb={4}>
              {t('coverage.sections')}
            </Text>
            <Table fz="sm" verticalSpacing={2} data-testid="coverage-sections">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('coverage.section')}</Table.Th>
                  <Table.Th>{t('coverage.lines')}</Table.Th>
                  <Table.Th>{t('coverage.firstLine')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sections.map((s) => (
                  <Table.Tr key={s.section}>
                    <Table.Td ff="monospace">{s.section}</Table.Td>
                    <Table.Td>{number(s.lines)}</Table.Td>
                    <Table.Td>
                      <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        onClick={() => showSource([[s.firstLine, s.firstLine]])}
                      >
                        {t('source.line', { line: s.firstLine })}
                      </Anchor>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {c.sections.length > SECTIONS_SHOWN && (
              <Anchor
                component="button"
                type="button"
                size="sm"
                mt={4}
                onClick={() => setAllSections((v) => !v)}
              >
                {allSections
                  ? t('coverage.showFewer')
                  : t('coverage.showAll', { count: c.sections.length })}
              </Anchor>
            )}
          </>
        )}
      </Paper>
    </Stack>
  );
}

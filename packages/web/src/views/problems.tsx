// The problems found by the consistency checks (#15, part 2; chapter 6 of the study): what does
// not agree between two devices, why it matters and how to fix it, with the lines of both
// sides. Shown by the map, by the VPN view of the client and by the summary of a device.

import { Badge, Box, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconArrowRight, IconCode, IconTerminal2 } from '@tabler/icons-react';
import type { LinkEvidence, Problem, Severity } from '@ncv/core';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { severityCounts } from '../state/infra';
import { sourceRange, useDeviceView } from './source';

/** The severities, most serious first. */
export const SEVERITIES = ['error', 'warning', 'info'] as const satisfies readonly Severity[];

export const SEVERITY_COLOR: Record<Severity, string> = {
  error: 'red',
  warning: 'orange',
  info: 'blue',
};

/** "2 errors, 1 warning": how many problems of each severity there are. */
export function problemsSummary(problems: readonly Problem[], t: TFunction): string {
  const counts = severityCounts(problems);
  return SEVERITIES.filter((s) => counts[s] > 0)
    .map((s) => t(`problems.countOf.${s}`, { count: counts[s] }))
    .join(', ');
}

/** A word of a value (a mode, a role) in the language of the page, or the value itself. */
function word(t: TFunction, prefix: string, value: string | undefined): string | undefined {
  if (value === undefined || value === '' || value === '—') return value;
  return t(`${prefix}.${value}`, { defaultValue: value });
}

/** The values of a problem as its messages show them: words for the modes, the defaults said. */
export function problemValues(problem: Problem, t: TFunction): Record<string, string> {
  const values: Record<string, string> = { ...problem.values };
  const prefix: Partial<Record<Problem['code'], string>> = {
    'lag-mode': 'problems.lagProtocol',
    'trunk-mode': 'ports.mode',
    'ipsec-advpn': 'vpn.advpn',
    'ipsec-auth': 'problems.auth',
  };
  const words = prefix[problem.code];
  for (const side of ['A', 'B'] as const) {
    const key = `value${side}`;
    const value = values[key];
    if (value === undefined) continue;
    let text = words ? (word(t, words, value) ?? value) : value;
    if (values[`default${side}`] === 'yes') text = t('problems.withDefault', { value: text });
    values[key] = text;
  }
  return values;
}

export interface ProblemText {
  title: string;
  why: string;
  fix: string;
}

export function problemText(problem: Problem, t: TFunction): ProblemText {
  const values = problemValues(problem, t);
  const key = `problems.code.${problem.code}`;
  let why = t(`${key}.why`, values);
  // A session over a tunnel: the tunnel down, or with errors, is the first thing to look at.
  if (problem.code === 'bgp-down' && values.via) {
    const transport =
      values.viaDown === 'yes' ? 'viaDown' : values.viaProblem === 'yes' ? 'viaProblem' : 'viaUp';
    why = `${why} ${t(`${key}.${transport}`, values)}`;
  }
  if (problem.unverified) why = `${why} ${t('problems.unverifiedNote')}`;
  return { title: t(`${key}.title`, values), why, fix: t(`${key}.fix`, values) };
}

export function SeverityBadge({ problem, size = 'sm' }: { problem: Problem; size?: 'xs' | 'sm' }) {
  const { t } = useTranslation();
  return (
    <Group gap={4} wrap="nowrap" component="span" style={{ flexShrink: 0 }}>
      <Badge
        size={size}
        variant="filled"
        color={SEVERITY_COLOR[problem.severity]}
        tt="none"
        data-testid="problem-severity"
      >
        {t(`problems.severity.${problem.severity}`)}
      </Badge>
      {problem.unverified && (
        <Badge
          size={size}
          variant="light"
          color="orange"
          tt="none"
          data-testid="problem-unverified"
        >
          {t('source.toCheck')}
        </Badge>
      )}
    </Group>
  );
}

/** Opens the configuration of a device, or a file of shows, at the first line of a source. */
export function EvidenceButton({ evidence }: { evidence: LinkEvidence }) {
  const { t } = useTranslation();
  const { infra, openFile } = useDeviceView();
  const device = infra.devices.find((d) => d.key === evidence.device);
  const range = sourceRange(evidence.src);
  const file = evidence.file ?? device?.file;
  if (!file || !range) return null;
  const values = { device: device?.hostname ?? evidence.device, line: range[0] };
  const label = evidence.file ? t('map.evidence.show', values) : t('map.evidence.config', values);
  return (
    <Button
      size="compact-xs"
      variant="subtle"
      leftSection={evidence.file ? <IconTerminal2 size={14} /> : <IconCode size={14} />}
      onClick={() => openFile(file, range[0])}
      data-testid="map-evidence"
      data-file={file}
      data-line={range[0]}
    >
      {label}
    </Button>
  );
}

/** One problem: what, why, how to fix it, and the lines of the devices it comes from. */
export function ProblemItem({
  problem,
  action,
}: {
  problem: Problem;
  /** A button after the lines: show the link, open the map. */
  action?: { label: string; onClick(): void; testId: string };
}) {
  const { t } = useTranslation();
  const text = problemText(problem, t);
  // The same line can prove more than one value: one button for each.
  const seen = new Set<string>();
  const evidence = problem.evidence.filter((e) => {
    const key = `${e.device}|${e.file ?? ''}|${sourceRange(e.src)?.[0] ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <Paper
      withBorder
      p="xs"
      className={`ncv-problem ncv-problem-${problem.severity}`}
      data-testid="problem"
      data-code={problem.code}
      data-severity={problem.severity}
      data-unverified={problem.unverified ? 'yes' : undefined}
    >
      <Stack gap={4}>
        <Group gap={6} wrap="nowrap" align="flex-start">
          <SeverityBadge problem={problem} size="xs" />
          <Text size="sm" fw={600} style={{ overflowWrap: 'anywhere' }} data-testid="problem-title">
            {text.title}
          </Text>
        </Group>
        <Text size="xs" data-testid="problem-why">
          {text.why}
        </Text>
        <Text size="xs" data-testid="problem-fix">
          <Text span inherit fw={600}>
            {t('problems.fixLabel')}
          </Text>{' '}
          {text.fix}
        </Text>
        {(evidence.length > 0 || action) && (
          <Group gap={4}>
            {evidence.map((e, i) => (
              <EvidenceButton key={i} evidence={e} />
            ))}
            {action && (
              <Button
                size="compact-xs"
                variant="light"
                rightSection={<IconArrowRight size={12} />}
                onClick={action.onClick}
                data-testid={action.testId}
              >
                {action.label}
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </Paper>
  );
}

/** The problems of a device with the others of its client, in its summary. */
export function DeviceProblems({ problems }: { problems: Problem[] }) {
  const { t } = useTranslation();
  const { openMap, deviceKey } = useDeviceView();
  if (problems.length === 0) return null;
  return (
    <Box data-testid="device-problems-panel">
      <Text size="sm" mb="xs">
        {t('problems.deviceIntro', { count: problems.length })}
      </Text>
      <Stack gap="xs">
        {problems.map((p) => (
          <ProblemItem
            key={p.id}
            problem={p}
            action={{
              label: t('problems.showOnMap'),
              testId: 'problem-show-map',
              onClick: () =>
                openMap(
                  p.link
                    ? { kind: 'link', id: p.link }
                    : { kind: 'node', id: deviceKey ?? p.devices[0]! },
                ),
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}

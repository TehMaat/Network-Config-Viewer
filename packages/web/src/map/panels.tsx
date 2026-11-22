// What the map shows beside the drawing (#15): the two sides of a link, a device or an
// external node, with the lines of the configurations and of the shows they come from.

import { Badge, Box, Button, Group, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowRight, IconCode, IconTerminal2 } from '@tabler/icons-react';
import type { Infrastructure, Link, LinkEvidence, LinkSource } from '@ncv/core';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { sourceRange } from '../views/source';
import { endLabel, kindLabel, linkRows, side, type ModelOf } from './details';

export interface PanelProps {
  infra: Infrastructure;
  modelOf: ModelOf;
  onOpenFile(id: string, line?: number): void;
  onSelectLink(id: string): void;
}

/** Opens the configuration of a device, or a file of shows, at the first line of a source. */
function EvidenceButton({
  evidence,
  infra,
  onOpenFile,
}: {
  evidence: LinkEvidence;
  infra: Infrastructure;
  onOpenFile: PanelProps['onOpenFile'];
}) {
  const { t } = useTranslation();
  const device = infra.devices.find((d) => d.key === evidence.device);
  const range = sourceRange(evidence.src);
  const file = evidence.file ?? device?.file;
  if (!file || !range) return null;
  const label = evidence.file
    ? t('map.evidence.show', { device: device?.hostname ?? evidence.device, line: range[0] })
    : t('map.evidence.config', { device: device?.hostname ?? evidence.device, line: range[0] });
  return (
    <Button
      size="compact-xs"
      variant="subtle"
      leftSection={evidence.file ? <IconTerminal2 size={14} /> : <IconCode size={14} />}
      onClick={() => onOpenFile(file, range[0])}
      data-testid="map-evidence"
      data-file={file}
      data-line={range[0]}
    >
      {label}
    </Button>
  );
}

function sourceText(source: LinkSource, infra: Infrastructure, t: TFunction) {
  const device = infra.devices.find((d) => d.key === source.device)?.hostname ?? source.device;
  return t(`map.source.${source.kind}`, { device, text: source.text ?? '' });
}

export function LinkPanel({ link, ...props }: PanelProps & { link: Link }) {
  const { t } = useTranslation();
  const { infra, modelOf, onOpenFile } = props;
  const a = side(infra, link.a, modelOf);
  const b = side(infra, link.b, modelOf);
  const rows = linkRows(link, infra, modelOf, t);
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
          <Badge
            variant="light"
            color={link.verified ? 'teal' : 'gray'}
            tt="none"
            data-testid="map-link-verified"
            data-verified={link.verified}
          >
            {link.verified ? t('map.verified') : t('map.inferred')}
          </Badge>
          {link.dialup && (
            <Badge variant="light" color="grape" tt="none">
              {t('map.dialup')}
            </Badge>
          )}
        </Group>
        <Title order={4} style={{ overflowWrap: 'anywhere' }}>
          {a.name} ↔ {b.name}
        </Title>
      </Box>
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
            <Table.Tr key={r.key} data-testid="map-link-row" data-row={r.key}>
              <Table.Td fw={600}>{r.label}</Table.Td>
              <Table.Td style={{ overflowWrap: 'anywhere' }}>{r.a || '—'}</Table.Td>
              <Table.Td style={{ overflowWrap: 'anywhere' }}>{r.b || '—'}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
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
                  <EvidenceButton key={j} evidence={e} infra={infra} onOpenFile={onOpenFile} />
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
      {device && (
        <Button
          rightSection={<IconArrowRight size={14} />}
          onClick={() => onOpenFile(device.file)}
          data-testid="map-open-device"
        >
          {t('map.openViews')}
        </Button>
      )}
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

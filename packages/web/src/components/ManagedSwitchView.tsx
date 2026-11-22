// A FortiSwitch managed by a FortiGate (#15, part 4), as a device of its own: its ports and its
// VLANs, from the configuration of the FortiGate, with the MACs of the shows of the FortiGate.
// Every element opens its lines in the configuration of the FortiGate.

import {
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import {
  hostKey,
  vlanGateways,
  type DeviceModel,
  type DeviceState,
  type Infrastructure,
  type ManagedSwitch,
} from '@ncv/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { safeFileName } from '../export/download';
import { peersOf, problemsOf, type MapFocus } from '../state/infra';
import type { TextEntry } from '../state/files';
import { PortsView } from '../views/PortsView';
import { DeviceProblems, problemsSummary } from '../views/problems';
import {
  DeviceViewContext,
  ShowSourceButton,
  sourceRange,
  type DeviceViewApi,
} from '../views/source';
import { VlansView } from '../views/VlansView';

type Tab = 'summary' | 'ports' | 'vlans';
const TABS: Tab[] = ['summary', 'ports', 'vlans'];

export interface ManagedSwitchViewProps {
  /** The configuration of the FortiGate that manages the switch. */
  fortigate: TextEntry;
  fortigateName: string;
  sw: ManagedSwitch;
  /** The switch as a device: its model and its state, from the FortiGate. */
  model: DeviceModel;
  state: DeviceState | null;
  infra: Infrastructure;
  modelOf(key: string): DeviceModel | null;
  onOpenFile(id: string, line?: number): void;
  onOpenMap(focus: MapFocus): void;
  fileName(id: string): string;
}

export function ManagedSwitchView({
  fortigate,
  fortigateName,
  sw,
  model,
  state,
  infra,
  modelOf,
  onOpenFile,
  onOpenMap,
  fileName,
}: ManagedSwitchViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('ports');
  const key = hostKey(sw.name);
  const api = useMemo<DeviceViewApi>(
    () => ({
      // The lines of the switch are lines of the configuration of the FortiGate.
      showSource: (src) => {
        const range = sourceRange(src);
        if (range) onOpenFile(fortigate.id, range[0]);
      },
      state,
      openFile: onOpenFile,
      fileName,
      exportName: safeFileName(sw.name),
      peers: peersOf(infra, sw.name),
      infra,
      deviceKey: key,
      gatewaysOf: (vlan: number) => vlanGateways(infra, modelOf, key, vlan),
      openMap: onOpenMap,
    }),
    [fortigate.id, state, onOpenFile, fileName, sw.name, infra, key, modelOf, onOpenMap],
  );
  const live = state?.managedSwitches[0];
  const problems = problemsOf(infra, key);
  const trunks = sw.ports.filter((p) => p.kind === 'lag');
  const physical = sw.ports.filter((p) => p.kind === 'physical');
  const fact = (label: string, value: string | number) => (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={500} style={{ overflowWrap: 'anywhere' }}>
        {value === '' ? '—' : value}
      </Text>
    </div>
  );
  const view = (name: Tab) => {
    switch (name) {
      case 'ports':
        return <PortsView model={model} />;
      case 'vlans':
        return <VlansView model={model} />;
      default:
        return (
          <Stack gap="md" p="md" data-testid="managed-summary">
            <Paper withBorder p="sm">
              <Title order={5} mb="xs">
                {t('summary.device')}
              </Title>
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="sm">
                {fact(t('managed.col.serial'), sw.serial)}
                {fact(t('managed.col.model'), sw.model ?? '')}
                {fact(t('managed.col.fortilink'), sw.fortilink ?? '')}
                {fact(t('managed.col.version'), live?.version ?? '')}
                {fact(t('managed.col.address'), live?.address ?? '')}
                {fact(t('managed.col.ports'), physical.length)}
                {fact(
                  t('managed.col.poe'),
                  physical.filter((p) => p.poe && p.poe.mode !== 'never').length,
                )}
                {fact(t('managed.col.down'), physical.filter((p) => p.shutdown).length)}
              </SimpleGrid>
            </Paper>
            {trunks.length > 0 && (
              <Paper withBorder p="sm" data-testid="managed-trunks">
                <Title order={5} mb="xs">
                  {t('managed.trunks')}
                </Title>
                <Stack gap={4}>
                  {trunks.map((trunk) => (
                    <Group key={trunk.name} gap="xs" data-testid="managed-trunk">
                      <Text size="sm" fw={600}>
                        {trunk.name}
                      </Text>
                      {trunk.trunkRole && (
                        <Badge size="sm" variant="light" tt="none">
                          {t(`managed.mclag.${trunk.trunkRole}`)}
                        </Badge>
                      )}
                      <Text size="sm">{(trunk.members ?? []).join(', ')}</Text>
                      {trunk.description && (
                        <Text size="sm" c="dimmed">
                          {trunk.description}
                        </Text>
                      )}
                    </Group>
                  ))}
                </Stack>
              </Paper>
            )}
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
          </Stack>
        );
    }
  };

  return (
    <DeviceViewContext.Provider value={api}>
      <Stack
        gap={0}
        className="ncv-file-view"
        data-testid="managed-switch-view"
        data-serial={sw.serial}
      >
        <Box p="md" pb="sm" className="ncv-file-header ncv-file-header-compact">
          <Group justify="space-between" align="flex-start" gap="xs">
            <Box miw={0}>
              <Title order={3} data-testid="managed-title">
                {sw.name}
              </Title>
              <Text size="sm" c="dimmed">
                {t('managed.by', { fortigate: fortigateName, fortilink: sw.fortilink ?? '—' })}
              </Text>
            </Box>
            <Group gap={6}>
              {sw.model && (
                <Badge variant="default" tt="none">
                  {sw.model}
                </Badge>
              )}
              <Badge variant="default" tt="none">
                {sw.serial}
              </Badge>
              {live && (
                <Group gap={2} wrap="nowrap">
                  <Badge
                    variant="light"
                    tt="none"
                    color={live.status === 'up' ? 'teal' : 'red'}
                    data-testid="managed-status"
                  >
                    {live.statusText}
                  </Badge>
                  <ShowSourceButton item={live} />
                </Group>
              )}
              <Button
                size="compact-sm"
                variant="light"
                rightSection={<IconArrowRight size={14} />}
                onClick={() => onOpenFile(fortigate.id)}
                data-testid="btn-open-fortigate"
              >
                {t('managed.openFortigate', { fortigate: fortigateName })}
              </Button>
            </Group>
          </Group>
        </Box>
        <Tabs
          value={tab}
          onChange={(value) => value && setTab(value as Tab)}
          keepMounted={false}
          className="ncv-tabs ncv-tabs-grow"
        >
          <Tabs.List className="ncv-tab-list">
            {TABS.map((name) => (
              <Tabs.Tab key={name} value={name} data-testid={`tab-${name}`}>
                {t(`tabs.${name}`)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          {TABS.map((name) => (
            <Tabs.Panel key={name} value={name} className="ncv-tab-panel">
              {view(name)}
            </Tabs.Panel>
          ))}
        </Tabs>
      </Stack>
    </DeviceViewContext.Provider>
  );
}

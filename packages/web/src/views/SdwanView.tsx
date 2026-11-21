import { Badge, Group, Paper, Stack, Table, Text, Title } from '@mantine/core';
import type { LogicalContext, Sdwan, SdwanServiceState, SlaState } from '@ncv/core';
import { useTranslation } from 'react-i18next';
import { ShowSourceButton, SourceButton, useDeviceView, Value } from './source';

/** SD-WAN of a VDOM: zones and members, health checks with their SLAs, rules in order. */
export function SdwanView({ context }: { context: LogicalContext }) {
  const { t } = useTranslation();
  const { state } = useDeviceView();
  const sdwan = context.sdwan;
  const inContext = <T extends { context?: string }>(items: T[]) =>
    items.filter((x) => !x.context || x.context === context.name);
  const sla = inContext(state?.sla ?? []);
  const services = inContext(state?.sdwanServices ?? []);
  if (!sdwan) {
    return (
      <Text p="md" size="sm" c="dimmed">
        {t('sdwan.none')}
      </Text>
    );
  }
  const memberName = (seq: number) =>
    sdwan.members.find((m) => m.seq === seq)?.interface ?? String(seq);
  return (
    <Stack gap="md" p="md" data-testid="view-sdwan">
      <Group gap="xs">
        <Badge color={sdwan.enabled ? 'teal' : 'gray'} variant="light" tt="none">
          {sdwan.enabled ? t('sdwan.enabled') : t('sdwan.disabled')}
        </Badge>
        <SourceButton src={sdwan.src} />
      </Group>

      <Paper withBorder p="sm" data-testid="sdwan-members">
        <Title order={5} mb="xs">
          {t('sdwan.members')}
        </Title>
        <Table fz="sm" verticalSpacing={2}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('sdwan.col.seq')}</Table.Th>
              <Table.Th>{t('sdwan.col.interface')}</Table.Th>
              <Table.Th>{t('sdwan.col.zone')}</Table.Th>
              <Table.Th>{t('sdwan.col.gateway')}</Table.Th>
              <Table.Th>{t('sdwan.col.cost')}</Table.Th>
              <Table.Th>{t('sdwan.col.priority')}</Table.Th>
              <Table.Th>{t('ports.col.state')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sdwan.members.map((m) => (
              <Table.Tr key={m.seq}>
                <Table.Td>{m.seq}</Table.Td>
                <Table.Td ff="monospace">{m.interface}</Table.Td>
                <Table.Td>
                  <Value element={m} field="zone">
                    {m.zone}
                  </Value>
                </Table.Td>
                <Table.Td ff="monospace">{m.gateway ?? '—'}</Table.Td>
                <Table.Td>{m.cost ?? 0}</Table.Td>
                <Table.Td>{m.priority ?? '—'}</Table.Td>
                <Table.Td>{m.enabled ? t('ports.state.up') : t('policies.disabled')}</Table.Td>
                <Table.Td>
                  <SourceButton src={m.src} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Paper withBorder p="sm" data-testid="sdwan-health-checks">
        <Title order={5} mb="xs">
          {t('sdwan.healthChecks')}
        </Title>
        <Table fz="sm" verticalSpacing={2}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('sdwan.col.name')}</Table.Th>
              <Table.Th>{t('sdwan.col.servers')}</Table.Th>
              <Table.Th>{t('sdwan.col.protocol')}</Table.Th>
              <Table.Th>{t('sdwan.members')}</Table.Th>
              <Table.Th>SLA</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sdwan.healthChecks.map((h) => (
              <Table.Tr key={h.name}>
                <Table.Td ff="monospace" fw={600}>
                  {h.name}
                </Table.Td>
                <Table.Td ff="monospace">{h.servers.join(' ')}</Table.Td>
                <Table.Td>
                  <Value element={h} field="protocol">
                    {h.protocol}
                  </Value>
                </Table.Td>
                <Table.Td>{h.members.map(memberName).join(', ')}</Table.Td>
                <Table.Td>
                  {h.sla.map((s) => (
                    <Text key={s.id} size="xs">
                      {t('sdwan.sla', {
                        id: s.id,
                        latency: s.latency ?? '',
                        jitter: s.jitter ?? '',
                        packetloss: s.packetloss ?? '',
                      })}
                    </Text>
                  ))}
                </Table.Td>
                <Table.Td>
                  <SourceButton src={h.src} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      {sla.length > 0 && <LiveHealth sla={sla} />}

      <Rules sdwan={sdwan} memberName={memberName} services={services} />
    </Stack>
  );
}

/** Health checks in the shows: every member with its measures and the SLAs it meets. */
function LiveHealth({ sla }: { sla: SlaState[] }) {
  const { t } = useTranslation();
  return (
    <Paper withBorder p="sm" data-testid="sdwan-live">
      <Title order={5} mb="xs">
        {t('sdwan.live')}
      </Title>
      <Table fz="sm" verticalSpacing={2}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('sdwan.col.name')}</Table.Th>
            <Table.Th>{t('sdwan.col.interface')}</Table.Th>
            <Table.Th>{t('ports.col.state')}</Table.Th>
            <Table.Th>{t('sdwan.col.measures')}</Table.Th>
            <Table.Th>SLA</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sla.map((x) => (
            <Table.Tr
              key={`${x.healthCheck}-${x.seq}`}
              data-testid="sdwan-live-row"
              data-ok={x.alive && (x.slaMap ?? 0) > 0}
            >
              <Table.Td ff="monospace">{x.healthCheck}</Table.Td>
              <Table.Td ff="monospace">{x.member}</Table.Td>
              <Table.Td>
                <Badge size="sm" variant="dot" color={x.alive ? 'teal' : 'red'} tt="none">
                  {x.alive ? t('sdwan.alive') : t('sdwan.dead')}
                </Badge>
              </Table.Td>
              <Table.Td>
                {x.latency !== undefined
                  ? t('sdwan.measures', {
                      latency: x.latency,
                      jitter: x.jitter ?? 0,
                      packetloss: x.packetLoss ?? 0,
                    })
                  : ''}
              </Table.Td>
              <Table.Td>
                <Badge
                  size="sm"
                  variant="light"
                  color={(x.slaMap ?? 0) > 0 ? 'teal' : 'orange'}
                  tt="none"
                >
                  {(x.slaMap ?? 0) > 0 ? t('sdwan.slaMet') : t('sdwan.slaMissed')}
                </Badge>
              </Table.Td>
              <Table.Td>
                <ShowSourceButton item={x} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

function Rules({
  sdwan,
  memberName,
  services,
}: {
  sdwan: Sdwan;
  memberName(seq: number): string;
  services: SdwanServiceState[];
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder p="sm" data-testid="sdwan-rules">
      <Title order={5} mb={4}>
        {t('sdwan.rules')}
      </Title>
      <Text size="xs" c="dimmed" mb="xs">
        {t('sdwan.rulesHelp')}
      </Text>
      <Table fz="sm" verticalSpacing={2}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('sdwan.col.seq')}</Table.Th>
            <Table.Th>{t('sdwan.col.name')}</Table.Th>
            <Table.Th>{t('sdwan.col.mode')}</Table.Th>
            <Table.Th>{t('sdwan.col.match')}</Table.Th>
            <Table.Th>{t('sdwan.col.quality')}</Table.Th>
            <Table.Th>{t('sdwan.col.preferred')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sdwan.rules.map((r) => (
            <Table.Tr
              key={r.id}
              data-testid="sdwan-rule"
              style={r.enabled ? undefined : { opacity: 0.5 }}
            >
              <Table.Td>{r.id}</Table.Td>
              <Table.Td fw={600}>{r.name ?? ''}</Table.Td>
              <Table.Td>
                <Value element={r} field="mode">
                  {t(`sdwan.mode.${r.mode}`, { defaultValue: r.mode })}
                </Value>
              </Table.Td>
              <Table.Td>
                <Text size="xs" ff="monospace">
                  {[
                    r.srcaddr.length > 0 && t('sdwan.from', { names: r.srcaddr.join(', ') }),
                    r.dstaddr.length > 0 && t('sdwan.to', { names: r.dstaddr.join(', ') }),
                    r.internetService.length > 0 && r.internetService.join(', '),
                    r.application.length > 0 && r.application.join(', '),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Table.Td>
              <Table.Td>
                {[
                  r.healthCheck,
                  ...r.sla.map((s) =>
                    s.id !== undefined ? `${s.healthCheck} #${s.id}` : s.healthCheck,
                  ),
                ]
                  .filter(Boolean)
                  .join(', ')}
              </Table.Td>
              <Table.Td>
                {[...r.priorityMembers.map(memberName), ...r.priorityZones].join(' › ')}
                {(() => {
                  // The member the rule uses now: the first alive one chosen in the shows.
                  const service = services.find((x) => x.id === r.id);
                  const used = service?.members.find((m) => m.selected && m.alive);
                  return used ? (
                    <Badge
                      size="xs"
                      color="teal"
                      variant="light"
                      tt="none"
                      ml={6}
                      data-testid="sdwan-rule-used"
                    >
                      {t('sdwan.used', { name: used.interface })}
                    </Badge>
                  ) : null;
                })()}
              </Table.Td>
              <Table.Td>
                <SourceButton src={r.src} />
              </Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr data-testid="sdwan-implicit-rule">
            <Table.Td>—</Table.Td>
            <Table.Td fw={600}>{t('sdwan.implicit')}</Table.Td>
            <Table.Td colSpan={5}>
              <Text size="xs" c="dimmed">
                {t('sdwan.implicitHelp')}
              </Text>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

import { Anchor, Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconDeviceDesktopAnalytics } from '@tabler/icons-react';
import type { AssignReason, ShowFile } from '@ncv/core';
import { useTranslation } from 'react-i18next';
import type { TextEntry } from '../state/files';

interface Props {
  show: ShowFile;
  device: { device: TextEntry; reason: AssignReason } | null;
  onOpenFile(id: string, line?: number): void;
  onGoToLine(line: number): void;
}

/** A file of shows: the device it belongs to and the commands it contains. */
export function ShowPanel({ show, device, onOpenFile, onGoToLine }: Props) {
  const { t } = useTranslation();
  // Commands with no output (such as "terminal length 0") are not worth listing.
  const outputs = show.outputs.filter((o) => o.to >= o.from);
  return (
    <Paper withBorder p="sm" mt="sm" data-testid="show-panel">
      <Group justify="space-between" align="flex-start" mb="xs" wrap="wrap">
        <Title order={5}>{t('shows.title')}</Title>
        {device ? (
          <Group gap="xs" data-testid="show-device" data-device={device.device.name}>
            <Text size="sm">
              {t('shows.device', { name: device.device.name })}{' '}
              <Text span size="xs" c="dimmed">
                ({t(`shows.reason.${device.reason}`)})
              </Text>
            </Text>
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconDeviceDesktopAnalytics size={14} />}
              onClick={() => onOpenFile(device.device.id)}
              data-testid="btn-open-device"
            >
              {t('shows.openDevice')}
            </Button>
          </Group>
        ) : (
          <Text size="sm" c="orange" data-testid="show-device" data-device="">
            {t('shows.noDevice')}
          </Text>
        )}
      </Group>
      <Stack gap={2}>
        {outputs.map((o) => (
          <Group key={o.line} gap="xs" wrap="nowrap" data-testid="show-command" data-read={o.read}>
            <Anchor
              component="button"
              type="button"
              size="sm"
              ff="monospace"
              onClick={() => onGoToLine(o.line)}
            >
              {o.command}
            </Anchor>
            {o.context && (
              <Badge size="xs" variant="outline" tt="none">
                {o.context}
              </Badge>
            )}
            {!o.typed && (
              <Text span size="xs" c="dimmed">
                {t('shows.inferred')}
              </Text>
            )}
            <Badge size="xs" variant="light" color={o.read ? 'teal' : 'gray'} tt="none">
              {o.read ? t('shows.read') : t('shows.notRead')}
            </Badge>
          </Group>
        ))}
      </Stack>
    </Paper>
  );
}

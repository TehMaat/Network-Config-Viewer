import { Button, Center, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconFolderOpen, IconShieldLock, IconUpload } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

/** Shown when no file is loaded: everything can be dropped anywhere in the window. */
export function EmptyState({ onChoose }: { onChoose(): void }) {
  const { t } = useTranslation();
  return (
    <Center p="xl" mih="calc(100dvh - 56px)">
      <Paper
        withBorder
        radius="lg"
        p="xl"
        maw={640}
        w="100%"
        className="ncv-drop-target"
        data-testid="empty-state"
      >
        <Stack align="center" gap="md" ta="center">
          <ThemeIcon size={64} radius="xl" variant="light">
            <IconUpload size={32} />
          </ThemeIcon>
          <Title order={2} size="h3">
            {t('drop.title')}
          </Title>
          <Text c="dimmed">{t('drop.hint')}</Text>
          <Button
            size="md"
            leftSection={<IconFolderOpen size={18} />}
            onClick={onChoose}
            data-testid="btn-choose"
          >
            {t('drop.choose')}
          </Button>
          <Text size="sm" c="dimmed">
            <IconShieldLock size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {t('drop.privacy')}
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
}

import {
  Button,
  Center,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconBriefcase,
  IconFileImport,
  IconFolderOpen,
  IconPlus,
  IconShieldLock,
  IconUpload,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { ClientSummary } from '../archive/api';
import type { Archive } from '../archive/useArchive';
import { ArchiveError, type ClientDialog } from './ClientBar';

interface Props {
  onChoose(): void;
  archive: Archive;
  onDialog(dialog: ClientDialog): void;
  onImport(): void;
}

/**
 * Shown when no file is loaded: everything can be dropped anywhere in the window. Without a
 * client open, the clients of the archive are listed below.
 */
export function EmptyState({ onChoose, archive, onDialog, onImport }: Props) {
  const { t } = useTranslation();
  const { available, current, clients } = archive.state;
  return (
    <Center p="xl" mih="calc(100dvh - 56px)">
      <Stack maw={720} w="100%" gap="lg">
        <Paper
          withBorder
          radius="lg"
          p="xl"
          className="ncv-drop-target"
          data-testid="empty-state"
          data-archive={available === null ? 'checking' : available ? 'yes' : 'no'}
        >
          <Stack align="center" gap="md" ta="center">
            <ThemeIcon size={64} radius="xl" variant="light">
              <IconUpload size={32} />
            </ThemeIcon>
            <Title order={2} size="h3">
              {current ? t('drop.titleClient', { name: current.name }) : t('drop.title')}
            </Title>
            <Text c="dimmed">{current ? t('drop.hintClient') : t('drop.hint')}</Text>
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
              {available ? t('drop.privacyArchive') : t('drop.privacy')}
            </Text>
          </Stack>
        </Paper>
        {available && !current && (
          <Stack gap="sm" data-testid="clients-start">
            <Group justify="space-between">
              <Title order={3} size="h4">
                {t('clients.title')}
              </Title>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconFileImport size={14} />}
                  onClick={onImport}
                  data-testid="btn-start-import"
                >
                  {t('clients.import')}
                </Button>
                <Button
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => onDialog({ type: 'create' })}
                  data-testid="btn-start-new"
                >
                  {t('clients.new')}
                </Button>
              </Group>
            </Group>
            <ArchiveError archive={archive} />
            {clients.length === 0 ? (
              <Text size="sm" c="dimmed">
                {t('clients.startEmpty')}
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
                {clients.map((client) => (
                  <ClientCard
                    key={client.id}
                    client={client}
                    onOpen={() => void archive.open(client.id)}
                  />
                ))}
              </SimpleGrid>
            )}
          </Stack>
        )}
      </Stack>
    </Center>
  );
}

function ClientCard({ client, onOpen }: { client: ClientSummary; onOpen(): void }) {
  const { t, i18n } = useTranslation();
  return (
    <UnstyledButton onClick={onOpen} data-testid="client-card" data-client={client.name}>
      <Paper withBorder radius="md" p="sm" className="ncv-client-card">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" size="lg">
            <IconBriefcase size={18} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text fw={600} size="sm" truncate="end">
              {client.name}
            </Text>
            <Text size="xs" c="dimmed">
              {t('clients.cardInfo', {
                count: client.files,
                date: new Date(client.updatedAt).toLocaleDateString(i18n.language),
              })}
            </Text>
          </div>
        </Group>
      </Paper>
    </UnstyledButton>
  );
}

import {
  ActionIcon,
  Box,
  Group,
  Loader,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconFileText,
  IconFileUnknown,
  IconTerminal2,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { baseName, formatOrigin, formatPath } from '../format';
import { effectiveDetection } from '../state/effective';
import type { FileEntry, TextEntry } from '../state/files';

interface Props {
  files: FileEntry[];
  selectedId: string | null;
  processing: boolean;
  onSelect(id: string): void;
  onRemove(id: string): void;
  onClear(): void;
}

export function FileList({ files, selectedId, processing, onSelect, onRemove, onClear }: Props) {
  const { t } = useTranslation();
  return (
    <Stack gap={0} h="100%">
      <Group justify="space-between" px="sm" py="xs" className="ncv-list-header">
        <Text fw={600} size="sm">
          {t('files.title')}
          <Text span c="dimmed" size="sm" ml={6} data-testid="file-count">
            {t('files.count', { count: files.length })}
          </Text>
        </Text>
        {files.length > 0 && (
          <Tooltip label={t('files.clear')}>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={onClear}
              aria-label={t('files.clear')}
              data-testid="btn-clear"
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {processing && (
        <Group gap="xs" px="sm" py="xs" data-testid="processing">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            {t('files.processing')}
          </Text>
        </Group>
      )}
      <ScrollArea flex={1} type="auto" scrollbars="y">
        {files.length === 0 && !processing && (
          <Text size="sm" c="dimmed" px="sm" py="xs">
            {t('files.empty')}
          </Text>
        )}
        {files.map((file) => (
          <FileItem
            key={file.id}
            file={file}
            active={file.id === selectedId}
            onSelect={() => onSelect(file.id)}
            onRemove={() => onRemove(file.id)}
          />
        ))}
      </ScrollArea>
    </Stack>
  );
}

function FileItem({
  file,
  active,
  onSelect,
  onRemove,
}: {
  file: FileEntry;
  active: boolean;
  onSelect(): void;
  onRemove(): void;
}) {
  const { t } = useTranslation();
  const name = file.type === 'text' ? file.name : baseName(file.path.at(-1) ?? '');
  const origin = formatOrigin(file.path, name);
  return (
    <Group
      gap={0}
      wrap="nowrap"
      className="ncv-file-item"
      data-testid="file-item"
      data-file-name={name}
      data-status={file.type}
    >
      <NavLink
        component="button"
        type="button"
        active={active}
        onClick={onSelect}
        title={formatPath(file.path)}
        style={{ flex: 1, minWidth: 0 }}
        label={
          <Text size="sm" fw={500} truncate="end">
            {name}
          </Text>
        }
        description={
          <Box component="span" display="block">
            {origin && (
              <Text size="xs" c="dimmed" truncate="end" span display="block">
                {origin}
              </Text>
            )}
            <Text
              size="xs"
              c={file.type === 'issue' ? 'orange' : 'dimmed'}
              truncate="end"
              span
              display="block"
            >
              {file.type === 'issue' ? t('files.unreadable') : <Summary file={file} />}
            </Text>
          </Box>
        }
        leftSection={<FileIcon file={file} />}
      />
      <Tooltip label={t('files.remove')} openDelay={400}>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          mx={6}
          aria-label={t('files.remove')}
          onClick={onRemove}
          data-testid="btn-remove"
        >
          <IconX size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function FileIcon({ file }: { file: FileEntry }) {
  if (file.type === 'issue')
    return <IconAlertTriangle size={18} color="var(--mantine-color-orange-6)" />;
  const kind = effectiveDetection(file.detection, file.overrides).kind.value;
  if (kind === 'show') return <IconTerminal2 size={18} />;
  if (kind === 'config') return <IconFileText size={18} />;
  return <IconFileUnknown size={18} />;
}

function Summary({ file }: { file: TextEntry }) {
  const { t } = useTranslation();
  const e = effectiveDetection(file.detection, file.overrides);
  const parts: string[] = [];
  if (e.os.value)
    parts.push(t(`os.${e.os.value}`) + (e.version.value ? ` ${e.version.value}` : ''));
  else if (e.vendor.value) parts.push(t(`vendor.${e.vendor.value}`));
  if (e.model.value) parts.push(e.model.value);
  if (e.hostname.value) parts.push(e.hostname.value);
  if (e.kind.value !== 'config') parts.unshift(t(`kind.${e.kind.value ?? 'unknown'}`));
  return <>{parts.join(' · ')}</>;
}

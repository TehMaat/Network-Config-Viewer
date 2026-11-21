import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Loader,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCloudX,
  IconFileText,
  IconFileUnknown,
  IconPin,
  IconPinnedOff,
  IconServer2,
  IconTerminal2,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { baseName, formatOrigin, formatPath } from '../format';
import type { ShowLinks } from '../state/devices';
import { effectiveDetection } from '../state/effective';
import type { FileEntry, TextEntry } from '../state/files';
import { fileDate, type DeviceGroup } from '../state/groups';

interface Props {
  files: FileEntry[];
  /** Configurations grouped by device, with the current one and the previous versions. */
  groups: DeviceGroup[];
  deviceOf: ShowLinks['deviceOf'];
  selectedId: string | null;
  processing: boolean;
  /** A client is open: the files are saved in its archive. */
  clientOpen: boolean;
  onSelect(id: string): void;
  onRemove(id: string): void;
  onClear(): void;
  onPin(entry: TextEntry, pinned: boolean): void;
}

type Role = 'current' | 'version' | 'show';

const CURRENT: Role = 'current';
const VERSION: Role = 'version';
const SHOW: Role = 'show';

export function FileList({
  files,
  groups,
  deviceOf,
  selectedId,
  processing,
  clientOpen,
  onSelect,
  onRemove,
  onClear,
  onPin,
}: Props) {
  const { t } = useTranslation();
  // Every device with its versions and shows; the other files after them.
  const { devices, rest } = useMemo(() => {
    const devices = groups.map((group) => ({
      group,
      shows: files.filter(
        (f): f is TextEntry =>
          f.type === 'text' && deviceOf.get(f.id)?.device.id === group.current.id,
      ),
    }));
    const placed = new Set(
      devices.flatMap(({ group, shows }) => [
        group.current.id,
        ...group.versions.map((v) => v.id),
        ...shows.map((s) => s.id),
      ]),
    );
    return { devices, rest: files.filter((f) => !placed.has(f.id)) };
  }, [files, groups, deviceOf]);
  const item = (file: FileEntry, role?: Role, extra?: { pinned?: boolean; pinnable?: boolean }) => (
    <FileItem
      key={file.id}
      file={file}
      role={role}
      clientOpen={clientOpen}
      active={file.id === selectedId}
      onSelect={() => onSelect(file.id)}
      onRemove={() => onRemove(file.id)}
      {...(file.type === 'text' && extra?.pinnable
        ? { onPin: () => onPin(file, true) }
        : file.type === 'text' && extra?.pinned
          ? { onUnpin: () => onPin(file, false) }
          : {})}
    />
  );
  return (
    <Stack gap={0} flex={1} mih={0}>
      <Group justify="space-between" px="sm" py="xs" className="ncv-list-header">
        <Text fw={600} size="sm">
          {t('files.title')}
          <Text span c="dimmed" size="sm" ml={6} data-testid="file-count">
            {t('files.count', { count: files.length })}
          </Text>
        </Text>
        {files.length > 0 && !clientOpen && (
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
        {devices.map(({ group, shows }) => (
          <Box
            key={group.key}
            className="ncv-device-group"
            data-testid="device-group"
            data-device={group.hostname}
          >
            <UnstyledButton
              className="ncv-device-header"
              onClick={() => onSelect(group.current.id)}
              data-testid="device-header"
            >
              <Group gap={6} wrap="nowrap" px="sm" py={4}>
                <IconServer2 size={14} aria-hidden />
                <Text size="xs" fw={700} truncate="end">
                  {group.hostname}
                </Text>
              </Group>
            </UnstyledButton>
            {item(group.current, CURRENT, { pinned: group.pinned })}
            {group.versions.map((v) => item(v, VERSION, { pinnable: true }))}
            {shows.map((s) => item(s, SHOW))}
          </Box>
        ))}
        {devices.length > 0 && rest.length > 0 && (
          <Text size="xs" fw={700} c="dimmed" px="sm" pt="xs" pb={2} data-testid="other-files">
            {t('files.others')}
          </Text>
        )}
        {rest.map((file) => item(file))}
      </ScrollArea>
    </Stack>
  );
}

function FileItem({
  file,
  role,
  clientOpen,
  active,
  onSelect,
  onRemove,
  onPin,
  onUnpin,
}: {
  file: FileEntry;
  role: Role | undefined;
  clientOpen: boolean;
  active: boolean;
  onSelect(): void;
  onRemove(): void;
  onPin?(): void;
  onUnpin?(): void;
}) {
  const { t } = useTranslation();
  const name = file.type === 'text' ? file.name : baseName(file.path.at(-1) ?? '');
  const origin = formatOrigin(file.path, name);
  const saved =
    file.type !== 'text' || !clientOpen
      ? 'no'
      : file.saveError
        ? 'error'
        : file.archived
          ? 'yes'
          : 'pending';
  return (
    <Group
      gap={0}
      wrap="nowrap"
      className={role ? `ncv-file-item ncv-file-${role}` : 'ncv-file-item'}
      data-testid="file-item"
      data-file-name={name}
      data-status={file.type}
      data-role={role ?? ''}
      data-saved={saved}
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
            {file.type === 'text' && role && role !== 'show' && (
              <VersionLine file={file} role={role} />
            )}
          </Box>
        }
        leftSection={<FileIcon file={file} />}
      />
      {saved === 'pending' && <Loader size={12} mx={4} data-testid="saving" />}
      {saved === 'error' && file.type === 'text' && (
        <Tooltip
          label={t(`clients.error.${file.saveError}`, { defaultValue: t('clients.error.generic') })}
        >
          <IconCloudX size={16} color="var(--mantine-color-orange-6)" data-testid="save-error" />
        </Tooltip>
      )}
      {onPin && (
        <IconAction label={t('files.pin')} onClick={onPin} testId="btn-pin">
          <IconPin size={14} />
        </IconAction>
      )}
      {onUnpin && (
        <IconAction label={t('files.unpin')} onClick={onUnpin} testId="btn-unpin">
          <IconPinnedOff size={14} />
        </IconAction>
      )}
      <Tooltip label={clientOpen ? t('files.delete') : t('files.remove')} openDelay={400}>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          mx={6}
          aria-label={clientOpen ? t('files.delete') : t('files.remove')}
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

function IconAction({
  label,
  onClick,
  testId,
  children,
}: {
  label: string;
  onClick(): void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label} openDelay={300}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        ml={2}
        aria-label={label}
        onClick={onClick}
        data-testid={testId}
      >
        {children}
      </ActionIcon>
    </Tooltip>
  );
}

/** "Current" or "previous", with the date of the version and where it comes from. */
function VersionLine({ file, role }: { file: TextEntry; role: 'current' | 'version' }) {
  const { t, i18n } = useTranslation();
  const date = fileDate(file);
  return (
    <Group component="span" gap={6} wrap="nowrap" mt={2}>
      <Badge
        component="span"
        size="xs"
        variant="light"
        color={role === 'current' ? 'teal' : 'gray'}
        tt="none"
        data-testid="version-badge"
      >
        {role === 'current'
          ? file.pinnedAt
            ? t('files.currentPinned')
            : t('files.current')
          : t('files.previous')}
      </Badge>
      {date && (
        <Text
          span
          size="xs"
          c="dimmed"
          title={t(`files.dateSource.${date.source}`)}
          data-testid="version-date"
          data-date={date.date}
        >
          {new Date(date.date).toLocaleDateString(i18n.language, { timeZone: 'UTC' })}
        </Text>
      )}
    </Group>
  );
}

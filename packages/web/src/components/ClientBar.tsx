import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Menu,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconBriefcase,
  IconCheck,
  IconChevronDown,
  IconDoorExit,
  IconFileExport,
  IconFileImport,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { archiveApi, type ClientSummary } from '../archive/api';
import type { Archive } from '../archive/useArchive';

export type ClientDialog =
  | { type: 'create' }
  | { type: 'rename' }
  | { type: 'delete' }
  | { type: 'switch'; client: ClientSummary }
  | null;

interface BarProps {
  archive: Archive;
  /** Files on the page that are in no client. */
  unsavedCount: number;
  onDialog(dialog: ClientDialog): void;
  onImport(): void;
}

/** The client open in the app, with the actions on the clients of the archive (#10). */
export function ClientBar({ archive, unsavedCount, onDialog, onImport }: BarProps) {
  const { t } = useTranslation();
  const { state } = archive;
  if (state.available === null) return null;
  if (!state.available) {
    return (
      <Text size="xs" c="dimmed" px="sm" py={6} data-testid="archive-unavailable">
        {t('clients.unavailable')}
      </Text>
    );
  }
  const choose = (client: ClientSummary) => {
    if (client.id === state.current?.id) return;
    if (!state.current && unsavedCount > 0) onDialog({ type: 'switch', client });
    else void archive.open(client.id);
  };
  return (
    <Stack gap={6} px="sm" py="xs" className="ncv-client-bar" data-testid="client-bar">
      <Menu position="bottom-start" width={300} onOpen={() => void archive.refresh()}>
        <Menu.Target>
          <Button
            variant="light"
            fullWidth
            justify="space-between"
            leftSection={<IconBriefcase size={16} />}
            rightSection={<IconChevronDown size={14} />}
            data-testid="client-menu"
            data-client={state.current?.name ?? ''}
          >
            <Text span size="sm" fw={600} truncate="end">
              {state.current ? state.current.name : t('clients.none')}
            </Text>
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {/* The actions first: the list of the clients can be long, and scrolls by itself. */}
          {state.current && (
            <>
              <Menu.Label>{state.current.name}</Menu.Label>
              <Menu.Item
                leftSection={<IconPencil size={14} />}
                onClick={() => onDialog({ type: 'rename' })}
                data-testid="btn-client-rename"
              >
                {t('clients.rename')}
              </Menu.Item>
              <Menu.Item
                component="a"
                href={archiveApi.exportUrl(state.current.id)}
                download
                leftSection={<IconFileExport size={14} />}
                data-testid="btn-client-export"
              >
                {t('clients.export')}
              </Menu.Item>
              <Menu.Item
                leftSection={<IconDoorExit size={14} />}
                onClick={archive.close}
                data-testid="btn-client-close"
              >
                {t('clients.close')}
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={() => onDialog({ type: 'delete' })}
                data-testid="btn-client-delete"
              >
                {t('clients.delete')}
              </Menu.Item>
              <Menu.Divider />
            </>
          )}
          <Menu.Item
            leftSection={<IconPlus size={14} />}
            onClick={() => onDialog({ type: 'create' })}
            data-testid="btn-client-new"
          >
            {t('clients.new')}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconFileImport size={14} />}
            onClick={onImport}
            data-testid="btn-client-import"
          >
            {t('clients.import')}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Label>{t('clients.title')}</Menu.Label>
          {state.clients.length === 0 && <Menu.Item disabled>{t('clients.empty')}</Menu.Item>}
          <ScrollArea.Autosize mah={260} type="auto" data-testid="client-options">
            {state.clients.map((client) => (
              <Menu.Item
                key={client.id}
                onClick={() => choose(client)}
                leftSection={
                  client.id === state.current?.id ? (
                    <IconCheck size={14} />
                  ) : (
                    <span className="ncv-icon-space" />
                  )
                }
                rightSection={
                  <Text span size="xs" c="dimmed">
                    {t('clients.fileCount', { count: client.files })}
                  </Text>
                }
                data-testid="client-option"
                data-client={client.name}
              >
                {client.name}
              </Menu.Item>
            ))}
          </ScrollArea.Autosize>
        </Menu.Dropdown>
      </Menu>
      {!state.current && unsavedCount > 0 && (
        <Group justify="space-between" gap="xs" wrap="nowrap" data-testid="unsaved-notice">
          <Text size="xs" c="orange">
            {t('clients.unsaved', { count: unsavedCount })}
          </Text>
          <Button
            size="compact-xs"
            variant="light"
            onClick={() => onDialog({ type: 'create' })}
            data-testid="btn-save-to-client"
          >
            {t('clients.saveTo')}
          </Button>
        </Group>
      )}
      {state.opening && (
        <Group gap="xs" data-testid="client-loading">
          <Loader size="xs" />
          <Text size="xs" c="dimmed">
            {t('clients.opening')}
          </Text>
        </Group>
      )}
      <ArchiveError archive={archive} />
    </Stack>
  );
}

/** The last error of the archive, until dismissed. */
export function ArchiveError({ archive }: { archive: Archive }) {
  const { t } = useTranslation();
  const error = archive.state.error;
  if (!error) return null;
  return (
    <Alert
      color="red"
      variant="light"
      p="xs"
      withCloseButton
      closeButtonLabel={t('clients.dismiss')}
      onClose={archive.dismissError}
      data-testid="archive-error"
      data-error={error}
    >
      <Text size="xs">
        {t(`clients.error.${error}`, { defaultValue: t('clients.error.generic') })}
      </Text>
    </Alert>
  );
}

interface DialogProps {
  archive: Archive;
  dialog: ClientDialog;
  unsavedCount: number;
  onClose(): void;
}

/** Creation, renaming and deletion of clients, and the files on the page when opening one. */
export function ClientDialogs({ archive, dialog, unsavedCount, onClose }: DialogProps) {
  const { t } = useTranslation();
  const current = archive.state.current;
  return (
    <>
      <NameDialog
        key={dialog?.type === 'rename' ? `rename-${current?.id}` : 'create'}
        opened={dialog?.type === 'create' || dialog?.type === 'rename'}
        mode={dialog?.type === 'rename' ? 'rename' : 'create'}
        initial={dialog?.type === 'rename' ? (current?.name ?? '') : ''}
        unsavedCount={dialog?.type === 'create' && !current ? unsavedCount : 0}
        onClose={onClose}
        onSubmit={async (name, keepFiles) =>
          dialog?.type === 'rename' ? archive.rename(name) : archive.create(name, keepFiles)
        }
      />
      <Modal
        opened={dialog?.type === 'delete'}
        onClose={onClose}
        title={t('clients.deleteTitle', { name: current?.name ?? '' })}
      >
        <Stack>
          <Text size="sm">{t('clients.deleteText', { count: current?.files ?? 0 })}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('detection.cancel')}
            </Button>
            <Button
              color="red"
              onClick={() => {
                onClose();
                void archive.removeClient();
              }}
              data-testid="btn-client-delete-confirm"
            >
              {t('clients.deleteConfirm')}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={dialog?.type === 'switch'} onClose={onClose} title={t('clients.switchTitle')}>
        {dialog?.type === 'switch' && (
          <Stack>
            <Text size="sm">
              {t('clients.switchText', { count: unsavedCount, name: dialog.client.name })}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                {t('detection.cancel')}
              </Button>
              <Button
                variant="light"
                color="red"
                onClick={() => {
                  onClose();
                  void archive.open(dialog.client.id);
                }}
                data-testid="btn-switch-discard"
              >
                {t('clients.switchDiscard')}
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  void archive.saveAllTo(dialog.client.id);
                }}
                data-testid="btn-switch-add"
              >
                {t('clients.switchAdd', { name: dialog.client.name })}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}

function NameDialog({
  opened,
  mode,
  initial,
  unsavedCount,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  mode: 'create' | 'rename';
  initial: string;
  unsavedCount: number;
  onClose(): void;
  onSubmit(name: string, keepFiles: boolean): Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const [keepFiles, setKeepFiles] = useState(true);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit(name.trim(), keepFiles);
    setBusy(false);
    if (ok) {
      setName('');
      onClose();
    }
  };
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={mode === 'rename' ? t('clients.renameTitle') : t('clients.newTitle')}
      onEnterTransitionEnd={() => input.current?.focus()}
    >
      <form onSubmit={(event) => void submit(event)}>
        <Stack>
          <TextInput
            ref={input}
            label={t('clients.name')}
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.currentTarget.value)}
            data-testid="input-client-name"
          />
          {unsavedCount > 0 && (
            <Checkbox
              label={t('clients.keepFiles', { count: unsavedCount })}
              checked={keepFiles}
              onChange={(event) => setKeepFiles(event.currentTarget.checked)}
              data-testid="check-keep-files"
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('detection.cancel')}
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={!name.trim()}
              data-testid="btn-client-confirm"
            >
              {mode === 'rename' ? t('clients.renameConfirm') : t('clients.create')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

import { AppShell, Button, Center, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useDisclosure } from '@mantine/hooks';
import { IconUpload } from '@tabler/icons-react';
import { DEFAULT_LIMITS, type MapEdits, type ModelHints } from '@ncv/core';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useArchive } from './archive/useArchive';
import { useMapEdits } from './archive/useMapEdits';
import { AppHeader } from './components/AppHeader';
import { ClientBar, ClientDialogs, type ClientDialog } from './components/ClientBar';
import { EmptyState } from './components/EmptyState';
import { FileList } from './components/FileList';
import { FileView } from './components/FileView';
import { normalizeDroppedPath } from './format';
import { contentStore } from './state/content';
import { deviceState, linkShows } from './state/devices';
import { effectiveDetection, effectiveFamily } from './state/effective';
import {
  filesReducer,
  initialFilesState,
  type FileEntry,
  type Overrides,
  type TextEntry,
} from './state/files';
import { deviceGroups } from './state/groups';
import { buildInfrastructure, MAP_ID, VPN_ID, type MapFocus } from './state/infra';
import { EMPTY_EDITS, structuralEdits } from './state/mapEdits';
import { AnalyzerClient } from './worker/client';
import type { WorkerMessage } from './worker/protocol';

let localIssueCounter = 0;

/** The map of the client, with React Flow and dagre: loaded only when it is opened (#15). */
const MapView = lazy(() => import('./map/MapView'));
/** The VPN of the client: its tunnels, ADVPN and the checks (#15, part 2). */
const ClientVpnView = lazy(() => import('./map/ClientVpnView'));

export function App() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(filesReducer, initialFilesState);
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const client = useRef<AnalyzerClient | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  // The files on the page, for the callbacks of the archive and of the worker.
  const files = useRef<readonly FileEntry[]>([]);
  useEffect(() => {
    files.current = state.files;
  }, [state.files]);

  /** Removes every file from the page; the archive of the client is not touched. */
  const closeFiles = useCallback(() => {
    client.current?.forget(files.current.map((f) => f.id));
    files.current = [];
    contentStore.clear();
    dispatch({ type: 'clear' });
  }, []);

  // The changes made by hand to the map (#15, part 3), as they are now: the archive saves those
  // of the tab with the files of the tab.
  const tabMap = useRef<MapEdits>(EMPTY_EDITS);
  const archive = useArchive({ dispatch, analyzer: client, files, closeFiles, tabMap });
  const mapEdits = useMapEdits(archive.state.current?.id ?? null, tabMap);
  const { take, save } = archive;
  const [dialog, setDialog] = useState<ClientDialog>(null);
  const [confirmDelete, setConfirmDelete] = useState<TextEntry | null>(null);

  /**
   * Every correction can change the structure (syntax family, Small Business dialect) or the
   * model (kind, system, version, model, hostname): the worker rebuilds both.
   */
  const restructure = useCallback((entry: TextEntry, overrides: Overrides) => {
    const effective = effectiveDetection(entry.detection, overrides);
    const family = effectiveFamily(effective);
    const os = effective.os.value;
    const hints: ModelHints = {
      ...(effective.kind.value ? { kind: effective.kind.value } : {}),
      ...(os && !effective.encrypted ? { os } : {}),
      ...(effective.version.value ? { version: effective.version.value } : {}),
      ...(effective.model.value ? { model: effective.model.value } : {}),
      ...(effective.hostname.value ? { hostname: effective.hostname.value } : {}),
    };
    client.current?.restructure(entry.id, family, hints, os);
  }, []);

  const handleMessage = useCallback(
    (message: WorkerMessage) => {
      switch (message.type) {
        case 'text': {
          contentStore.set(message.id, {
            text: message.text,
            bytes: new Uint8Array(message.bytes),
            folds: message.structure.folds,
            outline: message.structure.outline,
            model: message.structure.model,
            show: message.structure.show,
          });
          // A file of the archive comes back with its corrections.
          const record = take(message.archiveId);
          const entry: TextEntry = {
            type: 'text',
            id: message.id,
            path: message.path,
            name: message.name,
            size: message.size,
            encoding: message.encoding,
            bom: message.bom,
            eol: message.eol,
            lineCount: message.lineCount,
            detection: message.detection,
            overrides: (record?.overrides as Overrides | undefined) ?? {},
            family: message.structure.family,
            diagnostics: message.structure.diagnostics,
            structureVersion: 0,
            ...(message.configDate ? { configDate: message.configDate } : {}),
            ...(message.lastModified
              ? { modifiedAt: new Date(message.lastModified).toISOString() }
              : {}),
            ...(record ? { archived: { fileId: record.id, addedAt: record.addedAt } } : {}),
            ...(record?.pinnedAt ? { pinnedAt: record.pinnedAt } : {}),
          };
          files.current = [...files.current, entry];
          dispatch({ type: 'added', entry });
          if (record && Object.keys(record.overrides).length > 0) {
            restructure(entry, entry.overrides);
          }
          // Just loaded: saved in the open client.
          if (!record) void save(entry);
          break;
        }
        case 'issue':
          take(message.archiveId);
          dispatch({
            type: 'added',
            entry: {
              type: 'issue',
              id: message.id,
              path: message.path,
              size: message.size,
              code: message.code,
            },
          });
          break;
        case 'structure':
          contentStore.update(message.id, {
            folds: message.structure.folds,
            outline: message.structure.outline,
            model: message.structure.model,
            show: message.structure.show,
          });
          dispatch({
            type: 'structure',
            id: message.id,
            family: message.structure.family,
            diagnostics: message.structure.diagnostics,
          });
          break;
        case 'done':
          dispatch({ type: 'batch-done', batch: message.batch });
          break;
        case 'error':
          dispatch({
            type: 'added',
            entry: {
              type: 'issue',
              id: `error-${++localIssueCounter}`,
              path: ['—'],
              code: 'worker-error',
              message: message.message,
            },
          });
          if (message.batch !== undefined) dispatch({ type: 'batch-done', batch: message.batch });
          break;
      }
    },
    [restructure, save, take],
  );

  useEffect(() => {
    const instance = new AnalyzerClient(handleMessage);
    client.current = instance;
    return () => {
      instance.dispose();
      client.current = null;
    };
  }, [handleMessage]);

  const addFiles = useCallback(async (picked: File[]) => {
    if (picked.length === 0 || !client.current) return;
    const readable: { name: string; buffer: ArrayBuffer; lastModified?: number }[] = [];
    for (const file of picked) {
      const relative =
        (file as File & { path?: string }).path || file.webkitRelativePath || file.name;
      const name = normalizeDroppedPath(relative) || file.name;
      if (file.size > DEFAULT_LIMITS.maxFileBytes) {
        dispatch({
          type: 'added',
          entry: {
            type: 'issue',
            id: `local-${++localIssueCounter}`,
            path: [name],
            size: file.size,
            code: 'too-large',
          },
        });
        continue;
      }
      readable.push({
        name,
        buffer: await file.arrayBuffer(),
        ...(file.lastModified ? { lastModified: file.lastModified } : {}),
      });
    }
    if (readable.length === 0) return;
    const batch = client.current.load(readable);
    dispatch({ type: 'batch-started', batch });
  }, []);

  const openPicker = () => fileInput.current?.click();
  const openImport = () => importInput.current?.click();

  const select = (id: string) => {
    dispatch({ type: 'select', id });
    closeNav();
  };

  // The map opens on a link or a device when a problem elsewhere asks for it.
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const openMap = useCallback(
    (focus?: MapFocus) => {
      setMapFocus(focus ?? null);
      dispatch({ type: 'select', id: MAP_ID });
      closeNav();
    },
    [closeNav],
  );

  const removeFromPage = (id: string) => {
    contentStore.delete(id);
    client.current?.forget([id]);
    dispatch({ type: 'remove', id });
  };

  // A file of a client is deleted from its archive: the user confirms first.
  const remove = (id: string) => {
    const entry = state.files.find((f) => f.id === id);
    if (entry?.type === 'text' && entry.archived && archive.state.current) {
      setConfirmDelete(entry);
    } else {
      removeFromPage(id);
    }
  };

  const override = (id: string, overrides: Overrides) => {
    const entry = state.files.find((f) => f.id === id);
    if (!entry || entry.type !== 'text') return;
    dispatch({ type: 'override', id, overrides });
    restructure(entry, overrides);
    archive.saveOverrides(entry, overrides);
  };

  const mapOpen = state.selectedId === MAP_ID;
  const vpnOpen = state.selectedId === VPN_ID;
  const selected = state.files.find((f) => f.id === state.selectedId) ?? null;
  const hasFiles = state.files.length > 0 || state.pendingBatches.length > 0;
  const clientOpen = archive.state.current !== null;
  const showNav = hasFiles || clientOpen;
  const unsavedCount = state.files.filter((f) => f.type === 'text' && !f.archived).length;

  // Configurations grouped by device: only the current version of each gets the shows.
  const groups = useMemo(() => deviceGroups(state.files), [state.files]);
  const currentIds = useMemo(() => new Set(groups.map((g) => g.current.id)), [groups]);
  // Files of shows go with the device they describe: its views show the real state.
  const links = useMemo(() => linkShows(state.files, currentIds), [state.files, currentIds]);
  // The devices of the client put together: sites, links and nodes outside the client (#15),
  // with the changes made by hand. The positions change only the drawing, not the links.
  const structure = JSON.stringify(structuralEdits(mapEdits.edits));
  const infra = useMemo(
    () => buildInfrastructure(groups, links, JSON.parse(structure) as MapEdits),
    [groups, links, structure],
  );
  const modelOf = useCallback(
    (key: string) => {
      const file = infra.devices.find((d) => d.key === key)?.file;
      return (file && contentStore.get(file)?.model) || null;
    },
    [infra],
  );
  const { linkedShows, selectedState } = useMemo(() => {
    const shows = state.selectedId ? links.showsOf.get(state.selectedId) : undefined;
    return { linkedShows: shows, selectedState: deviceState(shows) };
  }, [links, state.selectedId]);
  const [goTo, setGoTo] = useState<{ id: string; line: number } | null>(null);
  const openFile = useCallback((id: string, line?: number) => {
    dispatch({ type: 'select', id });
    setGoTo(line === undefined ? null : { id, line });
  }, []);
  const fileName = useCallback(
    (id: string) => {
      const f = state.files.find((x) => x.id === id);
      return f?.type === 'text' ? f.name : id;
    },
    [state.files],
  );

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        data-testid="file-input"
        onChange={(event) => {
          const picked = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void addFiles(picked);
        }}
      />
      <input
        ref={importInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="client-import-input"
        onChange={(event) => {
          const zip = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (zip) void archive.importZip(zip);
        }}
      />
      <AppShell
        header={{ height: 56 }}
        navbar={
          showNav ? { width: 320, breakpoint: 'sm', collapsed: { mobile: !navOpened } } : undefined
        }
        padding={0}
      >
        <AppShell.Header>
          <AppHeader
            navOpened={navOpened}
            onToggleNav={toggleNav}
            onAddFiles={openPicker}
            hasFiles={showNav}
          />
        </AppShell.Header>
        {showNav && (
          <AppShell.Navbar>
            <Stack gap={0} h="100%">
              <ClientBar
                archive={archive}
                unsavedCount={unsavedCount}
                onDialog={setDialog}
                onImport={openImport}
              />
              <FileList
                files={state.files}
                groups={groups}
                infra={infra}
                mapOpen={mapOpen}
                onOpenMap={() => openMap()}
                vpnOpen={vpnOpen}
                onOpenVpn={() => select(VPN_ID)}
                deviceOf={links.deviceOf}
                selectedId={state.selectedId}
                processing={state.pendingBatches.length > 0}
                clientOpen={clientOpen}
                onSelect={select}
                onRemove={remove}
                onClear={closeFiles}
                onPin={archive.pin}
              />
            </Stack>
          </AppShell.Navbar>
        )}
        <AppShell.Main>
          {mapOpen ? (
            <Suspense
              fallback={
                <Center h={200}>
                  <Loader />
                </Center>
              }
            >
              <MapView
                infra={infra}
                modelOf={modelOf}
                onOpenFile={openFile}
                exportName={archive.state.current?.name ?? t('map.exportName')}
                focus={mapFocus}
                edits={mapEdits.edits}
                onEdit={mapEdits.update}
                saveState={mapEdits.state}
              />
            </Suspense>
          ) : vpnOpen ? (
            <Suspense
              fallback={
                <Center h={200}>
                  <Loader />
                </Center>
              }
            >
              <ClientVpnView
                infra={infra}
                modelOf={modelOf}
                onOpenFile={openFile}
                onOpenMap={openMap}
                exportName={archive.state.current?.name ?? t('vpnClient.exportName')}
              />
            </Suspense>
          ) : selected ? (
            <FileView
              key={selected.id}
              entry={selected}
              infra={infra}
              modelOf={modelOf}
              onOpenMap={openMap}
              onOverride={override}
              shows={linkedShows ?? []}
              state={selectedState}
              device={links.deviceOf.get(selected.id) ?? null}
              onOpenFile={openFile}
              fileName={fileName}
              goTo={goTo?.id === selected.id ? goTo.line : null}
              onGoToDone={() => setGoTo(null)}
            />
          ) : (
            !hasFiles && (
              <EmptyState
                onChoose={openPicker}
                archive={archive}
                onDialog={setDialog}
                onImport={openImport}
              />
            )
          )}
        </AppShell.Main>
      </AppShell>
      <ClientDialogs
        archive={archive}
        dialog={dialog}
        unsavedCount={unsavedCount}
        onClose={() => setDialog(null)}
      />
      <Modal
        opened={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('files.deleteTitle')}
      >
        <Stack>
          <Text size="sm">
            {t('files.deleteText', {
              name: confirmDelete?.name ?? '',
              client: archive.state.current?.name ?? '',
            })}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmDelete(null)}>
              {t('detection.cancel')}
            </Button>
            <Button
              color="red"
              data-testid="btn-file-delete-confirm"
              onClick={() => {
                const entry = confirmDelete;
                setConfirmDelete(null);
                if (!entry) return;
                void archive.removeFile(entry).then((ok) => {
                  if (ok) removeFromPage(entry.id);
                });
              }}
            >
              {t('files.deleteConfirm')}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Dropzone.FullScreen
        active
        multiple
        onDrop={(dropped) => void addFiles(dropped)}
        data-testid="dropzone"
      >
        <Center h="100%">
          <Stack align="center" gap="xs">
            <IconUpload size={48} />
            <Text size="xl" fw={600}>
              {archive.state.current
                ? t('drop.overlayClient', { name: archive.state.current.name })
                : t('drop.overlay')}
            </Text>
          </Stack>
        </Center>
      </Dropzone.FullScreen>
    </>
  );
}

import { AppShell, Center, Stack, Text } from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { useDisclosure } from '@mantine/hooks';
import { IconUpload } from '@tabler/icons-react';
import { DEFAULT_LIMITS, type ModelHints } from '@ncv/core';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppHeader } from './components/AppHeader';
import { EmptyState } from './components/EmptyState';
import { FileList } from './components/FileList';
import { FileView } from './components/FileView';
import { normalizeDroppedPath } from './format';
import { contentStore } from './state/content';
import { deviceState, linkShows } from './state/devices';
import { effectiveDetection, effectiveFamily } from './state/effective';
import { filesReducer, initialFilesState, type Overrides, type TextEntry } from './state/files';
import { AnalyzerClient } from './worker/client';
import type { WorkerMessage } from './worker/protocol';

let localIssueCounter = 0;

export function App() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(filesReducer, initialFilesState);
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const client = useRef<AnalyzerClient | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleMessage = useCallback((message: WorkerMessage) => {
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
          overrides: {},
          family: message.structure.family,
          diagnostics: message.structure.diagnostics,
          structureVersion: 0,
        };
        dispatch({ type: 'added', entry });
        break;
      }
      case 'issue':
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
  }, []);

  useEffect(() => {
    const instance = new AnalyzerClient(handleMessage);
    client.current = instance;
    return () => {
      instance.dispose();
      client.current = null;
    };
  }, [handleMessage]);

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || !client.current) return;
    const readable: { name: string; buffer: ArrayBuffer }[] = [];
    for (const file of files) {
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
      readable.push({ name, buffer: await file.arrayBuffer() });
    }
    if (readable.length === 0) return;
    const batch = client.current.load(readable);
    dispatch({ type: 'batch-started', batch });
  }, []);

  const openPicker = () => fileInput.current?.click();

  const select = (id: string) => {
    dispatch({ type: 'select', id });
    closeNav();
  };

  const remove = (id: string) => {
    contentStore.delete(id);
    client.current?.forget([id]);
    dispatch({ type: 'remove', id });
  };

  const clear = () => {
    client.current?.forget(state.files.map((f) => f.id));
    contentStore.clear();
    dispatch({ type: 'clear' });
  };

  const override = (id: string, overrides: Overrides) => {
    const entry = state.files.find((f) => f.id === id);
    if (!entry || entry.type !== 'text') return;
    dispatch({ type: 'override', id, overrides });
    const effective = effectiveDetection(entry.detection, overrides);
    const family = effectiveFamily(effective);
    const os = effective.os.value;
    // Every correction can change the structure (syntax family, Small Business dialect) or
    // the model (kind, system, version, model, hostname): the worker rebuilds both.
    const hints: ModelHints = {
      ...(effective.kind.value ? { kind: effective.kind.value } : {}),
      ...(os && !effective.encrypted ? { os } : {}),
      ...(effective.version.value ? { version: effective.version.value } : {}),
      ...(effective.model.value ? { model: effective.model.value } : {}),
      ...(effective.hostname.value ? { hostname: effective.hostname.value } : {}),
    };
    client.current?.restructure(id, family, hints, os);
  };

  const selected = state.files.find((f) => f.id === state.selectedId) ?? null;
  const hasFiles = state.files.length > 0 || state.pendingBatches.length > 0;

  // Files of shows go with the device they describe: its views show the real state.
  const links = useMemo(() => linkShows(state.files), [state.files]);
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
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void addFiles(files);
        }}
      />
      <AppShell
        header={{ height: 56 }}
        navbar={
          hasFiles ? { width: 320, breakpoint: 'sm', collapsed: { mobile: !navOpened } } : undefined
        }
        padding={0}
      >
        <AppShell.Header>
          <AppHeader
            navOpened={navOpened}
            onToggleNav={toggleNav}
            onAddFiles={openPicker}
            hasFiles={hasFiles}
          />
        </AppShell.Header>
        {hasFiles && (
          <AppShell.Navbar>
            <FileList
              files={state.files}
              selectedId={state.selectedId}
              processing={state.pendingBatches.length > 0}
              onSelect={select}
              onRemove={remove}
              onClear={clear}
            />
          </AppShell.Navbar>
        )}
        <AppShell.Main>
          {selected ? (
            <FileView
              key={selected.id}
              entry={selected}
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
            !hasFiles && <EmptyState onChoose={openPicker} />
          )}
        </AppShell.Main>
      </AppShell>
      <Dropzone.FullScreen
        active
        multiple
        onDrop={(files) => void addFiles(files)}
        data-testid="dropzone"
      >
        <Center h="100%">
          <Stack align="center" gap="xs">
            <IconUpload size={48} />
            <Text size="xl" fw={600}>
              {t('drop.overlay')}
            </Text>
          </Stack>
        </Center>
      </Dropzone.FullScreen>
    </>
  );
}

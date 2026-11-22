import { isEmptyEdits, type MapEdits } from '@ncv/core';
import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { baseName } from '../format';
import { contentStore } from '../state/content';
import type { FileEntry, FilesAction, Overrides, TextEntry } from '../state/files';
import { mapFile, mergeEdits } from '../state/mapEdits';
import type { AnalyzerClient } from '../worker/client';
import { archiveApi, ArchiveRequestError, type ClientSummary, type FileRecord } from './api';

export interface ArchiveState {
  /** Null while checking; false without the server of the app (for example "vite dev"). */
  available: boolean | null;
  clients: ClientSummary[];
  current: ClientSummary | null;
  /** The files of the client are being downloaded. */
  opening: boolean;
  /** Code of the last error, shown until dismissed. */
  error: string | null;
}

interface Deps {
  dispatch: Dispatch<FilesAction>;
  analyzer: { readonly current: AnalyzerClient | null };
  /** The files on the page, kept up to date by the app. */
  files: { readonly current: readonly FileEntry[] };
  /** Removes every file from the page, without touching the archive. */
  closeFiles(): void;
  /** The changes made by hand to the map without a client open: they go with the files. */
  tabMap: { readonly current: MapEdits };
}

const code = (error: unknown) => (error instanceof ArchiveRequestError ? error.code : 'error');

/**
 * The last client open in this browser, reopened when the page is loaded again. Only a
 * convenience: the archive itself is on the server, and without this the app simply starts
 * from the list of the clients.
 */
const LAST_CLIENT = 'ncv.lastClient';

function rememberClient(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_CLIENT, id);
    else localStorage.removeItem(LAST_CLIENT);
  } catch {
    // Storage not available: nothing to remember.
  }
}

function lastClient(): string | null {
  try {
    return localStorage.getItem(LAST_CLIENT);
  } catch {
    return null;
  }
}

/** Like Promise.all with a map, but at most `limit` at a time. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const summaryOf = (index: {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  files: FileRecord[];
}): ClientSummary => ({
  id: index.id,
  name: index.name,
  createdAt: index.createdAt,
  updatedAt: index.updatedAt,
  files: index.files.length,
  size: index.files.reduce((total, f) => total + f.size, 0),
});

/**
 * The archive of the clients (#10): clients kept on the computer by the server of the app.
 * Without a client open, the files stay only on the page, as before.
 */
export function useArchive({ dispatch, analyzer, files, closeFiles, tabMap }: Deps) {
  const [state, setState] = useState<ArchiveState>({
    available: null,
    clients: [],
    current: null,
    opening: false,
    error: null,
  });
  const current = useRef<ClientSummary | null>(null);
  /** Records of the files of the archive being read by the worker. */
  const records = useRef(new Map<string, FileRecord>());

  const fail = useCallback((error: unknown) => {
    setState((s) => ({ ...s, error: code(error) }));
  }, []);

  const setCurrent = useCallback((client: ClientSummary | null) => {
    current.current = client;
    rememberClient(client?.id ?? null);
    setState((s) => ({ ...s, current: client }));
  }, []);

  const refresh = useCallback(async () => {
    const clients = await archiveApi.list();
    setState((s) => ({ ...s, clients }));
    return clients;
  }, []);

  /** Opens a client: its files come from the archive and are read again, as when loaded. */
  const open = useCallback(
    async (id: string) => {
      closeFiles();
      records.current.clear();
      setState((s) => ({ ...s, opening: true, error: null }));
      try {
        const index = await archiveApi.index(id);
        setCurrent(summaryOf(index));
        const loaded = await mapLimit(index.files, 6, async (record) => ({
          record,
          buffer: await archiveApi.fileBytes(id, record.id),
        }));
        // Another client was opened meanwhile.
        if (current.current?.id !== id || !analyzer.current) return;
        for (const { record } of loaded) records.current.set(record.id, record);
        if (loaded.length > 0) {
          const batch = analyzer.current.load(
            loaded.map(({ record, buffer }) => ({
              name: baseName(record.path.at(-1) ?? 'file'),
              buffer,
              path: record.path,
              archiveId: record.id,
              ...(record.modifiedAt ? { lastModified: Date.parse(record.modifiedAt) } : {}),
            })),
          );
          dispatch({ type: 'batch-started', batch });
        }
      } catch (error) {
        fail(error);
      } finally {
        setState((s) => ({ ...s, opening: false }));
      }
    },
    [analyzer, closeFiles, dispatch, fail, setCurrent],
  );

  // At the start: is the archive there, which clients it has, and the last one open here.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const available = await archiveApi.available();
      if (!alive) return;
      setState((s) => ({ ...s, available }));
      if (!available) return;
      const clients = await refresh().catch((error: unknown) => {
        fail(error);
        return [];
      });
      const last = lastClient();
      if (alive && last && clients.some((c) => c.id === last) && !current.current) {
        await open(last);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh, fail, open]);

  /** The record of a file of the archive that the worker has just read. */
  const take = useCallback((archiveId: string | undefined) => {
    if (!archiveId) return undefined;
    const record = records.current.get(archiveId);
    records.current.delete(archiveId);
    return record;
  }, []);

  /** Uploads the original bytes of a file loaded on the page to a client. */
  const upload = useCallback(
    async (clientId: string, entry: TextEntry) => {
      const bytes = contentStore.get(entry.id)?.bytes;
      if (!bytes) throw new ArchiveRequestError(0, 'missing');
      const result = await archiveApi.upload(clientId, bytes, entry.path, entry.modifiedAt);
      const latest = files.current.find((f) => f.id === entry.id);
      // Corrections made before the file was saved.
      if (!result.duplicate && latest?.type === 'text') {
        if (Object.keys(latest.overrides).length > 0 || latest.pinnedAt) {
          await archiveApi.updateFile(clientId, result.record.id, {
            overrides: latest.overrides as Record<string, string>,
            ...(latest.pinnedAt ? { pinnedAt: latest.pinnedAt } : {}),
          });
        }
      }
      return result;
    },
    [files],
  );

  /** Saves in the open client a file just loaded. */
  const save = useCallback(
    async (entry: TextEntry) => {
      const client = current.current;
      if (!client) return;
      try {
        const { record, duplicate } = await upload(client.id, entry);
        if (current.current?.id !== client.id) return;
        const existing = files.current.find(
          (f) => f.type === 'text' && f.id !== entry.id && f.archived?.fileId === record.id,
        );
        if (duplicate && existing) {
          // Already in the client, byte for byte: the copy just loaded goes away.
          contentStore.delete(entry.id);
          analyzer.current?.forget([entry.id]);
          dispatch({ type: 'remove', id: entry.id });
          dispatch({ type: 'select', id: existing.id });
          return;
        }
        dispatch({
          type: 'archived',
          id: entry.id,
          archived: { fileId: record.id, addedAt: record.addedAt },
        });
      } catch (error) {
        dispatch({ type: 'save-failed', id: entry.id, code: code(error) });
      }
    },
    [analyzer, dispatch, files, upload],
  );

  const saveOverrides = useCallback(
    (entry: TextEntry, overrides: Overrides) => {
      const client = current.current;
      if (!client || !entry.archived) return;
      archiveApi
        .updateFile(client.id, entry.archived.fileId, {
          overrides: overrides as Record<string, string>,
        })
        .catch(fail);
    },
    [fail],
  );

  /** Chooses a version as the current configuration of its device, or goes back to the most recent. */
  const pin = useCallback(
    (entry: TextEntry, pinned: boolean) => {
      const pinnedAt = pinned ? new Date().toISOString() : undefined;
      dispatch({ type: 'pin', id: entry.id, pinnedAt });
      const client = current.current;
      if (client && entry.archived) {
        archiveApi
          .updateFile(client.id, entry.archived.fileId, { pinnedAt: pinnedAt ?? null })
          .catch(fail);
      }
    },
    [dispatch, fail],
  );

  /** Deletes a file from the archive of the open client; false when it could not. */
  const removeFile = useCallback(
    async (entry: TextEntry) => {
      const client = current.current;
      if (!client || !entry.archived) return true;
      try {
        await archiveApi.removeFile(client.id, entry.archived.fileId);
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [fail],
  );

  /** The files on the page that are not in any client. */
  const unsaved = useCallback(
    () => files.current.filter((f): f is TextEntry => f.type === 'text' && !f.archived),
    [files],
  );

  /** Adds the files on the page to a client, then opens it. */
  const saveAllTo = useCallback(
    async (clientId: string) => {
      setState((s) => ({ ...s, opening: true, error: null }));
      try {
        await mapLimit(unsaved(), 4, (entry) => upload(clientId, entry));
        // The map changed in the tab goes with its files, added to the map of the client.
        if (!isEmptyEdits(tabMap.current)) {
          const map = await archiveApi.getMap(clientId);
          await archiveApi.putMap(clientId, mapFile(mergeEdits(map, tabMap.current)));
        }
        await refresh();
      } catch (error) {
        fail(error);
        setState((s) => ({ ...s, opening: false }));
        return;
      }
      await open(clientId);
    },
    [fail, open, refresh, tabMap, unsaved, upload],
  );

  const create = useCallback(
    async (name: string, keepFiles: boolean) => {
      try {
        const client = await archiveApi.create(name);
        await refresh();
        if (keepFiles && unsaved().length > 0) {
          await saveAllTo(client.id);
        } else {
          closeFiles();
          setCurrent(client);
        }
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [closeFiles, fail, refresh, saveAllTo, setCurrent, unsaved],
  );

  const rename = useCallback(
    async (name: string) => {
      const client = current.current;
      if (!client) return false;
      try {
        setCurrent(await archiveApi.rename(client.id, name));
        await refresh();
        return true;
      } catch (error) {
        fail(error);
        return false;
      }
    },
    [fail, refresh, setCurrent],
  );

  const removeClient = useCallback(async () => {
    const client = current.current;
    if (!client) return;
    try {
      await archiveApi.remove(client.id);
      closeFiles();
      setCurrent(null);
      await refresh();
    } catch (error) {
      fail(error);
    }
  }, [closeFiles, fail, refresh, setCurrent]);

  const close = useCallback(() => {
    closeFiles();
    records.current.clear();
    setCurrent(null);
    void refresh().catch(fail);
  }, [closeFiles, fail, refresh, setCurrent]);

  const importZip = useCallback(
    async (zip: File) => {
      setState((s) => ({ ...s, error: null }));
      try {
        const client = await archiveApi.importZip(zip);
        await refresh();
        await open(client.id);
      } catch (error) {
        fail(error);
      }
    },
    [fail, open, refresh],
  );

  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return {
    state,
    open,
    take,
    save,
    saveOverrides,
    pin,
    removeFile,
    unsaved,
    saveAllTo,
    create,
    rename,
    removeClient,
    close,
    importZip,
    refresh,
    dismissError,
  };
}

export type Archive = ReturnType<typeof useArchive>;

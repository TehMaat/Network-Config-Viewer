// The changes made by hand to the map of the client open (#15, part 3): read from its archive
// when it opens, written back a moment after every change. Without a client they stay in the
// tab, and go with the files when these are saved in a client.

import type { MapEdits } from '@ncv/core';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { EMPTY_EDITS, mapFile } from '../state/mapEdits';
import { archiveApi } from './api';

/** Where the changes are: only in this tab, being read or written, written, or not written. */
export type MapSaveState = 'tab' | 'loading' | 'saving' | 'saved' | 'error';

const DELAY = 400;

/**
 * `latestRef` always holds the changes as they are now: the archive reads it to save the changes
 * of the tab with the files.
 */
export function useMapEdits(clientId: string | null, latestRef: MutableRefObject<MapEdits>) {
  const [edits, setEdits] = useState<MapEdits>(EMPTY_EDITS);
  const [state, setState] = useState<MapSaveState>('tab');
  /** The client whose map is loaded: changes are written only to it. */
  const loaded = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = useCallback(
    (id: string) => {
      setState('saving');
      archiveApi
        .putMap(id, mapFile(latestRef.current))
        .then(() => {
          if (loaded.current === id) setState('saved');
        })
        .catch(() => {
          if (loaded.current === id) setState('error');
        });
    },
    [latestRef],
  );

  useEffect(() => {
    // A change of the client before still to write is written first.
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      if (loaded.current) write(loaded.current);
    }
    loaded.current = null;
    if (!clientId) {
      latestRef.current = EMPTY_EDITS;
      setEdits(EMPTY_EDITS);
      setState('tab');
      return;
    }
    let alive = true;
    setState('loading');
    archiveApi
      .getMap(clientId)
      .then((map) => {
        if (!alive) return;
        loaded.current = clientId;
        latestRef.current = map;
        setEdits(map);
        setState('saved');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [clientId, latestRef, write]);

  /** A change of the map: shown at once, written a moment later. */
  const update = useCallback(
    (change: (current: MapEdits) => MapEdits) => {
      const next = change(latestRef.current);
      latestRef.current = next;
      setEdits(next);
      const id = loaded.current;
      if (!id) return;
      if (timer.current) clearTimeout(timer.current);
      setState('saving');
      timer.current = setTimeout(() => {
        timer.current = null;
        write(id);
      }, DELAY);
    },
    [latestRef, write],
  );

  // A change still to write when the page goes away is written at once.
  useEffect(() => {
    const flush = () => {
      if (!timer.current || !loaded.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      write(loaded.current);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [write]);

  return { edits, state, update };
}

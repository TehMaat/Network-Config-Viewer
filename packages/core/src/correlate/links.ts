// The links found by the correlation, without duplicates: the same link seen from both sides,
// or from several sources, is one link with all its sources.

import {
  VERIFYING_SOURCES,
  type EndState,
  type LinkEvidence,
  type Link,
  type LinkEnd,
  type LinkKind,
  type LinkSource,
} from './types';

/** The part of a side that tells it apart: node, context and interface, tunnel or peer. */
function endKey(end: LinkEnd): string {
  return [end.node, end.context ?? '', end.interface ?? end.tunnel ?? end.neighbor ?? end.ip ?? '']
    .join('/')
    .toLowerCase();
}

/** Same id whichever side comes first. */
export function linkId(kind: LinkKind, a: LinkEnd, b: LinkEnd): string {
  const [x, y] = [endKey(a), endKey(b)].sort();
  return `${kind}:${x}|${y}`;
}

const sourceKey = (s: LinkSource) => [s.kind, s.device, s.text ?? ''].join('|');

export type NewLink = Omit<Link, 'id' | 'verified'> & { id?: string };

export class LinkSet {
  private readonly byId = new Map<string, Link>();

  /** Adds a link, or the sources of a link already found under the same id. */
  add(link: NewLink): Link {
    const id = link.id ?? linkId(link.kind, link.a, link.b);
    const existing = this.byId.get(id);
    if (existing) {
      for (const s of link.sources) addSource(existing, s);
      return existing;
    }
    const created: Link = { ...link, id, sources: [], verified: false };
    for (const s of link.sources) addSource(created, s);
    this.byId.set(id, created);
    return created;
  }

  get(id: string): Link | undefined {
    return this.byId.get(id);
  }

  all(): Link[] {
    return [...this.byId.values()];
  }
}

export function addSource(link: Link, source: LinkSource): void {
  const key = sourceKey(source);
  const same = link.sources.find((s) => sourceKey(s) === key);
  if (same) {
    for (const e of source.evidence) if (!same.evidence.includes(e)) same.evidence.push(e);
  } else {
    link.sources.push({ ...source, evidence: [...source.evidence] });
  }
  if (VERIFYING_SOURCES.includes(source.kind)) link.verified = true;
}

/** Lines of the configuration of a device. */
export function configEvidence(device: string, src: LinkEvidence['src']): LinkEvidence[] {
  return src.length > 0 ? [{ device, src }] : [];
}

/** Lines of a file of shows: the items of a merged state remember their file. */
export function showEvidence(
  device: string,
  item: { src: LinkEvidence['src']; file?: string },
): LinkEvidence[] {
  return [{ device, ...(item.file ? { file: item.file } : {}), src: item.src }];
}

/** The state of one side from several items: up when all are up, partial when some are. */
export function combineStates(states: EndState[]): EndState | undefined {
  if (states.length === 0) return undefined;
  if (states.length === 1) return states[0];
  const up = states.filter((s) => s.status === 'up').length;
  const status = up === states.length ? 'up' : up === 0 ? 'down' : 'partial';
  return {
    status,
    text: `${up}/${states.length}`,
    evidence: states.flatMap((s) => s.evidence),
  };
}

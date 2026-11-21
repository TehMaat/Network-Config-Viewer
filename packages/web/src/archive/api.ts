// The archive of the clients, kept by the server of the app on the user's computer (#10).
// Only this computer: the server answers only to localhost and refuses changes without the
// header below, which pages of other sites cannot send.

export interface ClientSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  files: number;
  size: number;
}

export interface FileRecord {
  id: string;
  path: string[];
  size: number;
  sha256: string;
  addedAt: string;
  modifiedAt?: string;
  overrides: Record<string, string>;
  pinnedAt?: string;
}

export interface ClientIndex {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  files: FileRecord[];
}

export class ArchiveRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const CHANGE = { 'x-ncv-request': '1' };

/** Relative URLs: the app works also behind a path of a reverse proxy. */
const url = (path: string) => `api/${path}`;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url(path), { ...init, cache: 'no-store' });
  } catch {
    throw new ArchiveRequestError(0, 'unreachable');
  }
  if (!response.ok) {
    let code = 'error';
    try {
      code = ((await response.json()) as { error?: string }).error ?? code;
    } catch {
      // Not JSON: a refusal of the protections, or a server that is not ours.
    }
    throw new ArchiveRequestError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { ...CHANGE, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const archiveApi = {
  /** True when the app is served by its server: false with "vite dev" and similar. */
  async available(): Promise<boolean> {
    try {
      const response = await fetch(url('health'), { cache: 'no-store' });
      if (!response.ok) return false;
      return ((await response.json()) as { ok?: boolean }).ok === true;
    } catch {
      return false;
    }
  },

  list: async () => (await call<{ clients: ClientSummary[] }>('clients')).clients,

  create: (name: string) => call<ClientSummary>('clients', json('POST', { name })),

  rename: (id: string, name: string) =>
    call<ClientSummary>(`clients/${id}`, json('PATCH', { name })),

  remove: (id: string) => call<void>(`clients/${id}`, { method: 'DELETE', headers: CHANGE }),

  index: (id: string) => call<ClientIndex>(`clients/${id}`),

  async fileBytes(id: string, fileId: string): Promise<ArrayBuffer> {
    let response: Response;
    try {
      response = await fetch(url(`clients/${id}/files/${fileId}`), { cache: 'no-store' });
    } catch {
      throw new ArchiveRequestError(0, 'unreachable');
    }
    if (!response.ok) throw new ArchiveRequestError(response.status, 'download');
    return response.arrayBuffer();
  },

  /** Saves the original bytes of a file; the same bytes already in the client are not saved twice. */
  upload: (id: string, bytes: Uint8Array, path: string[], modifiedAt?: string) =>
    call<{ record: FileRecord; duplicate: boolean }>(`clients/${id}/files`, {
      method: 'POST',
      headers: {
        ...CHANGE,
        'content-type': 'application/octet-stream',
        'x-ncv-path': encodeURIComponent(JSON.stringify(path)),
        ...(modifiedAt ? { 'x-ncv-modified': modifiedAt } : {}),
      },
      body: bytes as BodyInit,
    }),

  updateFile: (
    id: string,
    fileId: string,
    changes: { overrides?: Record<string, string>; pinnedAt?: string | null },
  ) => call<FileRecord>(`clients/${id}/files/${fileId}`, json('PATCH', changes)),

  removeFile: (id: string, fileId: string) =>
    call<void>(`clients/${id}/files/${fileId}`, { method: 'DELETE', headers: CHANGE }),

  exportUrl: (id: string) => url(`clients/${id}/export`),

  importZip: (zip: Blob) =>
    call<ClientSummary>('import', {
      method: 'POST',
      headers: { ...CHANGE, 'content-type': 'application/zip' },
      body: zip,
    }),
};

// Protections of a server that runs on the user's computer and holds their clients' files.
//
// - Only names of this computer are accepted: a page of another site cannot reach the
//   server by pointing one of its own names to 127.0.0.1 (DNS rebinding).
// - Every change needs a header that a page of another site cannot send without the
//   permission of the server (a CORS preflight), and the server never gives it.
// - A request that says it comes from another site is refused.

/** The security headers of every response, from a single source also used by the tests. */
export { default as SECURITY_HEADERS } from './security-headers.json' with { type: 'json' };

/** Header that the app adds to every change. */
export const REQUEST_HEADER = 'x-ncv-request';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type Headers = Record<string, string | string[] | undefined>;

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** The name in a Host header, without the port: "localhost", "127.0.0.1", "[::1]". */
export function hostName(host: string | undefined): string | null {
  if (!host) return null;
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(0, end + 1) : null;
  }
  const colon = value.indexOf(':');
  return colon >= 0 ? value.slice(0, colon) : value;
}

export function isLocalHost(host: string | undefined): boolean {
  const name = hostName(host);
  return name !== null && LOCAL_HOSTS.has(name);
}

export type Refusal = 'host' | 'header' | 'origin' | 'site';

/** Why a request is refused, or null when it may go on. */
export function refusal(method: string, headers: Headers): Refusal | null {
  const host = single(headers.host);
  if (!isLocalHost(host)) return 'host';
  if (SAFE_METHODS.has(method.toUpperCase())) return null;
  if (single(headers[REQUEST_HEADER]) !== '1') return 'header';
  const origin = single(headers.origin);
  if (origin !== undefined) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return 'origin';
    }
    if (originHost.toLowerCase() !== host!.trim().toLowerCase()) return 'origin';
  }
  const site = single(headers['sec-fetch-site']);
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'site';
  return null;
}

export const REFUSAL_MESSAGES: Record<Refusal, string> = {
  host: 'This server answers only to localhost, 127.0.0.1 and [::1].',
  header: 'Changes are accepted only from the app.',
  origin: 'Requests from other sites are not accepted.',
  site: 'Requests from other sites are not accepted.',
};

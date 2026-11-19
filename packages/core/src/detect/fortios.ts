import type { Detection, OsId } from './types';
import { detected, findLine, firstNonEmpty, unquote } from './util';

// #config-version=FGT60F-7.4.3-FW-build2573-240201:opmode=0:vdom=0:user=admin
const HEADER =
  /^#config-version=([A-Za-z0-9]+)-(\d+\.\d+\.\d+)-FW-build(\d+)-(\d{6})(?::(.*))?\s*$/;
const STATEMENT = /^\s*(config|edit|set|unset|next|end)\b/;

/** Detects a FortiOS configuration from its "#config-version" header (backup files). */
export function detectFortiosHeader(lines: string[]): Detection | null {
  const header = findLine(lines, HEADER, 0, 10);
  if (!header) return null;
  const [, platform, version, build, , options = ''] = header.match;
  const opts = new Map(
    options.split(':').map((pair) => {
      const [key = '', value = ''] = pair.split('=');
      return [key, value] as const;
    }),
  );
  const { os, model } = platformInfo(platform!);
  const i = header.index;
  const result: Detection = {
    kind: detected('config', 'fortios.header', i, lines),
    vendor: detected('fortinet', 'fortios.header', i, lines),
    os: detected(os, 'fortios.header', i, lines),
    version: detected(version!, 'fortios.header', i, lines),
    build: detected(build!, 'fortios.header', i, lines),
    model: detected(model, 'fortios.header', i, lines),
    syntax: 'fortios',
  };

  if (isEncrypted(lines, i)) {
    result.encrypted = detected(true, 'fortios.encrypted', i, lines);
    result.syntax = 'plain';
    return result;
  }

  const hostname = findHostname(lines);
  if (hostname) result.hostname = hostname;
  if (opts.get('vdom') === '1' || lines.some((l) => l === 'config vdom')) {
    const vdoms = findVdoms(lines);
    if (vdoms) result.vdoms = vdoms;
  }
  return result;
}

/** Detects FortiOS from its syntax alone (for example a pasted "show full-configuration"). */
export function detectFortiosSyntax(lines: string[]): Detection | null {
  const limit = Math.min(lines.length, 5000);
  let configs = 0;
  let ends = 0;
  let sets = 0;
  let first = -1;
  for (let i = 0; i < limit; i++) {
    const line = lines[i]!;
    if (/^config \S/.test(line)) {
      configs++;
      if (first === -1) first = i;
    } else if (/^\s*end\s*$/.test(line)) ends++;
    else if (/^\s+set \S/.test(line)) sets++;
  }
  if (configs === 0 || ends === 0 || sets === 0) return null;
  const result: Detection = {
    kind: detected('config', 'fortios.syntax', first, lines),
    vendor: detected('fortinet', 'fortios.syntax', first, lines),
    syntax: 'fortios',
  };
  const hostname = findHostname(lines);
  if (hostname) result.hostname = hostname;
  return result;
}

function platformInfo(platform: string): { os: OsId; model: string } {
  const p = platform.toUpperCase();
  if (p.startsWith('FS')) return { os: 'fortiswitchos', model: platform };
  let m: RegExpExecArray | null;
  if ((m = /^FGVM(\w*)$/.exec(p))) return { os: 'fortios', model: `FortiGate-VM${m[1]}` };
  if ((m = /^FWF(\d\w*)$/.exec(p))) return { os: 'fortios', model: `FortiWiFi-${m[1]}` };
  if ((m = /^FGR(\d\w*)$/.exec(p))) return { os: 'fortios', model: `FortiGateRugged-${m[1]}` };
  if ((m = /^FGT?(\d\w*)$/.exec(p))) return { os: 'fortios', model: `FortiGate-${m[1]}` };
  return { os: 'fortios', model: platform };
}

/**
 * Backups protected by a password keep the header in clear text and the rest encrypted.
 * The exact format is not public: here the file is considered encrypted when no
 * configuration statement follows the header.
 */
function isEncrypted(lines: string[], headerIndex: number): boolean {
  const start = firstNonEmpty(lines, headerIndex + 1);
  if (start === -1) return true;
  const end = Math.min(lines.length, start + 200);
  for (let i = start; i < end; i++) {
    const line = lines[i]!;
    if (line.startsWith('#')) continue;
    if (STATEMENT.test(line)) return false;
  }
  return true;
}

function findHostname(lines: string[]) {
  const global = findLine(lines, /^\s*config system global\s*$/);
  if (!global) return null;
  for (let i = global.index + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*end\s*$/.test(line)) break;
    const m = /^\s*set hostname\s+(.+?)\s*$/.exec(line);
    if (m) return detected(unquote(m[1]!), 'fortios.hostname', i, lines);
  }
  return null;
}

/** VDOM names from the first "config vdom" block, which declares them. */
function findVdoms(lines: string[]) {
  const start = findLine(lines, /^config vdom\s*$/);
  if (!start) return null;
  const names: string[] = [];
  let depth = 1;
  for (let i = start.index + 1; i < lines.length && depth > 0; i++) {
    const line = lines[i]!.trim();
    if (/^config\s/.test(line)) depth++;
    else if (line === 'end') depth--;
    else if (depth === 1) {
      const m = /^edit\s+(.+)$/.exec(line);
      if (m) names.push(unquote(m[1]!));
    }
  }
  if (names.length === 0) return null;
  return detected(names, 'fortios.vdoms', start.index, lines);
}

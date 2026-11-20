import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLES_DIR = fileURLToPath(new URL('../../../samples', import.meta.url));

/** Relative paths (with "/") of every sample configuration or command output. */
export function sampleFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name !== 'README.md' && !/^expected.*\.json$/.test(name)) {
        out.push(relative(SAMPLES_DIR, full).split(sep).join('/'));
      }
    }
  };
  walk(SAMPLES_DIR);
  return out.sort();
}

export function readSample(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(SAMPLES_DIR, rel)));
}

export function readSampleText(rel: string): string {
  return readFileSync(join(SAMPLES_DIR, rel), 'utf8');
}

export interface Expected {
  kind: string;
  vendor?: string;
  os?: string;
  version?: string;
  build?: string;
  model?: string;
  hostname?: string;
  stack?: number;
  vdoms?: string[];
  commands?: string[];
}

export function expectedDetections(): Record<string, Expected> {
  return JSON.parse(readFileSync(join(SAMPLES_DIR, 'expected.json'), 'utf8')) as Record<
    string,
    Expected
  >;
}

const encoder = new TextEncoder();
export const bytes = (text: string): Uint8Array => encoder.encode(text);

export interface TarInput {
  name: string;
  data: Uint8Array | string;
  type?: string;
}

/** Minimal ustar writer for the tests. */
export function makeTar(entries: TarInput[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const data = typeof entry.data === 'string' ? bytes(entry.data) : entry.data;
    const header = new Uint8Array(512);
    const put = (offset: number, value: string) => header.set(bytes(value), offset);
    put(0, entry.name.slice(0, 100));
    put(100, '0000644\0');
    put(108, '0000000\0');
    put(116, '0000000\0');
    put(124, data.length.toString(8).padStart(11, '0') + '\0');
    put(136, '00000000000\0');
    put(148, '        ');
    put(156, entry.type ?? '0');
    put(257, 'ustar\0');
    put(263, '00');
    let sum = 0;
    for (const b of header) sum += b;
    put(148, sum.toString(8).padStart(6, '0') + '\0 ');
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

/** A pax extended header record: "<length> path=<value>\n". */
export function paxPathRecord(path: string): string {
  const body = ` path=${path}\n`;
  let length = body.length + 1;
  while (String(length).length + body.length !== length) length++;
  return `${length}${body}`;
}

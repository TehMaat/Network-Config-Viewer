// The example client of the samples, samples/cliente-esempio.zip, made again from the samples
// after a change to them (#15): the same names, dates and corrections, the bytes of the samples
// and the map of samples/mappa-esempio.json, each with its size and sha256 as the app exports
// them.
//   node scripts/example-client.mjs
// @ts-check

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const SAMPLES = fileURLToPath(new URL('../samples/', import.meta.url));
export const EXAMPLE_ZIP = join(SAMPLES, 'cliente-esempio.zip');
export const EXAMPLE_MAP = join(SAMPLES, 'mappa-esempio.json');

const sha256 = (/** @type {Uint8Array} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');

/** Every sample file by its name: configurations, shows and previous versions. */
export function sampleFilesByName() {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const dir of ['fortigate', 'cisco-ios', 'cisco-sb', 'show', 'versioni']) {
    for (const name of readdirSync(join(SAMPLES, dir))) out.set(name, join(SAMPLES, dir, name));
  }
  return out;
}

/**
 * The example client with the samples as they are now.
 * @param {Uint8Array} zip the example client as it is
 * @returns {Uint8Array}
 */
export function rebuildExampleClient(zip) {
  const entries = unzipSync(zip);
  const manifest = JSON.parse(strFromU8(entries['client.json']));
  const files = sampleFilesByName();
  /** @type {import('fflate').Zippable} */
  const out = {};
  for (const item of manifest.files) {
    const name = item.path[item.path.length - 1];
    const path = files.get(name);
    if (!path) throw new Error(`No sample for ${name}`);
    const bytes = new Uint8Array(readFileSync(path));
    item.size = bytes.length;
    item.sha256 = sha256(bytes);
    out[item.entry] = [bytes, { mtime: new Date(item.modifiedAt ?? item.addedAt) }];
  }
  const map = new Uint8Array(readFileSync(EXAMPLE_MAP));
  out['map.json'] = [map, { mtime: new Date(manifest.exportedAt) }];
  manifest.map = { entry: 'map.json', size: map.length, sha256: sha256(map) };
  out['client.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  return zipSync(out, { level: 6 });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(EXAMPLE_ZIP, rebuildExampleClient(new Uint8Array(readFileSync(EXAMPLE_ZIP))));
  console.log(`Written ${EXAMPLE_ZIP}`);
}

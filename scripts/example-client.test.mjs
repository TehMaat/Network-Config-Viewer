import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_MAP,
  EXAMPLE_ZIP,
  rebuildExampleClient,
  sampleFilesByName,
} from './example-client.mjs';

// The example client must always be the samples as they are: after a change to a sample or to
// the map of the example, it is made again with "node scripts/example-client.mjs".

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

describe('the example client', () => {
  const entries = unzipSync(new Uint8Array(readFileSync(EXAMPLE_ZIP)));
  const manifest = JSON.parse(strFromU8(entries['client.json']));

  it('has every sample file as it is, with its size and sha256', () => {
    const files = sampleFilesByName();
    expect(manifest.files.map((f) => f.path.at(-1)).sort()).toEqual([...files.keys()].sort());
    for (const item of manifest.files) {
      const sample = new Uint8Array(readFileSync(files.get(item.path.at(-1))));
      expect(entries[item.entry], item.entry).toEqual(sample);
      expect(item.size, item.entry).toBe(sample.length);
      expect(item.sha256, item.entry).toBe(sha256(sample));
    }
  });

  it('adds a sample that is not in it yet after the others, with its bytes', () => {
    const last = manifest.files.at(-1);
    const fewer = { ...manifest, files: manifest.files.slice(0, -1) };
    const { [last.entry]: _left, ...rest } = entries;
    const zip = zipSync({ ...rest, 'client.json': strToU8(JSON.stringify(fewer)) });
    const again = unzipSync(rebuildExampleClient(zip));
    const added = JSON.parse(strFromU8(again['client.json'])).files.at(-1);
    expect(added).toEqual({ ...last, addedAt: manifest.exportedAt });
    expect(again[last.entry]).toEqual(entries[last.entry]);
  });

  it('has the map of the example, with its size and sha256', () => {
    const map = new Uint8Array(readFileSync(EXAMPLE_MAP));
    expect(entries['map.json']).toEqual(map);
    expect(manifest.map).toEqual({ entry: 'map.json', size: map.length, sha256: sha256(map) });
  });
});

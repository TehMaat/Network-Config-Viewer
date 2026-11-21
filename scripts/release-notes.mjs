// The notes of a version, taken from CHANGELOG.md for its release on GitHub (#13).
//   node scripts/release-notes.mjs 0.1.0 > notes.md
// @ts-check

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The text of the section of a version in a changelog, without its heading: from the line
 * after "## [version]" to the next heading of the same level.
 * @param {string} changelog
 * @param {string} version
 * @returns {string | undefined}
 */
export function releaseNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start < 0) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  const notes = lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
  return notes || undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/release-notes.mjs <version>');
    process.exit(2);
  }
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const notes = releaseNotes(changelog, version);
  if (!notes) {
    console.error(`No notes for ${version} in CHANGELOG.md`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}

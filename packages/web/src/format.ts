/** Human-readable size in the user's language, e.g. "12,3 kB" or "12.3 kB". */
export function formatBytes(bytes: number, language: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

/** Where a file comes from: "backup.zip › sede/fgt.conf". */
export function formatPath(path: string[]): string {
  return path.join(' › ');
}

/** File name without folders. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/**
 * Where a file is, without its own name: "backup.zip › sede" for "sede/fgt.conf" inside
 * backup.zip, or "fgt.conf.gz" for a decompressed file. Null for a file dropped on its own.
 */
export function formatOrigin(path: string[], name: string): string | null {
  const last = path.at(-1) ?? '';
  const segments = path.slice(0, -1);
  const slash = Math.max(last.lastIndexOf('/'), last.lastIndexOf('\\'));
  if (baseName(last) === name) {
    if (slash > 0) segments.push(last.slice(0, slash));
  } else {
    segments.push(last);
  }
  return segments.length > 0 ? formatPath(segments) : null;
}

/** The relative path of a dropped file, without the leading "./" or "/". */
export function normalizeDroppedPath(path: string): string {
  return path.replace(/^\.?\/+/, '');
}

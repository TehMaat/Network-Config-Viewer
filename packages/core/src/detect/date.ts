// Dates that tell which version of a configuration is the most recent: the one written in the
// configuration itself, or the one in the name of the file.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** An ISO date and time, or undefined when the numbers are not a real date. */
function iso(year: number, month: number, day: number, h = 0, m = 0, s = 0): string | undefined {
  if (year < 1990 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31)
    return undefined;
  if (h > 23 || m > 59 || s > 59) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day, h, m, s));
  // 31 February and similar.
  if (date.getUTCMonth() !== month - 1) return undefined;
  return `${year}-${pad(month)}-${pad(day)}T${pad(h)}:${pad(m)}:${pad(s)}.000Z`;
}

/**
 * When the configuration was last changed, as Cisco writes it at the top:
 * "! Last configuration change at 18:30:12 CET Wed Oct 22 2025 by netadmin", or the date of
 * the last "write memory". The time is kept as written, without the time zone.
 */
export function configDate(lines: readonly string[]): string | undefined {
  let saved: string | undefined;
  for (const line of lines.slice(0, 60)) {
    const m =
      /^!\s*(Last configuration change|NVRAM config last updated) at (\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?\s+\S+\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})/i.exec(
        line,
      );
    if (!m) continue;
    const month = MONTHS.indexOf(m[5]!.toLowerCase()) + 1;
    const date = iso(Number(m[7]), month, Number(m[6]), Number(m[2]), Number(m[3]), Number(m[4]));
    if (!date) continue;
    if (/^Last/i.test(m[1]!)) return date;
    saved ??= date;
  }
  return saved;
}

/**
 * A date in the name of a file, as backups are often named: "fgt-hq_2025-11-03.conf",
 * "sw-core-20251103-1405.txt", "backup 03.11.2025.txt".
 */
export function fileNameDate(name: string): string | undefined {
  const base = name.split(/[\\/]/).pop() ?? name;
  let m =
    /(?<!\d)(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:[-_T ]?(\d{2})[-_.:h]?(\d{2})(?:[-_.:]?(\d{2}))?)?(?!\d)/.exec(
      base,
    );
  if (m) {
    const date =
      iso(
        Number(m[1]),
        Number(m[2]),
        Number(m[3]),
        Number(m[4] ?? 0),
        Number(m[5] ?? 0),
        Number(m[6] ?? 0),
      ) ?? iso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (date) return date;
  }
  m = /(?<!\d)(\d{2})[-_.](\d{2})[-_.](\d{4})(?!\d)/.exec(base);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  return undefined;
}

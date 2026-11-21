// Which device a file of shows belongs to: by the hostname of its prompt or of its output,
// by the serial number, or by the name of the file; the user can always correct it.

export interface DeviceCandidate {
  id: string;
  hostname?: string;
  serials?: string[];
}

export interface ShowCandidate {
  id: string;
  /** Hostname corrected by hand: it always wins. */
  manualHostname?: string;
  hostname?: string;
  serials: string[];
  fileName: string;
}

export type AssignReason = 'manual' | 'hostname' | 'serial' | 'file-name';

export interface Assignment {
  device: string;
  reason: AssignReason;
}

/** "SW-HQ-CORE.esempio.example" → "sw-hq-core". */
export function hostKey(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\..*$/, '');
}

/** Letters and digits only, for comparing a hostname with a file name. */
const compact = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

export function assignShows(
  devices: readonly DeviceCandidate[],
  shows: readonly ShowCandidate[],
): Map<string, Assignment> {
  const out = new Map<string, Assignment>();
  const byHost = new Map<string, string>();
  for (const d of devices) if (d.hostname) byHost.set(hostKey(d.hostname), d.id);
  for (const show of shows) {
    if (show.manualHostname !== undefined) {
      const device = byHost.get(hostKey(show.manualHostname));
      if (device) out.set(show.id, { device, reason: 'manual' });
      continue;
    }
    const byName = show.hostname ? byHost.get(hostKey(show.hostname)) : undefined;
    if (byName) {
      out.set(show.id, { device: byName, reason: 'hostname' });
      continue;
    }
    const bySerial = devices.find((d) => d.serials?.some((s) => show.serials.includes(s)));
    if (bySerial) {
      out.set(show.id, { device: bySerial.id, reason: 'serial' });
      continue;
    }
    // "sw-br1-acc_show-vlan-brief.txt": the longest hostname the file name starts with.
    const file = compact(show.fileName);
    let best: { id: string; length: number } | null = null;
    for (const d of devices) {
      if (!d.hostname) continue;
      const key = compact(hostKey(d.hostname));
      if (key.length >= 3 && file.startsWith(key) && (!best || key.length > best.length)) {
        best = { id: d.id, length: key.length };
      }
    }
    if (best) out.set(show.id, { device: best.id, reason: 'file-name' });
  }
  return out;
}

import { findPrompts, isConfigDump, signatureStarts } from '../detect/show';
import { commandId } from './commands';
import { readOutput } from './readers';
import { emptyState, type DeviceState, type ShowOutput } from './types';

export * from './assign';
export * from './commands';
export * from './types';

/** A prompt with nothing typed after it, as found at the end of a terminal log. */
const BARE_PROMPT = /^[A-Za-z0-9][\w.\-/:]*(?:\([^)]*\))?(?: \([^)\s]+\))?\s?[#>$]\s*$/;

/**
 * Splits a file of command outputs into its commands: after each prompt in a session log,
 * or where the shape of an output begins in a file without prompts.
 */
export function splitShowOutputs(lines: string[]): ShowOutput[] {
  const prompts = findPrompts(lines).filter((p) => !isConfigDump(p));
  if (prompts.length > 0) {
    return prompts.map((p, n) => {
      const next = prompts[n + 1]?.index ?? lines.length;
      let last = next - 1;
      while (last > p.index && (lines[last]!.trim() === '' || BARE_PROMPT.test(lines[last]!)))
        last--;
      const id = commandId(p.command);
      return {
        command: p.command,
        ...(id ? { id } : {}),
        typed: true,
        hostname: p.hostname,
        // "(global)" and "(vdom)" are modes of the prompt, not VDOMs.
        ...(p.context && p.context !== 'global' && p.context !== 'vdom'
          ? { context: p.context }
          : {}),
        line: p.index + 1,
        from: p.index + 2,
        to: last + 1,
        read: false,
      };
    });
  }
  const starts = signatureStarts(lines);
  return starts.map((s, n) => {
    const id = commandId(s.command);
    return {
      command: s.command,
      ...(id ? { id } : {}),
      typed: false,
      line: s.index + 1,
      from: s.index + 1,
      to: starts[n + 1]?.index ?? lines.length,
      read: false,
    };
  });
}

export interface ShowFile {
  outputs: ShowOutput[];
  state: DeviceState;
  /** Hostname from the prompts or from the outputs (show version, get system status). */
  hostname?: string;
}

/** Reads every command of a file of show outputs. */
export function readShowFile(lines: string[]): ShowFile {
  const outputs = splitShowOutputs(lines);
  const state = emptyState();
  for (const out of outputs) out.read = readOutput(lines, out, state);
  const hostname = outputs.find((o) => o.hostname)?.hostname ?? state.hostname;
  return { outputs, state, ...(hostname ? { hostname } : {}) };
}

/** Puts together the shows of one device; each value remembers the file it comes from. */
export function mergeStates(parts: { file: string; state: DeviceState }[]): DeviceState {
  const out = emptyState();
  for (const { file, state } of parts) {
    out.hostname ??= state.hostname;
    out.version ??= state.version;
    out.model ??= state.model;
    out.uptime ??= state.uptime;
    for (const s of state.serials) if (!out.serials.includes(s)) out.serials.push(s);
    const tag = <T extends object>(items: T[]) => items.map((x) => ({ ...x, file }));
    for (const u of tag(state.units)) {
      const existing = out.units.find((x) => x.member === u.member);
      if (existing)
        Object.assign(
          existing,
          Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined)),
        );
      else out.units.push(u);
    }
    // The same output loaded twice, or the same command in two files: each item once.
    const ctx = (x: { context?: string }) => x.context ?? '';
    add(out.ports, tag(state.ports), (p) => p.name);
    add(out.vlans, tag(state.vlans), (v) => String(v.id));
    add(out.etherchannels, tag(state.etherchannels), (e) => e.name);
    add(out.neighbors, tag(state.neighbors), (n) =>
      [n.protocol, n.local, n.device, n.port ?? ''].join('|'),
    );
    add(out.macs, tag(state.macs), (m) => [m.mac, m.vlan ?? '', m.port].join('|'));
    add(out.arp, tag(state.arp), (a) => [a.ip, a.mac ?? '', a.interface ?? ''].join('|'));
    add(out.poe, tag(state.poe), (p) => p.port);
    add(out.tunnels, tag(state.tunnels), (t) => [ctx(t), t.name, t.instance].join('|'));
    add(out.routes, tag(state.routes), (r) =>
      [ctx(r), r.code, r.prefix, r.gateway ?? '', r.interface ?? ''].join('|'),
    );
    add(out.bgp, tag(state.bgp), (b) => [ctx(b), b.neighbor].join('|'));
    add(out.sla, tag(state.sla), (x) => [ctx(x), x.healthCheck, x.seq].join('|'));
    add(out.sdwanServices, tag(state.sdwanServices), (x) => [ctx(x), x.id].join('|'));
    add(out.managedSwitches, tag(state.managedSwitches), (x) => x.serial);
    add(out.switchMacs, tag(state.switchMacs), (m) =>
      [m.switch, m.mac, m.vlan ?? '', m.port].join('|'),
    );
    out.commands.push(...tag(state.commands));
  }
  out.units.sort((a, b) => a.member - b.member);
  return out;
}

/**
 * Adds the items of one more file: an item already there is kept, with its file and lines,
 * and only completed with what it lacks.
 */
function add<T extends object>(list: T[], items: T[], key: (item: T) => string): void {
  const index = new Map(list.map((x) => [key(x), x]));
  for (const item of items) {
    const k = key(item);
    const existing = index.get(k) as Record<string, unknown> | undefined;
    if (!existing) {
      list.push(item);
      index.set(k, item);
      continue;
    }
    for (const [name, value] of Object.entries(item)) {
      if (value !== undefined && existing[name] === undefined) existing[name] = value;
    }
  }
}

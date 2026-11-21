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
    out.ports.push(...tag(state.ports));
    out.vlans.push(...tag(state.vlans));
    out.etherchannels.push(...tag(state.etherchannels));
    out.neighbors.push(...tag(state.neighbors));
    out.macs.push(...tag(state.macs));
    out.arp.push(...tag(state.arp));
    out.poe.push(...tag(state.poe));
    out.tunnels.push(...tag(state.tunnels));
    out.routes.push(...tag(state.routes));
    out.bgp.push(...tag(state.bgp));
    out.sla.push(...tag(state.sla));
    out.sdwanServices.push(...tag(state.sdwanServices));
    out.commands.push(...tag(state.commands));
  }
  out.units.sort((a, b) => a.member - b.member);
  return out;
}

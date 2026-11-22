// The devices managed by a FortiGate in the infrastructure (#15, part 4): every FortiSwitch is a
// device of the client, linked to its FortiGate through FortiLink; the two switches of an MCLAG
// pair are linked by their inter-chassis trunk; the FortiAPs are a group under the FortiGate.

import { managedSwitchModel, managedSwitchState } from '../model/managed';
import { hostKey } from '../show/assign';
import type { DeviceInfo } from './devices';
import { configEvidence, type NewLink } from './links';
import type { CorrelationInput, ExternalNode, LinkEvidence } from './types';

/** The devices given, and the FortiSwitches managed by the FortiGates among them. */
export function withManagedSwitches(inputs: readonly CorrelationInput[]): CorrelationInput[] {
  const out = [...inputs];
  for (const input of inputs) {
    for (const sw of input.model.managedSwitches ?? []) {
      out.push({
        hostname: sw.name,
        file: input.file,
        model: managedSwitchModel(input.model, sw),
        state: managedSwitchState(input.state, sw),
        managedBy: input.hostname,
        serial: sw.serial,
      });
    }
  }
  return out;
}

/** Id of the group of the FortiAPs of a FortiGate. */
export const apGroupId = (fortigate: string) => `aps:${fortigate}`;

export interface ManagedResult {
  links: NewLink[];
  externals: ExternalNode[];
  /** Nodes linked as by a cable: a switch is in the site of its FortiGate. */
  pairs: [string, string][];
}

export function findManaged(
  devices: readonly DeviceInfo[],
  byKey: ReadonlyMap<string, DeviceInfo>,
): ManagedResult {
  const links: NewLink[] = [];
  const externals: ExternalNode[] = [];
  const pairs: [string, string][] = [];
  const showEvidence = (fgt: DeviceInfo, item: { file?: string; src: LinkEvidence['src'] }) =>
    item.file ? [{ device: fgt.key, file: item.file, src: item.src }] : [];

  // FortiLink: every managed switch to its FortiGate, verified when the FortiGate sees it up.
  const managed = devices.filter((d) => d.input.managedBy);
  for (const d of managed) {
    const fgt = byKey.get(hostKey(d.input.managedBy!));
    const sw = fgt?.model.managedSwitches?.find((s) => s.serial === d.input.serial);
    if (!fgt || !sw) continue;
    const uplink = sw.ports.find((p) => p.trunkRole === 'fortilink');
    const status = fgt.state?.managedSwitches.find((s) => s.serial === sw.serial);
    links.push({
      kind: 'fortilink',
      a: {
        node: fgt.key,
        ...(sw.fortilink
          ? { interface: sw.fortilink, context: fgt.contextOf(fgt.iface(sw.fortilink)) }
          : {}),
      },
      b: { node: d.key, ...(uplink ? { interface: uplink.name } : {}) },
      sources: [
        {
          kind: 'fortilink',
          device: fgt.key,
          text: sw.serial,
          evidence: configEvidence(fgt.key, sw.src),
        },
        ...(status?.status === 'up'
          ? [
              {
                kind: 'fortilink-state' as const,
                device: fgt.key,
                text: status.statusText,
                evidence: showEvidence(fgt, status),
              },
            ]
          : []),
      ],
      ...(status
        ? {
            state: {
              b: {
                status: status.status,
                text: status.statusText,
                evidence: showEvidence(fgt, status),
              },
            },
          }
        : {}),
    });
    pairs.push([fgt.key, d.key]);
  }

  // MCLAG: the two switches of a FortiGate with an inter-chassis trunk, one LAG between them.
  const byFortigate = new Map<string, DeviceInfo[]>();
  for (const d of managed) {
    const key = hostKey(d.input.managedBy!);
    byFortigate.set(key, [...(byFortigate.get(key) ?? []), d]);
  }
  for (const [fgtKey, switches] of byFortigate) {
    const pair = switches.filter((d) => d.model.interfaces.some((i) => i.trunkRole === 'icl'));
    if (pair.length !== 2) continue;
    const [x, y] = pair as [DeviceInfo, DeviceInfo];
    const iclX = x.model.interfaces.find((i) => i.trunkRole === 'icl')!;
    const iclY = y.model.interfaces.find((i) => i.trunkRole === 'icl')!;
    const mx = iclX.members ?? [];
    const my = iclY.members ?? [];
    // The same id as a LAG found from the descriptions of its ports: one link, two sources.
    links.push({
      kind: 'lag',
      a: { node: x.key, context: x.contextOf(iclX), interface: iclX.name },
      b: { node: y.key, context: y.contextOf(iclY), interface: iclY.name },
      sources: [
        {
          kind: 'mclag',
          device: fgtKey,
          text: iclX.name,
          evidence: [...configEvidence(fgtKey, iclX.src), ...configEvidence(fgtKey, iclY.src)],
        },
      ],
      // The ports of the trunk in their order: the first with the first.
      cables: mx.map((port, i) => ({ a: port, ...(my[i] ? { b: my[i] } : {}), verified: false })),
    });
  }

  // FortiAPs: one group under their FortiGate.
  for (const fgt of devices) {
    const aps = fgt.model.wireless?.accessPoints ?? [];
    if (aps.length === 0) continue;
    const id = apGroupId(fgt.key);
    externals.push({
      id,
      kind: 'ap-group',
      label: `FortiAP (${aps.length})`,
      detail: aps.map((ap) => ap.name).join(', '),
    });
    links.push({
      kind: 'capwap',
      a: { node: fgt.key },
      b: { node: id },
      sources: [
        {
          kind: 'capwap',
          device: fgt.key,
          text: String(aps.length),
          evidence: aps.flatMap((ap) => configEvidence(fgt.key, ap.src)),
        },
      ],
    });
    pairs.push([fgt.key, id]);
  }
  return { links, externals, pairs };
}

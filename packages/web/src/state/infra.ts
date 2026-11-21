// The infrastructure of the files on the page (#15): the current configuration of every device,
// with the real state of its shows, put together by the correlation of the core.

import {
  correlate,
  hostKey,
  type CorrelationInput,
  type Infrastructure,
  type Link,
} from '@ncv/core';
import { contentStore } from './content';
import { deviceState, type ShowLinks } from './devices';
import { effectiveDetection } from './effective';
import type { DeviceGroup } from './groups';

/** Selection of the map in the list of the files. */
export const MAP_ID = '#map';

export const EMPTY_INFRASTRUCTURE: Infrastructure = {
  devices: [],
  sites: [],
  externals: [],
  links: [],
  problems: [],
  advpn: { hubs: [], spokes: [], pairs: [] },
};

export function buildInfrastructure(
  groups: readonly DeviceGroup[],
  links: ShowLinks,
): Infrastructure {
  const inputs: CorrelationInput[] = [];
  for (const group of groups) {
    const entry = group.current;
    const model = contentStore.get(entry.id)?.model;
    if (!model) continue;
    const hostname =
      effectiveDetection(entry.detection, entry.overrides).hostname.value ??
      model.hostname ??
      group.hostname;
    inputs.push({
      hostname,
      file: entry.id,
      model,
      state: deviceState(links.showsOf.get(entry.id)),
    });
  }
  return inputs.length > 0 ? correlate(inputs) : EMPTY_INFRASTRUCTURE;
}

/** The other side of the links of a device, for its views: ports, tunnels, BGP sessions. */
export interface Peer {
  link: Link;
  /** The side of this device. */
  here: Link['a'];
  /** The other side. */
  there: Link['a'];
  /** Hostname or label of the other side. */
  name: string;
  /** Configuration file of the other device, when it is a device of the client. */
  file?: string;
}

export function peersOf(infra: Infrastructure, hostname: string | undefined): Peer[] {
  if (!hostname) return [];
  const key = hostKey(hostname);
  const out: Peer[] = [];
  for (const link of infra.links) {
    for (const [here, there] of [
      [link.a, link.b],
      [link.b, link.a],
    ] as const) {
      if (here.node !== key) continue;
      const device = infra.devices.find((d) => d.key === there.node);
      const external = infra.externals.find((e) => e.id === there.node);
      out.push({
        link,
        here,
        there,
        name: device?.hostname ?? external?.label ?? there.node,
        ...(device ? { file: device.file } : {}),
      });
    }
  }
  return out;
}

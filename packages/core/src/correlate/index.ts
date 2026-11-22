// Correlation (#15, chapter 3 of the study, principle 2): the devices of a client put together.
// It finds the links between them, the sites they are in and the nodes outside the client.

import { findCables } from './cables';
import { findProblems } from './checks';
import { AddressIndex, DeviceInfo } from './devices';
import { editLinks, editSites, type MapEdits } from './edits';
import { findInternet, findOspf, findSubnets } from './l3';
import { LinkSet } from './links';
import { assignSites } from './sites';
import {
  INTERNET,
  type CorrelationInput,
  type ExternalNode,
  type InfraDevice,
  type Infrastructure,
} from './types';
import { findBgp, findShortcuts, findTunnels } from './vpn';

export * from './types';
export * from './edits';
export { vlanGateways, type RemoteGateway } from './gateways';
export { linkId } from './links';
export { siteCode, siteFromLocation } from './sites';

/**
 * The infrastructure of a client from the current configuration of each of its devices and
 * their shows, with the changes made by hand to its map. A device appears once, by hostname:
 * the first one given wins.
 */
export function correlate(
  inputs: readonly CorrelationInput[],
  edits?: MapEdits | null,
): Infrastructure {
  const byKey = new Map<string, DeviceInfo>();
  for (const input of inputs) {
    const d = new DeviceInfo(input);
    if (!byKey.has(d.key)) byKey.set(d.key, d);
  }
  const devices = [...byKey.values()].sort((x, y) => x.key.localeCompare(y.key));
  const index = new AddressIndex(devices);
  const set = new LinkSet();
  const externals = new Map<string, ExternalNode>();

  const cables = findCables(devices, byKey, index);
  for (const link of cables.links) set.add(link);
  for (const e of cables.externals) externals.set(e.id, e);

  const siteNodes = [
    ...devices.map((d) => ({
      key: d.key,
      hostname: d.input.hostname,
      ...(d.model.location ? { location: d.model.location.text } : {}),
    })),
    ...cables.externals.map((e) => ({ key: e.id, hostname: e.label })),
  ];
  // The sites changed by hand count already for the subnets: a subnet in two sites merged is
  // in one site.
  const { sites, siteOf } = editSites(
    siteNodes,
    assignSites(siteNodes, cables.pairs),
    edits ?? undefined,
  );

  const subnets = findSubnets(
    devices,
    siteOf,
    new Set(sites.filter((s) => !s.name).map((s) => s.id)),
  );
  for (const link of subnets.links) set.add(link);
  for (const e of subnets.externals) externals.set(e.id, e);
  const internet = findInternet(devices, index);
  for (const link of internet) set.add(link);
  if (internet.length > 0)
    externals.set(INTERNET, { id: INTERNET, kind: 'internet', label: 'Internet' });
  for (const link of findOspf(devices)) set.add(link);
  findTunnels(devices, byKey, index, set, externals);
  findBgp(devices, byKey, index, set, externals);
  findShortcuts(devices, byKey, index, set);

  // Sites hold the devices; a neighbour that was not loaded sits in the site of its cable.
  const deviceKeys = new Set(devices.map((d) => d.key));
  const used = sites
    .map((s) => ({ ...s, devices: s.devices.filter((k) => deviceKeys.has(k)) }))
    .filter((s) => s.devices.length > 0);
  const usedIds = new Set(used.map((s) => s.id));
  for (const e of externals.values()) {
    if (e.kind !== 'neighbor') continue;
    const site = siteOf.get(e.id);
    if (site && usedIds.has(site)) e.site = site;
  }

  const infraDevices: InfraDevice[] = devices.map((d) => {
    const m = d.model;
    return {
      key: d.key,
      hostname: d.input.hostname,
      file: d.input.file,
      type: m.vendor === 'fortinet' ? 'firewall' : 'switch',
      vendor: m.vendor,
      os: m.os,
      ...(m.version ? { version: m.version } : {}),
      ...(m.model ? { model: m.model } : {}),
      site: siteOf.get(d.key) ?? '',
      ha: m.features.includes('ha'),
      contexts: m.contexts.length > 1 ? m.contexts.map((c) => c.name) : [],
      ...(m.management ? { managementIp: m.management.ip } : {}),
      ...(m.location ? { location: m.location.text } : {}),
    };
  });

  // The links confirmed, discarded and added by hand, before the checks: a cable added by hand
  // is checked like the others.
  const siteIdOf = (name: string | undefined) => {
    const wanted = name?.trim().toLowerCase();
    return wanted ? used.find((s) => s.name.toLowerCase() === wanted)?.id : undefined;
  };
  const edited = editLinks(set.all(), [...externals.values()], byKey, siteIdOf, edits ?? undefined);
  const graph = {
    devices: infraDevices,
    sites: used,
    externals: edited.externals.sort((x, y) => x.id.localeCompare(y.id)),
    links: edited.links.sort((x, y) => x.id.localeCompare(y.id)),
  };
  const { problems, advpn } = findProblems({
    infra: graph,
    byKey,
    mismatches: cables.mismatches,
    subnets,
    orphans: edited.orphans,
    unknownPorts: edited.unknownPorts,
  });
  return { ...graph, problems, advpn, discarded: edited.discarded };
}

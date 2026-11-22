import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCiscoModel,
  correlate,
  isEmptyEdits,
  parseSyntax,
  splitLines,
  type CorrelationInput,
  type MapEdits,
} from '../src';
import { sampleClient, SAMPLES_DIR } from './helpers';

// Changes made by hand to the map of a client (#15, part 3): sites renamed, merged and chosen,
// links added by hand, inferred links confirmed or discarded. Devices and ports are named by
// hostname and interface, as in map.json.

function cisco(text: string): CorrelationInput {
  const lines = splitLines(text);
  const tree = parseSyntax(lines, 'indent', { dialect: 'cisco' });
  const model = buildCiscoModel({ lines, tree, os: 'ios-xe' });
  return { hostname: model.hostname!, file: model.hostname!, model };
}

/** A switch with a trunk on Gi1/0/1 and an address in a subnet (10.0.0.0/24 by default). */
function sw(
  name: string,
  location: string,
  options: { native?: number; uplink?: string; subnet?: string } = {},
) {
  const n = name.charCodeAt(name.length - 1) - 64;
  return cisco(`hostname ${name}
snmp-server location ${location}
interface GigabitEthernet1/0/1
${options.uplink ? ` description ${options.uplink}\n` : ''} switchport mode trunk
 switchport trunk native vlan ${options.native ?? 1}
interface Vlan10
 ip address ${options.subnet ?? '10.0.0'}.${n} 255.255.255.0
`);
}

const names = (infra: ReturnType<typeof correlate>) =>
  infra.sites.map((s) => `${s.name}: ${s.devices.join(' ')}`).sort();

describe('sites', () => {
  it('renames and merges sites, and moves a device to another site', () => {
    const devices = [
      sw('SW-A', 'Sede - CED'),
      sw('SW-B', 'Magazzino'),
      sw('SW-C', 'Filiale', { subnet: '10.3.0' }),
    ];
    const auto = correlate(devices);
    expect(names(auto)).toEqual(['Filiale: sw-c', 'Magazzino: sw-b', 'Sede: sw-a']);
    // The same subnet in two sites is an overlap of addresses, not a link.
    expect(auto.problems.map((p) => p.code)).toEqual(['subnet-overlap']);

    const edits: MapEdits = {
      sites: { magazzino: 'Sede' },
      deviceSites: { 'sw-c': 'Laboratorio' },
    };
    const infra = correlate(devices, edits);
    expect(names(infra)).toEqual(['Laboratorio: sw-c', 'Sede: sw-a sw-b']);
    expect(infra.sites.find((s) => s.name === 'Sede')).toMatchObject({
      id: 'sede',
      source: 'manual',
    });
    // In one site now: the shared subnet is a link of the two devices of the site.
    expect(infra.problems).toEqual([]);
    expect(infra.links.filter((l) => l.kind === 'subnet')).toMatchObject([
      { a: { node: 'sw-a' }, b: { node: 'sw-b' } },
    ]);
  });
});

describe('links', () => {
  it('adds links by hand, also towards nodes outside the client, and checks them', () => {
    const edits: MapEdits = {
      externals: [{ id: 'mpls', label: 'MPLS del provider', site: 'Sede' }],
      links: [
        {
          id: 'trunk',
          kind: 'cable',
          a: { device: 'SW-A', interface: 'Gi1/0/1' },
          b: { device: 'sw-b', interface: 'GigabitEthernet1/0/1' },
          note: 'Visto in sede',
        },
        {
          id: 'wan',
          kind: 'wan',
          a: { device: 'SW-A', interface: 'Gi1/0/2' },
          b: { external: 'mpls' },
        },
      ],
    };
    const infra = correlate([sw('SW-A', 'Sede'), sw('SW-B', 'Sede', { native: 99 })], edits);
    expect(infra.links.find((l) => l.id === 'manual:trunk')).toMatchObject({
      kind: 'cable',
      manual: true,
      verified: false,
      note: 'Visto in sede',
      a: { node: 'sw-a', interface: 'GigabitEthernet1/0/1' },
      b: { node: 'sw-b', interface: 'GigabitEthernet1/0/1' },
      sources: [{ kind: 'manual', device: 'sw-a', text: 'Visto in sede' }],
    });
    expect(infra.externals.find((e) => e.id === 'manual:mpls')).toEqual({
      id: 'manual:mpls',
      kind: 'manual',
      label: 'MPLS del provider',
      site: 'sede',
    });
    // A cable added by hand is checked like the others; a port that is not there is said.
    expect(infra.problems.map((p) => `${p.severity} ${p.code} ${p.link}`)).toEqual([
      'warning trunk-native manual:trunk',
      'info manual-interface manual:wan',
    ]);
    expect(infra.links.find((l) => l.id === 'manual:wan')).toMatchObject({
      kind: 'wan',
      a: { node: 'sw-a', interface: 'GigabitEthernet1/0/2', unknownInterface: true },
      b: { node: 'manual:mpls' },
    });
  });

  it('confirms and discards inferred links, and a correction replaces one', () => {
    const devices = [sw('SW-A', 'Sede', { uplink: 'SW-B Gi1/0/1' }), sw('SW-B', 'Sede')];
    const inferred = correlate(devices).links.find((l) => l.kind === 'cable')!;
    expect(inferred).toMatchObject({ verified: false, a: { node: 'sw-a' }, b: { node: 'sw-b' } });

    const confirmed = correlate(devices, { decisions: { [inferred.id]: 'confirmed' } });
    expect(confirmed.links.find((l) => l.id === inferred.id)?.confirmed).toBe(true);

    const discarded = correlate(devices, { decisions: { [inferred.id]: 'discarded' } });
    expect(discarded.links.some((l) => l.id === inferred.id)).toBe(false);
    expect(discarded.discarded.map((l) => l.id)).toEqual([inferred.id]);

    // The cable is on another port of SW-B: the link by hand takes the place of the inferred one.
    const corrected = correlate(devices, {
      links: [
        {
          id: 'fix',
          kind: 'cable',
          a: { device: 'SW-A', interface: 'Gi1/0/1' },
          b: { device: 'SW-B', interface: 'Vlan10' },
          replaces: inferred.id,
        },
      ],
    });
    expect(corrected.links.filter((l) => l.kind === 'cable').map((l) => l.id)).toEqual([
      'manual:fix',
    ]);
    expect(corrected.discarded.map((l) => l.id)).toEqual([inferred.id]);
  });

  it('keeps a link towards a device that is not in the client any more, and says so', () => {
    const infra = correlate([sw('SW-A', 'Sede')], {
      links: [
        {
          id: 'old',
          kind: 'cable',
          a: { device: 'SW-A', interface: 'Gi1/0/1' },
          b: { device: 'SW-OLD', interface: 'Gi1/0/48' },
        },
      ],
    });
    expect(infra.links.find((l) => l.id === 'manual:old')).toMatchObject({
      a: { node: 'sw-a' },
      b: { node: 'missing:sw-old', interface: 'Gi1/0/48' },
    });
    expect(infra.externals.find((e) => e.id === 'missing:sw-old')).toEqual({
      id: 'missing:sw-old',
      kind: 'missing',
      label: 'SW-OLD',
    });
    expect(infra.problems).toMatchObject([
      {
        code: 'manual-orphan',
        severity: 'warning',
        link: 'manual:old',
        devices: ['sw-a'],
        values: { device: 'SW-OLD', other: 'SW-A' },
      },
    ]);
  });

  it('knows when nothing was changed by hand', () => {
    expect(isEmptyEdits(undefined)).toBe(true);
    expect(isEmptyEdits({ format: 'ncv-map', version: 1, links: [], positions: {} })).toBe(true);
    expect(isEmptyEdits({ positions: { devices: { 'SW-A': { x: 1, y: 2 } } } })).toBe(false);
  });
});

describe('the map of the example client', () => {
  const map = JSON.parse(readFileSync(join(SAMPLES_DIR, 'mappa-esempio.json'), 'utf8')) as MapEdits;

  it('adds its links and nodes to the samples, and says what is missing', () => {
    const base = correlate(sampleClient());
    const infra = correlate(sampleClient(), map);
    expect(
      infra.links
        .filter((l) => l.manual)
        .map((l) => `${l.id} ${l.a.node} ${l.a.interface} ${l.b.node}`),
    ).toEqual([
      'manual:dc-switch fgt-dc x1 manual:sw-dc',
      'manual:dmz-server fgt-hq port10 manual:server-dmz',
      'manual:magazzino sw-hq-core GigabitEthernet3/0/39 missing:sw-hq-mag',
    ]);
    expect(infra.links.find((l) => l.id === 'manual:dc-switch')?.a.context).toBe('CORE');
    expect(infra.externals.filter((e) => e.kind === 'manual')).toMatchObject([
      { id: 'manual:server-dmz', site: 'sede' },
      { id: 'manual:sw-dc', site: 'datacenter' },
    ]);
    const lag = infra.links.find(
      (l) => l.id === 'lag:sw-hq-acc3/default/port-channel1|sw-hq-core/default/port-channel12',
    );
    expect(lag?.confirmed).toBe(true);
    // One more problem than the samples alone: the switch of the old warehouse.
    expect(infra.problems).toHaveLength(base.problems.length + 1);
    expect(infra.problems.filter((p) => p.code.startsWith('manual-'))).toMatchObject([
      { code: 'manual-orphan', values: { device: 'SW-HQ-MAG', other: 'SW-HQ-CORE' } },
    ]);
  });
});

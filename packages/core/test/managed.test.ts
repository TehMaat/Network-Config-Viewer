import { describe, expect, it } from 'vitest';
import {
  correlate,
  managedSwitchModel,
  managedSwitchState,
  readShowFile,
  splitLines,
  vlanGateways,
  vlanSetIds,
} from '../src';
import { readSampleText, sampleClient, sampleModel } from './helpers';

// FortiSwitches and FortiAPs managed by a FortiGate (#15, part 4): read from the configuration
// of the FortiGate, with their state from its shows, and in the infrastructure of the client.
// The shows are synthetic: their formats are to be confirmed with real outputs.

const campus = sampleModel('fortigate/fgt-campus-200f-fortios-7.6.conf');
const shows = readShowFile(splitLines(readSampleText('show/fgt-campus_sessione.txt'))).state;

describe('managed FortiSwitches', () => {
  it('reads every switch with its ports, trunks and VLANs as numbers', () => {
    expect(
      campus.managedSwitches?.map((s) => `${s.serial} ${s.name} ${s.model} ${s.fortilink}`),
    ).toEqual([
      'S248EPTF20000001 FSW-CAMPUS-01 FortiSwitch 248E-POE fortilink',
      'S248EPTF20000002 FSW-CAMPUS-02 FortiSwitch 248E-POE fortilink',
    ]);
    const sw = campus.managedSwitches![0]!;
    expect(sw.ports).toHaveLength(55);
    // Native VLAN and tagged VLANs, from the names of the VLAN interfaces of the FortiGate.
    const port1 = sw.ports.find((p) => p.name === 'port1')!;
    expect(port1).toMatchObject({
      kind: 'physical',
      poe: { mode: 'auto' },
      position: { member: 1, slot: 0, port: 1, uplink: false },
      switchport: { mode: 'trunk', nativeVlan: 10 },
    });
    expect(vlanSetIds(port1.switchport!.allowed!)).toEqual([20]);
    expect(sw.ports.find((p) => p.name === 'port52')).toMatchObject({
      shutdown: true,
      position: { uplink: true },
    });
    // The trunks: the inter-chassis link of the MCLAG pair, FortiLink, a trunk to the classrooms.
    expect(
      sw.ports.filter((p) => p.kind === 'lag').map((p) => `${p.name} ${p.trunkRole} ${p.members}`),
    ).toEqual([
      'ICL-CAMPUS icl port47,port48',
      'FL-FGT-CAMPUS fortilink port49',
      'TRUNK-AULE mclag port45',
    ]);
    expect(sw.ports.find((p) => p.name === 'port47')?.lag).toEqual({
      group: 'ICL-CAMPUS',
      mode: 'active',
    });
    expect(campus.features).toEqual(expect.arrayContaining(['fortiswitch', 'mclag', 'fortiap']));
  });

  it('reads the FortiAPs, their profile and the SSIDs', () => {
    expect(campus.wireless?.ssids).toMatchObject([
      {
        name: 'WIFI-CORP',
        ssid: 'ESEMPIO-CORP',
        security: 'wpa2-only-enterprise',
        radiusServer: 'RADIUS-NPS',
        vlanId: 70,
        localBridging: true,
      },
      { name: 'WIFI-GUEST', ssid: 'ESEMPIO-OSPITI', vlanId: 71, localBridging: true },
    ]);
    expect(campus.wireless?.profiles).toMatchObject([
      {
        name: 'FAP231F-CAMPUS',
        platform: '231F',
        radios: [
          { radio: 1, band: '802.11ax,n,g-only', ssids: ['WIFI-CORP', 'WIFI-GUEST'] },
          { radio: 2, band: '802.11ax-5G', ssids: ['WIFI-CORP', 'WIFI-GUEST'] },
          { radio: 3, mode: 'monitor', ssids: [] },
        ],
      },
    ]);
    expect(campus.wireless?.accessPoints.map((a) => `${a.name} ${a.model} ${a.profile}`)).toEqual(
      [1, 2, 3, 4].map((n) => `AP-CAMPUS-0${n} FortiAP 231F FAP231F-CAMPUS`),
    );
    // The passphrase is a secret: read on purpose, left out of the model.
    expect(JSON.stringify(campus.wireless)).not.toContain('passphrase');
  });

  it('reads the status of the switches and the MACs on their ports from the shows', () => {
    expect(shows.managedSwitches).toMatchObject([
      {
        serial: 'S248EPTF20000001',
        name: 'FSW-CAMPUS-01',
        version: 'v7.4.4 (867)',
        status: 'up',
        statusText: 'Authorized/Up',
        address: '10.255.250.2',
      },
      { serial: 'S248EPTF20000002', status: 'up' },
    ]);
    expect(shows.switchMacs).toHaveLength(11);
    expect(shows.switchMacs[3]).toMatchObject({
      switch: 'S248EPTF20000001',
      mac: '00:00:5e:00:53:34',
      port: 'port12',
      vlan: 60,
      type: 'dynamic',
    });
  });

  it('makes every switch a device of its own, with the VLANs of its FortiGate', () => {
    const sw = campus.managedSwitches![1]!;
    const model = managedSwitchModel(campus, sw);
    expect(model).toMatchObject({
      vendor: 'fortinet',
      os: 'fortiswitchos',
      hostname: 'FSW-CAMPUS-02',
      model: 'FortiSwitch 248E-POE',
    });
    // The same VLANs, so the same colours, on every switch of the FortiGate.
    expect(model.vlans.map((v) => v.id)).toEqual([1, 10, 20, 60, 70, 71, 99]);
    expect(model.vlans).toEqual(managedSwitchModel(campus, campus.managedSwitches![0]!).vlans);
    const state = managedSwitchState(shows, sw)!;
    expect(state.macs.map((m) => `${m.port} ${m.vlan}`)).toEqual([
      'port1 10',
      'port10 20',
      'port12 60',
      'port24 60',
    ]);
    expect(state.serials).toEqual(['S248EPTF20000002']);
    expect(managedSwitchState(null, sw)).toBeNull();
  });
});

describe('managed devices in the infrastructure', () => {
  const infra = correlate(sampleClient());

  it('puts the switches in the site of their FortiGate, linked through FortiLink', () => {
    const switches = infra.devices.filter((d) => d.managedBy);
    expect(
      switches.map((d) => `${d.hostname} ${d.type} ${d.site} ${d.managedBy} ${d.serial}`),
    ).toEqual([
      'FSW-CAMPUS-01 switch campus fgt-campus S248EPTF20000001',
      'FSW-CAMPUS-02 switch campus fgt-campus S248EPTF20000002',
    ]);
    // The configuration of a managed switch is the one of its FortiGate.
    expect(switches[0]!.file).toBe(infra.devices.find((d) => d.key === 'fgt-campus')!.file);
    expect(infra.links.filter((l) => l.kind === 'fortilink')).toMatchObject([
      { verified: true, state: { b: { status: 'up', text: 'Authorized/Up' } } },
      { verified: true },
    ]);
  });

  it('follows a VLAN of a managed switch up to its FortiGate', () => {
    const models = new Map(sampleClient().map((i) => [i.hostname.toLowerCase(), i.model]));
    const modelOf = (key: string) =>
      models.get(key) ??
      (key.startsWith('fsw-')
        ? managedSwitchModel(
            models.get('fgt-campus')!,
            models.get('fgt-campus')!.managedSwitches!.find((s) => s.name.toLowerCase() === key)!,
          )
        : null);
    expect(vlanGateways(infra, modelOf, 'fsw-campus-01', 10)).toMatchObject([
      {
        hostname: 'FGT-CAMPUS',
        interface: 'VL10-DATA',
        ip: '10.30.10.1',
        path: ['fsw-campus-01', 'fgt-campus'],
      },
    ]);
  });
});

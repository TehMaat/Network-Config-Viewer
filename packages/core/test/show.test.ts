import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  assignShows,
  buildModel,
  commandId,
  hasMacTable,
  mergeStates,
  modelHints,
  portLive,
  portsWithoutMac,
  readShowFile,
  splitLines,
  splitShowOutputs,
  tunnelLive,
  vlanNameFromState,
  type DeviceModel,
} from '../src';
import { readSampleText } from './helpers';

const show = (rel: string) => readShowFile(splitLines(readSampleText(rel)));
const model = (rel: string): DeviceModel => {
  const text = readSampleText(rel);
  const a = analyzeText(text);
  return buildModel(splitLines(text), a.tree, modelHints(a.detection))!;
};

describe('show commands', () => {
  it('recognises commands typed in full or abbreviated', () => {
    expect(commandId('sh int status')).toBe('show interfaces status');
    expect(commandId('show mac address-table')).toBe('show mac address-table');
    expect(commandId('sh mac-address-table')).toBe('show mac address-table');
    expect(commandId('sh ver')).toBe('show version');
    expect(commandId('sh vlan br')).toBe('show vlan brief');
    expect(commandId('sh vlan')).toBe('show vlan');
    expect(commandId('show lldp neighbors detail | include System')).toBe(
      'show lldp neighbors detail',
    );
    expect(commandId('diag vpn ike gate list')).toBe('diagnose vpn ike gateway list');
    expect(commandId('diagnose sys sdwan service4')).toBe('diagnose sys sdwan service');
    expect(commandId('diagnose system sdwan health-check')).toBe('diagnose sys sdwan health-check');
    expect(commandId('get router info routing-table all')).toBe(
      'get router info routing-table all',
    );
    expect(commandId('show running-config')).toBeUndefined();
    expect(commandId('terminal length 0')).toBeUndefined();
  });

  it('splits a session log at every prompt, with the VDOM of FortiOS prompts', () => {
    const lines = splitLines(readSampleText('show/fgt-hq_sessione.txt'));
    const outputs = splitShowOutputs(lines);
    // "config vdom" and "edit OFFICE" are typed too: they only change the VDOM of the prompt.
    expect(outputs.map((o) => [o.id ?? o.command, o.context ?? null])).toEqual([
      ['get system interface physical', null],
      ['config vdom', null],
      ['edit OFFICE', null],
      ['get vpn ipsec tunnel summary', 'OFFICE'],
      ['diagnose vpn ike gateway list', 'OFFICE'],
      ['get router info routing-table all', 'OFFICE'],
      ['get router info bgp summary', 'OFFICE'],
    ]);
    // The output ends before the next prompt.
    expect(lines[outputs[0]!.to - 1]).toMatch(/speed: n\/a/);
  });

  it('splits a file without prompts where an output begins', () => {
    const outputs = splitShowOutputs(
      splitLines(readSampleText('show/sw-br1-acc_show-vlan-brief-senza-prompt.txt')),
    );
    expect(outputs).toEqual([expect.objectContaining({ id: 'show vlan brief', typed: false })]);
  });
});

describe('Cisco IOS and IOS-XE shows', () => {
  const core = show('show/sw-hq-core_sessione.txt');

  it('reads inventory, interfaces, port-channels and neighbours', () => {
    expect(core.hostname).toBe('SW-HQ-CORE');
    expect(core.state.units.map((u) => `${u.member} ${u.model} ${u.serial}`)).toEqual([
      '1 C9300-48P FOC2001X0AA',
      '2 C9300-48P FOC2001X0BB',
      '3 C9300-48P FOC2001X0CC',
    ]);
    const gi = core.state.ports.find((p) => p.name === 'GigabitEthernet1/0/1')!;
    expect(gi).toMatchObject({
      status: 'connected',
      vlan: '100',
      speed: 'a-1000',
      description: 'SRV-101',
    });
    expect(core.state.ports.find((p) => p.name === 'GigabitEthernet1/0/41')!.status).toBe(
      'disabled',
    );
    expect(core.state.etherchannels.find((e) => e.name === 'Port-channel10')).toMatchObject({
      flags: 'SU',
      protocol: 'LACP',
      members: [
        { name: 'TenGigabitEthernet1/1/2', flags: 'P' },
        { name: 'TenGigabitEthernet2/1/2', flags: 'D' },
      ],
    });
    expect(core.state.neighbors.map((n) => `${n.local} ${n.device} ${n.port}`)).toEqual([
      'TenGigabitEthernet1/1/1 FGT-HQ x1',
      'TenGigabitEthernet2/1/1 FGT-HQ x2',
    ]);
  });

  it('reads MACs, ARP and PoE in a single format', () => {
    const first = core.state.macs[0]!;
    expect(first).toMatchObject({
      mac: '00:00:5e:00:53:01',
      vlan: 100,
      type: 'dynamic',
      port: 'GigabitEthernet1/0/1',
    });
    expect(core.state.macs.filter((m) => m.port === 'Port-channel10')).toHaveLength(10);
    expect(core.state.arp.find((a) => a.ip === '10.10.99.250')).toMatchObject({
      mac: '00:00:5e:00:53:f1',
      interface: 'Vlan99',
    });
    expect(core.state.poe.find((p) => p.port === 'GigabitEthernet1/0/25')).toMatchObject({
      oper: 'on',
      watts: 4.1,
      device: 'IP Phone 8845',
    });
  });

  it('reads the neighbours with CDP and the stack from show version', () => {
    const cdp = show('show/sw-hq-core_show-cdp-lldp-neighbors.txt');
    expect(
      cdp.state.neighbors.filter((n) => n.protocol === 'cdp').map((n) => `${n.local} ${n.device}`),
    ).toEqual([
      'TenGigabitEthernet1/1/2 SW-HQ-ACC1',
      'TenGigabitEthernet2/1/2 SW-HQ-ACC1',
      'GigabitEthernet3/0/47 SW-HQ-ACC2',
      'GigabitEthernet3/0/48 SW-HQ-ACC2',
    ]);
    const br1 = show('show/sw-br1-acc_sessione.txt');
    expect(br1.state.version).toBe('15.2(7)E10');
    expect(br1.state.units.map((u) => `${u.member} ${u.serial}`)).toEqual([
      '1 FOC2002X1AA',
      '2 FOC2002X1BB',
    ]);
  });
});

describe('Cisco Small Business shows', () => {
  const sb = show('show/sw-br3-acc_sessione.txt');

  it('reads their own formats', () => {
    expect(sb.state.version).toBe('3.4.1.03');
    expect(sb.state.units.map((u) => u.model)).toEqual(['CBS350-48P-4G', 'CBS350-48P-4G']);
    expect(sb.state.ports.find((p) => p.name === 'GigabitEthernet1/0/1')).toMatchObject({
      status: 'up',
      speed: '1000',
    });
    expect(sb.state.ports.find((p) => p.name === 'GigabitEthernet1/0/31')!.status).toBe('down');
    expect(sb.state.ports.find((p) => p.name === 'Port-channel1')!.status).toBe('up');
    expect(sb.state.macs[0]).toMatchObject({
      mac: '00:00:5e:00:53:80',
      port: 'GigabitEthernet1/0/1',
      type: 'dynamic',
    });
    expect(sb.state.neighbors[0]).toMatchObject({
      local: 'GigabitEthernet1/0/48',
      device: 'FGT-BR3',
    });
    expect(sb.state.vlans.map((v) => `${v.id} ${v.name}`)).toContain('99 GESTIONE');
    expect(sb.state.poe.find((p) => p.port === 'GigabitEthernet1/0/10')).toMatchObject({
      device: 'Access point',
      class: 'class4',
    });
  });
});

describe('FortiOS shows', () => {
  it('reads interfaces, tunnels with their dial-up instances, routes and BGP', () => {
    const hq = show('show/fgt-hq_sessione.txt');
    expect(hq.state.ports.find((p) => p.name === 'ha2')).toMatchObject({ status: 'down' });
    expect(hq.state.ports.find((p) => p.name === 'x1')).toMatchObject({
      status: 'up',
      speed: '10000Mbps',
    });
    const wan2 = tunnelLive('ADVPN-WAN2', hq.state, 'OFFICE');
    expect([wan2.instances.length, wan2.up, wan2.down]).toEqual([2, 1, 1]);
    expect(wan2.instances.find((t) => t.instance === 'ADVPN-WAN2_1')).toMatchObject({
      ikeEstablished: false,
      ikeVersion: 2,
    });
    const recursive = hq.state.routes.filter((r) => r.prefix === '10.21.0.0/16');
    expect(recursive.map((r) => `${r.code} ${r.gateway} ${r.interface} ${r.distance}`)).toEqual([
      'B 10.255.1.21 ADVPN-WAN1 200',
      'B 10.255.2.21 ADVPN-WAN2 200',
    ]);
    expect(hq.state.routes.find((r) => r.prefix === '10.99.0.0/16')).toMatchObject({
      code: 'O E2',
      interface: 'VL900-CORE',
    });
    expect(hq.state.routes.every((r) => r.context === 'OFFICE')).toBe(true);
    expect(hq.state.bgp.find((b) => b.neighbor === '10.255.2.22')).toMatchObject({
      state: 'Active',
    });
    expect(hq.state.bgp.find((b) => b.neighbor === '10.255.1.21')).toMatchObject({
      state: 'Established',
      prefixes: 1,
    });
  });

  it('reads SD-WAN health checks and the members chosen by each rule', () => {
    const br1 = show('show/fgt-br1_sessione.txt');
    expect(br1.state.sla.map((s) => `${s.healthCheck} ${s.member} ${s.alive} ${s.slaMap}`)).toEqual(
      [
        'INTERNET wan1 true 1',
        'INTERNET wan2 true 0',
        'HUB HUB-WAN1 true 1',
        'HUB HUB-WAN2 true 1',
      ],
    );
    expect(br1.state.sla[1]).toMatchObject({ packetLoss: 3, latency: 171.88, jitter: 31.21 });
    expect(
      br1.state.sdwanServices[0]!.members.map((m) => `${m.seq} ${m.interface} ${m.selected}`),
    ).toEqual(['3 HUB-WAN1 true', '4 HUB-WAN2 true']);
  });
});

describe('shows and devices', () => {
  it('assigns each file of shows to its device', () => {
    const devices = [
      { id: 'core', hostname: 'SW-HQ-CORE' },
      { id: 'br1', hostname: 'SW-BR1-ACC' },
      { id: 'fgt', hostname: 'FGT-HQ' },
    ];
    const assigned = assignShows(devices, [
      { id: 'a', hostname: 'SW-HQ-CORE.esempio.example', serials: [], fileName: 'x.txt' },
      { id: 'b', serials: [], fileName: 'sw-br1-acc_show-vlan-brief-senza-prompt.txt' },
      { id: 'c', serials: [], fileName: 'output.txt' },
      { id: 'd', hostname: 'SW-HQ-CORE', manualHostname: 'FGT-HQ', serials: [], fileName: 'x.txt' },
    ]);
    expect(Object.fromEntries(assigned)).toEqual({
      a: { device: 'core', reason: 'hostname' },
      b: { device: 'br1', reason: 'file-name' },
      d: { device: 'fgt', reason: 'manual' },
    });
  });

  it('follows the MAC rules on every configured port (#6)', () => {
    const m = model('cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt');
    const state = mergeStates([
      { file: 'f1', state: show('show/sw-hq-core_sessione.txt').state },
      { file: 'f2', state: show('show/sw-hq-core_show-cdp-lldp-neighbors.txt').state },
    ]);
    expect(hasMacTable(state)).toBe(true);
    const port = (name: string) =>
      portLive(
        m.interfaces.find((i) => i.name === name)!,
        state,
      );
    expect(port('GigabitEthernet1/0/1').macs.map((x) => x.mac)).toEqual(['00:00:5e:00:53:01']);
    expect(port('GigabitEthernet1/0/1').macs[0]!.file).toBe('f1');
    // Members of a port-channel: their MACs are on the port-channel.
    expect(port('TenGigabitEthernet1/1/2')).toMatchObject({
      macs: [],
      macsOn: 'Port-channel10',
      channelFlags: 'P',
      noMac: false,
    });
    expect(port('TenGigabitEthernet2/1/2').channelFlags).toBe('D');
    // The LLDP neighbours are in both files: once each.
    expect(
      port('TenGigabitEthernet1/1/1').neighbors.map((n) => `${n.protocol} ${n.device}`),
    ).toEqual(['lldp FGT-HQ']);
    expect(port('Port-channel10').macs).toHaveLength(10);
    // The address of a MAC from the ARP table of the same switch.
    expect(
      port('Port-channel10')
        .macs.find((x) => x.mac === '00:00:5e:00:53:30')!
        .arp.map((a) => a.ip),
    ).toEqual(['10.10.99.11']);
    expect(port('TenGigabitEthernet1/1/2').neighbors[0]).toMatchObject({
      protocol: 'cdp',
      device: 'SW-HQ-ACC1',
    });
    // Configured and not shut down, connected or not, but nothing learned: marked (#6).
    // Shut down: not marked.
    expect(port('GigabitEthernet1/0/31').noMac).toBe(true);
    expect(port('GigabitEthernet1/0/41').noMac).toBe(false);
    // Interfaces that learn no MACs are never marked.
    expect(port('Loopback0').noMac).toBe(false);
    expect(port('Vlan99').noMac).toBe(false);
    expect(portsWithoutMac(m, state)).toHaveLength(20);
    expect(portsWithoutMac(m, state)).toContain('GigabitEthernet1/0/13');
    expect(portsWithoutMac(m, null)).toEqual([]);
  });

  it('marks the sticky MACs of the config and finds the names of the VLANs kept by VTP', () => {
    const acc1 = model('cisco-ios/sw-hq-acc1-c3850-iosxe-16.12-stack.txt');
    const guest = acc1.interfaces.find((i) => i.name === 'GigabitEthernet1/0/45')!;
    const state = mergeStates([
      {
        file: 'f',
        state: readShowFile(
          splitLines(
            [
              'SW-HQ-ACC1#show mac address-table',
              'Vlan    Mac Address       Type        Ports',
              '----    -----------       --------    -----',
              '  50    0000.5e00.532d    STATIC      Gi1/0/45',
            ].join('\n'),
          ),
        ).state,
      },
    ]);
    expect(portLive(guest, state).macs[0]).toMatchObject({
      mac: '00:00:5e:00:53:2d',
      type: 'sticky',
    });

    const vlans = show('show/sw-br1-acc_show-vlan-brief-senza-prompt.txt').state;
    expect(vlanNameFromState(99, vlans)).toBe('GESTIONE');
  });
});

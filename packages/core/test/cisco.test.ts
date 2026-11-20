import { describe, expect, it } from 'vitest';
import {
  buildCiscoModel,
  formatVlanSet,
  parseAclEntry,
  parseSyntax,
  poeCapable,
  splitLines,
  type DeviceModel,
  type Interface,
  type OsId,
} from '../src';

function model(
  text: string,
  os: OsId = 'ios-xe',
  extra: { model?: string; version?: string } = {},
) {
  const lines = splitLines(text);
  const tree = parseSyntax(lines, 'indent', { dialect: os === 'cisco-sb' ? 'cisco-sb' : 'cisco' });
  return { lines, model: buildCiscoModel({ lines, tree, os, ...extra }) };
}

const iface = (m: DeviceModel, name: string): Interface => {
  const found = m.interfaces.find((i) => i.name === name);
  if (!found) throw new Error(`no interface ${name}`);
  return found;
};

/** The text of every reference, as "line text [name] → target line text". */
function references(lines: string[], m: DeviceModel): string[] {
  return m.references.map((r) => {
    const raw = lines[r.line - 1]!;
    return `${raw.slice(r.from, r.to)} → ${lines[r.targetLine - 1]!.trim()}`;
  });
}

describe('Cisco IOS and IOS-XE switch ports', () => {
  it('uses the vendor defaults for what the config does not say, and marks them', () => {
    const { model: m } = model(
      [
        'vlan 10',
        'interface GigabitEthernet1/0/1',
        '!',
        'interface GigabitEthernet1/0/2',
        ' switchport mode trunk',
        '!',
        'interface GigabitEthernet1/0/3',
        ' switchport access vlan 10',
        ' switchport mode access',
      ].join('\n'),
    );
    const p1 = iface(m, 'GigabitEthernet1/0/1');
    expect(p1.switchport).toMatchObject({ mode: 'dynamic-auto', accessVlan: 1, nativeVlan: 1 });
    expect(p1.switchport?.allowed?.all).toBe(true);
    expect(p1.defaults).toEqual(
      expect.arrayContaining(['switchport.mode', 'switchport.accessVlan', 'switchport.allowed']),
    );
    expect(p1.unverified).toBeUndefined();

    const p2 = iface(m, 'GigabitEthernet1/0/2');
    expect(p2.switchport?.mode).toBe('trunk');
    expect(p2.switchport?.allowed?.all).toBe(true);
    expect(p2.defaults).toEqual(['switchport.nativeVlan', 'switchport.allowed']);

    const p3 = iface(m, 'GigabitEthernet1/0/3');
    expect(p3.switchport).toEqual({ mode: 'access', accessVlan: 10 });
    expect(p3.defaults).toBeUndefined();
    expect(m.warnings).toEqual([]);
  });

  it('applies "allowed vlan" add, remove, except and none in order', () => {
    const { model: m } = model(
      [
        'interface TenGigabitEthernet1/1/1',
        ' switchport trunk allowed vlan 10,20',
        ' switchport trunk allowed vlan add 30-40',
        ' switchport trunk allowed vlan remove 35',
        ' switchport mode trunk',
        'interface TenGigabitEthernet1/1/2',
        ' switchport trunk allowed vlan except 1,1002-1005',
        ' switchport mode trunk',
        'interface TenGigabitEthernet1/1/3',
        ' switchport trunk allowed vlan none',
        ' switchport trunk native vlan 99',
        ' switchport mode trunk',
        ' switchport nonegotiate',
      ].join('\n'),
    );
    expect(formatVlanSet(iface(m, 'TenGigabitEthernet1/1/1').switchport!.allowed!)).toBe(
      '10,20,30-34,36-40',
    );
    expect(formatVlanSet(iface(m, 'TenGigabitEthernet1/1/2').switchport!.allowed!)).toBe(
      '2-1001,1006-4094',
    );
    const p3 = iface(m, 'TenGigabitEthernet1/1/3');
    expect(p3.switchport).toMatchObject({ mode: 'trunk', nativeVlan: 99, nonegotiate: true });
    expect(formatVlanSet(p3.switchport!.allowed!)).toBe('');
  });

  it('reads the access-port features: voice VLAN, port security, 802.1X, PoE, STP', () => {
    const { model: m } = model(
      [
        'vlan 10,20',
        'interface GigabitEthernet1/0/5',
        ' description PDL-005',
        ' switchport access vlan 10',
        ' switchport mode access',
        ' switchport voice vlan 20',
        ' switchport port-security maximum 2',
        ' switchport port-security mac-address sticky',
        ' switchport port-security mac-address sticky 0000.5e00.5301 vlan 10',
        ' switchport port-security',
        ' access-session port-control auto',
        ' mab',
        ' dot1x pae authenticator',
        ' power inline never',
        ' spanning-tree portfast',
        ' spanning-tree bpduguard enable',
        ' shutdown',
      ].join('\n'),
    );
    const p = iface(m, 'GigabitEthernet1/0/5');
    expect(p.description).toBe('PDL-005');
    expect(p.shutdown).toBe(true);
    expect(p.switchport).toEqual({ mode: 'access', accessVlan: 10, voiceVlan: 20 });
    expect(p.portSecurity).toEqual({
      enabled: true,
      maximum: 2,
      sticky: true,
      macs: [{ mac: '00:00:5e:00:53:01', sticky: true, vlan: 10 }],
    });
    expect(p.dot1x).toEqual({ dot1x: true, mab: true });
    expect(p.poe).toEqual({ mode: 'never' });
    expect(p.stp).toEqual({ portfast: true, bpduguard: true });
    // "power inline never": the port has no PoE.
    expect(m.features).toEqual(['dot1x', 'port-security', 'voice-vlan']);
    expect(m.vlans.find((v) => v.id === 20)?.voice).toBe(true);
    expect(m.coverage.unknown).toBe(0);
  });

  it('builds port-channels, also when only "channel-group" creates them', () => {
    const { lines, model: m } = model(
      [
        'interface Port-channel1',
        ' switchport mode trunk',
        'interface TenGigabitEthernet1/1/1',
        ' switchport mode trunk',
        ' channel-group 1 mode active',
        'interface TenGigabitEthernet2/1/1',
        ' switchport mode trunk',
        ' channel-group 1 mode active',
        'interface GigabitEthernet1/0/47',
        ' channel-group 2 mode on',
      ].join('\n'),
    );
    expect(iface(m, 'Port-channel1').members).toEqual([
      'TenGigabitEthernet1/1/1',
      'TenGigabitEthernet2/1/1',
    ]);
    expect(iface(m, 'TenGigabitEthernet1/1/1').lag).toEqual({
      group: 'Port-channel1',
      mode: 'active',
    });
    const po2 = iface(m, 'Port-channel2');
    expect(po2.members).toEqual(['GigabitEthernet1/0/47']);
    expect(po2.src).toEqual([]);
    expect(references(lines, m)).toEqual([
      '1 → interface Port-channel1',
      '1 → interface Port-channel1',
    ]);
    expect(m.features).toContain('lag');
  });

  it('places ports on the panel of each stack member and finds the uplinks', () => {
    const { model: m } = model(
      [
        'switch 1 provision c9300-48p',
        'switch 2 provision c9300-48p',
        'interface GigabitEthernet1/0/1',
        'interface GigabitEthernet1/0/48',
        'interface TenGigabitEthernet1/1/1',
        'interface GigabitEthernet2/0/1',
        'interface Vlan99',
        ' ip address 10.10.99.2 255.255.255.0',
      ].join('\n'),
      'ios-xe',
      { model: 'C9300-48P' },
    );
    expect(m.stack.map((s) => [s.member, s.model])).toEqual([
      [1, 'C9300-48P'],
      [2, 'C9300-48P'],
    ]);
    expect(iface(m, 'GigabitEthernet1/0/48').position).toEqual({
      member: 1,
      slot: 0,
      port: 48,
      uplink: false,
    });
    expect(iface(m, 'TenGigabitEthernet1/1/1').position).toEqual({
      member: 1,
      slot: 1,
      port: 1,
      uplink: true,
    });
    expect(iface(m, 'GigabitEthernet2/0/1').position?.member).toBe(2);
    // C9300-48P has PoE: front ports without "power inline" use the default.
    expect(iface(m, 'GigabitEthernet1/0/1').poe).toEqual({ mode: 'auto' });
    expect(iface(m, 'GigabitEthernet1/0/1').defaults).toContain('poe.mode');
    expect(iface(m, 'TenGigabitEthernet1/1/1').poe).toBeUndefined();
    expect(m.features).toEqual(expect.arrayContaining(['stack', 'poe', 'svi']));
    expect(m.management).toEqual({ ip: '10.10.99.2', interface: 'Vlan99' });
  });

  it('tells PoE models from the model name', () => {
    expect(poeCapable('WS-C2960X-48FPD-L')).toBe(true);
    expect(poeCapable('C9200-24P')).toBe(true);
    expect(poeCapable('C9300-48U')).toBe(true);
    expect(poeCapable('WS-C3850-24T')).toBe(false);
    expect(poeCapable('C9300-48T')).toBe(false);
    expect(poeCapable(undefined)).toBe(false);
  });

  it('reads layer 3 interfaces', () => {
    const { model: m } = model(
      [
        'interface GigabitEthernet1/0/48',
        ' no switchport',
        ' ip address 10.10.254.2 255.255.255.248',
        ' ip address 10.10.253.2 255.255.255.0 secondary',
        'interface Vlan70',
        ' ip address 10.10.70.1 255.255.255.0',
        ' ip helper-address 10.40.100.67',
        ' ip policy route-map PBR-OSPITI',
        'interface Vlan80',
        ' ip address dhcp',
        ' shutdown',
        'interface GigabitEthernet0/0',
        ' vrf forwarding Mgmt-vrf',
        ' ip address 192.0.2.10 255.255.255.0',
      ].join('\n'),
    );
    const routed = iface(m, 'GigabitEthernet1/0/48');
    expect(routed.switchport).toEqual({ mode: 'routed' });
    expect(routed.ipv4).toEqual([
      { ip: '10.10.254.2', prefix: 29 },
      { ip: '10.10.253.2', prefix: 24, secondary: true },
    ]);
    const svi = iface(m, 'Vlan70');
    expect(svi).toMatchObject({
      kind: 'svi',
      vlanId: 70,
      helperAddresses: ['10.40.100.67'],
      policyRouteMap: 'PBR-OSPITI',
    });
    expect(iface(m, 'Vlan80').dhcpClient).toBe(true);
    expect(iface(m, 'GigabitEthernet0/0')).toMatchObject({ kind: 'management', vrf: 'Mgmt-vrf' });
    expect(m.contexts[0]!.routing.policyRoutes).toEqual([
      expect.objectContaining({
        interface: 'Vlan70',
        routeMap: 'PBR-OSPITI',
        inputDevices: ['Vlan70'],
      }),
    ]);
    expect(m.features).toContain('pbr');
    // VLAN 70 exists because of its SVI, even if no "vlan 70" is written.
    expect(m.vlans.map((v) => v.id)).toEqual([1, 70, 80]);
  });
});

describe('Cisco VLANs and VTP', () => {
  it('reads VLAN blocks, ranges and names', () => {
    const { lines, model: m } = model(
      [
        'vlan 10',
        ' name DATI',
        '!',
        'vlan 20-22',
        '!',
        'interface GigabitEthernet1/0/1',
        ' switchport access vlan 10',
        ' switchport mode access',
      ].join('\n'),
    );
    expect(m.vlans.map((v) => [v.id, v.name ?? null, v.implicit ?? false])).toEqual([
      [1, 'default', true],
      [10, 'DATI', false],
      [20, null, false],
      [21, null, false],
      [22, null, false],
    ]);
    expect(references(lines, m)).toEqual(['10 → vlan 10']);
    expect(m.warnings).toEqual([]);
  });

  it('warns when VLANs are not in the config because of VTP', () => {
    const server = model(
      ['vtp mode server', 'vtp domain ESEMPIO', 'vlan 10', ' name DATI'].join('\n'),
    );
    expect(server.model.vtpMode).toBe('server');
    expect(server.model.warnings).toEqual([{ code: 'vtp-vlans-not-in-config', line: 1 }]);

    // VTP server and client keep VLANs and VTP settings in vlan.dat: only the ports show them.
    const hidden = model(
      [
        'interface GigabitEthernet1/0/1',
        ' switchport access vlan 10',
        ' switchport voice vlan 20',
        ' switchport mode access',
      ].join('\n'),
    );
    expect(hidden.model.vlans.every((v) => v.implicit)).toBe(true);
    expect(hidden.model.warnings).toEqual([{ code: 'vtp-vlans-not-in-config' }]);
    expect(hidden.model.features).toContain('vtp');

    const transparent = model(['vtp mode transparent', 'vlan 10', ' name DATI'].join('\n'));
    expect(transparent.model.warnings).toEqual([]);
  });
});

describe('Cisco access lists', () => {
  it('parses standard, extended and numbered entries', () => {
    expect(parseAclEntry('10 permit 10.10.99.0 0.0.0.255', 'standard', false)).toMatchObject({
      seq: 10,
      action: 'permit',
      source: { kind: 'wildcard', ip: '10.10.99.0', wildcard: '0.0.0.255' },
    });
    expect(parseAclEntry('deny   any log', 'standard', false)).toMatchObject({
      action: 'deny',
      source: { kind: 'any' },
      options: ['log'],
    });
    expect(
      parseAclEntry(
        '20 permit tcp 10.10.100.0 0.0.0.255 eq 443 host 10.40.100.53 range 1000 2000 established',
        'extended',
        false,
      ),
    ).toMatchObject({
      protocol: 'tcp',
      sourcePort: { op: 'eq', ports: ['443'] },
      destination: { kind: 'host', ip: '10.40.100.53' },
      destinationPort: { op: 'range', ports: ['1000', '2000'] },
      options: ['established'],
    });
    expect(
      parseAclEntry('permit tcp any any eq www 443 22', 'extended', false)?.destinationPort,
    ).toEqual({
      op: 'eq',
      ports: ['www', '443', '22'],
    });
    expect(
      parseAclEntry(
        '30 permit object-group OG-WEB 10.10.70.0 0.0.0.255 object-group OG-DC',
        'extended',
        false,
      ),
    ).toMatchObject({
      protocol: 'object-group:OG-WEB',
      destination: { kind: 'object-group', name: 'OG-DC' },
    });
    expect(parseAclEntry('remark Accesso alla gestione', 'extended', false)).toMatchObject({
      action: 'remark',
      remark: 'Accesso alla gestione',
    });
    expect(parseAclEntry('description prova', 'extended', false)).toBeNull();
  });

  it('parses the Small Business forms: ace-priority and management lists', () => {
    expect(
      parseAclEntry('deny ip any 10.0.0.0 0.255.255.255 ace-priority 10', 'extended', true),
    ).toMatchObject({
      seq: 10,
      action: 'deny',
      destination: { kind: 'wildcard', ip: '10.0.0.0', wildcard: '0.255.255.255' },
      options: [],
    });
    expect(
      parseAclEntry(
        'permit ip-source 10.10.99.0 mask 255.255.255.0 service ssh',
        'management',
        true,
      ),
    ).toMatchObject({
      action: 'permit',
      source: { kind: 'subnet', ip: '10.10.99.0', prefix: 24 },
      services: ['ssh'],
    });
    expect(parseAclEntry('deny', 'management', true)).toMatchObject({
      source: { kind: 'any' },
      services: [],
    });
  });

  it('finds where every list is applied and links the names to the definitions', () => {
    const { lines, model: m } = model(
      [
        'object-group network OG-DC',
        ' description Servizi',
        ' host 10.40.100.53',
        ' 10.40.100.0 255.255.255.0',
        'object-group network OG-INTERNE',
        ' 10.10.0.0 255.255.0.0',
        ' group-object OG-DC',
        'object-group service OG-WEB',
        ' tcp eq 443',
        'interface Vlan70',
        ' ip address 10.10.70.1 255.255.255.0',
        ' ip access-group ACL-OSPITI in',
        'ip access-list extended ACL-OSPITI',
        ' 10 deny ip any object-group OG-INTERNE',
        ' 20 permit object-group OG-WEB any any',
        'ip access-list standard MGMT',
        ' permit 10.10.99.0 0.0.0.255',
        'access-list 10 permit 192.0.2.0 0.0.0.255',
        'access-list 10 deny any',
        'route-map PBR permit 10',
        ' match ip address ACL-OSPITI 10',
        ' set ip next-hop 10.10.254.1',
        'snmp-server community ESEMPIO-RO RO MGMT',
        'line vty 0 4',
        ' access-class MGMT in',
        ' transport input ssh',
      ].join('\n'),
    );
    const acls = m.contexts[0]!.acls;
    expect(acls.map((a) => [a.name, a.type, a.entries.length])).toEqual([
      ['ACL-OSPITI', 'extended', 2],
      ['MGMT', 'standard', 1],
      ['10', 'standard', 2],
    ]);
    const bindings = (name: string) =>
      acls.find((a) => a.name === name)!.bindings.map((b) => b.kind);
    expect(bindings('ACL-OSPITI')).toEqual(['interface', 'route-map']);
    expect(bindings('MGMT')).toEqual(['line', 'snmp']);
    expect(bindings('10')).toEqual(['route-map']);
    expect(iface(m, 'Vlan70').aclIn).toBe('ACL-OSPITI');

    const groups = m.contexts[0]!.objectGroups;
    expect(groups.find((g) => g.name === 'OG-INTERNE')!.entries.map((e) => e.kind)).toEqual([
      'subnet',
      'group',
    ]);
    expect(groups.find((g) => g.name === 'OG-WEB')!.entries[0]).toMatchObject({
      kind: 'service',
      protocol: 'tcp',
      port: { op: 'eq', ports: ['443'] },
    });
    expect(references(lines, m)).toEqual([
      'OG-DC → object-group network OG-DC',
      'ACL-OSPITI → ip access-list extended ACL-OSPITI',
      'OG-INTERNE → object-group network OG-INTERNE',
      'OG-WEB → object-group service OG-WEB',
      'ACL-OSPITI → ip access-list extended ACL-OSPITI',
      '10 → access-list 10 permit 192.0.2.0 0.0.0.255',
      'MGMT → ip access-list standard MGMT',
      'MGMT → ip access-list standard MGMT',
    ]);
    // "transport input" is not interpreted yet: its line stays unknown, in the "line" section.
    expect(m.coverage.unknown).toBe(1);
    expect(m.coverage.sections).toEqual([{ section: 'line › transport', lines: 1, firstLine: 26 }]);
  });
});

describe('Cisco routing', () => {
  it('reads static routes and the default gateway', () => {
    const { model: m } = model(
      [
        'ip route 0.0.0.0 0.0.0.0 10.10.254.1 250 name DEFAULT-RISERVA',
        'ip route 10.99.0.0 255.255.0.0 Null0 name SCARTO',
        'ip route vrf Mgmt-vrf 0.0.0.0 0.0.0.0 GigabitEthernet0/0 192.0.2.1',
        'ip route 10.50.0.0 255.255.0.0 Vlan900 10.10.254.1 tag 5',
        'ip default-gateway 10.10.99.250',
        'interface Vlan900',
      ].join('\n'),
    );
    expect(m.contexts[0]!.routing.statics.map(({ src: _src, ...r }) => r)).toEqual([
      {
        dst: { ip: '0.0.0.0', prefix: 0 },
        gateway: '10.10.254.1',
        distance: 250,
        name: 'DEFAULT-RISERVA',
        enabled: true,
        kind: 'route',
      },
      {
        dst: { ip: '10.99.0.0', prefix: 16 },
        device: 'Null0',
        blackhole: true,
        name: 'SCARTO',
        enabled: true,
        kind: 'route',
      },
      {
        dst: { ip: '0.0.0.0', prefix: 0 },
        vrf: 'Mgmt-vrf',
        device: 'GigabitEthernet0/0',
        gateway: '192.0.2.1',
        enabled: true,
        kind: 'route',
      },
      {
        dst: { ip: '10.50.0.0', prefix: 16 },
        device: 'Vlan900',
        gateway: '10.10.254.1',
        enabled: true,
        kind: 'route',
      },
      {
        dst: { ip: '0.0.0.0', prefix: 0 },
        gateway: '10.10.99.250',
        enabled: true,
        kind: 'default-gateway',
      },
    ]);
    expect(m.references).toHaveLength(1);
  });

  it('reads OSPF with its interfaces, areas and passive interfaces', () => {
    const { lines, model: m } = model(
      [
        'interface Loopback0',
        ' ip address 10.10.255.2 255.255.255.255',
        ' ip ospf 1 area 0',
        'interface Vlan60',
        ' ip address 10.10.60.1 255.255.255.0',
        'interface Vlan900',
        ' ip address 10.10.254.2 255.255.255.248',
        ' ip ospf cost 10',
        'interface Vlan99',
        ' ip address 10.10.99.2 255.255.255.0',
        'router ospf 1',
        ' router-id 10.10.255.2',
        ' passive-interface default',
        ' no passive-interface Vl900',
        ' network 10.10.60.0 0.0.0.255 area 0',
        ' network 10.10.254.0 0.0.0.7 area 0',
        ' area 10 stub',
        ' redistribute static subnets route-map RM-STATICHE',
        'route-map RM-STATICHE permit 10',
        ' match ip address prefix-list PL-STATICHE',
        'ip prefix-list PL-STATICHE seq 10 permit 10.99.0.0/16 le 24',
      ].join('\n'),
    );
    const ospf = m.contexts[0]!.routing.ospf[0]!;
    expect(ospf).toMatchObject({
      process: '1',
      routerId: '10.10.255.2',
      passiveDefault: true,
      notPassive: ['Vlan900'],
      networks: [
        expect.objectContaining({ prefix: '10.10.60.0/24', area: '0' }),
        expect.objectContaining({ prefix: '10.10.254.0/29', area: '0' }),
      ],
      areas: [expect.objectContaining({ id: '10', type: 'stub' })],
      redistribute: [expect.objectContaining({ protocol: 'static', routeMap: 'RM-STATICHE' })],
    });
    expect(ospf.interfaces.map((i) => [i.name, i.area, i.passive, i.cost ?? null])).toEqual([
      ['Loopback0', '0', true, null],
      ['Vlan60', '0', true, null],
      ['Vlan900', '0', false, 10],
    ]);
    expect(m.contexts[0]!.routing.prefixLists[0]!.entries[0]).toMatchObject({
      seq: 10,
      action: 'permit',
      prefix: '10.99.0.0/16',
      le: 24,
    });
    expect(references(lines, m)).toEqual([
      'Vl900 → interface Vlan900',
      'RM-STATICHE → route-map RM-STATICHE permit 10',
      'PL-STATICHE → ip prefix-list PL-STATICHE seq 10 permit 10.99.0.0/16 le 24',
    ]);
    expect(m.features).toContain('ospf');
    expect(m.coverage.unknown).toBe(0);
  });

  it('reads BGP neighbours, peer groups, networks and policies', () => {
    const { lines, model: m } = model(
      [
        'router bgp 65010',
        ' bgp router-id 10.10.255.2',
        ' bgp log-neighbor-changes',
        ' neighbor HUB peer-group',
        ' neighbor HUB remote-as 65000',
        ' neighbor 10.255.1.254 peer-group HUB',
        ' neighbor 10.255.1.254 description FGT-HQ',
        ' neighbor 192.0.2.1 remote-as 64500',
        ' neighbor 192.0.2.1 shutdown',
        ' !',
        ' address-family ipv4',
        '  network 10.10.0.0 mask 255.255.0.0',
        '  neighbor HUB activate',
        '  neighbor HUB route-map RM-IN in',
        '  neighbor 192.0.2.1 prefix-list PL-OUT out',
        '  redistribute connected route-map RM-IN',
        ' exit-address-family',
        'route-map RM-IN permit 10',
        'ip prefix-list PL-OUT seq 5 permit 10.10.0.0/16',
      ].join('\n'),
    );
    const bgp = m.contexts[0]!.routing.bgp!;
    expect(bgp.asn).toBe('65010');
    expect(bgp.routerId).toBe('10.10.255.2');
    expect(bgp.groups).toEqual([
      expect.objectContaining({ address: 'HUB', remoteAs: '65000', routeMapIn: 'RM-IN' }),
    ]);
    expect(bgp.neighbors).toEqual([
      expect.objectContaining({ address: '10.255.1.254', group: 'HUB', description: 'FGT-HQ' }),
      expect.objectContaining({
        address: '192.0.2.1',
        remoteAs: '64500',
        shutdown: true,
        prefixListOut: 'PL-OUT',
      }),
    ]);
    expect(bgp.networks.map((n) => n.prefix)).toEqual(['10.10.0.0/16']);
    expect(bgp.redistribute).toEqual([
      expect.objectContaining({ protocol: 'connected', routeMap: 'RM-IN' }),
    ]);
    expect(references(lines, m)).toEqual([
      'HUB → neighbor HUB peer-group',
      'RM-IN → route-map RM-IN permit 10',
      'PL-OUT → ip prefix-list PL-OUT seq 5 permit 10.10.0.0/16',
      'RM-IN → route-map RM-IN permit 10',
    ]);
    expect(m.coverage.unknown).toBe(0);
  });
});

describe('Cisco Small Business', () => {
  const sb = (body: string[]) =>
    model(
      [
        'config-file-header',
        'SW-SB',
        'v3.4.1.3 / RCBS3.4.1.3_950_377_003',
        '@',
        'vlan database',
        'vlan 10,20,60,70,99',
        'exit',
        'voice vlan id 20',
        'hostname SW-SB',
        ...body,
      ].join('\n'),
      'cisco-sb',
    );

  it('uses the Small Business defaults and marks the uncertain ones', () => {
    const { model: m } = sb([
      'interface GigabitEthernet1/0/1',
      '!',
      'interface GigabitEthernet1/0/2',
      ' switchport mode trunk',
      ' switchport trunk allowed vlan add 60,70',
    ]);
    const p1 = iface(m, 'GigabitEthernet1/0/1');
    expect(p1.switchport).toEqual({ mode: 'access', accessVlan: 1 });
    expect(p1.unverified).toEqual(['switchport.mode']);
    const p2 = iface(m, 'GigabitEthernet1/0/2');
    // With the Small Business default (no VLAN on a new trunk) "add" gives exactly the list.
    expect(formatVlanSet(p2.switchport!.allowed!)).toBe('60,70');
    expect(m.warnings).toEqual([{ code: 'unverified-defaults' }]);
    expect(m.hostname).toBe('SW-SB');
    expect(m.vlans.map((v) => v.id)).toEqual([1, 10, 20, 60, 70, 99]);
    expect(m.vlans.find((v) => v.id === 20)?.voice).toBe(true);
  });

  it('reads general mode, VLAN names on the SVIs and the management ACL', () => {
    const { lines, model: m } = sb([
      'management access-list MGMT',
      'permit ip-source 10.10.99.0 mask 255.255.255.0 service ssh',
      'exit',
      'management access-class MGMT',
      'ip access-list extended ACL-OSPITI',
      'deny ip any 10.0.0.0 0.255.255.255 ace-priority 10',
      'permit ip any any ace-priority 20',
      'exit',
      'interface vlan 70',
      ' name WIFI',
      ' service-acl input ACL-OSPITI',
      '!',
      'interface vlan 99',
      ' name GESTIONE',
      ' ip address 10.22.99.2 255.255.255.0',
      '!',
      'interface GigabitEthernet1/0/10',
      ' switchport mode general',
      ' switchport general allowed vlan add 60 untagged',
      ' switchport general allowed vlan add 70 tagged',
      ' switchport general pvid 60',
      '!',
      'interface GigabitEthernet1/0/11',
      ' channel-group 1 mode auto',
      '!',
    ]);
    const ap = iface(m, 'GigabitEthernet1/0/10');
    expect(ap.switchport?.mode).toBe('general');
    expect(ap.switchport?.nativeVlan).toBe(60);
    expect(formatVlanSet(ap.switchport!.allowed!)).toBe('70');
    expect(formatVlanSet(ap.switchport!.untagged!)).toBe('60');
    expect(m.vlans.find((v) => v.id === 70)?.name).toBe('WIFI');
    expect(m.vlans.find((v) => v.id === 99)?.name).toBe('GESTIONE');
    expect(m.management).toEqual({ ip: '10.22.99.2', interface: 'Vlan99' });
    const acls = m.contexts[0]!.acls;
    expect(
      acls.map((a) => [a.name, a.type, a.entries.map((e) => e.seq), a.bindings.map((b) => b.kind)]),
    ).toEqual([
      ['MGMT', 'management', [undefined], ['management']],
      ['ACL-OSPITI', 'extended', [10, 20], ['interface']],
    ]);
    expect(iface(m, 'Port-channel1').members).toEqual(['GigabitEthernet1/0/11']);
    expect(references(lines, m)).toEqual(
      expect.arrayContaining([
        'MGMT → management access-list MGMT',
        'ACL-OSPITI → ip access-list extended ACL-OSPITI',
      ]),
    );
    // The header and the "exit" lines belong to their blocks.
    expect(m.coverage.unknown).toBe(0);
  });
});

describe('Cisco coverage', () => {
  it('ignores comments, banners and certificates, and groups what it does not know', () => {
    const { model: m } = model(
      [
        'Building configuration...',
        '',
        'Current configuration : 1000 bytes',
        '!',
        'version 17.12',
        'hostname SW-1',
        'aaa new-model',
        'aaa authentication login default local',
        'snmp-server location Sede',
        'snmp-server contact noc@esempio.example',
        'snmp-server location Sede',
        'banner motd ^C',
        'Solo personale autorizzato',
        '^C',
        'crypto pki certificate chain TP-1',
        ' certificate self-signed 01',
        '  3082 0000',
        '  \tquit',
        'interface GigabitEthernet1/0/1',
        ' storm-control broadcast level 1.00',
        'end',
      ].join('\n'),
    );
    const c = m.coverage;
    expect(c.total).toBe(c.understood + c.ignored + c.unknown);
    expect(c.unknown).toBe(6);
    expect(c.sections).toEqual([
      { section: 'aaa', lines: 2, firstLine: 7 },
      { section: 'snmp-server location', lines: 2, firstLine: 9 },
      { section: 'snmp-server contact', lines: 1, firstLine: 10 },
      { section: 'interface › storm-control', lines: 1, firstLine: 20 },
    ]);
    expect(m.hostname).toBe('SW-1');
  });
});

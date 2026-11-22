import { describe, expect, it } from 'vitest';
import {
  addressesMatchIp,
  buildFortiosModel,
  ipToInt,
  objectUsage,
  parsePortRanges,
  parseSyntax,
  policyMatchesIp,
  resolveAddress,
  resolveService,
  serviceText,
  splitLines,
  tokenize,
  type DeviceModel,
} from '../src';
import { sampleModel } from './helpers';

function model(text: string, version = '7.4.4'): { lines: string[]; model: DeviceModel } {
  const lines = splitLines(text);
  const tree = parseSyntax(lines, 'fortios');
  return { lines, model: buildFortiosModel({ lines, tree, os: 'fortios', version }) };
}

const references = (lines: string[], m: DeviceModel) =>
  m.references.map(
    (r) => `${lines[r.line - 1]!.slice(r.from, r.to)} → ${lines[r.targetLine - 1]!.trim()}`,
  );

describe('FortiOS values', () => {
  it('splits the values of a line, also quoted ones with spaces and escapes', () => {
    expect(tokenize('    set member "LAN A" "LAN-B"').map((t) => t.value)).toEqual([
      'set',
      'member',
      'LAN A',
      'LAN-B',
    ]);
    expect(tokenize('set comments "il \\"nuovo\\" server"')[2]!.value).toBe('il "nuovo" server');
    const line = '        set srcaddr "LAN-HQ"';
    const token = tokenize(line)[2]!;
    expect(line.slice(token.from, token.to)).toBe('LAN-HQ');
  });

  it('reads the port ranges of the custom services', () => {
    expect(parsePortRanges(['80', '1000-2000:1024-65535'])).toEqual([
      { dst: { low: 80, high: 80 } },
      { dst: { low: 1000, high: 2000 }, src: { low: 1024, high: 65535 } },
    ]);
  });
});

describe('FortiOS driver', () => {
  const text = [
    '#config-version=FG100F-7.4.4-FW-build2662-240514:opmode=0:vdom=0:user=admin',
    'config system global',
    '    set hostname "FGT-PROVA"',
    'end',
    'config system interface',
    '    edit "port1"',
    '        set vdom "root"',
    '        set ip 192.0.2.2 255.255.255.0',
    '        set allowaccess ping https',
    '        set type physical',
    '        set role wan',
    '    next',
    '    edit "port2"',
    '        set vdom "root"',
    '        set type physical',
    '        set status down',
    '    next',
    '    edit "VL10"',
    '        set vdom "root"',
    '        set ip 10.1.10.1 255.255.255.0',
    '        set interface "port2"',
    '        set vlanid 10',
    '    next',
    'end',
    'config firewall address',
    '    edit "NET-A"',
    '        set subnet 10.1.10.0 255.255.255.0',
    '    next',
    '    edit "HOST-B"',
    '        set subnet 10.1.10.20 255.255.255.255',
    '    next',
    '    edit "RANGE-C"',
    '        set type iprange',
    '        set start-ip 10.1.20.10',
    '        set end-ip 10.1.20.20',
    '    next',
    'end',
    'config firewall addrgrp',
    '    edit "GRP"',
    '        set member "NET-A" "RANGE-C"',
    '        set exclude enable',
    '        set exclude-member "HOST-B"',
    '    next',
    'end',
    'config firewall service custom',
    '    edit "WEB-8443"',
    '        set tcp-portrange 8443',
    '    next',
    'end',
    'config firewall service group',
    '    edit "GRP-WEB"',
    '        set member "HTTPS" "WEB-8443"',
    '    next',
    'end',
    'config firewall policy',
    '    edit 7',
    '        set srcintf "VL10"',
    '        set dstintf "port1"',
    '        set action accept',
    '        set srcaddr "GRP"',
    '        set dstaddr "all"',
    '        set schedule "always"',
    '        set service "GRP-WEB"',
    '        set nat enable',
    '    next',
    '    edit 3',
    '        set status disable',
    '        set srcintf "port1"',
    '        set dstintf "VL10"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set schedule "always"',
    '        set service "ALL"',
    '        set action accept',
    '        set logtraffic disable',
    '    next',
    'end',
    'config router static',
    '    edit 1',
    '        set gateway 192.0.2.1',
    '        set device "port1"',
    '    next',
    'end',
    'config vpn ipsec phase1-interface',
    '    edit "VPN-1"',
    '        set interface "port1"',
    '        set remote-gw 198.51.100.1',
    '        set psksecret ENC ESEMPIOSINTETICO',
    '    next',
    'end',
    'config vpn ipsec phase2-interface',
    '    edit "VPN-1-P2"',
    '        set phase1name "VPN-1"',
    '        set src-subnet 10.1.10.0 255.255.255.0',
    '    next',
    'end',
  ].join('\n');

  it('reads interfaces, VLANs and their state', () => {
    const { model: m } = model(text);
    expect(m.hostname).toBe('FGT-PROVA');
    const vl10 = m.interfaces.find((i) => i.name === 'VL10')!;
    expect(vl10).toMatchObject({
      kind: 'subinterface',
      parent: 'port2',
      vlanId: 10,
      context: 'root',
    });
    expect(m.interfaces.find((i) => i.name === 'port2')!.shutdown).toBe(true);
    expect(m.interfaces.find((i) => i.name === 'port1')!.allowAccess).toEqual(['ping', 'https']);
    expect(m.contexts.map((c) => c.name)).toEqual(['root']);
  });

  it('keeps the policies in the order of the table, with the defaults marked', () => {
    const { model: m } = model(text);
    const [first, second] = m.contexts[0]!.policies;
    expect(first).toMatchObject({
      id: 7,
      order: 1,
      action: 'accept',
      nat: true,
      enabled: true,
      logtraffic: 'utm',
    });
    expect(first!.defaults).toEqual(['status', 'logtraffic']);
    expect(second).toMatchObject({
      id: 3,
      order: 2,
      enabled: false,
      logtraffic: 'disable',
      nat: false,
    });
    expect(m.warnings.map((w) => w.code)).toEqual([
      'policy-disabled',
      'policy-no-log',
      'policy-any-any',
    ]);
  });

  it('adds the built-in objects the policies use', () => {
    const { model: m } = model(text);
    const ctx = m.contexts[0]!;
    expect(ctx.addresses.find((a) => a.name === 'all')).toMatchObject({ builtin: true, src: [] });
    expect(ctx.services.find((s) => s.name === 'HTTPS')).toMatchObject({ builtin: true });
    expect(resolveService('GRP-WEB', ctx).flatMap(serviceText)).toEqual(['tcp/443', 'tcp/8443']);
    expect(resolveService('ALL', ctx).flatMap(serviceText)).toEqual(['all']);
  });

  it('uses the FortiOS defaults for IPsec, with the uncertain ones marked', () => {
    const { model: m } = model(text);
    const tunnel = m.contexts[0]!.ipsec[0]!;
    expect(tunnel).toMatchObject({
      name: 'VPN-1',
      type: 'static',
      ikeVersion: 1,
      netDevice: false,
      addRoute: true,
    });
    expect(tunnel.unverified).toEqual(['ikeVersion', 'proposals', 'dhgrp']);
    expect(tunnel.phase2[0]).toMatchObject({
      name: 'VPN-1-P2',
      srcSubnet: '10.1.10.0/24',
      pfs: true,
    });
    // From 7.6 the assumed default is IKEv2, still to be confirmed.
    expect(model(text, '7.6.3').model.contexts[0]!.ipsec[0]!.ikeVersion).toBe(2);
  });

  it('marks the secret on purpose as ignored and links the names', () => {
    const { lines, model: m } = model(text);
    expect(m.coverage.unknown).toBe(0);
    expect(m.coverage.ignored).toBe(2);
    expect(references(lines, m)).toEqual(
      expect.arrayContaining([
        'port2 → edit "port2"',
        'GRP → edit "GRP"',
        'HOST-B → edit "HOST-B"',
        'WEB-8443 → edit "WEB-8443"',
        'GRP-WEB → edit "GRP-WEB"',
        'VPN-1 → edit "VPN-1"',
      ]),
    );
  });

  it('finds an IP in the policies through subnets, groups, exclusions and all', () => {
    const { model: m } = model(text);
    const ctx = m.contexts[0]!;
    const [first, second] = ctx.policies;
    expect(policyMatchesIp(first!, '10.1.10.5', ctx, m)).toEqual({
      source: 'group',
      destination: 'any',
    });
    // HOST-B is excluded from the group.
    expect(policyMatchesIp(first!, '10.1.10.20', ctx, m).source).toBeNull();
    expect(policyMatchesIp(first!, '10.1.20.15', ctx, m).source).toBe('group');
    expect(policyMatchesIp(second!, '10.9.9.9', ctx, m)).toEqual({
      source: 'any',
      destination: 'any',
    });
    expect(addressesMatchIp(['HOST-B'], ipToInt('10.1.10.20')!, ctx)).toBe('host');
    expect(resolveAddress('GRP', ctx).excluded.map((a) => a.name)).toEqual(['HOST-B']);
  });
});

describe('FortiOS samples', () => {
  const hq = sampleModel('fortigate/fgt-hq-100f-fortios-7.2-vdom.conf');

  it('puts every VDOM in its own context', () => {
    expect(hq.contexts.map((c) => c.name)).toEqual(['root', 'OFFICE', 'DMZ']);
    expect(hq.interfaces.find((i) => i.name === 'port10')?.context).toBe('DMZ');
    const office = hq.contexts.find((c) => c.name === 'OFFICE')!;
    expect(office.zones[0]).toMatchObject({
      name: 'OVERLAY',
      interfaces: ['ADVPN-WAN1', 'ADVPN-WAN2'],
    });
    expect(office.routing.bgp?.ranges.map((r) => `${r.prefix} ${r.group}`)).toEqual([
      '10.255.1.0/24 SPOKES-WAN1',
      '10.255.2.0/24 SPOKES-WAN2',
    ]);
    const dialup = office.ipsec.filter((t) => t.type === 'dynamic');
    expect(dialup.map((t) => t.name)).toEqual(['ADVPN-WAN1', 'ADVPN-WAN2']);
    expect(dialup.every((t) => t.advpn === 'sender')).toBe(true);
    // The static tunnel to the datacenter (#15).
    expect(office.ipsec.find((t) => t.name === 'VPN-DC')).toMatchObject({
      type: 'static',
      remoteGw: '203.0.113.130',
    });
  });

  it('finds the mail server through the VIP and says where the objects are used', () => {
    const office = hq.contexts.find((c) => c.name === 'OFFICE')!;
    const mail = office.policies.find((p) => p.name === 'Posta-in-ingresso')!;
    expect(policyMatchesIp(mail, '10.10.100.25', office, hq).destination).toBe('vip');
    expect(policyMatchesIp(mail, '203.0.113.3', office, hq).destination).toBe('vip');
    const usage = objectUsage(office);
    expect(usage.get('GRP-CORPORATE')?.map((u) => `${u.kind} ${u.id}`)).toEqual([
      'policy 3',
      'policy 4',
      'policy 5',
      'policy 8',
    ]);
    expect(usage.get('LAN-BR1')?.map((u) => `${u.kind} ${u.id}`)).toEqual([
      'address-group GRP-CORPORATE',
    ]);
  });

  it('reads SD-WAN with zones, members, health checks and rules', () => {
    const br1 = sampleModel('fortigate/fgt-br1-60f-fortios-7.0.conf');
    const sdwan = br1.contexts[0]!.sdwan!;
    expect(sdwan.enabled).toBe(true);
    expect(sdwan.members.map((m) => `${m.seq} ${m.interface} ${m.zone}`)).toEqual([
      '1 wan1 virtual-wan-link',
      '2 wan2 virtual-wan-link',
      '3 HUB-WAN1 overlay',
      '4 HUB-WAN2 overlay',
    ]);
    expect(sdwan.healthChecks[0]!.sla[0]).toMatchObject({
      latency: 150,
      jitter: 30,
      packetloss: 2,
    });
    expect(sdwan.rules.map((r) => `${r.id} ${r.mode} ${r.priorityMembers.join(',')}`)).toEqual([
      '1 sla 3,4',
      '2 priority 1,2',
    ]);
    expect(br1.contexts[0]!.routing.statics[0]!.sdwanZones).toEqual(['virtual-wan-link']);
  });

  it('ignores certificates and replacement messages on purpose', () => {
    const campus = sampleModel('fortigate/fgt-campus-200f-fortios-7.6.conf');
    expect(campus.coverage.sections.some((s) => /certificate|replacemsg/.test(s.section))).toBe(
      false,
    );
    // The managed FortiSwitches and FortiAPs are read now (#15, part 4).
    expect(
      campus.coverage.sections.some((s) => /switch-controller|wireless-controller/.test(s.section)),
    ).toBe(false);
    expect(campus.coverage.sections[0]!.section).toBe('config system admin');
  });
});

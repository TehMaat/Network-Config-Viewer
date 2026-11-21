import { describe, expect, it } from 'vitest';
import {
  buildCiscoModel,
  buildFortiosModel,
  correlate,
  emptyState,
  parseSyntax,
  splitLines,
  type CorrelationInput,
  type DeviceState,
  type Problem,
} from '../src';

// Consistency checks between devices (#15, part 2), on small synthetic configurations: one
// case for every check, and the rule that an unconfirmed default never makes an error.

function cisco(text: string, state?: DeviceState): CorrelationInput {
  const lines = splitLines(text);
  const tree = parseSyntax(lines, 'indent', { dialect: 'cisco' });
  const model = buildCiscoModel({ lines, tree, os: 'ios-xe' });
  return { hostname: model.hostname!, file: model.hostname!, model, ...(state ? { state } : {}) };
}

function forti(text: string, state?: DeviceState, version = '7.4.4'): CorrelationInput {
  const lines = splitLines(text);
  const tree = parseSyntax(lines, 'fortios');
  const model = buildFortiosModel({ lines, tree, os: 'fortios', version });
  return { hostname: model.hostname!, file: model.hostname!, model, ...(state ? { state } : {}) };
}

const codes = (problems: Problem[]) => problems.map((p) => `${p.severity} ${p.code}`);
const find = (problems: Problem[], code: string) => problems.filter((p) => p.code === code);

/** Two FortiGates with a static tunnel between them, with the phase 1 and 2 given. */
function tunnelPair(a: { p1?: string; p2?: string }, b: { p1?: string; p2?: string }) {
  const fortigate = (
    name: string,
    own: string,
    peer: string,
    extra: { p1?: string; p2?: string },
  ) =>
    forti(`config system global
    set hostname "${name}"
end
config system interface
    edit "wan1"
        set vdom "root"
        set ip ${own} 255.255.255.252
        set role wan
    next
end
config vpn ipsec phase1-interface
    edit "VPN"
        set interface "wan1"
        set remote-gw ${peer}
${extra.p1 ?? '        set ike-version 2\n        set proposal aes256-sha256\n        set dhgrp 14'}
    next
end
config vpn ipsec phase2-interface
    edit "VPN"
        set phase1name "VPN"
${extra.p2 ?? '        set proposal aes256-sha256\n        set dhgrp 14'}
    next
end`);
  return correlate([
    fortigate('FGT-A', '192.0.2.1', '192.0.2.2', a),
    fortigate('FGT-B', '192.0.2.2', '192.0.2.1', b),
  ]);
}

describe('IPsec tunnels', () => {
  it('finds nothing when the two sides agree, and counts what was compared', () => {
    const infra = tunnelPair({}, {});
    expect(infra.problems).toEqual([]);
    // IKE, authentication, proposals and DH of phase 1; selectors, proposals, PFS and DH of phase 2.
    expect(infra.links.find((l) => l.kind === 'ipsec')?.comparison).toEqual({
      compared: 8,
      issues: 0,
    });
  });

  it('finds proposals and DH groups with nothing in common, and a different IKE version', () => {
    const infra = tunnelPair(
      { p1: '        set ike-version 1\n        set proposal aes128-sha1\n        set dhgrp 2' },
      {},
    );
    expect(codes(infra.problems)).toEqual([
      'error ipsec-dhgrp',
      'error ipsec-ike',
      'error ipsec-proposals',
    ]);
    expect(find(infra.problems, 'ipsec-proposals')[0]!.values).toMatchObject({
      a: 'FGT-A',
      b: 'FGT-B',
      valueA: 'aes128-sha1',
      valueB: 'aes256-sha256',
    });
  });

  it('compares the phase 2: selectors, proposals and PFS', () => {
    const infra = tunnelPair(
      {
        p2: '        set proposal aes128-sha1\n        set pfs disable\n        set src-subnet 10.1.0.0 255.255.0.0\n        set dst-subnet 10.2.0.0 255.255.0.0',
      },
      {
        p2: '        set proposal aes256-sha256\n        set src-subnet 10.2.0.0 255.255.0.0\n        set dst-subnet 10.1.0.0 255.255.0.0',
      },
    );
    expect(codes(infra.problems)).toEqual(['error ipsec-p2-proposals', 'error ipsec-pfs']);
    const other = tunnelPair(
      {
        p2: '        set src-subnet 10.1.0.0 255.255.0.0\n        set dst-subnet 10.2.0.0 255.255.0.0',
      },
      {
        p2: '        set src-subnet 10.2.0.0 255.255.0.0\n        set dst-subnet 10.9.0.0 255.255.0.0',
      },
    );
    expect(codes(other.problems)).toEqual(['error ipsec-selectors']);
  });

  it('never makes an error of a default that is not confirmed: it is to be checked', () => {
    // No DH groups written on side B: the default of FortiOS, not confirmed yet.
    const infra = tunnelPair(
      { p1: '        set ike-version 2\n        set proposal aes256-sha256\n        set dhgrp 21' },
      { p1: '        set ike-version 2\n        set proposal aes256-sha256' },
    );
    expect(infra.problems).toMatchObject([
      { code: 'ipsec-dhgrp', severity: 'warning', unverified: true },
    ]);
  });

  it('finds a remote gateway that points to a device with no tunnel there', () => {
    const infra = correlate([
      forti(`config system global
    set hostname "FGT-A"
end
config system interface
    edit "wan1"
        set ip 192.0.2.1 255.255.255.252
    next
end
config vpn ipsec phase1-interface
    edit "VPN"
        set interface "wan1"
        set remote-gw 192.0.2.2
    next
end`),
      forti(`config system global
    set hostname "FGT-B"
end
config system interface
    edit "wan1"
        set ip 192.0.2.2 255.255.255.252
    next
end`),
    ]);
    expect(infra.problems).toMatchObject([
      {
        code: 'ipsec-no-tunnel',
        severity: 'error',
        values: { interface: 'wan1', peer: '192.0.2.2' },
      },
    ]);
  });
});

describe('BGP sessions', () => {
  const router = (
    name: string,
    ip: string,
    asn: string,
    peer: string,
    remoteAs: string,
    state?: DeviceState,
  ) =>
    cisco(
      `hostname ${name}
interface GigabitEthernet0/1
 no switchport
 ip address ${ip} 255.255.255.252
!
router bgp ${asn}
 neighbor ${peer} remote-as ${remoteAs}
!`,
      state,
    );

  it('finds an AS that is not the one of the other side', () => {
    const infra = correlate([
      router('R-A', '10.0.0.1', '65001', '10.0.0.2', '65099'),
      router('R-B', '10.0.0.2', '65002', '10.0.0.1', '65001'),
    ]);
    expect(infra.problems).toMatchObject([
      {
        code: 'bgp-as',
        values: { device: 'R-A', peer: 'R-B', expected: '65099', actual: '65002' },
      },
    ]);
  });

  it('finds a neighbour missing on the other side, and a session down in the shows', () => {
    const state = emptyState();
    state.bgp.push({ neighbor: '10.0.0.2', state: 'Active', src: [[1, 1]] });
    const infra = correlate([
      router('R-A', '10.0.0.1', '65001', '10.0.0.2', '65002', state),
      cisco(
        'hostname R-B\ninterface GigabitEthernet0/1\n no switchport\n ip address 10.0.0.2 255.255.255.252\n!\nrouter bgp 65002\n!',
      ),
    ]);
    expect(codes(infra.problems)).toEqual(['error bgp-down', 'error bgp-no-neighbor']);
    expect(find(infra.problems, 'bgp-down')[0]!.values).toMatchObject({ state: 'Active' });
  });
});

describe('cables, trunks and LAGs', () => {
  const sw = (name: string, body: string, state?: DeviceState) =>
    cisco(`hostname ${name}\n${body}`, state);

  it('finds a trunk against an access port, and two sides that only negotiate', () => {
    const infra = correlate([
      sw(
        'SW-A',
        'interface GigabitEthernet1/0/1\n description SW-B Gi1/0/1\n switchport mode trunk\n!',
      ),
      sw(
        'SW-B',
        'interface GigabitEthernet1/0/1\n switchport mode access\n switchport access vlan 10\n!',
      ),
    ]);
    expect(infra.problems).toMatchObject([
      { code: 'trunk-mode', severity: 'error', values: { valueA: 'trunk', valueB: 'access' } },
    ]);
    const dtp = correlate([
      sw(
        'SW-A',
        'interface GigabitEthernet1/0/1\n description SW-B Gi1/0/1\n switchport mode dynamic auto\n!',
      ),
      sw('SW-B', 'interface GigabitEthernet1/0/1\n switchport mode dynamic auto\n!'),
    ]);
    expect(codes(dtp.problems)).toEqual(['error trunk-mode']);
  });

  it('finds a different native VLAN and VLANs allowed on one side only', () => {
    const infra = correlate([
      sw(
        'SW-A',
        'interface GigabitEthernet1/0/1\n description SW-B Gi1/0/1\n switchport mode trunk\n switchport trunk allowed vlan 10,20,30\n!',
      ),
      sw(
        'SW-B',
        'interface GigabitEthernet1/0/1\n switchport mode trunk\n switchport trunk native vlan 999\n switchport trunk allowed vlan 10,20,40-41\n!',
      ),
    ]);
    expect(codes(infra.problems)).toEqual(['warning trunk-allowed', 'warning trunk-native']);
    expect(find(infra.problems, 'trunk-allowed')[0]!.values).toMatchObject({
      onlyA: '30',
      onlyB: '40-41',
    });
    expect(find(infra.problems, 'trunk-native')[0]!.values).toMatchObject({
      valueA: '1',
      valueB: '999',
    });
  });

  it('finds the VLAN interfaces of a FortiGate that the switch does not carry', () => {
    const infra = correlate([
      forti(`config system global
    set hostname "FGT-A"
end
config system interface
    edit "port1"
        set vdom "root"
    next
    edit "VL10"
        set vdom "root"
        set interface "port1"
        set vlanid 10
    next
    edit "VL20"
        set vdom "root"
        set interface "port1"
        set vlanid 20
    next
end`),
      sw(
        'SW-B',
        'interface GigabitEthernet1/0/1\n description FGT-A port1\n switchport mode trunk\n switchport trunk allowed vlan 10\n!',
      ),
    ]);
    expect(find(infra.problems, 'trunk-allowed')).toMatchObject([
      // Side A is the FortiGate, with VLAN 20 that the switch does not carry.
      { values: { a: 'FGT-A', onlyA: '20', onlyB: '—' } },
    ]);
    // The FortiGate does not send LLDP by default: the cable cannot be verified there.
    expect(find(infra.problems, 'discovery-off')).toMatchObject([
      { severity: 'info', values: { device: 'FGT-A', port: 'port1' } },
    ]);
  });

  it('finds LACP on one side only, LACP passive on both and a different number of cables', () => {
    const lag = (mode: string, members: number) =>
      [
        'interface Port-channel1\n description OTHER\n switchport mode trunk\n!',
        ...Array.from(
          { length: members },
          (_, i) =>
            `interface GigabitEthernet1/0/${i + 1}\n switchport mode trunk\n channel-group 1 mode ${mode}\n!`,
        ),
      ].join('\n');
    const pair = (a: string, b: string) =>
      correlate([
        sw('SW-A', a.replace('OTHER', 'SW-B Po1')),
        sw('SW-B', b.replace('OTHER', 'SW-A Po1')),
      ]);
    expect(codes(pair(lag('active', 2), lag('on', 2)).problems)).toEqual(['error lag-mode']);
    expect(codes(pair(lag('passive', 2), lag('passive', 2)).problems)).toEqual(['error lag-mode']);
    expect(codes(pair(lag('active', 2), lag('active', 4)).problems)).toEqual([
      'warning lag-cables',
    ]);
    const single = correlate([
      sw('SW-A', lag('active', 2).replace('OTHER', 'SW-B Gi1/0/9')),
      sw('SW-B', 'interface GigabitEthernet1/0/9\n switchport mode trunk\n!'),
    ]);
    expect(codes(single.problems)).toEqual(['error lag-one-side']);
  });

  it('finds a different MTU on the two sides', () => {
    const infra = correlate([
      sw(
        'SW-A',
        'interface GigabitEthernet1/0/1\n description SW-B Gi1/0/1\n no switchport\n mtu 9000\n ip address 10.0.0.1 255.255.255.252\n!',
      ),
      sw(
        'SW-B',
        'interface GigabitEthernet1/0/1\n no switchport\n ip address 10.0.0.2 255.255.255.252\n!',
      ),
    ]);
    expect(infra.problems).toMatchObject([
      { code: 'mtu', values: { valueA: '9000', valueB: '1500 (default)' } },
    ]);
  });

  it('finds a description that names a device while LLDP or CDP sees another one', () => {
    const state = emptyState();
    state.neighbors.push({
      protocol: 'cdp',
      local: 'GigabitEthernet1/0/1',
      device: 'SW-C',
      port: 'GigabitEthernet1/0/1',
      src: [[1, 1]],
    });
    const infra = correlate([
      sw(
        'SW-A',
        'interface GigabitEthernet1/0/1\n description UPLINK-SW-B\n switchport mode trunk\n!',
        state,
      ),
      sw('SW-B', 'interface GigabitEthernet1/0/1\n switchport mode trunk\n!'),
      sw('SW-C', 'interface GigabitEthernet1/0/1\n switchport mode trunk\n!'),
    ]);
    expect(find(infra.problems, 'description-mismatch')).toMatchObject([
      { values: { device: 'SW-A', described: 'SW-B', seen: 'SW-C', protocol: 'CDP' } },
    ]);
    // The cable is the one seen by CDP, not the one of the description.
    expect(infra.links.map((l) => `${l.kind} ${l.a.node} ${l.b.node}`)).toEqual([
      'cable sw-a sw-c',
    ]);
  });

  it('says where a cable cannot be verified, with LLDP and CDP off', () => {
    const infra = correlate([
      sw(
        'SW-A',
        'no cdp run\ninterface GigabitEthernet1/0/1\n description SW-B Gi1/0/1\n switchport mode trunk\n!',
      ),
      sw('SW-B', 'lldp run\ninterface GigabitEthernet1/0/1\n switchport mode trunk\n!'),
    ]);
    expect(infra.problems).toMatchObject([
      {
        code: 'discovery-off',
        severity: 'info',
        values: { device: 'SW-A', port: 'GigabitEthernet1/0/1' },
      },
    ]);
  });
});

describe('OSPF and addresses', () => {
  it('finds a different area and a passive interface', () => {
    const r = (name: string, ip: string, area: string, passive = false) =>
      cisco(`hostname ${name}
interface Vlan10
 ip address ${ip} 255.255.255.0
!
router ospf 1
 network 10.0.0.0 0.0.0.255 area ${area}
${passive ? ' passive-interface Vlan10\n' : ''}!`);
    expect(
      codes(correlate([r('R-A', '10.0.0.1', '0'), r('R-B', '10.0.0.2', '1')]).problems),
    ).toEqual(['error ospf-area']);
    expect(
      codes(correlate([r('R-A', '10.0.0.1', '0'), r('R-B', '10.0.0.2', '0.0.0.0', true)]).problems),
    ).toEqual(['warning ospf-passive']);
  });

  it('finds the same address on two devices and the same subnet in two sites', () => {
    const svi = (name: string, ip: string, location: string) =>
      cisco(
        `hostname ${name}\nsnmp-server location ${location}\ninterface Vlan10\n ip address ${ip} 255.255.255.0\n!`,
      );
    const duplicate = correlate([svi('SW-A', '10.0.0.1', 'Sede'), svi('SW-B', '10.0.0.1', 'Sede')]);
    expect(duplicate.problems).toMatchObject([
      { code: 'ip-duplicate', severity: 'error', values: { ip: '10.0.0.1' } },
    ]);
    const overlap = correlate([
      svi('SW-A', '192.168.1.1', 'Milano'),
      svi('SW-B', '192.168.1.2', 'Roma'),
    ]);
    expect(overlap.problems).toMatchObject([
      { code: 'subnet-overlap', severity: 'warning', values: { subnet: '192.168.1.0/24' } },
    ]);
  });
});

describe('expected routes', () => {
  it('finds a network announced in BGP that the routing table of a peer does not have', () => {
    const state = emptyState();
    state.routes.push({ code: 'C', prefix: '10.0.0.0/30', selected: true, src: [[1, 1]] });
    state.commands.push({ id: 'get router info routing-table all', line: 1 });
    const fgt = (name: string, ip: string, peer: string, net: string, s?: DeviceState) =>
      forti(
        `config system global
    set hostname "${name}"
end
config system interface
    edit "port1"
        set vdom "root"
        set ip ${ip} 255.255.255.252
    next
end
config router bgp
    set as 65000
    config neighbor
        edit "${peer}"
            set remote-as 65000
        next
    end
    config network
        edit 1
            set prefix ${net} 255.255.0.0
        next
    end
end`,
        s,
      );
    const infra = correlate([
      fgt('FGT-A', '10.0.0.1', '10.0.0.2', '10.1.0.0', state),
      fgt('FGT-B', '10.0.0.2', '10.0.0.1', '10.2.0.0'),
    ]);
    expect(infra.problems).toMatchObject([
      { code: 'route-missing', values: { device: 'FGT-A', prefix: '10.2.0.0/16', from: 'FGT-B' } },
    ]);
  });
});

describe('ADVPN', () => {
  const hub = (extra: string) =>
    forti(`config system global
    set hostname "FGT-HUB"
end
config system interface
    edit "wan1"
        set vdom "root"
        set ip 203.0.113.2 255.255.255.248
        set role wan
    next
    edit "ADVPN"
        set vdom "root"
        set type tunnel
        set ip 10.255.0.254 255.255.255.255
        set remote-ip 10.255.0.253 255.255.255.0
        set interface "wan1"
    next
end
config vpn ipsec phase1-interface
    edit "ADVPN"
        set type dynamic
        set interface "wan1"
        set ike-version 2
        set proposal aes256-sha256
        set dhgrp 14
        set auto-discovery-sender enable
    next
end
config router bgp
    set as 65000
    config neighbor-group
        edit "SPOKES"
            set remote-as 65000
            set route-reflector-client enable
${extra}
        next
    end
    config neighbor-range
        edit 1
            set prefix 10.255.0.0 255.255.255.0
            set neighbor-group "SPOKES"
        next
    end
end`);
  const spoke = (n: number, policy: boolean) =>
    forti(`config system global
    set hostname "FGT-S${n}"
end
config system interface
    edit "wan1"
        set vdom "root"
        set ip 192.0.2.${n * 4 + 2} 255.255.255.252
        set role wan
    next
    edit "lan"
        set vdom "root"
        set ip 10.${n}.0.1 255.255.0.0
    next
    edit "HUB"
        set vdom "root"
        set type tunnel
        set ip 10.255.0.${n} 255.255.255.255
        set remote-ip 10.255.0.254 255.255.255.0
        set interface "wan1"
    next
end
config firewall address
    edit "OTHERS"
        set subnet 10.0.0.0 255.0.0.0
    next
end
config firewall policy
${
  policy
    ? `    edit 1
        set srcintf "lan"
        set dstintf "HUB"
        set action accept
        set srcaddr "all"
        set dstaddr "OTHERS"
        set schedule "always"
        set service "ALL"
    next`
    : ''
}
end
config vpn ipsec phase1-interface
    edit "HUB"
        set interface "wan1"
        set ike-version 2
        set proposal aes256-sha256
        set dhgrp 14
        set remote-gw 203.0.113.2
        set auto-discovery-receiver enable
    next
end
config router bgp
    set as 65000
    config neighbor
        edit "10.255.0.254"
            set remote-as 65000
        next
    end
    config network
        edit 1
            set prefix 10.${n}.0.0 255.255.0.0
        next
    end
end`);

  it('finds the hub without a policy between the overlays and with next-hop-self', () => {
    const infra = correlate([
      hub('            set next-hop-self enable'),
      spoke(1, true),
      spoke(2, true),
    ]);
    expect(codes(infra.problems)).toEqual(['warning advpn-hub-policy', 'warning advpn-next-hop']);
    expect(infra.advpn.hubs).toEqual([{ device: 'fgt-hub', context: 'root', tunnels: ['ADVPN'] }]);
    expect(infra.advpn.pairs).toMatchObject([{ a: 'fgt-s1', b: 'fgt-s2', status: 'impossible' }]);
    expect(infra.advpn.pairs[0]!.reasons).toHaveLength(2);
  });

  it('finds a branch without a policy towards the other branches', () => {
    const infra = correlate([hub(''), spoke(1, true), spoke(2, false)]);
    expect(codes(infra.problems)).toEqual([
      'warning advpn-hub-policy',
      'warning advpn-spoke-policy',
    ]);
    expect(find(infra.problems, 'advpn-spoke-policy')[0]!.values).toMatchObject({
      device: 'FGT-S2',
    });
  });
});

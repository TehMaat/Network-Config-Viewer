import { describe, expect, it } from 'vitest';
import {
  aclEntryMatchesIp,
  analyzeText,
  buildModel,
  configRoutes,
  expandObjectGroup,
  lookupRoute,
  modelHints,
  portVlanRole,
  splitLines,
  vlanUsage,
  type DeviceModel,
} from '../src';
import { readSampleText } from './helpers';

function sampleModel(rel: string): DeviceModel {
  const text = readSampleText(rel);
  const analysis = analyzeText(text);
  return buildModel(splitLines(text), analysis.tree, modelHints(analysis.detection))!;
}

const core = sampleModel('cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt');
const sb = sampleModel('cisco-sb/sw-br2-acc-sg350-28p-2.5.txt');

describe('VLAN usage', () => {
  it('lists the ports of every VLAN by role, with the gateway on the same switch', () => {
    const usage = vlanUsage(core);
    const vlan70 = usage.find((u) => u.vlan.id === 70)!;
    expect(vlan70.gateways).toEqual([{ interface: 'Vlan70', ip: '10.10.70.1', prefix: 24 }]);
    // Port-channels count once: their members are not listed.
    expect(vlan70.ports.tagged).toEqual(['Port-channel10', 'Port-channel11', 'Port-channel12']);
    expect(vlan70.ports.access).toEqual([]);

    const vlan100 = usage.find((u) => u.vlan.id === 100)!;
    expect(vlan100.ports.access).toHaveLength(72);
    expect(vlan100.ports.tagged).toEqual(['Port-channel1']);
    expect(vlan100.gateways).toEqual([]);
  });

  it('tells how a port carries a VLAN, also in general mode', () => {
    const ap = sb.interfaces.find((i) => i.name === 'GigabitEthernet1/0/10')!;
    expect(portVlanRole(ap, 60)).toBe('untagged');
    expect(portVlanRole(ap, 70)).toBe('tagged');
    expect(portVlanRole(ap, 10)).toBeNull();
    const pc = core.interfaces.find((i) => i.name === 'GigabitEthernet1/0/30')!;
    expect(portVlanRole(pc, 10)).toBe('access');
    const uplink = core.interfaces.find((i) => i.name === 'Port-channel1')!;
    expect(portVlanRole(uplink, 1)).toBe('untagged');
    expect(portVlanRole(uplink, 900)).toBe('tagged');
    expect(portVlanRole(uplink, 70)).toBeNull();
  });
});

describe('IP search in the ACLs', () => {
  const ctx = core.contexts[0]!;
  const acl = (name: string) => ctx.acls.find((a) => a.name === name)!;

  it('expands nested object groups once', () => {
    expect(expandObjectGroup('OG-RETI-INTERNE', ctx.objectGroups).map((e) => e.kind)).toEqual([
      'subnet',
      'subnet',
      'host',
      'subnet',
    ]);
    expect(expandObjectGroup('NON-ESISTE', ctx.objectGroups)).toEqual([]);
  });

  it('finds entries through hosts, subnets, groups and "any"', () => {
    const entries = acl('ACL-OSPITI-IN').entries;
    const match = (ip: string) => entries.map((e) => aclEntryMatchesIp(e, ip, ctx.objectGroups));
    // A DNS server: host in entry 10, through the nested group in entry 20, "any" in 30 and 40.
    expect(match('10.40.100.53')).toEqual([
      { source: null, destination: 'host' },
      { source: null, destination: 'group' },
      { source: null, destination: 'any' },
      { source: 'any', destination: 'any' },
    ]);
    // A guest: source subnet of the first three entries.
    expect(match('10.10.70.25').map((m) => m.source)).toEqual([
      'subnet',
      'subnet',
      'subnet',
      'any',
    ]);
    expect(match('non-un-ip').every((m) => !m.source && !m.destination)).toBe(true);
  });
});

describe('routes from the configuration', () => {
  it('joins the networks of the interfaces and the static routes', () => {
    const routes = configRoutes(core);
    expect(
      routes.map((r) => `${r.prefix.ip}/${r.prefix.prefix} ${r.type} ${r.interface ?? r.gateway}`),
    ).toEqual([
      '0.0.0.0/0 static 10.10.254.1',
      '10.10.60.0/24 connected Vlan60',
      '10.10.70.0/24 connected Vlan70',
      '10.10.99.0/24 connected Vlan99',
      '10.10.254.0/29 connected Vlan900',
      '10.10.255.2/32 connected Loopback0',
      '10.99.0.0/16 static Null0',
    ]);
  });

  it('finds the route of an IP with the longest prefix', () => {
    const routes = configRoutes(core);
    expect(lookupRoute(routes, '10.10.70.9').map((r) => r.interface)).toEqual(['Vlan70']);
    expect(lookupRoute(routes, '10.99.1.1').map((r) => r.interface)).toEqual(['Null0']);
    expect(lookupRoute(routes, '192.0.2.1').map((r) => r.gateway)).toEqual(['10.10.254.1']);
    expect(lookupRoute(routes, 'x')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ciscoInterfaceKind,
  formatVlanSet,
  intToIp,
  ipToInt,
  maskToPrefix,
  networkOf,
  normalizeInterfaceName,
  normalizeMac,
  parsePortNumbers,
  parsePrefix,
  parseVlanList,
  prefixContains,
  prefixToMask,
  shortInterfaceName,
  speedClass,
  vlanSetAdd,
  vlanSetAll,
  vlanSetCount,
  vlanSetExcept,
  vlanSetFrom,
  vlanSetHas,
  vlanSetIds,
  vlanSetNone,
  vlanSetRemove,
  wildcardMatches,
  wildcardToPrefix,
} from '../src';

const list = (text: string) => {
  const ranges = parseVlanList(text);
  if (!ranges) throw new Error(`not a VLAN list: ${text}`);
  return ranges;
};

describe('VLAN sets', () => {
  it('parses VLAN lists with ranges and spaces', () => {
    expect(parseVlanList('10,20, 30-32')).toEqual([
      { from: 10, to: 10 },
      { from: 20, to: 20 },
      { from: 30, to: 32 },
    ]);
    expect(parseVlanList('5,1-3,4')).toEqual([{ from: 1, to: 5 }]);
    expect(parseVlanList('0')).toBeNull();
    expect(parseVlanList('4095')).toBeNull();
    expect(parseVlanList('20-10')).toBeNull();
    expect(parseVlanList('dieci')).toBeNull();
  });

  it('adds, removes and excludes VLANs like "switchport trunk allowed vlan"', () => {
    let set = vlanSetFrom(list('10,20'));
    set = vlanSetAdd(set, list('30-40'));
    set = vlanSetRemove(set, list('35'));
    expect(formatVlanSet(set)).toBe('10,20,30-34,36-40');
    expect(vlanSetCount(set)).toBe(12);
    expect(vlanSetHas(set, 35)).toBe(false);
    expect(vlanSetHas(set, 36)).toBe(true);

    const except = vlanSetExcept(list('1,1002-1005'));
    expect(except.all).toBe(false);
    expect(formatVlanSet(except)).toBe('2-1001,1006-4094');

    expect(vlanSetAll().all).toBe(true);
    expect(vlanSetAdd(vlanSetNone(), list('1-4094')).all).toBe(true);
    expect(vlanSetRemove(vlanSetAll(), list('1')).all).toBe(false);
    expect(vlanSetIds(vlanSetFrom(list('1-3,10')))).toEqual([1, 2, 3, 10]);
    expect(vlanSetIds(vlanSetAll(), 3)).toEqual([1, 2, 3]);
  });
});

describe('IPv4 helpers', () => {
  it('converts addresses, masks and wildcards', () => {
    expect(ipToInt('10.0.0.1')).toBe(167772161);
    expect(intToIp(167772161)).toBe('10.0.0.1');
    expect(ipToInt('10.0.0.256')).toBeNull();
    expect(maskToPrefix('255.255.255.0')).toBe(24);
    expect(maskToPrefix('255.255.255.255')).toBe(32);
    expect(maskToPrefix('0.0.0.0')).toBe(0);
    expect(maskToPrefix('255.0.255.0')).toBeNull();
    expect(wildcardToPrefix('0.0.0.255')).toBe(24);
    expect(wildcardToPrefix('0.0.255.0')).toBeNull();
    expect(prefixToMask(29)).toBe('255.255.255.248');
    expect(prefixToMask(0)).toBe('0.0.0.0');
  });

  it('parses prefixes in the forms used by the vendors', () => {
    expect(parsePrefix('10.0.0.0 255.0.0.0')).toEqual({ ip: '10.0.0.0', prefix: 8 });
    expect(parsePrefix('"192.0.2.0/24"')).toEqual({ ip: '192.0.2.0', prefix: 24 });
    expect(parsePrefix('192.0.2.7')).toEqual({ ip: '192.0.2.7', prefix: 32 });
    expect(parsePrefix('esempio.example')).toBeNull();
    expect(networkOf({ ip: '10.10.99.2', prefix: 24 })).toEqual({ ip: '10.10.99.0', prefix: 24 });
    expect(prefixContains({ ip: '10.10.0.0', prefix: 16 }, ipToInt('10.10.255.1')!)).toBe(true);
    expect(prefixContains({ ip: '10.10.0.0', prefix: 16 }, ipToInt('10.11.0.1')!)).toBe(false);
    expect(prefixContains({ ip: '0.0.0.0', prefix: 0 }, ipToInt('203.0.113.9')!)).toBe(true);
  });

  it('matches Cisco wildcards, also non-contiguous ones', () => {
    expect(wildcardMatches('10.10.70.0', '0.0.0.255', ipToInt('10.10.70.42')!)).toBe(true);
    expect(wildcardMatches('10.10.70.0', '0.0.0.255', ipToInt('10.10.71.1')!)).toBe(false);
    // Odd addresses of 10.0.0.0/24.
    expect(wildcardMatches('10.0.0.1', '0.0.0.254', ipToInt('10.0.0.7')!)).toBe(true);
    expect(wildcardMatches('10.0.0.1', '0.0.0.254', ipToInt('10.0.0.8')!)).toBe(false);
  });
});

describe('interface names', () => {
  it('expands abbreviations to the names of the running-config', () => {
    expect(normalizeInterfaceName('Gi1/0/1')).toBe('GigabitEthernet1/0/1');
    expect(normalizeInterfaceName('gi1/0/1')).toBe('GigabitEthernet1/0/1');
    expect(normalizeInterfaceName('Te2/1/1')).toBe('TenGigabitEthernet2/1/1');
    expect(normalizeInterfaceName('Po10')).toBe('Port-channel10');
    expect(normalizeInterfaceName('vlan 10')).toBe('Vlan10');
    expect(normalizeInterfaceName('Fa0')).toBe('FastEthernet0');
    expect(normalizeInterfaceName('Twe1/0/1')).toBe('TwentyFiveGigE1/0/1');
    expect(normalizeInterfaceName('Null0')).toBe('Null0');
    expect(shortInterfaceName('GigabitEthernet1/0/1')).toBe('Gi1/0/1');
    expect(shortInterfaceName('Port-channel1')).toBe('Po1');
  });

  it('tells the kind, the speed class and the position of a port', () => {
    expect(ciscoInterfaceKind('Vlan99')).toBe('svi');
    expect(ciscoInterfaceKind('Port-channel1')).toBe('lag');
    expect(ciscoInterfaceKind('GigabitEthernet0/0')).toBe('management');
    expect(ciscoInterfaceKind('GigabitEthernet1/0/1.10')).toBe('subinterface');
    expect(ciscoInterfaceKind('AppGigabitEthernet1/0/1')).toBe('virtual');
    expect(speedClass('TenGigabitEthernet1/1/1')).toBeGreaterThan(
      speedClass('GigabitEthernet1/0/1'),
    );
    expect(parsePortNumbers('GigabitEthernet2/0/17')).toEqual({ member: 2, slot: 0, port: 17 });
    expect(parsePortNumbers('GigabitEthernet0/5')).toEqual({ member: 1, slot: 0, port: 5 });
    expect(parsePortNumbers('Vlan10')).toBeNull();
  });

  it('writes MAC addresses in a single format', () => {
    expect(normalizeMac('0000.5e00.5301')).toBe('00:00:5e:00:53:01');
    expect(normalizeMac('00-00-5E-00-53-01')).toBe('00:00:5e:00:53:01');
    expect(normalizeMac('00:00:5e:00:53:01')).toBe('00:00:5e:00:53:01');
    expect(normalizeMac('0000.5e00.53')).toBeNull();
    expect(normalizeMac('dynamic')).toBeNull();
  });
});

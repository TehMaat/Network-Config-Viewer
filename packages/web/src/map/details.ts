// The two sides of a link, parameter by parameter (#15): what the map shows when a link is
// clicked and what the list of the links exports. Only values: the words come from i18n.

import {
  shortInterfaceName,
  type DeviceModel,
  type EndState,
  type ExternalNode,
  type InfraDevice,
  type Infrastructure,
  type Interface,
  type IpsecTunnel,
  type Link,
  type LinkEnd,
  type LinkKind,
  type LogicalContext,
  type ProblemCode,
} from '@ncv/core';
import type { TFunction } from 'i18next';
import { vlanText } from '../views/values';

export type ModelOf = (deviceKey: string) => DeviceModel | null;

export interface Side {
  end: LinkEnd;
  device?: InfraDevice;
  external?: ExternalNode;
  model: DeviceModel | null;
  /** "FGT-HQ", "Internet", "AS 64496". */
  name: string;
}

export interface DetailRow {
  key: string;
  label: string;
  a: string;
  b: string;
}

export function side(infra: Infrastructure, end: LinkEnd, modelOf: ModelOf): Side {
  const device = infra.devices.find((d) => d.key === end.node);
  if (device) return { end, device, model: modelOf(device.key), name: device.hostname };
  const external = infra.externals.find((e) => e.id === end.node);
  return { end, ...(external ? { external } : {}), model: null, name: external?.label ?? end.node };
}

const short = (name: string | undefined) => (name ? shortInterfaceName(name) : '');

/** "Te1/1/1", "HUB-WAN1", "10.255.1.254": what tells the side apart on the device. */
export function endLabel(end: LinkEnd): string {
  return short(end.tunnel ?? end.interface) || end.ip || end.neighbor || end.range?.prefix || '';
}

export function linkTitle(link: Link, infra: Infrastructure, modelOf: ModelOf): string {
  const a = side(infra, link.a, modelOf);
  const b = side(infra, link.b, modelOf);
  const part = (s: Side) => [s.name, endLabel(s.end)].filter(Boolean).join(' ');
  return `${part(a)} ↔ ${part(b)}`;
}

/**
 * The interface of a side. A port of a FortiGate hardware switch that the configuration does not
 * list on its own (internal1 of internal) is the switch.
 */
function iface(s: Side, name = s.end.interface): Interface | undefined {
  const list = s.model?.interfaces;
  return (
    list?.find((i) => i.name === name) ??
    (name ? list?.find((i) => i.kind === 'hard-switch' && i.members?.includes(name)) : undefined)
  );
}

/** A value that is not written in the configuration: the default of the device, and maybe uncertain. */
function withDefault(
  element: { defaults?: string[]; unverified?: string[] } | undefined,
  field: string,
  text: string,
  t: TFunction,
): string {
  if (!element || !text || !element.defaults?.includes(field)) return text;
  return element.unverified?.includes(field)
    ? t('problems.withDefaultToCheck', { value: text })
    : t('problems.withDefault', { value: text });
}

function context(s: Side): LogicalContext | undefined {
  return s.model?.contexts.find((c) => c.name === s.end.context) ?? s.model?.contexts[0];
}

function tunnel(s: Side, name = s.end.tunnel): IpsecTunnel | undefined {
  return context(s)?.ipsec.find((t) => t.name === name);
}

/** The VLANs an interface carries: switchport, or the VLAN interfaces of a FortiGate on it. */
function vlans(s: Side, i: Interface | undefined, t: TFunction): string {
  if (!i || !s.model) return '';
  if (i.switchport) return vlanText(i, t);
  // A member of a hardware switch carries the VLANs of the switch.
  const parent = s.model.interfaces.find(
    (p) => p.members?.includes(i.name) && p.kind === 'hard-switch',
  );
  const base = parent?.name ?? i.name;
  const ids = s.model.interfaces
    .filter((x) => x.parent === base && x.vlanId !== undefined)
    .map((x) => x.vlanId!)
    .sort((x, y) => x - y);
  return ids.length > 0 ? t('map.value.vlanInterfaces', { vlans: ids.join(', ') }) : '';
}

function stateText(state: EndState | undefined, t: TFunction): string {
  if (!state) return '';
  const word = t(`map.state.${state.status}`);
  const extra = [
    state.text,
    state.prefixes !== undefined ? t('map.value.prefixes', { count: state.prefixes }) : '',
  ]
    .filter(Boolean)
    .join(', ');
  return extra ? `${word} (${extra})` : word;
}

function address(i: Interface | undefined, t: TFunction): string {
  if (!i) return '';
  if (i.ipv4.length > 0) return i.ipv4.map((a) => `${a.ip}/${a.prefix}`).join(', ');
  return i.addressingMode === 'dhcp' || i.dhcpClient ? t('map.value.dhcp') : '';
}

type Rows = [key: string, a: string, b: string][];

function cableRows(link: Link, a: Side, b: Side, t: TFunction): Rows {
  const ia = iface(a);
  const ib = iface(b);
  const name = (s: Side) =>
    s.end.interface
      ? `${s.end.interface}${s.end.unknownInterface ? ` (${t('map.value.notInConfig')})` : ''}`
      : t('map.value.unknownPort');
  const mode = (i: Interface | undefined) =>
    i?.switchport ? t(`ports.mode.${i.switchport.mode}`) : i ? t(`ports.kind.${i.kind}`) : '';
  const rows: Rows = [
    ['interface', name(a), name(b)],
    ['description', ia?.description ?? '', ib?.description ?? ''],
    ['mode', mode(ia), mode(ib)],
    ['vlans', vlans(a, ia, t), vlans(b, ib, t)],
  ];
  if (link.kind === 'lag') {
    const members = (i: Interface | undefined) => (i?.members ?? []).map(short).join(', ');
    const lacp = (s: Side, i: Interface | undefined) => {
      const first = i?.members?.map((m) => iface(s, m)).find((m) => m?.lag?.mode);
      return first?.lag?.mode ?? '';
    };
    rows.push(['members', members(ia), members(ib)]);
    rows.push(['lacp', lacp(a, ia), lacp(b, ib)]);
    rows.push([
      'cables',
      (link.cables ?? []).map((c) => short(c.a)).join(', '),
      (link.cables ?? []).map((c) => short(c.b) || '?').join(', '),
    ]);
  }
  // With an MTU on one side only, the other has the default one.
  const mtu = (i: Interface | undefined, other: Interface | undefined) =>
    i?.mtu ? String(i.mtu) : i && other?.mtu ? t('problems.withDefault', { value: '1500' }) : '';
  rows.push(['mtu', mtu(ia, ib), mtu(ib, ia)]);
  return rows;
}

/** A FortiGate and a FortiSwitch it manages (#15, part 4). */
function fortilinkRows(a: Side, b: Side, t: TFunction): Rows {
  const ia = iface(a);
  const ib = iface(b);
  return [
    ['interface', a.end.interface ?? '', b.end.interface ?? ''],
    ['members', (ia?.members ?? []).join(', '), (ib?.members ?? []).join(', ')],
    ['address', address(ia, t), ''],
    ['serial', '', b.device?.serial ?? ''],
    ['model', '', b.device?.model ?? ''],
  ];
}

/** A FortiGate and its FortiAPs. */
function capwapRows(a: Side, b: Side): Rows {
  const wireless = a.model?.wireless;
  return [
    ['accessPoints', '', b.external?.detail ?? ''],
    ['ssids', (wireless?.ssids ?? []).map((s) => s.ssid).join(', '), ''],
  ];
}

function subnetRows(link: Link, a: Side, b: Side, t: TFunction): Rows {
  const ia = iface(a);
  const ib = iface(b);
  const vlan = (i: Interface | undefined) =>
    i?.vlanId !== undefined
      ? String(i.vlanId)
      : i?.kind === 'svi'
        ? i.name.replace(/^Vlan/i, '')
        : '';
  return [
    ['subnet', link.subnet ?? '', link.subnet ?? ''],
    ['interface', a.end.interface ?? '', b.end.interface ?? ''],
    ['address', address(ia, t), address(ib, t)],
    ['vlan', vlan(ia), vlan(ib)],
    ['description', ia?.description ?? '', ib?.description ?? ''],
  ];
}

function internetRows(link: Link, a: Side, t: TFunction): Rows {
  const ia = iface(a);
  const member = context(a)?.sdwan?.members.find((m) => m.interface === a.end.interface);
  return [
    ['interface', a.end.interface ?? '', ''],
    ['address', address(ia, t), ''],
    ['gateway', link.gateway ?? '', ''],
    ['provider', ia?.description ?? ia?.alias ?? '', ''],
    ['sdwan', member ? `${member.zone ?? ''} #${member.seq}`.trim() : '', ''],
  ];
}

function ipsecRows(link: Link, a: Side, b: Side, t: TFunction): Rows {
  const ta = tunnel(a);
  const tb = tunnel(b);
  const kind = (x: IpsecTunnel | undefined) =>
    !x
      ? ''
      : x.type === 'static'
        ? t('map.value.staticTo', { peer: x.remoteGw ?? '' })
        : x.type === 'ddns'
          ? t('map.value.ddnsTo', { peer: x.remoteGwDdns ?? '' })
          : t('vpn.type.dynamic');
  const where = (s: Side) => [s.end.interface, s.end.ip].filter(Boolean).join(' · ');
  const tunnelIp = (s: Side, x: IpsecTunnel | undefined) => {
    const ti = x ? iface(s, x.name) : undefined;
    return ti?.ipv4[0] ? ti.ipv4[0].ip : '';
  };
  const phase2 = (x: IpsecTunnel | undefined) =>
    (x?.phase2 ?? [])
      .map(
        (p) =>
          `${p.srcSubnet ?? '0.0.0.0/0'} ↔ ${p.dstSubnet ?? '0.0.0.0/0'} · ${p.proposals.join(' ')}` +
          (p.pfs ? ` · PFS DH ${p.dhgrp.join(' ')}` : ' · PFS no'),
      )
      .join('; ');
  const overlay = (o: NonNullable<Link['overlay']>['a']) =>
    o
      ? [
          `${o.zone ?? ''} #${o.seq}`.trim(),
          ...o.sla.map(
            (s) =>
              `${s.healthCheck}: ${s.alive ? t('map.state.up') : t('map.state.down')}${s.met === false ? ` (${t('map.value.slaMissed')})` : ''}`,
          ),
        ].join(', ')
      : '';
  const both = (f: (x: IpsecTunnel) => string): [string, string] => [
    ta ? f(ta) : '',
    tb ? f(tb) : '',
  ];
  const ike1 = ta?.ikeVersion === 1 || tb?.ikeVersion === 1;
  const yesNo = (v: string | undefined) =>
    v === 'enable'
      ? t('map.value.yes')
      : v === 'disable'
        ? t('map.value.no')
        : v
          ? t(`map.value.${v}`, { defaultValue: v })
          : '';
  return [
    ['tunnel', a.end.tunnel ?? '', b.end.tunnel ?? ''],
    ['type', kind(ta), kind(tb)],
    ['interface', where(a), where(b)],
    ['ike', ...both((x) => withDefault(x, 'ikeVersion', `v${x.ikeVersion}`, t))],
    ...(ike1
      ? [['mode', ...both((x) => withDefault(x, 'mode', x.mode ?? '', t))] as Rows[number]]
      : []),
    [
      'auth',
      ...both((x) =>
        withDefault(
          x,
          'authMethod',
          x.authMethod ? t(`problems.auth.${x.authMethod}`, { defaultValue: x.authMethod }) : '',
          t,
        ),
      ),
    ],
    ['localId', ...both((x) => x.localId ?? '')],
    ['peerId', ...both((x) => x.peerId ?? '')],
    ['networkId', ...both((x) => (x.networkId !== undefined ? String(x.networkId) : ''))],
    ['proposals', ...both((x) => withDefault(x, 'proposals', x.proposals.join(' '), t))],
    ['dhgrp', ...both((x) => withDefault(x, 'dhgrp', x.dhgrp.join(' '), t))],
    ['nat', ...both((x) => withDefault(x, 'natTraversal', yesNo(x.natTraversal), t))],
    ['keylife', ...both((x) => withDefault(x, 'keylife', x.keylife ? String(x.keylife) : '', t))],
    ['phase2', phase2(ta), phase2(tb)],
    [
      'advpn',
      ta?.advpn ? t(`vpn.advpn.${ta.advpn}`) : '',
      tb?.advpn ? t(`vpn.advpn.${tb.advpn}`) : '',
    ],
    ['tunnelIp', tunnelIp(a, ta), tunnelIp(b, tb)],
    ['sdwan', overlay(link.overlay?.a), overlay(link.overlay?.b)],
  ];
}

function bgpRows(link: Link, a: Side, b: Side, infra: Infrastructure, t: TFunction): Rows {
  const neighbor = (s: Side) => {
    const bgp = context(s)?.routing.bgp;
    if (!bgp) return undefined;
    const n = bgp.neighbors.find((x) => x.address === s.end.neighbor);
    const group = s.end.range
      ? bgp.groups.find((g) => g.address === s.end.range!.group)
      : undefined;
    return n ?? group;
  };
  const na = neighbor(a);
  const nb = neighbor(b);
  const peer = (s: Side) =>
    s.end.neighbor ??
    (s.end.range
      ? t('map.value.range', { prefix: s.end.range.prefix, group: s.end.range.group })
      : '');
  const networks = (s: Side) =>
    (context(s)?.routing.bgp?.networks ?? []).map((n) => n.prefix).join(', ');
  const yes = (v: boolean | undefined) =>
    v ? t('map.value.yes') : v === false ? t('map.value.no') : '';
  const routeMaps = (n: typeof na) =>
    [n?.routeMapIn && `in ${n.routeMapIn}`, n?.routeMapOut && `out ${n.routeMapOut}`]
      .filter(Boolean)
      .join(', ');
  const via = link.via ? infra.links.find((l) => l.id === link.via) : undefined;
  return [
    ['as', a.end.asn ?? '', b.end.asn ?? ''],
    ['session', link.ibgp ? 'iBGP' : 'eBGP', link.ibgp ? 'iBGP' : 'eBGP'],
    ['peer', peer(a), peer(b)],
    ['localIp', a.end.ip ?? '', b.end.ip ?? ''],
    ['rrClient', yes(na?.routeReflectorClient), yes(nb?.routeReflectorClient)],
    ['nextHopSelf', yes(na?.nextHopSelf), yes(nb?.nextHopSelf)],
    ['routeMaps', routeMaps(na), routeMaps(nb)],
    ['networks', networks(a), networks(b)],
    ['transport', via?.a.tunnel ?? '', via?.b.tunnel ?? ''],
  ];
}

function ospfRows(a: Side, b: Side, t: TFunction): Rows {
  const entry = (s: Side) =>
    context(s)
      ?.routing.ospf.flatMap((o) => o.interfaces.map((i) => ({ o, i })))
      .find((x) => x.i.name === s.end.interface);
  const ea = entry(a);
  const eb = entry(b);
  const yes = (v: boolean | undefined) => (v ? t('map.value.yes') : t('map.value.no'));
  return [
    ['interface', a.end.interface ?? '', b.end.interface ?? ''],
    ['address', address(iface(a), t), address(iface(b), t)],
    ['area', a.end.area ?? '', b.end.area ?? ''],
    ['passive', ea ? yes(ea.i.passive) : '', eb ? yes(eb.i.passive) : ''],
    [
      'cost',
      ea?.i.cost !== undefined ? String(ea.i.cost) : '',
      eb?.i.cost !== undefined ? String(eb.i.cost) : '',
    ],
    ['routerId', ea?.o.routerId ?? '', eb?.o.routerId ?? ''],
  ];
}

function shortcutRows(a: Side, b: Side): Rows {
  return [
    ['tunnel', a.end.tunnel ?? '', b.end.tunnel ?? ''],
    ['interface', a.end.interface ?? '', b.end.interface ?? ''],
    ['publicIp', a.end.ip ?? '', b.end.ip ?? ''],
  ];
}

/** The rows of the detail of a link: only those with a value on at least one side. */
export function linkRows(
  link: Link,
  infra: Infrastructure,
  modelOf: ModelOf,
  t: TFunction,
): DetailRow[] {
  const a = side(infra, link.a, modelOf);
  const b = side(infra, link.b, modelOf);
  let rows: Rows;
  switch (link.kind) {
    case 'cable':
    case 'lag':
    case 'wan':
      rows = cableRows(link, a, b, t);
      break;
    case 'subnet':
      rows = subnetRows(link, a, b, t);
      break;
    case 'internet':
      rows = internetRows(link, a, t);
      break;
    case 'ipsec':
      rows = ipsecRows(link, a, b, t);
      break;
    case 'bgp':
      rows = bgpRows(link, a, b, infra, t);
      break;
    case 'ospf':
      rows = ospfRows(a, b, t);
      break;
    case 'shortcut':
      rows = shortcutRows(a, b);
      break;
    case 'fortilink':
      rows = fortilinkRows(a, b, t);
      break;
    case 'capwap':
      rows = capwapRows(a, b);
      break;
  }
  if (a.end.context && a.device && a.device.contexts.length > 0) {
    rows.unshift([
      'vdom',
      a.end.context,
      b.device && b.device.contexts.length > 0 ? (b.end.context ?? '') : '',
    ]);
  } else if (b.end.context && b.device && b.device.contexts.length > 0) {
    rows.unshift(['vdom', '', b.end.context]);
  }
  rows.push(['state', stateText(link.state?.a, t), stateText(link.state?.b, t)]);
  return rows
    .filter(([, x, y]) => x !== '' || y !== '')
    .map(([key, x, y]) => ({ key, label: t(`map.row.${key}`), a: x, b: y }));
}

/** The words of a kind of link, for titles, tables and exports. */
export function kindLabel(kind: LinkKind, t: TFunction): string {
  return t(`map.kind.${kind}`);
}

/** The row of the detail of a link that shows the values a problem is about. */
export const PROBLEM_ROW: Partial<Record<ProblemCode, string>> = {
  'ipsec-no-tunnel': 'tunnel',
  'ipsec-ike': 'ike',
  'ipsec-mode': 'mode',
  'ipsec-auth': 'auth',
  'ipsec-proposals': 'proposals',
  'ipsec-dhgrp': 'dhgrp',
  'ipsec-selectors': 'phase2',
  'ipsec-p2-proposals': 'phase2',
  'ipsec-pfs': 'phase2',
  'ipsec-p2-dhgrp': 'phase2',
  'ipsec-advpn': 'advpn',
  'bgp-down': 'state',
  'bgp-as': 'as',
  'bgp-no-neighbor': 'peer',
  'trunk-mode': 'mode',
  'trunk-native': 'vlans',
  'trunk-allowed': 'vlans',
  'lag-one-side': 'members',
  'lag-mode': 'lacp',
  'lag-cables': 'cables',
  mtu: 'mtu',
  'ospf-area': 'area',
  'ospf-passive': 'passive',
  'discovery-off': 'interface',
};

/**
 * How the two sides of a tunnel compare: "10 parameters agree", "2 do not agree", or a tunnel
 * with one side only. Null for the other links.
 */
export function comparisonText(
  link: Link,
  infra: Infrastructure,
  t: TFunction,
): { text: string; compared: number; issues: number } | null {
  if (link.kind !== 'ipsec') return null;
  if (!infra.devices.some((d) => d.key === link.b.node)) {
    return { text: t('vpnClient.compare.oneSide'), compared: 0, issues: 0 };
  }
  const c = link.comparison;
  if (!c) return null;
  if (c.compared === 0) return { text: t('vpnClient.compare.noTunnel'), ...c };
  return {
    text:
      c.issues === 0
        ? t('vpnClient.compare.agree', { count: c.compared })
        : t('vpnClient.compare.issues', { count: c.issues }),
    ...c,
  };
}

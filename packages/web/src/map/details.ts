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

function iface(s: Side, name = s.end.interface): Interface | undefined {
  return s.model?.interfaces.find((i) => i.name === name);
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
  rows.push(['mtu', ia?.mtu ? String(ia.mtu) : '', ib?.mtu ? String(ib.mtu) : '']);
  return rows;
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
  return [
    ['tunnel', a.end.tunnel ?? '', b.end.tunnel ?? ''],
    ['type', kind(ta), kind(tb)],
    ['interface', where(a), where(b)],
    ['ike', ta ? `v${ta.ikeVersion}` : '', tb ? `v${tb.ikeVersion}` : ''],
    ['proposals', ta?.proposals.join(' ') ?? '', tb?.proposals.join(' ') ?? ''],
    ['dhgrp', ta?.dhgrp.join(' ') ?? '', tb?.dhgrp.join(' ') ?? ''],
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

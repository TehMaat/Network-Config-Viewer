// IPsec tunnels, BGP sessions and ADVPN shortcuts between devices (#15). A tunnel is matched by
// its remote gateway: the address of an interface of another device, where a tunnel accepts it
// (a static one pointing back, or a dial-up one). A BGP session by the address of its neighbour,
// which on the other side is a neighbour or falls in a neighbour range.

import { isIpv4 } from '../model/ip';
import type { IpsecTunnel, LogicalContext } from '../model/types';
import { bgpPeerLive, tunnelLive } from '../query/state';
import type { TunnelState } from '../show/types';
import { prefixHas, type AddressIndex, type DeviceInfo, type OwnedAddress } from './devices';
import { combineStates, configEvidence, linkId, showEvidence, type LinkSet } from './links';
import type { EndState, ExternalNode, Link, LinkEnd, LinkSource, OverlayUse } from './types';

/** Same DDNS name: "fgt-hq.fortiddns.com", or only its first label. */
function sameDdns(domain: string, remote: string): boolean {
  const a = domain.toLowerCase().replace(/\.$/, '');
  const b = remote.toLowerCase().replace(/\.$/, '');
  return a === b || a.split('.')[0] === b || b.split('.')[0] === a;
}

function tunnelState(device: string, instances: TunnelState[]): EndState | undefined {
  const states = instances
    .filter((t) => t.selectorsTotal > 0 || t.ikeEstablished !== undefined)
    .map<EndState>((t) => ({
      status: t.selectorsUp > 0 || (t.selectorsTotal === 0 && t.ikeEstablished) ? 'up' : 'down',
      text: `${t.selectorsUp}/${t.selectorsTotal}`,
      evidence: showEvidence(device, t),
    }));
  return combineStates(states);
}

/** A tunnel that is a member of an SD-WAN zone, with its health checks from the shows. */
function overlayOf(
  d: DeviceInfo,
  ctx: LogicalContext | undefined,
  tunnel: string,
): OverlayUse | undefined {
  const member = ctx?.sdwan?.members.find((m) => m.interface === tunnel);
  if (!ctx || !member) return undefined;
  const sla = (d.state?.sla ?? [])
    .filter(
      (s) =>
        (s.member === tunnel || s.seq === member.seq) && (!s.context || s.context === ctx.name),
    )
    .map((s) => ({
      healthCheck: s.healthCheck,
      alive: s.alive,
      ...(s.slaMap !== undefined ? { met: s.slaMap > 0 } : {}),
      evidence: showEvidence(d.key, s),
    }));
  return { ...(member.zone ? { zone: member.zone } : {}), seq: member.seq, sla };
}

interface Target {
  device: DeviceInfo;
  context: string;
  iface?: string;
  ip?: string;
  via: 'remote-gw' | 'ddns';
}

export function findTunnels(
  devices: readonly DeviceInfo[],
  byKey: ReadonlyMap<string, DeviceInfo>,
  index: AddressIndex,
  set: LinkSet,
  externals: Map<string, ExternalNode>,
): void {
  for (const d of devices) {
    for (const ctx of d.model.contexts) {
      for (const t of ctx.ipsec) {
        if (t.type === 'dynamic') continue;
        const a: LinkEnd = {
          node: d.key,
          context: ctx.name,
          tunnel: t.name,
          ...(t.interface ? { interface: t.interface } : {}),
          ...(d.ipOf(t.interface) ? { ip: d.ipOf(t.interface)! } : {}),
        };
        const sources: LinkSource[] = [
          {
            kind: t.remoteGw ? 'remote-gw' : 'ddns',
            device: d.key,
            text: t.remoteGw ?? t.remoteGwDdns,
            evidence: configEvidence(d.key, t.src),
          },
        ];
        const target = tunnelTarget(d, t, byKey, index);
        const stateA = tunnelState(d.key, tunnelLive(t.name, d.state, ctx.name).instances);
        if (stateA?.status === 'up') {
          sources.push({ kind: 'tunnel-state', device: d.key, evidence: stateA.evidence });
        }
        const overlayA = overlayOf(d, ctx, t.name);
        if (!target) {
          const peer = t.remoteGw ?? t.remoteGwDdns;
          if (!peer) continue;
          const id = `peer:${peer.toLowerCase()}`;
          if (!externals.has(id)) externals.set(id, { id, kind: 'peer', label: peer });
          set.add({
            kind: 'ipsec',
            a,
            b: { node: id, ...(t.remoteGw ? { ip: t.remoteGw } : {}) },
            sources,
            ...(overlayA ? { overlay: { a: overlayA } } : {}),
            ...(stateA ? { state: { a: stateA } } : {}),
          });
          continue;
        }
        const e = target.device;
        const ctxE = e.logical(target.context);
        const bound = (ctxE?.ipsec ?? []).filter(
          (x) => !target.iface || !x.interface || x.interface === target.iface,
        );
        const own = new Set(d.addresses());
        const back = bound.find((x) => x.type !== 'dynamic' && !!x.remoteGw && own.has(x.remoteGw));
        const dial = bound.filter((x) => x.type === 'dynamic');
        const peer: IpsecTunnel | undefined = back ?? dial[0];
        if (back) {
          sources.push({
            kind: 'remote-gw',
            device: e.key,
            text: back.remoteGw,
            evidence: configEvidence(e.key, back.src),
          });
        } else if (peer) {
          sources.push({
            kind: target.via,
            device: e.key,
            text: peer.name,
            evidence: configEvidence(e.key, peer.src),
          });
        }
        let stateB: EndState | undefined;
        if (peer) {
          let instances = tunnelLive(peer.name, e.state, target.context).instances;
          // A dial-up tunnel has one instance per peer: the one of this side by its address.
          if (peer.type === 'dynamic')
            instances = instances.filter((x) => !!a.ip && x.remote === a.ip);
          stateB = tunnelState(e.key, instances);
          if (stateB?.status === 'up') {
            sources.push({ kind: 'tunnel-state', device: e.key, evidence: stateB.evidence });
          }
        }
        const overlayB = peer ? overlayOf(e, ctxE, peer.name) : undefined;
        const b: LinkEnd = {
          node: e.key,
          context: target.context,
          ...(peer ? { tunnel: peer.name } : {}),
          ...(target.iface ? { interface: target.iface } : {}),
          ...(target.ip ? { ip: target.ip } : {}),
        };
        set.add({
          kind: 'ipsec',
          a,
          b,
          sources,
          ...(peer?.type === 'dynamic' ? { dialup: true } : {}),
          ...(overlayA || overlayB
            ? {
                overlay: {
                  ...(overlayA ? { a: overlayA } : {}),
                  ...(overlayB ? { b: overlayB } : {}),
                },
              }
            : {}),
          ...(stateA || stateB
            ? { state: { ...(stateA ? { a: stateA } : {}), ...(stateB ? { b: stateB } : {}) } }
            : {}),
        });
      }
    }
  }
}

/** The device and interface a tunnel points to: by address, or by DDNS name. */
function tunnelTarget(
  d: DeviceInfo,
  t: IpsecTunnel,
  byKey: ReadonlyMap<string, DeviceInfo>,
  index: AddressIndex,
): Target | undefined {
  if (t.remoteGw && isIpv4(t.remoteGw)) {
    const owner: OwnedAddress | undefined = index.owners(t.remoteGw, d.key)[0];
    if (!owner) return undefined;
    return {
      device: byKey.get(owner.device)!,
      context: owner.context,
      iface: owner.iface.name,
      ip: owner.ip,
      via: 'remote-gw',
    };
  }
  const name = t.remoteGwDdns;
  if (!name) return undefined;
  for (const e of byKey.values()) {
    if (e.key === d.key) continue;
    const ddns = e.model.ddns?.find((x) => sameDdns(x.domain, name));
    if (!ddns) continue;
    const iface = e.iface(ddns.interface);
    return {
      device: e,
      context: e.contextOf(iface),
      ...(iface ? { iface: iface.name } : {}),
      ...(iface?.ipv4[0] ? { ip: iface.ipv4[0].ip } : {}),
      via: 'ddns',
    };
  }
  return undefined;
}

export function findBgp(
  devices: readonly DeviceInfo[],
  byKey: ReadonlyMap<string, DeviceInfo>,
  index: AddressIndex,
  set: LinkSet,
  externals: Map<string, ExternalNode>,
): void {
  for (const d of devices) {
    for (const ctx of d.model.contexts) {
      const bgp = ctx.routing.bgp;
      if (!bgp) continue;
      for (const n of bgp.neighbors) {
        if (!isIpv4(n.address)) continue;
        const group = n.group ? bgp.groups.find((g) => g.address === n.group) : undefined;
        const remoteAs = n.remoteAs ?? group?.remoteAs;
        const local = d.localAddressTowards(
          n.address,
          ctx.name,
          n.updateSource ?? group?.updateSource,
        );
        const a: LinkEnd = {
          node: d.key,
          context: ctx.name,
          neighbor: n.address,
          ...(local ? { ip: local } : {}),
          asn: bgp.asn,
        };
        const sources: LinkSource[] = [
          {
            kind: 'bgp-neighbor',
            device: d.key,
            text: n.address,
            evidence: configEvidence(d.key, n.src),
          },
        ];
        const peerA = bgpPeerLive(n.address, d.state, ctx.name);
        const stateA = peerA ? peerState(d.key, peerA) : undefined;
        if (stateA?.status === 'up') {
          sources.push({ kind: 'bgp-state', device: d.key, evidence: stateA.evidence });
        }
        const owner = index.owners(n.address, d.key)[0];
        if (!owner) {
          const external = remoteAs !== undefined && remoteAs !== bgp.asn;
          const id = external ? `as:${remoteAs}` : `peer:${n.address}`;
          if (!externals.has(id)) {
            externals.set(id, {
              id,
              kind: external ? 'provider' : 'peer',
              label: external ? `AS ${remoteAs}` : n.address,
              ...(n.description ? { detail: n.description } : {}),
            });
          }
          set.add({
            kind: 'bgp',
            a,
            b: { node: id, ip: n.address, ...(remoteAs ? { asn: remoteAs } : {}) },
            ibgp: remoteAs === bgp.asn,
            sources,
            ...(stateA ? { state: { a: stateA } } : {}),
          });
          continue;
        }
        const e = byKey.get(owner.device)!;
        const bgpE = e.logical(owner.context)?.routing.bgp;
        // The other side knows this one by the local address of the session; without it, by
        // any address of this side.
        const candidates = local ? [local] : d.addresses(ctx.name);
        const back = bgpE?.neighbors.find((x) => candidates.includes(x.address));
        const range = back
          ? undefined
          : bgpE?.ranges.find((r) => candidates.some((ip) => prefixHas(r.prefix, ip)));
        if (back) {
          sources.push({
            kind: 'bgp-neighbor',
            device: e.key,
            text: back.address,
            evidence: configEvidence(e.key, back.src),
          });
        } else if (range) {
          sources.push({
            kind: 'bgp-neighbor',
            device: e.key,
            text: `${range.prefix} (${range.group})`,
            evidence: configEvidence(e.key, range.src),
          });
        }
        const localIp =
          back?.address ?? (range ? candidates.find((ip) => prefixHas(range.prefix, ip)) : local);
        const peerB = localIp ? bgpPeerLive(localIp, e.state, owner.context) : undefined;
        const stateB = peerB ? peerState(e.key, peerB) : undefined;
        if (stateB?.status === 'up') {
          sources.push({ kind: 'bgp-state', device: e.key, evidence: stateB.evidence });
        }
        const b: LinkEnd = {
          node: e.key,
          context: owner.context,
          ...(back ? { neighbor: back.address } : {}),
          ...(range ? { range: { prefix: range.prefix, group: range.group } } : {}),
          ip: n.address,
          ...(bgpE ? { asn: bgpE.asn } : {}),
        };
        if (localIp && !a.ip) a.ip = localIp;
        const viaTunnel = tunnelBetween(
          set,
          d.key,
          d.ifaceWithAddress(a.ip)?.name,
          e.key,
          owner.iface,
        );
        set.add({
          id: linkId(
            'bgp',
            { node: d.key, context: ctx.name, ip: a.ip ?? n.address },
            { node: e.key, context: owner.context, ip: n.address },
          ),
          kind: 'bgp',
          a,
          b,
          ibgp: bgpE ? bgpE.asn === bgp.asn : remoteAs === bgp.asn,
          ...(viaTunnel ? { via: viaTunnel.id } : {}),
          sources,
          ...(stateA || stateB
            ? { state: { ...(stateA ? { a: stateA } : {}), ...(stateB ? { b: stateB } : {}) } }
            : {}),
        });
      }
    }
  }
}

function peerState(device: string, peer: NonNullable<ReturnType<typeof bgpPeerLive>>): EndState {
  const up = peer.state.toLowerCase() === 'established';
  return {
    status: up ? 'up' : 'down',
    text: peer.state,
    ...(peer.prefixes !== undefined ? { prefixes: peer.prefixes } : {}),
    evidence: showEvidence(device, peer),
  };
}

/** The IPsec link between the tunnel interfaces that carry a BGP session. */
function tunnelBetween(
  set: LinkSet,
  a: string,
  tunnelA: string | undefined,
  b: string,
  ifaceB: OwnedAddress['iface'],
): Link | undefined {
  if (ifaceB.kind !== 'tunnel' || !tunnelA) return undefined;
  return set
    .all()
    .find(
      (l) =>
        l.kind === 'ipsec' &&
        ((l.a.node === a &&
          l.a.tunnel === tunnelA &&
          l.b.node === b &&
          l.b.tunnel === ifaceB.name) ||
          (l.b.node === a &&
            l.b.tunnel === tunnelA &&
            l.a.node === b &&
            l.a.tunnel === ifaceB.name)),
    );
}

/**
 * ADVPN shortcuts from the shows: on a spoke, an instance of a static tunnel towards the public
 * address of another spoke.
 */
export function findShortcuts(
  devices: readonly DeviceInfo[],
  byKey: ReadonlyMap<string, DeviceInfo>,
  index: AddressIndex,
  set: LinkSet,
): void {
  for (const d of devices) {
    for (const inst of d.state?.tunnels ?? []) {
      if (inst.instance === inst.name || !inst.remote) continue;
      const ctx = d.model.contexts.find(
        (c) =>
          (!inst.context || c.name === inst.context) && c.ipsec.some((t) => t.name === inst.name),
      );
      const parent = ctx?.ipsec.find((t) => t.name === inst.name);
      if (!ctx || !parent || parent.type === 'dynamic') continue;
      const owner = index.owners(inst.remote, d.key)[0];
      if (!owner) continue;
      const e = byKey.get(owner.device)!;
      const state = tunnelState(d.key, [inst]);
      const a: LinkEnd = {
        node: d.key,
        context: ctx.name,
        tunnel: inst.instance,
        ...(parent.interface ? { interface: parent.interface } : {}),
        ...(d.ipOf(parent.interface) ? { ip: d.ipOf(parent.interface)! } : {}),
      };
      const b: LinkEnd = {
        node: e.key,
        context: owner.context,
        interface: owner.iface.name,
        ip: owner.ip,
      };
      const id = linkId('shortcut', { node: d.key }, { node: e.key });
      const existing = set.get(id);
      const source: LinkSource = {
        kind: 'tunnel-state',
        device: d.key,
        text: inst.instance,
        evidence: showEvidence(d.key, inst),
      };
      if (existing) {
        // The other spoke shows the same shortcut: its side and its state.
        const side = existing.a.node === d.key ? 'a' : 'b';
        existing[side] = { ...existing[side], ...a };
        if (state) existing.state = { ...existing.state, [side]: state };
        set.add({ ...existing, sources: [source] });
        continue;
      }
      set.add({
        id,
        kind: 'shortcut',
        a,
        b,
        sources: [source],
        ...(state ? { state: { a: state } } : {}),
      });
    }
  }
}

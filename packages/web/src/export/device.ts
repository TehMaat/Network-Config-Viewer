// The sheets of the Excel file of a device (#10): one for every view, with the same columns
// and the same words as the tables of the app. Values only: no formatting is needed to read
// them, and nothing is changed in the configuration.

import {
  configRoutes,
  hasMacTable,
  portLive,
  shortInterfaceName,
  tunnelLive,
  vlanNameFromState,
  vlanUsage,
  type DeviceModel,
  type DeviceState,
  type Interface,
  type LogicalContext,
  type ModelWarningCode,
} from '@ncv/core';
import type { TFunction } from 'i18next';
import { OBJECT_KINDS, objectRows } from '../views/ObjectsView';
import {
  bindingText,
  formatAddress,
  formatPorts,
  formatRoutePrefix,
  shortList,
  vlanText,
} from '../views/values';
import type { Sheet } from './xlsx';

const ip = (i: Interface) => i.ipv4.map((a) => `${a.ip}/${a.prefix}`).join(' ');
const names = (list: readonly string[]) => list.map(shortInterfaceName).join(', ');

/** Every sheet of a device: those of a switch, or those of a FortiGate for every VDOM. */
export function deviceSheets(model: DeviceModel, state: DeviceState | null, t: TFunction): Sheet[] {
  return model.vendor === 'fortinet'
    ? firewallSheets(model, state, t)
    : switchSheets(model, state, t);
}

function switchSheets(model: DeviceModel, state: DeviceState | null, t: TFunction): Sheet[] {
  const context = model.contexts[0]!;
  const live = state !== null && state.ports.length > 0;
  const macs = hasMacTable(state);
  const sheets: Sheet[] = [
    {
      name: t('export.sheet.ports'),
      columns: [
        t('ports.col.port'),
        t('ports.col.description'),
        t('ports.col.state'),
        t('ports.col.mode'),
        t('ports.col.vlan'),
        t('ports.col.voice'),
        t('ports.col.lag'),
        t('ports.col.poe'),
        t('ports.col.dot1x'),
        t('ports.col.ip'),
        ...(live ? [t('ports.col.live')] : []),
        ...(macs ? [t('ports.col.macs')] : []),
      ],
      rows: model.interfaces.map((i) => {
        const l = portLive(i, state);
        return [
          shortInterfaceName(i.name),
          i.description,
          i.shutdown ? t('ports.state.down') : t('ports.state.up'),
          i.switchport ? t(`ports.mode.${i.switchport.mode}`) : t(`ports.kind.${i.kind}`),
          vlanText(i, t),
          i.switchport?.voiceVlan,
          i.lag ? shortInterfaceName(i.lag.group) : names(i.members ?? []),
          i.poe?.mode,
          i.dot1x
            ? [i.dot1x.dot1x ? '802.1X' : '', i.dot1x.mab ? 'MAB' : ''].filter(Boolean).join(' + ')
            : '',
          ip(i) || (i.dhcpClient ? 'DHCP' : ''),
          ...(live ? [l.status?.statusText] : []),
          ...(macs ? [l.noMac ? t('ports.live.noMacShort') : l.macs.length || ''] : []),
        ];
      }),
    },
    {
      name: t('export.sheet.vlans'),
      columns: [
        t('vlans.col.id'),
        t('vlans.col.name'),
        t('vlans.col.gateway'),
        t('vlans.role.access'),
        t('vlans.role.voice'),
        t('vlans.role.untagged'),
        t('vlans.role.tagged'),
      ],
      rows: vlanUsage(model).map((u) => [
        u.vlan.id,
        u.vlan.name ?? vlanNameFromState(u.vlan.id, state),
        u.gateways.map((g) => `${g.ip}/${g.prefix}`).join(' '),
        shortList(u.ports.access, Infinity),
        shortList(u.ports.voice, Infinity),
        shortList(u.ports.untagged, Infinity),
        shortList(u.ports.tagged, Infinity),
      ]),
    },
  ];
  if (context.acls.length > 0) {
    sheets.push({
      name: t('export.sheet.acls'),
      columns: [
        t('acls.col.name'),
        t('acls.col.type'),
        t('acls.col.applied'),
        t('acls.col.seq'),
        t('acls.col.action'),
        t('acls.col.protocol'),
        t('acls.col.source'),
        t('acls.col.sourcePort'),
        t('acls.col.destination'),
        t('acls.col.destinationPort'),
        t('acls.col.options'),
      ],
      rows: context.acls.flatMap((acl) => {
        const head = [
          acl.name,
          t(`acls.type.${acl.type}`),
          acl.bindings.map((b) => bindingText(b, t)).join(', ') || t('acls.notApplied'),
        ];
        if (acl.entries.length === 0) return [head];
        return acl.entries.map((e) => [
          ...head,
          e.seq,
          e.action,
          e.protocol?.replace(/^object-group:/, ''),
          formatAddress(e.source),
          formatPorts(e.sourcePort),
          formatAddress(e.destination),
          formatPorts(e.destinationPort),
          [...(e.services ?? []), ...e.options].join(' '),
        ]);
      }),
    });
  }
  sheets.push(routesSheet(model, context, t, ''));
  const liveRoutes = liveRoutesSheet(state, context, t, '');
  if (liveRoutes) sheets.push(liveRoutes);
  if (macs) {
    sheets.push({
      name: t('export.sheet.macs'),
      columns: [
        t('ports.col.port'),
        t('ports.col.description'),
        'MAC',
        'VLAN',
        t('export.col.macType'),
        'IP',
      ],
      rows: model.interfaces.flatMap((i) =>
        portLive(i, state).macs.map((m) => [
          shortInterfaceName(i.name),
          i.description,
          m.mac,
          m.vlan,
          t(`ports.macType.${m.type}`),
          m.arp.map((a) => a.ip).join(', '),
        ]),
      ),
    });
  }
  return sheets;
}

function firewallSheets(model: DeviceModel, state: DeviceState | null, t: TFunction): Sheet[] {
  const live = state !== null && state.ports.length > 0;
  const zoneOf = new Map<string, string>();
  for (const c of model.contexts) {
    for (const z of c.zones) for (const i of z.interfaces) zoneOf.set(i, z.name);
    for (const m of c.sdwan?.members ?? []) if (m.zone) zoneOf.set(m.interface, `SD-WAN ${m.zone}`);
  }
  const sheets: Sheet[] = [
    {
      name: t('export.sheet.interfaces'),
      columns: [
        t('ports.col.port'),
        t('interfaces.col.alias'),
        t('interfaces.col.kind'),
        t('ports.col.ip'),
        t('interfaces.col.role'),
        t('interfaces.col.parent'),
        t('interfaces.col.zone'),
        'VDOM',
        t('interfaces.col.access'),
        t('ports.col.state'),
        ...(live ? [t('ports.col.live')] : []),
        t('ports.col.description'),
      ],
      rows: model.interfaces.map((i) => [
        i.name,
        i.alias,
        t(`ports.kind.${i.kind}`),
        ip(i) || (i.dhcpClient ? (i.addressingMode ?? 'dhcp').toUpperCase() : ''),
        i.role,
        i.parent
          ? `${i.parent}${i.vlanId !== undefined ? ` · VLAN ${i.vlanId}` : ''}`
          : (i.members ?? []).join(' '),
        zoneOf.get(i.name),
        i.context,
        (i.allowAccess ?? []).join(' '),
        i.shutdown ? t('ports.state.down') : t('ports.state.up'),
        ...(live ? [state.ports.find((p) => p.name === i.name)?.statusText] : []),
        i.description,
      ]),
    },
    {
      name: t('export.sheet.vlans'),
      columns: [
        t('vlans.col.id'),
        t('vlans.col.interface'),
        t('interfaces.col.parent'),
        t('vlans.col.gateway'),
        t('interfaces.col.role'),
        'VDOM',
        t('ports.col.description'),
      ],
      rows: model.interfaces
        .filter((i) => i.vlanId !== undefined)
        .map((i) => [
          i.vlanId,
          i.name,
          i.parent,
          ip(i),
          i.role,
          i.context,
          i.description ?? i.alias,
        ]),
    },
  ];
  for (const context of model.contexts) {
    // With several VDOMs every sheet of a VDOM has its name.
    const suffix = model.contexts.length > 1 ? ` ${context.name}` : '';
    sheets.push(policiesSheet(model, context, t, suffix));
    sheets.push(objectsSheet(context, t, suffix));
    sheets.push(routesSheet(model, context, t, suffix));
    const liveRoutes = liveRoutesSheet(state, context, t, suffix);
    if (liveRoutes) sheets.push(liveRoutes);
    if (context.ipsec.length > 0) sheets.push(vpnSheet(context, state, t, suffix));
    if (context.sdwan) sheets.push(...sdwanSheets(context, state, t, suffix));
  }
  return sheets;
}

function policiesSheet(
  model: DeviceModel,
  context: LogicalContext,
  t: TFunction,
  suffix: string,
): Sheet {
  const warnings = new Map<number, ModelWarningCode[]>();
  for (const w of model.warnings) {
    if (w.context !== context.name || w.line === undefined) continue;
    warnings.set(w.line, [...(warnings.get(w.line) ?? []), w.code]);
  }
  return {
    name: t('export.sheet.policies') + suffix,
    columns: [
      t('policies.col.order'),
      'ID',
      t('policies.col.name'),
      t('policies.col.srcintf'),
      t('policies.col.dstintf'),
      t('policies.col.srcaddr'),
      t('policies.col.dstaddr'),
      t('policies.col.service'),
      t('policies.col.action'),
      t('policies.nat'),
      t('policies.col.log'),
      t('policies.col.status'),
      t('policies.col.warnings'),
    ],
    rows: context.policies.map((p) => [
      p.order,
      p.id,
      p.name,
      p.srcintf.join(', '),
      p.dstintf.join(', '),
      `${p.srcaddrNegate ? '!' : ''}${p.srcaddr.join(', ')}`,
      `${p.dstaddrNegate ? '!' : ''}${p.dstaddr.join(', ')}`,
      p.service.join(', '),
      p.action,
      p.nat ? t('routing.yes') : t('routing.no'),
      p.logtraffic,
      p.enabled ? '' : t('policies.disabled'),
      (warnings.get(p.src[0]?.[0] ?? -1) ?? []).map((w) => t(`policies.warning.${w}`)).join(', '),
    ]),
  };
}

function objectsSheet(context: LogicalContext, t: TFunction, suffix: string): Sheet {
  return {
    name: t('export.sheet.objects') + suffix,
    columns: [
      t('export.col.category'),
      t('objects.col.name'),
      t('objects.col.type'),
      t('objects.col.value'),
      t('objects.col.comment'),
    ],
    rows: OBJECT_KINDS.flatMap((kind) =>
      objectRows(kind, context, t).map((r) => [
        t(`export.objectKind.${kind}`),
        r.name,
        r.type,
        r.value,
        r.comment,
      ]),
    ),
  };
}

function routesSheet(
  model: DeviceModel,
  context: LogicalContext,
  t: TFunction,
  suffix: string,
): Sheet {
  return {
    name: t('export.sheet.routes') + suffix,
    columns: [
      t('routing.col.prefix'),
      t('routing.col.type'),
      t('routing.col.gateway'),
      t('routing.col.interface'),
      t('routing.col.distance'),
      'VRF',
      t('routing.col.name'),
    ],
    rows: configRoutes(model, context.name).map((r) => [
      formatRoutePrefix(r.prefix),
      t(`routing.type.${r.type}`),
      r.gateway ?? (r.sdwanZones ? t('routing.sdwan', { zones: r.sdwanZones.join(', ') }) : ''),
      r.interface ? shortInterfaceName(r.interface) : '',
      r.distance,
      r.vrf,
      r.name,
    ]),
  };
}

function liveRoutesSheet(
  state: DeviceState | null,
  context: LogicalContext,
  t: TFunction,
  suffix: string,
): Sheet | null {
  const routes = (state?.routes ?? []).filter((r) => !r.context || r.context === context.name);
  if (routes.length === 0) return null;
  return {
    name: t('export.sheet.liveRoutes') + suffix,
    columns: [
      t('routing.col.code'),
      t('routing.col.prefix'),
      t('routing.col.gateway'),
      t('routing.col.interface'),
      t('routing.col.distanceMetric'),
      t('routing.col.age'),
    ],
    rows: routes.map((r) => [
      r.code,
      r.prefix,
      r.gateway,
      r.interface,
      r.distance !== undefined ? `${r.distance}/${r.metric ?? 0}` : '',
      r.age,
    ]),
  };
}

function vpnSheet(
  context: LogicalContext,
  state: DeviceState | null,
  t: TFunction,
  suffix: string,
): Sheet {
  const live = (state?.tunnels.length ?? 0) > 0;
  return {
    name: t('export.sheet.vpn') + suffix,
    columns: [
      t('vpn.col.name'),
      t('vpn.col.type'),
      t('vpn.col.interface'),
      t('vpn.col.remote'),
      'IKE',
      t('vpn.col.proposals'),
      t('vpn.dhgrp'),
      'ADVPN',
      t('vpn.col.phase2'),
      ...(live ? [t('vpn.col.live')] : []),
    ],
    rows: context.ipsec.map((x) => {
      const l = tunnelLive(x.name, state, context.name);
      return [
        x.name,
        t(`vpn.type.${x.type}`, { defaultValue: x.type }),
        x.interface,
        x.remoteGw ?? x.remoteGwDdns ?? (x.type === 'dynamic' ? t('vpn.dialup') : ''),
        `v${x.ikeVersion}`,
        x.proposals.join(' '),
        x.dhgrp.join(' '),
        x.advpn ? t(`vpn.advpn.${x.advpn}`) : '',
        x.phase2
          .map((p) => `${p.name}: ${p.srcSubnet ?? '0.0.0.0/0'} → ${p.dstSubnet ?? '0.0.0.0/0'}`)
          .join('; '),
        ...(live
          ? [l.instances.length > 0 ? t('vpn.liveCount', { up: l.up, down: l.down }) : '']
          : []),
      ];
    }),
  };
}

function sdwanSheets(
  context: LogicalContext,
  state: DeviceState | null,
  t: TFunction,
  suffix: string,
): Sheet[] {
  const sdwan = context.sdwan!;
  const memberName = (seq: number) =>
    sdwan.members.find((m) => m.seq === seq)?.interface ?? String(seq);
  const services = (state?.sdwanServices ?? []).filter(
    (x) => !x.context || x.context === context.name,
  );
  return [
    {
      name: t('export.sheet.sdwanMembers') + suffix,
      columns: [
        t('sdwan.col.seq'),
        t('sdwan.col.interface'),
        t('sdwan.col.zone'),
        t('sdwan.col.gateway'),
        t('sdwan.col.cost'),
        t('sdwan.col.priority'),
        t('ports.col.state'),
      ],
      rows: sdwan.members.map((m) => [
        m.seq,
        m.interface,
        m.zone,
        m.gateway,
        m.cost ?? 0,
        m.priority,
        m.enabled ? t('ports.state.up') : t('policies.disabled'),
      ]),
    },
    {
      name: t('export.sheet.sdwanHealth') + suffix,
      columns: [
        t('sdwan.col.name'),
        t('sdwan.col.servers'),
        t('sdwan.col.protocol'),
        t('sdwan.members'),
        'SLA',
      ],
      rows: sdwan.healthChecks.map((h) => [
        h.name,
        h.servers.join(' '),
        h.protocol,
        h.members.map(memberName).join(', '),
        h.sla
          .map((s) =>
            t('sdwan.sla', {
              id: s.id,
              latency: s.latency ?? '',
              jitter: s.jitter ?? '',
              packetloss: s.packetloss ?? '',
            }),
          )
          .join('; '),
      ]),
    },
    {
      name: t('export.sheet.sdwanRules') + suffix,
      columns: [
        t('sdwan.col.seq'),
        t('sdwan.col.name'),
        t('sdwan.col.mode'),
        t('sdwan.col.match'),
        t('sdwan.col.quality'),
        t('sdwan.col.preferred'),
        ...(services.length > 0 ? [t('export.col.used')] : []),
      ],
      rows: sdwan.rules.map((r) => {
        const used = services
          .find((x) => x.id === r.id)
          ?.members.find((m) => m.selected && m.alive)?.interface;
        return [
          r.id,
          r.name,
          t(`sdwan.mode.${r.mode}`, { defaultValue: r.mode }),
          [
            r.srcaddr.length > 0 && t('sdwan.from', { names: r.srcaddr.join(', ') }),
            r.dstaddr.length > 0 && t('sdwan.to', { names: r.dstaddr.join(', ') }),
            r.internetService.join(', '),
            r.application.join(', '),
          ]
            .filter(Boolean)
            .join(' · '),
          [
            r.healthCheck,
            ...r.sla.map((s) => (s.id !== undefined ? `${s.healthCheck} #${s.id}` : s.healthCheck)),
          ]
            .filter(Boolean)
            .join(', '),
          [...r.priorityMembers.map(memberName), ...r.priorityZones].join(' › '),
          ...(services.length > 0 ? [used] : []),
        ];
      }),
    },
  ];
}

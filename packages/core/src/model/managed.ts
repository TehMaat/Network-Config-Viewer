// The devices managed by a FortiGate as devices of their own (#15, part 4): a FortiSwitch with
// its ports and VLANs from the configuration of the FortiGate, and its real state from the
// shows of the FortiGate. Its lines are lines of the configuration of the FortiGate.

import { emptyState, type DeviceState } from '../show/types';
import {
  emptyContext,
  type DeviceModel,
  type FeatureCode,
  type ManagedSwitch,
  type Vlan,
} from './types';

/** The model of a managed FortiSwitch, with the VLANs of its FortiGate. */
export function managedSwitchModel(fortigate: DeviceModel, sw: ManagedSwitch): DeviceModel {
  // Every VLAN of the FortiGate: the same colours on every switch of the FortiGate.
  const vlans = new Map<number, Vlan>([[1, { id: 1, name: '_default', implicit: true, src: [] }]]);
  for (const i of fortigate.interfaces) {
    if (i.vlanId !== undefined && !vlans.has(i.vlanId)) {
      vlans.set(i.vlanId, { id: i.vlanId, name: i.name, src: i.src });
    }
  }
  const features = new Set<FeatureCode>();
  if (sw.ports.some((p) => p.poe && p.poe.mode !== 'never')) features.add('poe');
  if (sw.ports.some((p) => p.kind === 'lag')) features.add('lag');
  if (sw.ports.some((p) => p.trunkRole === 'icl')) features.add('mclag');
  return {
    vendor: 'fortinet',
    os: 'fortiswitchos',
    ...(sw.model ? { model: sw.model } : {}),
    hostname: sw.name,
    stack: [{ member: 1, ...(sw.model ? { model: sw.model } : {}), src: sw.src }],
    interfaces: sw.ports,
    vlans: [...vlans.values()].sort((a, b) => a.id - b.id),
    contexts: [emptyContext('default')],
    // LLDP runs on the FortiSwitches by default.
    discovery: { lldp: true, cdp: false, src: [] },
    features: [...features].sort(),
    references: [],
    coverage: { total: 0, understood: 0, ignored: 0, unknown: 0, sections: [], unknownLines: [] },
    warnings: [],
  };
}

/** The state of a managed FortiSwitch, from the shows of its FortiGate: MACs and status. */
export function managedSwitchState(
  state: DeviceState | null | undefined,
  sw: ManagedSwitch,
): DeviceState | null {
  if (!state) return null;
  const macs = state.switchMacs.filter((m) => m.switch === sw.serial);
  const status = state.managedSwitches.find((s) => s.serial === sw.serial);
  if (macs.length === 0 && !status) return null;
  const out = emptyState();
  out.managed = true;
  out.hostname = sw.name;
  out.serials = [sw.serial];
  if (status?.version) out.version = status.version;
  out.macs = macs.map(({ switch: _switch, ...m }) => m);
  if (status) out.managedSwitches = [status];
  out.commands = state.commands.filter(
    (c) =>
      c.id === 'diagnose switch-controller switch-info mac-table' ||
      c.id === 'execute switch-controller get-conn-status',
  );
  return out;
}

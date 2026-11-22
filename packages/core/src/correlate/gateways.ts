// The gateway of a VLAN on another device (#15, part 2): the VLAN is followed along the cables
// and LAGs that carry it, up to the device that has an interface with an address in it (an
// SVI of a switch, a VLAN interface of a FortiGate).

import type { DeviceModel, Interface } from '../model/types';
import { portVlanRole } from '../query/vlans';
import type { Infrastructure } from './types';

export interface RemoteGateway {
  /** Key of the device with the gateway. */
  device: string;
  hostname: string;
  file: string;
  interface: string;
  ip: string;
  prefix: number;
  /** Devices crossed from the first one to the gateway, both included. */
  path: string[];
}

type ModelOf = (key: string) => DeviceModel | null;

/** The interface of a FortiGate a VLAN rides on: the port, or the hardware switch it is in. */
function vlanBase(model: DeviceModel, port: Interface): string {
  return (
    model.interfaces.find((p) => p.kind === 'hard-switch' && p.members?.includes(port.name))
      ?.name ?? port.name
  );
}

/**
 * The interface of a link end: the port itself or, for a port of a FortiGate hardware switch
 * that the configuration does not list on its own (internal1 of internal), the switch.
 */
function portOf(model: DeviceModel, name: string): Interface | undefined {
  return (
    model.interfaces.find((i) => i.name === name) ??
    model.interfaces.find((i) => i.kind === 'hard-switch' && i.members?.includes(name))
  );
}

/** The port carries the VLAN: in its switchport, or as a VLAN interface of a FortiGate on it. */
function carries(model: DeviceModel, port: Interface, vlan: number): boolean {
  // FortiLink and the inter-chassis trunk of a managed FortiSwitch carry every VLAN.
  if (port.trunkRole === 'fortilink' || port.trunkRole === 'icl') return true;
  if (port.switchport) return portVlanRole(port, vlan) !== null;
  const base = vlanBase(model, port);
  return model.interfaces.some((i) => i.parent === base && i.vlanId === vlan);
}

/** The interface with an address in the VLAN that the port reaches on its device. */
function gatewayOn(model: DeviceModel, port: Interface, vlan: number): Interface | undefined {
  if (model.vendor === 'fortinet') {
    const base = vlanBase(model, port);
    return model.interfaces.find(
      (i) => i.parent === base && i.vlanId === vlan && i.ipv4.length > 0,
    );
  }
  return model.interfaces.find(
    (i) => i.kind === 'svi' && i.name.toLowerCase() === `vlan${vlan}` && i.ipv4.length > 0,
  );
}

export function vlanGateways(
  infra: Infrastructure,
  modelOf: ModelOf,
  start: string,
  vlan: number,
): RemoteGateway[] {
  const found: RemoteGateway[] = [];
  const seen = new Set([start]);
  const queue: { device: string; path: string[] }[] = [{ device: start, path: [start] }];
  while (queue.length > 0) {
    const { device, path } = queue.shift()!;
    const model = modelOf(device);
    if (!model) continue;
    for (const link of infra.links) {
      if (link.kind !== 'cable' && link.kind !== 'lag' && link.kind !== 'fortilink') continue;
      for (const [here, there] of [
        [link.a, link.b],
        [link.b, link.a],
      ] as const) {
        if (here.node !== device || seen.has(there.node)) continue;
        const other = modelOf(there.node);
        if (!other || !here.interface || !there.interface) continue;
        const portHere = portOf(model, here.interface);
        const portThere = portOf(other, there.interface);
        if (!portHere || !portThere) continue;
        if (!carries(model, portHere, vlan) || !carries(other, portThere, vlan)) continue;
        seen.add(there.node);
        const gateway = gatewayOn(other, portThere, vlan);
        const next = [...path, there.node];
        if (gateway) {
          const d = infra.devices.find((x) => x.key === there.node)!;
          found.push({
            device: d.key,
            hostname: d.hostname,
            file: d.file,
            interface: gateway.name,
            ip: gateway.ipv4[0]!.ip,
            prefix: gateway.ipv4[0]!.prefix,
            path: next,
          });
        } else {
          queue.push({ device: there.node, path: next });
        }
      }
    }
  }
  return found;
}

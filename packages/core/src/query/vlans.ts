import type { DeviceModel, Interface, Vlan } from '../model/types';
import { vlanSetHas } from '../model/vlans';

/** How a port carries a VLAN. */
export type VlanRole = 'access' | 'voice' | 'tagged' | 'untagged';

/** How a switch port carries a VLAN, or null. Ports that negotiate (DTP) count as access. */
export function portVlanRole(iface: Interface, vlan: number): VlanRole | null {
  const sp = iface.switchport;
  if (!sp || sp.mode === 'routed') return null;
  if (sp.voiceVlan === vlan) return 'voice';
  switch (sp.mode) {
    case 'access':
    case 'dynamic-auto':
    case 'dynamic-desirable':
      return sp.accessVlan === vlan ? 'access' : null;
    case 'trunk':
      if (sp.nativeVlan === vlan) return 'untagged';
      return vlanSetHas(sp.allowed, vlan) ? 'tagged' : null;
    case 'general':
      if (
        vlanSetHas(sp.untagged, vlan) ||
        (sp.nativeVlan === vlan && !vlanSetHas(sp.allowed, vlan))
      ) {
        return 'untagged';
      }
      return vlanSetHas(sp.allowed, vlan) ? 'tagged' : null;
  }
}

export interface VlanUsage {
  vlan: Vlan;
  /** Ports that carry the VLAN, by role. Members of a port-channel are counted in the port-channel. */
  ports: Record<VlanRole, string[]>;
  /** IP addresses of the VLAN interface on this device. */
  gateways: { interface: string; ip: string; prefix: number }[];
}

/** For every VLAN of a switch: the ports that carry it and its gateway on the same device. */
export function vlanUsage(model: DeviceModel): VlanUsage[] {
  const ports = model.interfaces.filter((i) => i.switchport && !i.lag);
  return model.vlans.map((vlan) => {
    const usage: VlanUsage = {
      vlan,
      ports: { access: [], voice: [], tagged: [], untagged: [] },
      gateways: [],
    };
    for (const port of ports) {
      const role = portVlanRole(port, vlan.id);
      if (role) usage.ports[role].push(port.name);
      // A voice port also carries its data VLAN.
      if (role === 'voice' && port.switchport?.accessVlan === vlan.id)
        usage.ports.access.push(port.name);
    }
    for (const svi of model.interfaces) {
      if (svi.kind === 'svi' && svi.vlanId === vlan.id) {
        for (const a of svi.ipv4)
          usage.gateways.push({ interface: svi.name, ip: a.ip, prefix: a.prefix });
      }
    }
    return usage;
  });
}

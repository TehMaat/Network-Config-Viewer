import { ipToInt, networkOf, prefixBounds } from '../model/ip';
import type { DeviceModel, Prefix, Src } from '../model/types';

export interface ConfigRoute {
  prefix: Prefix;
  type: 'connected' | 'static' | 'default-gateway';
  gateway?: string;
  interface?: string;
  distance: number;
  vrf?: string;
  name?: string;
  /** The interface is shut down, or the route is disabled. */
  inactive: boolean;
  src: Src;
}

/**
 * The routes that can be worked out from the configuration alone: the networks of the
 * interfaces and the static routes. Dynamic routes (OSPF, BGP) need the routing table from
 * the show commands.
 */
export function configRoutes(model: DeviceModel, contextName?: string): ConfigRoute[] {
  const context = model.contexts.find((c) => c.name === contextName) ?? model.contexts[0];
  const routes: ConfigRoute[] = [];
  for (const iface of model.interfaces) {
    if (contextName && iface.context && iface.context !== contextName) continue;
    for (const address of iface.ipv4) {
      routes.push({
        prefix: networkOf(address),
        type: 'connected',
        interface: iface.name,
        distance: 0,
        ...(iface.vrf ? { vrf: iface.vrf } : {}),
        inactive: iface.shutdown,
        src: iface.src,
      });
    }
  }
  for (const route of context?.routing.statics ?? []) {
    routes.push({
      prefix: route.dst,
      type: route.kind === 'default-gateway' ? 'default-gateway' : 'static',
      ...(route.gateway ? { gateway: route.gateway } : {}),
      ...(route.device ? { interface: route.device } : {}),
      distance: route.distance ?? 1,
      ...(route.vrf ? { vrf: route.vrf } : {}),
      ...(route.name ? { name: route.name } : {}),
      inactive: !route.enabled,
      src: route.src,
    });
  }
  return routes.sort(
    (a, b) =>
      (a.vrf ?? '').localeCompare(b.vrf ?? '') ||
      prefixBounds(a.prefix)[0] - prefixBounds(b.prefix)[0] ||
      a.prefix.prefix - b.prefix.prefix ||
      a.distance - b.distance,
  );
}

/** The routes used for an IP: the longest prefix, then the lowest distance (global table). */
export function lookupRoute(
  routes: readonly ConfigRoute[],
  ip: string,
  vrf?: string,
): ConfigRoute[] {
  const value = ipToInt(ip.trim());
  if (value === null) return [];
  let best: ConfigRoute[] = [];
  let bestLength = -1;
  for (const route of routes) {
    if (route.inactive || (route.vrf ?? '') !== (vrf ?? '')) continue;
    const [first, last] = prefixBounds(route.prefix);
    if (value < first || value > last) continue;
    if (route.prefix.prefix > bestLength) {
      best = [route];
      bestLength = route.prefix.prefix;
    } else if (route.prefix.prefix === bestLength) {
      best.push(route);
    }
  }
  const minDistance = Math.min(...best.map((r) => r.distance));
  return best.filter((r) => r.distance === minDistance);
}

// Model values written the way network engineers read them. Only data, no translated text:
// the views add the words around them.
import type { TFunction } from 'i18next';
import {
  formatPrefix,
  formatVlanSet,
  prefixToMask,
  shortInterfaceName,
  type AclBinding,
  type AddressMatch,
  type AddressObject,
  type Interface,
  type ObjectGroupEntry,
  type PortMatch,
  type Prefix,
  type VlanSet,
} from '@ncv/core';

export function formatAddress(match: AddressMatch | undefined): string {
  if (!match) return '';
  switch (match.kind) {
    case 'any':
      return 'any';
    case 'host':
      return match.ip;
    case 'wildcard':
      return match.wildcard === '0.0.0.0' ? match.ip : `${match.ip} ${match.wildcard}`;
    case 'subnet':
      return `${match.ip}/${match.prefix}`;
    case 'object-group':
      return match.name;
    case 'other':
      return match.text;
  }
}

export function formatPorts(match: PortMatch | undefined): string {
  if (!match) return '';
  return match.op === 'range'
    ? `${match.ports[0]}-${match.ports[1]}`
    : `${match.op} ${match.ports.join(' ')}`;
}

export function formatGroupEntry(entry: ObjectGroupEntry): string {
  switch (entry.kind) {
    case 'host':
      return entry.ip;
    case 'subnet':
      return `${entry.ip}/${entry.prefix}`;
    case 'range':
      return `${entry.from}-${entry.to}`;
    case 'group':
      return entry.name;
    case 'service':
      return `${entry.protocol}${entry.port ? ` ${formatPorts(entry.port)}` : ''}`;
    case 'other':
      return entry.text;
  }
}

export function formatVlans(set: VlanSet | undefined): string {
  if (!set) return '';
  if (set.all) return '1-4094';
  return formatVlanSet(set);
}

export function formatRoutePrefix(prefix: Prefix): string {
  return formatPrefix(prefix);
}

export function prefixWithMask(prefix: Prefix): string {
  return `${prefix.ip} ${prefixToMask(prefix.prefix)}`;
}

export { shortInterfaceName };

/** "GigabitEthernet1/0/1, GigabitEthernet1/0/2" in the short form, at most a few names. */
export function shortList(names: readonly string[], max = 6): string {
  const short = names.slice(0, max).map(shortInterfaceName);
  return names.length > max ? `${short.join(', ')} +${names.length - max}` : short.join(', ');
}

/** The content of a FortiOS address object: subnet, range, FQDN, country, interface subnet. */
export function addressText(a: AddressObject, t: TFunction): string {
  if (a.subnet) return `${a.subnet.ip}/${a.subnet.prefix}`;
  if (a.range) return `${a.range.start}-${a.range.end}`;
  if (a.fqdn) return a.fqdn;
  if (a.country) return t('objects.country', { country: a.country });
  if (a.wildcard) return `${a.wildcard.ip} ${a.wildcard.wildcard}`;
  if (a.interface) return t('objects.interfaceSubnet', { name: a.interface });
  return a.type;
}

/**
 * Styles of a badge whose text must never be cut: in a table, the column grows to fit it
 * instead of hiding the end of the text.
 */
export const FULL_LABEL = { label: { overflow: 'visible' } } as const;

/** The VLANs of a port as the table shows them: access, trunk with the native one, general. */
export function vlanText(i: Interface, t: TFunction): string {
  const sp = i.switchport;
  if (!sp || sp.mode === 'routed') return '';
  if (sp.mode === 'trunk') {
    const allowed = formatVlans(sp.allowed) || t('ports.detail.none');
    return sp.nativeVlan !== undefined
      ? t('ports.trunkVlans', { vlans: allowed, native: sp.nativeVlan })
      : allowed;
  }
  if (sp.mode === 'general') {
    return [
      formatVlans(sp.untagged) && t('ports.untaggedShort', { vlans: formatVlans(sp.untagged) }),
      formatVlans(sp.allowed) && t('ports.taggedShort', { vlans: formatVlans(sp.allowed) }),
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return String(sp.accessVlan ?? '');
}

/** Where an ACL is applied, in words. */
export function bindingText(b: AclBinding, t: TFunction): string {
  switch (b.kind) {
    case 'interface':
      return t('acls.binding.interface', {
        name: shortInterfaceName(b.interface),
        direction: t(`acls.direction.${b.direction}`),
      });
    case 'line':
      return t('acls.binding.line', { line: b.line });
    case 'snmp':
      return t('acls.binding.snmp');
    case 'route-map':
      return t('acls.binding.routeMap', { name: b.name });
    case 'management':
      return t('acls.binding.management');
  }
}

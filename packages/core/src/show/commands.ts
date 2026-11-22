import type { ShowCommandId } from './types';

/**
 * Commands as typed are often abbreviated ("sh int status", "sh mac add", "diag vpn ike gate
 * list"): each word typed must be the beginning of the word of the full command.
 */
const COMMANDS: { id: ShowCommandId; words: string[][] }[] = [
  { id: 'show version', words: [['show', 'version']] },
  { id: 'show inventory', words: [['show', 'inventory']] },
  { id: 'show interfaces status', words: [['show', 'interfaces', 'status']] },
  { id: 'show vlan brief', words: [['show', 'vlan', 'brief']] },
  { id: 'show vlan', words: [['show', 'vlan']] },
  { id: 'show etherchannel summary', words: [['show', 'etherchannel', 'summary']] },
  { id: 'show cdp neighbors detail', words: [['show', 'cdp', 'neighbors', 'detail']] },
  { id: 'show lldp neighbors detail', words: [['show', 'lldp', 'neighbors', 'detail']] },
  { id: 'show lldp neighbors', words: [['show', 'lldp', 'neighbors']] },
  {
    id: 'show mac address-table',
    words: [
      ['show', 'mac', 'address-table'],
      ['show', 'mac-address-table'],
      ['show', 'mac', 'address-table', 'dynamic'],
    ],
  },
  { id: 'show ip arp', words: [['show', 'ip', 'arp']] },
  { id: 'show arp', words: [['show', 'arp']] },
  { id: 'show power inline', words: [['show', 'power', 'inline']] },
  { id: 'get system status', words: [['get', 'system', 'status']] },
  { id: 'get system interface physical', words: [['get', 'system', 'interface', 'physical']] },
  { id: 'get vpn ipsec tunnel summary', words: [['get', 'vpn', 'ipsec', 'tunnel', 'summary']] },
  { id: 'diagnose vpn ike gateway list', words: [['diagnose', 'vpn', 'ike', 'gateway', 'list']] },
  {
    id: 'get router info routing-table all',
    words: [['get', 'router', 'info', 'routing-table', 'all']],
  },
  { id: 'get router info bgp summary', words: [['get', 'router', 'info', 'bgp', 'summary']] },
  { id: 'diagnose sys sdwan health-check', words: [['diagnose', 'sys', 'sdwan', 'health-check']] },
  {
    id: 'diagnose sys sdwan service',
    // From FortiOS 7.4 the IPv4 rules are in "service4", with the same output.
    words: [
      ['diagnose', 'sys', 'sdwan', 'service'],
      ['diagnose', 'sys', 'sdwan', 'service4'],
    ],
  },
  // FortiSwitches managed by the FortiGate (#15, part 4).
  {
    id: 'execute switch-controller get-conn-status',
    words: [['execute', 'switch-controller', 'get-conn-status']],
  },
  {
    id: 'diagnose switch-controller switch-info mac-table',
    words: [['diagnose', 'switch-controller', 'switch-info', 'mac-table']],
  },
];

/** The canonical command for a command as typed, or undefined when no reader knows it. */
export function commandId(typed: string): ShowCommandId | undefined {
  const words = typed
    .trim()
    .toLowerCase()
    .replace(/^do\s+/, '')
    .replace(/\s*\|.*$/, '')
    .split(/\s+/)
    .filter(Boolean);
  // "diag" is "diagnose" and "sys" is also typed "system".
  if (words[0] === 'diag') words[0] = 'diagnose';
  if (words[0] === 'diagnose' && words[1] === 'system') words[1] = 'sys';
  let best: ShowCommandId | undefined;
  let bestLength = 0;
  for (const command of COMMANDS) {
    for (const full of command.words) {
      if (words.length !== full.length) continue;
      if (words.every((w, i) => full[i]!.startsWith(w)) && full.length > bestLength) {
        best = command.id;
        bestLength = full.length;
      }
    }
  }
  return best;
}

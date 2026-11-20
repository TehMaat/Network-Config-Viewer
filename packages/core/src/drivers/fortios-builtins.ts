// Objects that FortiOS predefines. Full backups usually contain the predefined services in
// "config firewall service custom"; when a file does not (or a policy uses "all"), these
// definitions are added to the model, marked as built in and without lines of origin.

import type { AddressObject, ServiceObject, ServicePorts } from '../model/types';

export function builtinAddresses(): AddressObject[] {
  return [
    { name: 'all', type: 'subnet', subnet: { ip: '0.0.0.0', prefix: 0 }, builtin: true, src: [] },
    { name: 'none', type: 'subnet', subnet: { ip: '0.0.0.0', prefix: 32 }, builtin: true, src: [] },
  ];
}

const p = (low: number, high = low): ServicePorts => ({ dst: { low, high } });

interface Def {
  name: string;
  tcp?: ServicePorts[];
  udp?: ServicePorts[];
  protocol?: string;
  icmpType?: number;
  protocolNumber?: number;
  category: string;
}

/** The predefined services of FortiOS 7.x most used in policies. */
const SERVICES: Def[] = [
  { name: 'ALL', protocol: 'IP', protocolNumber: 0, category: 'General' },
  { name: 'ALL_TCP', tcp: [p(1, 65535)], category: 'General' },
  { name: 'ALL_UDP', udp: [p(1, 65535)], category: 'General' },
  { name: 'ALL_ICMP', protocol: 'ICMP', category: 'General' },
  { name: 'ALL_ICMP6', protocol: 'ICMP6', category: 'General' },
  { name: 'GRE', protocol: 'IP', protocolNumber: 47, category: 'Tunneling' },
  { name: 'ESP', protocol: 'IP', protocolNumber: 50, category: 'Tunneling' },
  { name: 'AH', protocol: 'IP', protocolNumber: 51, category: 'Tunneling' },
  { name: 'IKE', udp: [p(500), p(4500)], category: 'Tunneling' },
  { name: 'PING', protocol: 'ICMP', icmpType: 8, category: 'Network Services' },
  { name: 'TRACEROUTE', udp: [p(33434, 33535)], category: 'Network Services' },
  { name: 'DNS', tcp: [p(53)], udp: [p(53)], category: 'Network Services' },
  { name: 'NTP', tcp: [p(123)], udp: [p(123)], category: 'Network Services' },
  { name: 'DHCP', udp: [p(67, 68)], category: 'Network Services' },
  { name: 'BGP', tcp: [p(179)], category: 'Network Services' },
  { name: 'SNMP', tcp: [p(161, 162)], udp: [p(161, 162)], category: 'Network Services' },
  { name: 'SYSLOG', udp: [p(514)], category: 'Network Services' },
  { name: 'HTTP', tcp: [p(80)], category: 'Web Access' },
  { name: 'HTTPS', tcp: [p(443)], category: 'Web Access' },
  { name: 'FTP', tcp: [p(21)], category: 'File Access' },
  { name: 'SMB', tcp: [p(445)], category: 'File Access' },
  { name: 'SAMBA', tcp: [p(139)], category: 'File Access' },
  { name: 'SMTP', tcp: [p(25)], category: 'Email' },
  { name: 'SMTPS', tcp: [p(465)], category: 'Email' },
  { name: 'IMAP', tcp: [p(143)], category: 'Email' },
  { name: 'IMAPS', tcp: [p(993)], category: 'Email' },
  { name: 'POP3', tcp: [p(110)], category: 'Email' },
  { name: 'POP3S', tcp: [p(995)], category: 'Email' },
  { name: 'SSH', tcp: [p(22)], category: 'Remote Access' },
  { name: 'TELNET', tcp: [p(23)], category: 'Remote Access' },
  { name: 'RDP', tcp: [p(3389)], category: 'Remote Access' },
  { name: 'VNC', tcp: [p(5900)], category: 'Remote Access' },
  { name: 'LDAP', tcp: [p(389)], category: 'Authentication' },
  { name: 'LDAP_UDP', udp: [p(389)], category: 'Authentication' },
  { name: 'KERBEROS', tcp: [p(88)], udp: [p(88)], category: 'Authentication' },
  { name: 'RADIUS', udp: [p(1812, 1813)], category: 'Authentication' },
  { name: 'MYSQL', tcp: [p(3306)], category: 'Network Services' },
  { name: 'MS-SQL', tcp: [p(1433, 1434)], category: 'Network Services' },
  { name: 'SIP', tcp: [p(5060)], udp: [p(5060)], category: 'VoIP, Messaging & Other Applications' },
];

export function builtinServices(): ServiceObject[] {
  return SERVICES.map((d) => ({
    name: d.name,
    protocol: d.protocol ?? 'TCP/UDP/SCTP',
    tcp: d.tcp ?? [],
    udp: d.udp ?? [],
    sctp: [],
    ...(d.icmpType !== undefined ? { icmpType: d.icmpType } : {}),
    ...(d.protocolNumber !== undefined ? { protocolNumber: d.protocolNumber } : {}),
    category: d.category,
    builtin: true,
    src: [],
  }));
}

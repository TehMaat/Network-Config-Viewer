// Values that running-configs do not show because they are the vendor default
// (docs/STUDIO.md, chapter 3, principle 5). Each value is marked in the model, so the
// interface can tell what is written from what is implied. Values still to be confirmed on
// real devices are listed in `unverified` and shown as such.

import type { SwitchportMode } from '../model/types';

export interface SwitchDefaults {
  /** Mode of a layer 2 port without "switchport mode". */
  switchportMode: SwitchportMode;
  accessVlan: number;
  nativeVlan: number;
  /** VLANs allowed on a trunk without "switchport trunk allowed vlan". */
  trunkAllowed: 'all' | 'none';
  /** PoE on capable ports without "power inline". */
  poe: string;
  unverified: string[];
}

/**
 * Catalyst 2960 (IOS 15), 3850 (IOS-XE 16) and 9200/9300 (IOS-XE 17): ports negotiate the
 * mode with DTP ("dynamic auto"), a trunk carries every VLAN, PoE is "auto".
 */
export const CISCO_IOS_DEFAULTS: SwitchDefaults = {
  switchportMode: 'dynamic-auto',
  accessVlan: 1,
  nativeVlan: 1,
  trunkAllowed: 'all',
  poe: 'auto',
  unverified: [],
};

/**
 * Cisco Small Business (Sx350, CBS350, Catalyst 1200/1300). The documentation is thin and
 * the defaults changed between firmware generations: to be confirmed with real configs.
 */
export const CISCO_SB_DEFAULTS: SwitchDefaults = {
  switchportMode: 'access',
  accessVlan: 1,
  nativeVlan: 1,
  trunkAllowed: 'none',
  poe: 'auto',
  unverified: ['switchport.mode', 'switchport.allowed'],
};

/** FortiOS 7.0–8.0: values used when an attribute is not written in a backup. */
export const FORTIOS_DEFAULTS = {
  policy: {
    status: 'enable',
    action: 'deny',
    logtraffic: 'utm',
    nat: 'disable',
  },
  phase1: {
    type: 'static',
    peertype: 'any',
    netDevice: 'disable',
    addRoute: 'enable',
    dpd: 'on-demand',
    proposal: ['aes128-sha256', 'aes256-sha256', 'aes128-sha1', 'aes256-sha1'],
    dhgrp: [14, 5],
  },
  phase2: {
    pfs: 'enable',
    dhgrp: [14, 5],
    autoNegotiate: 'disable',
    keylifeSeconds: 43200,
    proposal: [
      'aes128-sha1',
      'aes256-sha1',
      'aes128-sha256',
      'aes256-sha256',
      'aes128gcm',
      'aes256gcm',
      'chacha20poly1305',
    ],
  },
  interface: {
    status: 'up',
    mode: 'static',
  },
  sdwanRule: {
    mode: 'manual',
  },
  healthCheck: {
    protocol: 'ping',
    latency: 5,
    jitter: 5,
    packetloss: 0,
  },
  /** The IKE version default differs between FortiOS releases: shown as to be confirmed. */
  unverified: ['ikeVersion', 'proposals', 'dhgrp'],
};

/**
 * IKE version used when "set ike-version" is missing. Assumption, to be confirmed on real
 * devices: IKEv1 up to FortiOS 7.4, IKEv2 from 7.6. Always marked as unverified.
 */
export function fortiosDefaultIkeVersion(version?: string): number {
  const major = Number(version?.split('.')[0] ?? 7);
  const minor = Number(version?.split('.')[1] ?? 0);
  return major > 7 || (major === 7 && minor >= 6) ? 2 : 1;
}

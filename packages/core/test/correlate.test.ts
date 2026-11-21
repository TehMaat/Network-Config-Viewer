import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  assignShows,
  buildCiscoModel,
  buildFortiosModel,
  buildModel,
  correlate,
  mergeStates,
  modelHints,
  parseSyntax,
  readShowFile,
  siteCode,
  siteFromLocation,
  splitLines,
  type CorrelationInput,
  type DeviceState,
  type Infrastructure,
  type Link,
  type LinkEnd,
} from '../src';
import { readSampleText, SAMPLES_DIR, sampleFiles } from './helpers';

// The links expected between the samples, in a compact form that can be read and checked by
// hand. After a deliberate change of the correlation or of a sample, rewrite it with
// NCV_UPDATE_EXPECTED=1 npx vitest run test/correlate.test.ts and review the diff.
const EXPECTED = join(SAMPLES_DIR, 'expected-links.json');
const update = process.env.NCV_UPDATE_EXPECTED === '1';

/** The client of the samples, as the app gives it: current configurations with their shows. */
function sampleClient(): CorrelationInput[] {
  const configs: { id: string; hostname: string; input: Omit<CorrelationInput, 'state'> }[] = [];
  const shows: {
    id: string;
    hostname?: string;
    serials: string[];
    fileName: string;
    state: DeviceState;
  }[] = [];
  for (const rel of sampleFiles()) {
    if (rel.startsWith('versioni/')) continue;
    const text = readSampleText(rel);
    const analysis = analyzeText(text);
    const lines = splitLines(text);
    if (analysis.detection.kind.value === 'config') {
      const model = buildModel(lines, analysis.tree, modelHints(analysis.detection));
      if (model?.hostname) {
        configs.push({
          id: rel,
          hostname: model.hostname,
          input: { hostname: model.hostname, file: rel, model },
        });
      }
    } else if (analysis.detection.kind.value === 'show') {
      const show = readShowFile(lines);
      shows.push({
        id: rel,
        ...(show.hostname ? { hostname: show.hostname } : {}),
        serials: show.state.serials,
        fileName: rel.split('/').at(-1)!,
        state: show.state,
      });
    }
  }
  const assigned = assignShows(
    configs.map((c) => ({ id: c.id, hostname: c.hostname })),
    shows,
  );
  return configs.map((c) => {
    const parts = shows
      .filter((s) => assigned.get(s.id)?.device === c.id)
      .map((s) => ({ file: s.id, state: s.state }));
    return { ...c.input, state: parts.length > 0 ? mergeStates(parts) : null };
  });
}

function endText(e: LinkEnd): string {
  return [
    e.node,
    e.context && e.context !== 'default' && e.context !== 'root' ? `(${e.context})` : '',
    e.interface ? `${e.interface}${e.unknownInterface ? '?' : ''}` : '',
    e.tunnel ? `tunnel ${e.tunnel}` : '',
    e.neighbor ? `neighbor ${e.neighbor}` : '',
    e.range ? `range ${e.range.prefix} ${e.range.group}` : '',
    e.ip ?? '',
    e.area ? `area ${e.area}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function linkText(l: Link): string {
  const parts = [
    l.kind,
    endText(l.a),
    endText(l.b),
    [...new Set(l.sources.map((s) => s.kind))].sort().join(','),
  ];
  if (l.verified) parts.push('verified');
  if (l.cables) parts.push(`cables ${l.cables.map((c) => `${c.a}-${c.b ?? '?'}`).join(' ')}`);
  if (l.dialup) parts.push('dial-up');
  if (l.via) parts.push(`via ${l.via}`);
  if (l.gateway) parts.push(`gateway ${l.gateway}`);
  if (l.state) parts.push(`state ${l.state.a?.status ?? '-'}/${l.state.b?.status ?? '-'}`);
  if (l.overlay) parts.push(`overlay ${l.overlay.a?.zone ?? '-'}/${l.overlay.b?.zone ?? '-'}`);
  return parts.join(' | ');
}

function summarize(infra: Infrastructure) {
  return {
    sites: Object.fromEntries(
      infra.sites.map((s) => [s.name || '-', `${s.source}: ${s.devices.join(' ')}`]),
    ),
    externals: infra.externals.map(
      (e) =>
        `${e.id} ${e.kind} ${e.label}${e.detail ? ` (${e.detail})` : ''}${e.site ? ` @${e.site}` : ''}`,
    ),
    links: infra.links.map(linkText),
  };
}

const find = (infra: Infrastructure, kind: Link['kind'], a: string, b: string) =>
  infra.links.filter(
    (l) =>
      l.kind === kind && ((l.a.node === a && l.b.node === b) || (l.a.node === b && l.b.node === a)),
  );

describe('correlation of the samples', () => {
  const infra = correlate(sampleClient());

  it('finds the expected sites, external nodes and links', () => {
    const summary = summarize(infra);
    if (update) writeFileSync(EXPECTED, `${JSON.stringify(summary, null, 2)}\n`);
    const expected = JSON.parse(readFileSync(EXPECTED, 'utf8')) as unknown;
    expect(summary).toEqual(expected);
  });

  it('puts the devices in their sites, from the SNMP location and the hostname', () => {
    const site = (name: string) => infra.sites.find((s) => s.name === name);
    expect(site('Sede')?.devices).toEqual([
      'fgt-hq',
      'sw-hq-acc1',
      'sw-hq-acc2',
      'sw-hq-acc3',
      'sw-hq-core',
    ]);
    // SW-BR2-ACC has no SNMP location: "BR2" in its hostname puts it beside FGT-BR2.
    expect(site('Filiale 2')?.devices).toEqual(['fgt-br2', 'sw-br2-acc']);
    // FGT-BR3 is not loaded: the neighbour seen by LLDP sits in the site of its cable.
    const br3 = infra.externals.find((e) => e.id === 'host:fgt-br3');
    expect(br3).toMatchObject({ kind: 'neighbor', site: site('Filiale 3')!.id });
  });

  it('joins the cables between two port-channels into one LAG, verified by LLDP', () => {
    const [lag] = find(infra, 'lag', 'fgt-hq', 'sw-hq-core');
    expect(lag).toMatchObject({
      a: { node: 'fgt-hq', context: 'OFFICE', interface: 'LAG-CORE' },
      b: { node: 'sw-hq-core', interface: 'Port-channel1' },
      verified: true,
      state: { a: { status: 'up' }, b: { status: 'up' } },
    });
    expect(lag!.cables).toEqual([
      { a: 'x1', b: 'TenGigabitEthernet1/1/1', verified: true },
      { a: 'x2', b: 'TenGigabitEthernet2/1/1', verified: true },
    ]);
    // Only described: inferred, with the far port written in the descriptions.
    const [acc3] = find(infra, 'lag', 'sw-hq-acc3', 'sw-hq-core');
    expect(acc3).toMatchObject({
      a: { interface: 'Port-channel1' },
      b: { interface: 'Port-channel12' },
      verified: false,
    });
  });

  it('matches the spokes with the dial-up tunnels of the hub and its BGP neighbour ranges', () => {
    const tunnels = find(infra, 'ipsec', 'fgt-br1', 'fgt-hq');
    expect(tunnels.map((t) => `${t.a.tunnel} > ${t.b.tunnel} ${t.dialup}`)).toEqual([
      'HUB-WAN1 > ADVPN-WAN1 true',
      'HUB-WAN2 > ADVPN-WAN2 true',
    ]);
    expect(tunnels[0]!.overlay?.a).toMatchObject({ zone: 'overlay', seq: 3 });
    const sessions = find(infra, 'bgp', 'fgt-br2', 'fgt-hq');
    expect(sessions.map((s) => `${s.a.ip} > ${s.b.range?.prefix} ${s.state?.b?.text}`)).toEqual([
      '10.255.1.22 > 10.255.1.0/24 Established',
      '10.255.2.22 > 10.255.2.0/24 Active',
    ]);
    // Each session rides on the tunnel between the same interfaces.
    const wan2 = sessions[1]!;
    expect(infra.links.find((l) => l.id === wan2.via)).toMatchObject({
      a: { node: 'fgt-br2', tunnel: 'HUB-WAN2' },
      b: { node: 'fgt-hq', tunnel: 'ADVPN-WAN2' },
    });
  });

  it('matches a static tunnel from both sides, once', () => {
    const [vpn, ...others] = find(infra, 'ipsec', 'fgt-dc', 'fgt-hq');
    expect(others).toEqual([]);
    expect(vpn!.dialup).toBeUndefined();
    expect(vpn!.sources.map((s) => `${s.kind} ${s.device}`).sort()).toEqual([
      'remote-gw fgt-dc',
      'remote-gw fgt-hq',
      'tunnel-state fgt-hq',
    ]);
  });

  it('finds the ADVPN shortcut that the hub opened between two branches', () => {
    expect(find(infra, 'shortcut', 'fgt-br1', 'fgt-br2')).toMatchObject([
      { a: { tunnel: 'HUB-WAN1_0' }, b: { ip: '192.0.2.38' }, verified: true },
    ]);
  });

  it('keeps the lines of the configurations and of the shows every link comes from', () => {
    const [cable] = find(infra, 'cable', 'fgt-br1', 'sw-br1-acc');
    const lldp = cable!.sources.find((s) => s.kind === 'lldp')!;
    expect(lldp.evidence[0]).toMatchObject({
      device: 'sw-br1-acc',
      file: 'show/sw-br1-acc_sessione.txt',
    });
    const description = cable!.sources.find((s) => s.kind === 'description')!;
    expect(description.text).toBe('UPLINK-FGT-BR1-internal1');
    expect(description.evidence[0]!.file).toBeUndefined();
    expect(description.evidence[0]!.src.length).toBeGreaterThan(0);
  });
});

// ---- Synthetic devices ------------------------------------------------------------------

function cisco(text: string, file = 'cisco'): CorrelationInput {
  const lines = splitLines(text);
  const tree = parseSyntax(lines, 'indent', { dialect: 'cisco' });
  const model = buildCiscoModel({ lines, tree, os: 'ios-xe' });
  return { hostname: model.hostname!, file, model };
}

function forti(text: string, file = 'fortigate'): CorrelationInput {
  const lines = splitLines(text);
  const tree = parseSyntax(lines, 'fortios');
  const model = buildFortiosModel({ lines, tree, os: 'fortios', version: '7.4.4' });
  return { hostname: model.hostname!, file, model };
}

const sw = (hostname: string, body: string, location?: string) =>
  cisco(
    [`hostname ${hostname}`, ...(location ? [`snmp-server location ${location}`] : []), body].join(
      '\n',
    ),
    hostname,
  );

describe('cables from descriptions', () => {
  it('makes one inferred cable from the descriptions of both sides', () => {
    const infra = correlate([
      sw('SW-A', 'interface GigabitEthernet1/0/1\n description UPLINK-SW-B-Gi1/0/24\n!'),
      sw('SW-B', 'interface GigabitEthernet1/0/24\n description SW-A Gi1/0/1\n!'),
    ]);
    expect(infra.links.map(linkText)).toEqual([
      'cable | sw-a GigabitEthernet1/0/1 | sw-b GigabitEthernet1/0/24 | description',
    ]);
    expect(infra.links[0]!.sources.map((s) => s.device)).toEqual(['sw-a', 'sw-b']);
  });

  it('takes the longest hostname a description names, and only whole names', () => {
    const infra = correlate([
      sw('SW-A1', 'interface GigabitEthernet1/0/1\n!'),
      sw('SW-A10', 'interface GigabitEthernet1/0/1\n!'),
      sw(
        'SW-X',
        'interface GigabitEthernet1/0/1\n description UPLINK-SW-A10\n!\ninterface GigabitEthernet1/0/2\n description SW-A100\n!',
      ),
    ]);
    expect(infra.links.map(linkText)).toEqual([
      'cable | sw-a10 | sw-x GigabitEthernet1/0/1 | description',
    ]);
  });

  it('keeps a port that is not in the configuration only when it looks like one', () => {
    const infra = correlate([
      sw(
        'SW-A',
        'interface GigabitEthernet1/0/1\n description SW-B Gi1/0/9\n!\ninterface GigabitEthernet1/0/2\n description SW-B porta\n!',
      ),
      sw('SW-B', 'interface GigabitEthernet1/0/1\n!'),
    ]);
    expect(infra.links.map(linkText).sort()).toEqual([
      'cable | sw-a GigabitEthernet1/0/1 | sw-b GigabitEthernet1/0/9? | description',
      'cable | sw-a GigabitEthernet1/0/2 | sw-b | description',
    ]);
  });
});

describe('subnets', () => {
  const vlan = (hostname: string, ip: string, mask: string, location: string) =>
    sw(hostname, `interface Vlan10\n ip address ${ip} ${mask}\n!`, location);

  it('links two devices of the same site, not the same subnet in two sites', () => {
    const same = correlate([
      vlan('SW-A', '192.168.1.1', '255.255.255.0', 'Milano - CED'),
      vlan('SW-B', '192.168.1.2', '255.255.255.0', 'Milano - piano 1'),
    ]);
    expect(same.links.map(linkText)).toEqual([
      'subnet | sw-a Vlan10 192.168.1.1 | sw-b Vlan10 192.168.1.2 | subnet',
    ]);
    const apart = correlate([
      vlan('SW-A', '192.168.1.1', '255.255.255.0', 'Milano'),
      vlan('SW-B', '192.168.1.2', '255.255.255.0', 'Roma'),
    ]);
    expect(apart.links).toEqual([]);
    // A point-to-point network between two sites is a link.
    const wan = correlate([
      vlan('SW-A', '10.99.0.1', '255.255.255.252', 'Milano'),
      vlan('SW-B', '10.99.0.2', '255.255.255.252', 'Roma'),
    ]);
    expect(wan.links).toHaveLength(1);
  });

  it('makes a segment of a subnet shared by more than two devices, and no link from a duplicate', () => {
    const segment = correlate([
      vlan('SW-A', '10.0.0.1', '255.255.255.0', 'Sede'),
      vlan('SW-B', '10.0.0.2', '255.255.255.0', 'Sede'),
      vlan('SW-C', '10.0.0.3', '255.255.255.0', 'Sede'),
    ]);
    expect(segment.externals).toEqual([
      { id: 'net:10.0.0.0/24', kind: 'segment', label: '10.0.0.0/24', site: 'sede' },
    ]);
    expect(segment.links).toHaveLength(3);
    const duplicate = correlate([
      vlan('SW-A', '10.0.0.1', '255.255.255.0', 'Sede'),
      vlan('SW-B', '10.0.0.1', '255.255.255.0', 'Sede'),
    ]);
    expect(duplicate.links).toEqual([]);
  });
});

describe('tunnels and BGP', () => {
  const hub = forti(`config system global
    set hostname "FGT-HUB"
end
config system ddns
    edit 1
        set ddns-server FortiGuardDDNS
        set ddns-domain "hub-esempio.fortiddns.com"
        set monitor-interface "wan1"
    next
end
config system interface
    edit "wan1"
        set vdom "root"
        set mode dhcp
        set role wan
    next
end
config vpn ipsec phase1-interface
    edit "SPOKES"
        set type dynamic
        set interface "wan1"
        set ike-version 2
    next
end`);
  const spoke = forti(`config system global
    set hostname "FGT-SPOKE"
end
config system interface
    edit "wan1"
        set vdom "root"
        set ip 192.0.2.10 255.255.255.252
        set role wan
    next
end
config vpn ipsec phase1-interface
    edit "HUB"
        set type ddns
        set interface "wan1"
        set ike-version 2
        set remotegw-ddns "hub-esempio.fortiddns.com"
    next
    edit "PARTNER"
        set interface "wan1"
        set ike-version 2
        set remote-gw 198.51.100.200
    next
end
config router bgp
    set as 65010
    config neighbor
        edit "203.0.113.9"
            set remote-as 64496
            set description "Provider A"
        next
    end
end`);

  it('finds the peer of a tunnel by its DDNS name, and keeps peers outside the client', () => {
    const infra = correlate([hub, spoke]);
    const tunnels = infra.links.filter((l) => l.kind === 'ipsec').map(linkText);
    expect(tunnels).toEqual([
      'ipsec | fgt-spoke wan1 tunnel HUB 192.0.2.10 | fgt-hub wan1 tunnel SPOKES | ddns | dial-up',
      'ipsec | fgt-spoke wan1 tunnel PARTNER 192.0.2.10 | peer:198.51.100.200 198.51.100.200 | remote-gw',
    ]);
    expect(infra.externals.map((e) => `${e.id} ${e.label} ${e.detail ?? ''}`.trim())).toEqual([
      'as:64496 AS 64496 Provider A',
      'internet Internet',
      'peer:198.51.100.200 198.51.100.200',
    ]);
  });
});

describe('sites', () => {
  it('reads the site from the SNMP location and the code from the hostname', () => {
    expect(siteFromLocation('Sede - CED piano terra - rack R2')).toBe('Sede');
    expect(siteFromLocation('Milano, Via Roma 1')).toBe('Milano');
    expect(siteFromLocation('Filiale-1')).toBe('Filiale-1');
    expect(siteFromLocation('  ')).toBeUndefined();
    expect(siteCode('SW-BR1-ACC')).toBe('BR1');
    expect(siteCode('FGT-HQ')).toBe('HQ');
    expect(siteCode('MI-FW01')).toBe('MI');
    expect(siteCode('FW01')).toBeUndefined();
  });

  it('goes along the cables to the devices without location or code', () => {
    const infra = correlate([
      sw('SW-A', 'interface GigabitEthernet1/0/1\n description SW01\n!', 'Torino - CED'),
      sw('SW01', 'interface GigabitEthernet1/0/1\n!'),
    ]);
    expect(infra.sites).toEqual([
      { id: 'torino', name: 'Torino', source: 'snmp', devices: ['sw-a', 'sw01'] },
    ]);
  });
});

describe('performance', () => {
  it('correlates a client of 150 devices in less than a second', () => {
    const inputs: CorrelationInput[] = [];
    for (let s = 1; s <= 30; s++) {
      const fw = `FGT-S${s}`;
      inputs.push(
        forti(`config system global
    set hostname "${fw}"
end
config system snmp sysinfo
    set location "Sito ${s} - armadio"
end
config system interface
    edit "wan1"
        set vdom "root"
        set ip 198.18.${s}.2 255.255.255.252
        set role wan
    next
    edit "lan"
        set vdom "root"
        set ip 10.${s}.0.1 255.255.255.0
        set description "SW-S${s}-CORE"
    next
    edit "HUB"
        set vdom "root"
        set type tunnel
        set ip 10.255.0.${s} 255.255.255.255
        set remote-ip 10.255.0.254 255.255.255.0
        set interface "wan1"
    next
end
config vpn ipsec phase1-interface
    edit "HUB"
        set interface "wan1"
        set ike-version 2
        set remote-gw 198.18.0.2
    next
end
config router bgp
    set as 65000
    config neighbor
        edit "10.255.0.254"
            set remote-as 65000
        next
    end
end`),
      );
      for (let n = 0; n < 4; n++) {
        const name = n === 0 ? `SW-S${s}-CORE` : `SW-S${s}-ACC${n}`;
        const uplink = n === 0 ? fw : `SW-S${s}-CORE`;
        inputs.push(
          sw(
            name,
            [
              `interface GigabitEthernet1/0/48\n description UPLINK-${uplink}\n switchport mode trunk\n!`,
              `interface Vlan99\n ip address 10.${s}.99.${n + 2} 255.255.255.0\n!`,
              ...Array.from(
                { length: 40 },
                (_, p) => `interface GigabitEthernet1/0/${p + 1}\n switchport access vlan 10\n!`,
              ),
            ].join('\n'),
          ),
        );
      }
    }
    expect(inputs).toHaveLength(150);
    const start = performance.now();
    const infra = correlate(inputs);
    const elapsed = performance.now() - start;
    expect(infra.devices).toHaveLength(150);
    expect(infra.sites).toHaveLength(30);
    expect(infra.links.filter((l) => l.kind === 'cable')).toHaveLength(120);
    expect(elapsed).toBeLessThan(1000);
  });
});

import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  bannerDelimiter,
  buildOutline,
  foldRanges,
  parseFortios,
  parseIndented,
  parseShow,
  splitLines,
  type SyntaxNode,
  type SyntaxTree,
} from '../src';
import { readSampleText, sampleFiles } from './helpers';

/** Compact view of a tree: "line-endLine text" with children nested. */
function shape(nodes: SyntaxNode[]): unknown[] {
  return nodes.map((n) =>
    n.children.length > 0
      ? [`${n.line}-${n.endLine} ${n.text}`, shape(n.children)]
      : `${n.line}-${n.endLine} ${n.text}`,
  );
}

const fortios = (text: string) => parseFortios(splitLines(text));
const indented = (text: string, dialect: 'cisco' | 'cisco-sb' = 'cisco') =>
  parseIndented(splitLines(text), dialect);

/** Every non-empty line belongs to exactly one top-level node, in order and without overlaps. */
function expectFullCoverage(tree: SyntaxTree, lines: string[], label: string) {
  let previousEnd = 0;
  for (const node of tree.nodes) {
    expect(node.line, label).toBeGreaterThan(previousEnd);
    expect(node.endLine, label).toBeGreaterThanOrEqual(node.line);
    for (let l = previousEnd + 1; l < node.line; l++) {
      expect(lines[l - 1]!.trim(), `${label}: line ${l} outside any node`).toBe('');
    }
    previousEnd = node.endLine;
  }
  for (let l = previousEnd + 1; l <= lines.length; l++) {
    expect(lines[l - 1]!.trim(), `${label}: line ${l} outside any node`).toBe('');
  }
}

describe('FortiOS syntax', () => {
  it('nests config, edit and nested config blocks', () => {
    const tree = fortios(
      [
        'config system interface',
        '    edit "port1"',
        '        set ip 10.0.0.1 255.255.255.0',
        '        config ipv6',
        '            set ip6-mode static',
        '        end',
        '    next',
        'end',
      ].join('\n'),
    );
    expect(shape(tree.nodes)).toEqual([
      [
        '1-8 config system interface',
        [
          [
            '2-7 edit "port1"',
            ['3-3 set ip 10.0.0.1 255.255.255.0', ['4-6 config ipv6', ['5-5 set ip6-mode static']]],
          ],
        ],
      ],
    ]);
    expect(tree.diagnostics).toEqual([]);
  });

  it('keeps multi-line quoted values together, with escaped quotes', () => {
    const tree = fortios(
      [
        'config system replacemsg admin "pre_admin-disclaimer-text"',
        '    set buffer "<p>Sistema \\"riservato\\"',
        'config finta dentro la stringa',
        'end"',
        '    set format html',
        'end',
      ].join('\n'),
    );
    expect(shape(tree.nodes)).toEqual([
      [
        '1-6 config system replacemsg admin "pre_admin-disclaimer-text"',
        ['2-4 set buffer "<p>Sistema \\"riservato\\"', '5-5 set format html'],
      ],
    ]);
  });

  it('follows the multi-VDOM layout where nested blocks start at column 0', () => {
    const tree = fortios(
      [
        'config vdom',
        'edit root',
        'next',
        'end',
        'config global',
        'config system global',
        '    set hostname "A"',
        'end',
        'end',
        'config vdom',
        'edit root',
        'config firewall policy',
        'end',
        'next',
        'end',
      ].join('\n'),
    );
    expect(shape(tree.nodes)).toEqual([
      ['1-4 config vdom', ['2-3 edit root']],
      ['5-9 config global', [['6-8 config system global', ['7-7 set hostname "A"']]]],
      ['10-15 config vdom', [['11-14 edit root', ['12-13 config firewall policy']]]],
    ]);
  });

  it('recovers from a quote that is never closed', () => {
    const tree = fortios(
      ['config system global', '    set alias "rotto', '    set hostname "A"', 'end'].join('\n'),
    );
    expect(tree.diagnostics).toEqual([{ line: 2, code: 'unterminated-string' }]);
    expect(shape(tree.nodes)).toEqual([
      ['1-4 config system global', ['2-2 set alias "rotto', '3-3 set hostname "A"']],
    ]);
  });

  it('reports unexpected and missing closing keywords', () => {
    const tree = fortios(['next', 'config a', '    edit 1', 'end', 'end', 'config b'].join('\n'));
    expect(tree.diagnostics).toEqual([
      { line: 1, code: 'unexpected-close' },
      { line: 3, code: 'unclosed-block' },
      { line: 5, code: 'unexpected-close' },
      { line: 6, code: 'unclosed-block' },
    ]);
  });
});

describe('indentation syntax', () => {
  it('nests by indentation and keeps "!" lines as comments', () => {
    const tree = indented(
      [
        'interface Gi1/0/1',
        ' description PC',
        ' switchport mode access',
        '!',
        'router bgp 65000',
        ' address-family ipv4',
        '  neighbor 10.0.0.1 activate',
        ' exit-address-family',
        'end',
      ].join('\n'),
    );
    expect(shape(tree.nodes)).toEqual([
      ['1-3 interface Gi1/0/1', ['2-2 description PC', '3-3 switchport mode access']],
      '4-4 !',
      [
        '5-8 router bgp 65000',
        [
          ['6-7 address-family ipv4', ['7-7 neighbor 10.0.0.1 activate']],
          '8-8 exit-address-family',
        ],
      ],
      '9-9 end',
    ]);
  });

  it('reads banners with ^C, ETX or another delimiter, also on one line', () => {
    const tree = indented(
      [
        'banner motd ^C',
        'Benvenuti',
        '  testo indentato',
        '^C',
        'banner exec \u0003',
        'riga',
        '\u0003',
        'banner login #Una riga#',
        'banner motd Solo testo ASA',
        'hostname A',
      ].join('\n'),
    );
    expect(shape(tree.nodes)).toEqual([
      '1-4 banner motd ^C',
      '5-7 banner exec \u0003',
      '8-8 banner login #Una riga#',
      '9-9 banner motd Solo testo ASA',
      '10-10 hostname A',
    ]);
    expect(bannerDelimiter('banner motd ^CHello^C')).toEqual({
      delimiter: '^C',
      closedOnSameLine: true,
    });
  });

  it('keeps "quit" with the certificate hex lines and PEM blocks together', () => {
    const tree = indented(
      [
        'crypto pki certificate chain TP-1',
        ' certificate self-signed 01',
        '  3082 0330',
        '  3082 0218',
        '  \tquit',
        'crypto ca import',
        '-----BEGIN CERTIFICATE-----',
        'MIIB',
        '-----END CERTIFICATE-----',
        'hostname A',
      ].join('\n'),
    );
    expect(shape(tree.nodes)).toEqual([
      [
        '1-5 crypto pki certificate chain TP-1',
        [['2-5 certificate self-signed 01', ['3-3 3082 0330', '4-4 3082 0218', '5-5 quit']]],
      ],
      '6-6 crypto ca import',
      '7-9 -----BEGIN CERTIFICATE-----',
      '10-10 hostname A',
    ]);
  });

  it('reads Small Business blocks closed by "exit", the header and the control markers', () => {
    const tree = indented(
      [
        'config-file-header',
        'SW-A',
        'v3.4.1.3 / RCBS3.4.1.3',
        '@',
        'ssd-control-start',
        'ssd config',
        'ssd-control-end abc',
        'vlan database',
        'vlan 10,20',
        'exit',
        'hostname SW-A',
        'interface vlan 10',
        ' name DATI',
        '!',
        'exit',
      ].join('\n'),
      'cisco-sb',
    );
    expect(shape(tree.nodes)).toEqual([
      '1-4 config-file-header',
      '5-7 ssd-control-start',
      ['8-10 vlan database', ['9-9 vlan 10,20']],
      '11-11 hostname SW-A',
      ['12-13 interface vlan 10', ['13-13 name DATI']],
      '14-14 !',
      '15-15 exit',
    ]);
    expect(tree.diagnostics).toEqual([]);
  });

  it('closes a Small Business block whose "exit" is missing', () => {
    const tree = indented(
      ['line ssh', 'exec-timeout 30', 'interface vlan 1', ' name A', '!'].join('\n'),
      'cisco-sb',
    );
    expect(tree.diagnostics).toEqual([{ line: 1, code: 'unclosed-block' }]);
    expect(shape(tree.nodes)[0]).toEqual(['1-2 line ssh', ['2-2 exec-timeout 30']]);
  });

  it('recovers from a banner that is never closed', () => {
    const tree = indented(['banner motd ^C', 'testo', 'hostname A'].join('\n'));
    expect(tree.diagnostics).toEqual([{ line: 1, code: 'unterminated-banner' }]);
    expect(shape(tree.nodes)).toEqual(['1-1 banner motd ^C', '2-2 testo', '3-3 hostname A']);
  });
});

describe('command output', () => {
  it('makes one block for each command', () => {
    const tree = parseShow(
      splitLines('SW#show clock\n10:00:00 CET\n\nSW#show users\nLine User\n\nSW#'),
    );
    expect(shape(tree.nodes)).toEqual(['1-2 SW#show clock', '4-5 SW#show users']);
  });
});

describe('structure of the samples', () => {
  for (const rel of sampleFiles()) {
    it(`parses ${rel} without errors and covers every line`, () => {
      const text = readSampleText(rel);
      const lines = splitLines(text);
      const analysis = analyzeText(text);
      expect(analysis.tree.diagnostics).toEqual([]);
      if (analysis.tree.family === 'fortios' || analysis.tree.family === 'indent') {
        expectFullCoverage(analysis.tree, lines, rel);
      }
      const folds = analysis.folds;
      for (let i = 0; i < folds.length; i += 2) {
        expect(folds[i]!).toBeLessThan(folds[i + 1]!);
        expect(folds[i + 1]!).toBeLessThanOrEqual(lines.length);
      }
    });
  }

  it('outlines a multi-VDOM FortiGate: global settings, VDOMs and their blocks', () => {
    const analysis = analyzeText(readSampleText('fortigate/fgt-hq-100f-fortios-7.2-vdom.conf'));
    const entries = analysis.outline.entries.map((e) => `${e.depth} ${e.label}`);
    expect(entries.slice(0, 6)).toEqual([
      '0 config vdom',
      '1 edit root',
      '1 edit OFFICE',
      '1 edit DMZ',
      '0 config global',
      '1 config system global',
    ]);
    expect(entries).toContain('1 edit OFFICE');
    expect(entries).toContain('2 config firewall policy');
    expect(entries).toContain('3 config neighbor-group');
    expect(entries.some((e) => e.includes('edit "port10"'))).toBe(false);
  });

  it('outlines the Cisco blocks: interfaces, lines, banner', () => {
    const analysis = analyzeText(
      readSampleText('cisco-ios/sw-hq-core-c9300-iosxe-17.12-stack.txt'),
    );
    const labels = analysis.outline.entries.map((e) => e.label);
    expect(labels).toContain('interface Port-channel1');
    expect(labels).toContain('interface GigabitEthernet3/0/48');
    expect(labels).toContain('banner motd ^C');
    expect(labels).toContain('line vty 0 4');
    expect(labels.filter((l) => l.startsWith('interface GigabitEthernet')).length).toBe(145);
  });

  it('uses the Small Business dialect for Small Business files', () => {
    const analysis = analyzeText(readSampleText('cisco-sb/sw-br3-acc-cbs350-48p-3.4-stack.txt'));
    const vlanDb = analysis.tree.nodes.find((n) => n.text === 'vlan database')!;
    expect(vlanDb.children.map((c) => c.text)).toEqual(['vlan 10,20,60,70,99']);
    expect(buildOutline(analysis.tree).entries.map((e) => e.label)).toContain(
      'management access-list MGMT',
    );
  });

  it('builds fold ranges as [first, last] pairs', () => {
    const tree = fortios('config a\n    edit 1\n    next\nend\n');
    expect(Array.from(foldRanges(tree))).toEqual([1, 4, 2, 3]);
  });
});

describe('large files', () => {
  it('analyses a 20 MB FortiOS configuration quickly', () => {
    const policy = (id: number) =>
      [
        `    edit ${id}`,
        `        set name "regola-${id}"`,
        `        set uuid 5e1e0000-0000-51ef-8000-${id.toString(16).padStart(12, '0')}`,
        '        set srcintf "port1"',
        '        set dstintf "port2"',
        '        set action accept',
        `        set srcaddr "net-${id % 500}"`,
        '        set dstaddr "all"',
        '        set schedule "always"',
        '        set service "HTTPS"',
        '        set logtraffic all',
        '    next',
      ].join('\n');
    const parts = [
      '#config-version=FG100F-7.4.4-FW-build2662-240514:opmode=0:vdom=0:user=admin',
      'config firewall policy',
    ];
    let size = 0;
    for (let id = 1; size < 20 * 1024 * 1024; id++) {
      const p = policy(id);
      parts.push(p);
      size += p.length + 1;
    }
    parts.push('end', '');
    const text = parts.join('\n');
    const started = performance.now();
    const analysis = analyzeText(text);
    const elapsed = performance.now() - started;
    expect(analysis.detection.os?.value).toBe('fortios');
    expect(analysis.tree.nodes[1]!.children.length).toBeGreaterThan(50_000);
    expect(analysis.tree.diagnostics).toEqual([]);
    expect(elapsed).toBeLessThan(15_000);
  });
});

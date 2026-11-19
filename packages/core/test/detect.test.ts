import { describe, expect, it } from 'vitest';
import { detect, splitLines, type Detected, type Detection } from '../src';
import { expectedDetections, readSampleText, sampleFiles } from './helpers';

const FIELDS = [
  'vendor',
  'os',
  'version',
  'build',
  'model',
  'hostname',
  'stack',
  'vdoms',
  'encrypted',
] as const;

function summary(d: Detection) {
  const out: Record<string, unknown> = { kind: d.kind.value };
  for (const field of FIELDS) {
    const value = d[field] as Detected<unknown> | undefined;
    if (value !== undefined) out[field] = value.value;
  }
  if (d.commands) out.commands = d.commands.map((c) => c.command);
  return out;
}

const run = (text: string) => detect(splitLines(text));

describe('detection of the samples', () => {
  const expected = expectedDetections();

  it('has an expectation for every sample', () => {
    expect(Object.keys(expected).sort()).toEqual(sampleFiles());
  });

  for (const [rel, exp] of Object.entries(expected)) {
    it(`recognises ${rel}`, () => {
      expect(summary(run(readSampleText(rel)))).toEqual(exp);
    });
  }

  it('points every value to the line it comes from', () => {
    for (const rel of sampleFiles()) {
      const lines = splitLines(readSampleText(rel));
      const d = detect(lines);
      for (const field of ['kind', ...FIELDS] as const) {
        const value = d[field] as Detected<unknown> | undefined;
        if (!value?.evidence.line) continue;
        const line = lines[value.evidence.line - 1]!;
        expect(line.trim(), `${rel} ${field}`).toBe(value.evidence.excerpt);
      }
    }
  });
});

describe('detection rules', () => {
  it('distinguishes IOS and IOS-XE from the version line', () => {
    expect(run('version 15.2\nhostname A\n').os?.value).toBe('ios');
    expect(run('version 16.12\nhostname A\n').os?.evidence.rule).toBe('cisco.version-xe');
    expect(run('version 17.15\nhostname A\n').os?.value).toBe('ios-xe');
  });

  it('takes the model from "license udi" when there is no provision line', () => {
    const d = run('version 17.9\nhostname R1\nlicense udi pid ISR4331/K9 sn FDO0000X0AA\n');
    expect(d.model?.value).toBe('ISR4331/K9');
    expect(d.model?.evidence.rule).toBe('cisco.license-udi');
  });

  it('recognises NX-OS and ASA even if they are not read yet', () => {
    const nxos = run(
      '!Command: show running-config\n!Time: Mon Oct 6 10:00:00 2025\n\nversion 9.3(8) Bios:version 05.45\nhostname N9K-01\nfeature lacp\n',
    );
    expect(summary(nxos)).toMatchObject({
      kind: 'config',
      vendor: 'cisco',
      os: 'nx-os',
      version: '9.3(8)',
      hostname: 'N9K-01',
    });
    const asa = run(
      ': Saved\n:\n: Serial Number: JAD000000AA\n: Hardware:   ASA5516, 8192 MB RAM, CPU Atom C2000 series 2416 MHz\n:\nASA Version 9.16(4)\n!\nhostname ASA-01\n',
    );
    expect(summary(asa)).toMatchObject({
      kind: 'config',
      os: 'asa',
      version: '9.16(4)',
      model: 'ASA5516',
      hostname: 'ASA-01',
    });
  });

  it('reads FortiOS without header from its syntax', () => {
    const d = run(
      'config system global\n    set hostname "FGT-X"\nend\nconfig system interface\n    edit "port1"\n        set ip 10.0.0.1 255.255.255.0\n    next\nend\n',
    );
    expect(summary(d)).toEqual({ kind: 'config', vendor: 'fortinet', hostname: 'FGT-X' });
    expect(d.syntax).toBe('fortios');
  });

  it('maps FortiOS platform codes to models', () => {
    const model = (platform: string) =>
      run(
        `#config-version=${platform}-7.2.8-FW-build1639-240313:opmode=0:vdom=0:user=admin\nconfig system global\nend\n`,
      ).model?.value;
    expect(model('FGT40F')).toBe('FortiGate-40F');
    expect(model('FG100F')).toBe('FortiGate-100F');
    expect(model('FWF61F')).toBe('FortiWiFi-61F');
    expect(model('FGVM64')).toBe('FortiGate-VM64');
    const fsw = run(
      '#config-version=FS1E48-7.2.5-FW-build0453-230707:user=admin\nconfig system global\nend\n',
    );
    expect(fsw.os?.value).toBe('fortiswitchos');
  });

  it('recognises an encrypted FortiGate backup that keeps a text header', () => {
    const d = run(
      '#config-version=FGT60F-7.4.3-FW-build2573-240201:opmode=0:vdom=0:user=admin\n#conf_file_ver=1\n#buildno=2573\n#global_vdom=1\nU2FsdGVkX1+abcdefghijklmnopqrstuvwxyz0123456789ABCDEF\nQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=\n',
    );
    expect(d.encrypted?.value).toBe(true);
    expect(d.syntax).toBe('plain');
    expect(d.version?.value).toBe('7.4.3');
  });

  it('treats "show running-config" with a prompt as a configuration', () => {
    const d = run(
      'SW-PROMPT#show running-config\nBuilding configuration...\n\nCurrent configuration : 100 bytes\n!\nversion 17.9\n!\ninterface Vlan1\n!\nend\n\nSW-PROMPT#',
    );
    expect(summary(d)).toEqual({
      kind: 'config',
      vendor: 'cisco',
      os: 'ios-xe',
      version: '17.9',
      hostname: 'SW-PROMPT',
    });
    expect(d.hostname?.evidence.rule).toBe('show.prompt');
  });

  it('does not take the software version of CDP neighbours as the device version', () => {
    const d = run(readSampleText('show/sw-hq-core_show-cdp-lldp-neighbors.txt'));
    expect(d.os).toBeUndefined();
    expect(d.version).toBeUndefined();
  });

  it('marks commands recognised without a prompt as inferred', () => {
    const d = run(readSampleText('show/sw-br1-acc_show-vlan-brief-senza-prompt.txt'));
    expect(d.commands).toEqual([{ command: 'show vlan brief', line: 2, inferred: true }]);
  });

  it('reports unknown text as unknown', () => {
    const d = run('Lista della spesa\n- pane\n- latte\n');
    expect(d).toEqual({ kind: { value: 'unknown', evidence: { rule: 'none' } }, syntax: 'plain' });
  });
});

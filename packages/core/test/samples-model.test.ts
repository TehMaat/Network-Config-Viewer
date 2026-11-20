import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyzeText,
  buildModel,
  formatPrefix,
  formatVlanSet,
  hasDriver,
  modelHints,
  splitLines,
  type DeviceModel,
  type Element,
} from '../src';
import { readSampleText, SAMPLES_DIR, sampleFiles } from './helpers';

// The expected model of every sample config, in a compact form that can be read and checked
// by hand. After a deliberate change of a driver or of a sample, rewrite it with
// NCV_UPDATE_EXPECTED=1 npx vitest run test/samples-model.test.ts and review the diff.
const EXPECTED = join(SAMPLES_DIR, 'expected-models.json');

function modelOf(rel: string): { lines: string[]; model: DeviceModel | null } {
  const text = readSampleText(rel);
  const lines = splitLines(text);
  const analysis = analyzeText(text);
  return { lines, model: buildModel(lines, analysis.tree, modelHints(analysis.detection)) };
}

const count = (values: string[]) => {
  const out: Record<string, number> = {};
  for (const v of [...values].sort()) out[v] = (out[v] ?? 0) + 1;
  return out;
};

export function summarize(m: DeviceModel) {
  const ctx = m.contexts[0]!;
  const r = ctx.routing;
  return {
    hostname: m.hostname,
    model: m.model,
    version: m.version,
    stack: m.stack.map((s) => (s.model ? `${s.member} ${s.model}` : String(s.member))),
    management: m.management ? `${m.management.ip} ${m.management.interface ?? ''}`.trim() : null,
    features: m.features,
    warnings: m.warnings.map((w) => w.code),
    interfaces: {
      kinds: count(m.interfaces.map((i) => i.kind)),
      modes: count(m.interfaces.flatMap((i) => (i.switchport ? [i.switchport.mode] : []))),
      shutdown: m.interfaces.filter((i) => i.shutdown).length,
      uplinks: m.interfaces.filter((i) => i.position?.uplink).map((i) => i.name),
      lags: m.interfaces
        .filter((i) => i.kind === 'lag')
        .map((i) => `${i.name}: ${(i.members ?? []).join(' ')}`),
      layer3: m.interfaces
        .filter((i) => i.ipv4.length > 0)
        .map((i) => `${i.name} ${i.ipv4.map((a) => `${a.ip}/${a.prefix}`).join(' ')}`),
      poe: count(m.interfaces.flatMap((i) => (i.poe ? [i.poe.mode] : []))),
      dot1x: m.interfaces.filter((i) => i.dot1x).length,
      portSecurity: m.interfaces.filter((i) => i.portSecurity).length,
      voice: m.interfaces.filter((i) => i.switchport?.voiceVlan !== undefined).length,
      trunks: count(
        m.interfaces.flatMap((i) =>
          i.switchport?.allowed && i.switchport.mode !== 'dynamic-auto'
            ? [
                `${i.switchport.mode} ${i.switchport.allowed.all ? 'all' : formatVlanSet(i.switchport.allowed)}`,
              ]
            : [],
        ),
      ),
      withDefaults: m.interfaces.filter((i) => i.defaults).length,
      unverified: count(m.interfaces.flatMap((i) => i.unverified ?? [])),
    },
    vlans: m.vlans.map(
      (v) =>
        `${v.id}${v.name ? ` ${v.name}` : ''}${v.implicit ? ' (implicit)' : ''}${v.voice ? ' (voice)' : ''}`,
    ),
    acls: ctx.acls.map(
      (a) =>
        `${a.name} ${a.type} ${a.entries.length}: ${a.bindings
          .map((b) =>
            b.kind === 'interface'
              ? `${b.interface} ${b.direction}`
              : b.kind === 'line'
                ? `line ${b.line}`
                : b.kind === 'route-map'
                  ? `route-map ${b.name}`
                  : b.kind,
          )
          .join(', ')}`,
    ),
    objectGroups: ctx.objectGroups.map((g) => `${g.name} ${g.type} ${g.entries.length}`),
    routing: {
      statics: r.statics.map(
        (s) =>
          `${s.vrf ? `vrf ${s.vrf} ` : ''}${formatPrefix(s.dst)} ${[s.device, s.gateway].filter(Boolean).join(' ')}${s.distance ? ` ad ${s.distance}` : ''}${s.kind === 'default-gateway' ? ' (default-gateway)' : ''}`,
      ),
      policyRoutes: r.policyRoutes.map((p) => `${p.interface} route-map ${p.routeMap}`),
      ospf: r.ospf.map(
        (o) =>
          `${o.process} networks ${o.networks.map((n) => `${n.prefix} area ${n.area}`).join(', ')}; interfaces ${o.interfaces
            .map((i) => `${i.name}${i.passive ? ' passive' : ''}`)
            .join(', ')}`,
      ),
      bgp: r.bgp
        ? `${r.bgp.asn} neighbors ${r.bgp.neighbors.length} groups ${r.bgp.groups.length}`
        : null,
      routeMaps: r.routeMaps.map((x) => `${x.name} ${x.entries.length}`),
      prefixLists: r.prefixLists.map((x) => `${x.name} ${x.entries.length}`),
    },
    references: m.references.length,
    coverage: {
      total: m.coverage.total,
      understood: m.coverage.understood,
      ignored: m.coverage.ignored,
      unknown: m.coverage.unknown,
    },
  };
}

/** Every element of the model with its lines, for the checks on the line ranges. */
function elements(m: DeviceModel): Element[] {
  const ctx = m.contexts[0]!;
  return [
    ...m.interfaces,
    ...m.vlans,
    ...m.stack,
    ...ctx.acls,
    ...ctx.acls.flatMap((a) => a.entries),
    ...ctx.objectGroups,
    ...ctx.routing.statics,
    ...ctx.routing.ospf,
    ...ctx.routing.routeMaps,
    ...ctx.routing.prefixLists,
    ...ctx.routing.policyRoutes,
    ...(ctx.routing.bgp ? [ctx.routing.bgp, ...ctx.routing.bgp.neighbors] : []),
  ];
}

const configs = sampleFiles().filter((rel) => {
  const d = analyzeText(readSampleText(rel)).detection;
  return d.kind.value === 'config' && hasDriver(d.os?.value);
});

describe('model of the samples', () => {
  const update = process.env.NCV_UPDATE_EXPECTED === '1';
  const expected = update
    ? {}
    : (JSON.parse(readFileSync(EXPECTED, 'utf8')) as Record<string, unknown>);
  const actual: Record<string, unknown> = {};

  it('has an expected model for every sample config with a driver', () => {
    for (const rel of configs) actual[rel] = summarize(modelOf(rel).model!);
    if (update) writeFileSync(EXPECTED, JSON.stringify(actual, null, 2) + '\n');
    else expect(Object.keys(expected).sort()).toEqual(configs);
  });

  for (const rel of configs) {
    it(`builds the expected model of ${rel}`, () => {
      const { model } = modelOf(rel);
      expect(model).not.toBeNull();
      if (!update) expect(summarize(model!)).toEqual(expected[rel]);
    });

    it(`keeps the lines of every element of ${rel} inside the file`, () => {
      const { lines, model } = modelOf(rel);
      const m = model!;
      for (const el of elements(m)) {
        for (const [first, last] of el.src) {
          expect(first).toBeGreaterThanOrEqual(1);
          expect(last).toBeGreaterThanOrEqual(first);
          expect(last).toBeLessThanOrEqual(lines.length);
        }
      }
      for (const ref of m.references) {
        const raw = lines[ref.line - 1]!;
        expect(ref.to).toBeLessThanOrEqual(raw.length);
        expect(lines[ref.targetLine - 1]!.trim().length).toBeGreaterThan(0);
      }
      const c = m.coverage;
      expect(c.total).toBe(c.understood + c.ignored + c.unknown);
      expect(c.sections.reduce((n, s) => n + s.lines, 0)).toBe(c.unknown);
    });
  }
});

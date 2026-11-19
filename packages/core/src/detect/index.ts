import { detectAsa, detectCiscoSb, detectCiscoSyntax, detectIos, detectNxos } from './cisco';
import { detectFortiosHeader, detectFortiosSyntax } from './fortios';
import { detectShowSignature, detectShowWithPrompts, findPrompts, isConfigDump } from './show';
import { syntaxFor, type Detection } from './types';
import { detected } from './util';

export * from './types';

const CONFIG_DETECTORS = [
  detectFortiosHeader,
  detectCiscoSb,
  detectAsa,
  detectNxos,
  detectIos,
  detectFortiosSyntax,
  detectCiscoSyntax,
];

/**
 * Recognises what a text file contains: a configuration, the output of show commands or
 * something unknown, with vendor, operating system, version, model and host name when present.
 * Every value carries the rule and the line it comes from.
 */
export function detect(lines: string[]): Detection {
  const prompts = findPrompts(lines);

  if (prompts.length > 0 && prompts.every(isConfigDump)) {
    // "show running-config" or FortiOS "show": the output is a configuration.
    const config = detectConfig(lines);
    const first = prompts[0]!;
    if (config) {
      config.hostname ??= detected(first.hostname, 'show.prompt', first.index, lines);
      return config;
    }
    const vendor = detected(first.vendor, 'show.prompt', first.index, lines);
    return {
      kind: detected('config', 'show.prompt', first.index, lines),
      vendor,
      hostname: detected(first.hostname, 'show.prompt', first.index, lines),
      syntax: syntaxFor('config', undefined, first.vendor),
    };
  }
  if (prompts.length > 0) return detectShowWithPrompts(lines, prompts);

  return (
    detectConfig(lines) ??
    detectShowSignature(lines) ?? {
      kind: { value: 'unknown', evidence: { rule: 'none' } },
      syntax: 'plain',
    }
  );
}

function detectConfig(lines: string[]): Detection | null {
  for (const detector of CONFIG_DETECTORS) {
    const result = detector(lines);
    if (result) return result;
  }
  return null;
}

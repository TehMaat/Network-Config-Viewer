import {
  syntaxFor,
  vendorOf,
  type Detected,
  type Detection,
  type Evidence,
  type FileKind,
  type OsId,
  type ShowCommand,
  type SyntaxFamily,
  type Vendor,
} from '@ncv/core';
import type { Overrides } from './files';

export type FieldSource = 'detected' | 'manual' | 'none';

export interface Field<T> {
  value?: T;
  source: FieldSource;
  evidence?: Evidence;
}

/** What the interface shows: the automatic recognition, corrected by the user where needed. */
export interface EffectiveDetection {
  kind: Field<FileKind>;
  vendor: Field<Vendor>;
  os: Field<OsId>;
  version: Field<string>;
  build: Field<string>;
  model: Field<string>;
  hostname: Field<string>;
  stack: Field<number>;
  vdoms: Field<string[]>;
  commands: ShowCommand[];
  encrypted: boolean;
  edited: boolean;
}

function detectedField<T>(d: Detected<T> | undefined): Field<T> {
  return d ? { value: d.value, source: 'detected', evidence: d.evidence } : { source: 'none' };
}

function textField(
  detectedValue: Detected<string> | undefined,
  override: string | undefined,
): Field<string> {
  if (override === undefined) return detectedField(detectedValue);
  return override.trim() === ''
    ? { source: 'manual' }
    : { value: override.trim(), source: 'manual' };
}

export function effectiveDetection(detection: Detection, overrides: Overrides): EffectiveDetection {
  const kind: Field<FileKind> =
    overrides.kind !== undefined
      ? { value: overrides.kind, source: 'manual' }
      : detectedField(detection.kind);

  let os: Field<OsId>;
  let vendor: Field<Vendor>;
  if (overrides.os !== undefined) {
    os = overrides.os === '' ? { source: 'manual' } : { value: overrides.os, source: 'manual' };
    vendor =
      overrides.os === ''
        ? { source: 'manual' }
        : { value: vendorOf(overrides.os), source: 'manual' };
  } else {
    os = detectedField(detection.os);
    vendor = detectedField(detection.vendor);
  }

  const versionOverridden = overrides.version !== undefined;
  return {
    kind,
    vendor,
    os,
    version: textField(detection.version, overrides.version),
    // A version typed by hand makes the detected build meaningless.
    build: versionOverridden ? { source: 'none' } : detectedField(detection.build),
    model: textField(detection.model, overrides.model),
    hostname: textField(detection.hostname, overrides.hostname),
    stack: detectedField(detection.stack),
    vdoms: detectedField(detection.vdoms),
    commands: detection.commands ?? [],
    encrypted: detection.encrypted?.value === true,
    edited: Object.values(overrides).some((v) => v !== undefined),
  };
}

/** The syntax family to use for the viewer, after the user's corrections. */
export function effectiveFamily(effective: EffectiveDetection): SyntaxFamily {
  if (effective.encrypted) return 'plain';
  return syntaxFor(effective.kind.value ?? 'unknown', effective.os.value, effective.vendor.value);
}

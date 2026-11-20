import type { Detection, FileKind, OsId } from '../detect/types';
import type { DeviceModel } from '../model/types';
import type { SyntaxTree } from '../syntax/types';
import { buildCiscoModel } from './cisco';

export { buildCiscoModel, parseAclEntry, poeCapable, type DriverInput } from './cisco';
export { DriverContext, findWord, type SymbolKind } from './context';
export * from './defaults';

/** Operating systems that have a driver: the others are only shown as text. */
export const MODEL_OS: readonly OsId[] = ['ios', 'ios-xe', 'cisco-sb'];

export function hasDriver(os: OsId | undefined): os is OsId {
  return os !== undefined && MODEL_OS.includes(os);
}

/** What the driver needs to know about a file: recognised, or corrected by the user. */
export interface ModelHints {
  kind?: FileKind;
  os?: OsId;
  version?: string;
  model?: string;
  hostname?: string;
}

export function modelHints(detection: Detection): ModelHints {
  return {
    kind: detection.kind.value,
    ...(detection.os ? { os: detection.os.value } : {}),
    ...(detection.version ? { version: detection.version.value } : {}),
    ...(detection.model ? { model: detection.model.value } : {}),
    ...(detection.hostname ? { hostname: detection.hostname.value } : {}),
  };
}

/**
 * Neutral model of a configuration, or null when the file is not a configuration or its
 * operating system has no driver yet.
 */
export function buildModel(
  lines: string[],
  tree: SyntaxTree,
  hints: ModelHints,
): DeviceModel | null {
  const os = hints.os;
  if (hints.kind !== 'config' || !hasDriver(os)) return null;
  const input = {
    lines,
    tree,
    os,
    ...(hints.version ? { version: hints.version } : {}),
    ...(hints.model ? { model: hints.model } : {}),
    ...(hints.hostname ? { hostname: hints.hostname } : {}),
  };
  switch (os) {
    case 'ios':
    case 'ios-xe':
    case 'cisco-sb':
      return buildCiscoModel(input);
    default:
      return null;
  }
}

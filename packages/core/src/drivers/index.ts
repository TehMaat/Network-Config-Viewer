import type { Detection, OsId } from '../detect/types';
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

/**
 * Neutral model of a configuration, or null when the file is not a configuration or its
 * operating system has no driver yet.
 */
export function buildModel(
  lines: string[],
  tree: SyntaxTree,
  detection: Detection,
): DeviceModel | null {
  const os = detection.os?.value;
  if (detection.kind.value !== 'config' || !hasDriver(os)) return null;
  const input = {
    lines,
    tree,
    os,
    ...(detection.version ? { version: detection.version.value } : {}),
    ...(detection.model ? { model: detection.model.value } : {}),
    ...(detection.hostname ? { hostname: detection.hostname.value } : {}),
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

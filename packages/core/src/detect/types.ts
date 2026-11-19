export type Vendor = 'fortinet' | 'cisco';

export type OsId = 'fortios' | 'fortiswitchos' | 'ios' | 'ios-xe' | 'nx-os' | 'asa' | 'cisco-sb';

export type FileKind = 'config' | 'show' | 'unknown';

/** How the text is split into blocks for folding and navigation. */
export type SyntaxFamily = 'fortios' | 'indent' | 'show' | 'plain';

/**
 * The rule that produced a detected value. The user interface turns it into a sentence
 * in the user's language, so the core never produces visible text.
 */
export type EvidenceRule =
  | 'fortios.header'
  | 'fortios.syntax'
  | 'fortios.hostname'
  | 'fortios.vdoms'
  | 'fortios.encrypted'
  | 'cisco.version-ios'
  | 'cisco.version-xe'
  | 'cisco.provision'
  | 'cisco.license-udi'
  | 'cisco.hostname'
  | 'cisco.syntax'
  | 'cisco.stack-interfaces'
  | 'nxos.header'
  | 'nxos.version'
  | 'asa.version'
  | 'asa.hardware'
  | 'sb.header'
  | 'sb.version'
  | 'sb.family'
  | 'show.prompt'
  | 'show.signature'
  | 'show.version-output'
  | 'none';

export interface Evidence {
  rule: EvidenceRule;
  /** 1-based line where the value was found. */
  line?: number;
  /** The text that was matched, shortened. */
  excerpt?: string;
}

export interface Detected<T> {
  value: T;
  evidence: Evidence;
}

export interface ShowCommand {
  command: string;
  /** 1-based line of the prompt, when the command was typed in the file. */
  line?: number;
  /** True when the command was recognised from the shape of its output (no prompt). */
  inferred: boolean;
}

export interface Detection {
  kind: Detected<FileKind>;
  vendor?: Detected<Vendor>;
  os?: Detected<OsId>;
  version?: Detected<string>;
  build?: Detected<string>;
  model?: Detected<string>;
  hostname?: Detected<string>;
  /** Number of stack members, only when more than one. */
  stack?: Detected<number>;
  /** FortiOS virtual domains, only in multi-VDOM configurations. */
  vdoms?: Detected<string[]>;
  /** Encrypted FortiGate backup: the content cannot be read. */
  encrypted?: Detected<boolean>;
  commands?: ShowCommand[];
  syntax: SyntaxFamily;
}

export function vendorOf(os: OsId): Vendor {
  return os === 'fortios' || os === 'fortiswitchos' ? 'fortinet' : 'cisco';
}

export function syntaxFor(kind: FileKind, os?: OsId, vendor?: Vendor): SyntaxFamily {
  if (kind === 'show') return 'show';
  if (kind === 'unknown' && !os && !vendor) return 'plain';
  if (os === 'fortios' || os === 'fortiswitchos') return 'fortios';
  if (os) return 'indent';
  if (vendor === 'fortinet') return 'fortios';
  if (vendor === 'cisco') return 'indent';
  return 'plain';
}

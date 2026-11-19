// The core package compiles against the plain ECMAScript library, without DOM or Node types,
// so that it keeps running unchanged in the browser, in Web Workers and on a future server.
// These are the only host APIs it relies on: they exist in every modern browser and in Node.

interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

interface TextDecodeOptions {
  stream?: boolean;
}

declare class TextDecoder {
  constructor(label?: string, options?: TextDecoderOptions);
  readonly encoding: string;
  readonly fatal: boolean;
  readonly ignoreBOM: boolean;
  decode(input?: ArrayBufferView | ArrayBuffer, options?: TextDecodeOptions): string;
}

declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array<ArrayBuffer>;
}

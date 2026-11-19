/** Line ending style of a text file. */
export type Eol = 'lf' | 'crlf' | 'cr' | 'mixed' | 'none';

/** Same separators CodeMirror uses by default, so line numbers always match the viewer. */
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Splits text into lines without the line terminators.
 * A text ending with a line break yields a final empty line, exactly like an editor does.
 */
export function splitLines(text: string): string[] {
  return text.split(LINE_BREAK);
}

/** Detects the line ending style, looking at the whole text. */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (ch === 10) {
      lf++;
    }
  }
  const kinds = (crlf > 0 ? 1 : 0) + (lf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0);
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  if (crlf > 0) return 'crlf';
  return lf > 0 ? 'lf' : 'cr';
}

/** The separator to use for rebuilding the text exactly, when the file uses a single style. */
export function eolSeparator(eol: Eol): string | undefined {
  switch (eol) {
    case 'crlf':
      return '\r\n';
    case 'cr':
      return '\r';
    case 'lf':
      return '\n';
    default:
      return undefined;
  }
}

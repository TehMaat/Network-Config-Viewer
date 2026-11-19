import { StreamLanguage, type StreamParser } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import type { SyntaxFamily } from '@ncv/core';

// Lightweight highlighters: they only colour the text. Structure (folding, outline) comes
// from the parsers of @ncv/core, which run in the worker.

const tokenTable = {
  keyword: tags.keyword,
  property: tags.propertyName,
  string: tags.string,
  number: tags.number,
  comment: tags.comment,
  atom: tags.atom,
  type: tags.typeName,
  meta: tags.meta,
  heading: tags.heading,
  negation: tags.operatorKeyword,
};

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?(?![\w.])/;
const IPV6 = /^[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){2,7}(?:\/\d{1,3})?(?![\w:])/;
const NUMBER = /^\d+(?![\w.])/;
/** A word, an address or a name with dots, slashes, colons and dashes. */
const WORD = /^[\w./:-]+/;

interface FortiState {
  inString: boolean;
  afterSet: boolean;
}

const FORTI_BLOCK = /^(config|edit|next|end)\b/;
const FORTI_COMMAND = /^(set|unset|append|select|unselect|clear|purge|rename|delete|move)\b/;
const FORTI_ATOM = /^(enable|disable|accept|deny|allow|block|none|all|any|always)(?![\w-])/;

function readFortiString(
  stream: Parameters<StreamParser<FortiState>['token']>[0],
  state: FortiState,
) {
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === '\\') stream.next();
    else if (ch === '"') {
      state.inString = false;
      return;
    }
  }
}

const fortios: StreamParser<FortiState> = {
  name: 'fortios',
  startState: () => ({ inString: false, afterSet: false }),
  token(stream, state) {
    if (state.inString) {
      readFortiString(stream, state);
      return 'string';
    }
    if (stream.sol()) state.afterSet = false;
    if (stream.eatSpace()) return null;
    if (stream.sol() && stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.peek() === '"') {
      stream.next();
      state.inString = true;
      readFortiString(stream, state);
      return 'string';
    }
    const atLineStart = stream.string.slice(0, stream.pos).trim() === '';
    if (atLineStart && stream.match(FORTI_BLOCK)) return 'keyword';
    if (atLineStart && stream.match(FORTI_COMMAND)) {
      state.afterSet = true;
      return 'keyword';
    }
    if (state.afterSet && stream.match(/^[\w-]+/)) {
      state.afterSet = false;
      return 'property';
    }
    if (stream.match('ENC ')) {
      stream.match(/^\S+/);
      return 'meta';
    }
    if (stream.match(IPV4) || stream.match(IPV6)) return 'number';
    if (stream.match(NUMBER)) return 'number';
    if (stream.match(FORTI_ATOM)) return 'atom';
    if (!stream.match(WORD)) stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
  tokenTable,
};

interface CiscoState {
  bannerDelimiter: string | null;
  firstWord: boolean;
  restIsText: boolean;
}

const INTERFACE_NAME =
  /^(?:GigabitEthernet|TenGigabitEthernet|TwentyFiveGigE|FortyGigabitEthernet|HundredGigE|TwoGigabitEthernet|FiveGigabitEthernet|AppGigabitEthernet|FastEthernet|Ethernet|Port-channel|port-channel|Vlan|vlan|Loopback|loopback|Tunnel|mgmt|Management|Gi|Te|Fa|Fo|Hu|Po|Lo|Tu|Eth|gi|te|fa)\s?\d+(?:\/\d+)*(?:\.\d+)?/;
const CISCO_ATOM =
  /^(permit|deny|any|host|eq|access|trunk|active|passive|on|auto|enable|disable)(?![\w-])/;
const TEXT_COMMANDS =
  /^(description|name|remark|alias|location|contact|snmp-server location|snmp-server contact)$/;

const cisco: StreamParser<CiscoState> = {
  name: 'cisco',
  startState: () => ({ bannerDelimiter: null, firstWord: true, restIsText: false }),
  token(stream, state) {
    if (state.bannerDelimiter) {
      const delimiter = state.bannerDelimiter;
      const at = stream.string.indexOf(delimiter, stream.pos);
      if (at === -1) {
        stream.skipToEnd();
      } else {
        stream.pos = at + delimiter.length;
        state.bannerDelimiter = null;
      }
      return 'string';
    }
    if (stream.sol()) {
      state.firstWord = true;
      state.restIsText = false;
    }
    if (stream.eatSpace()) return null;
    if (state.restIsText) {
      stream.skipToEnd();
      return 'string';
    }
    if (state.firstWord && stream.peek() === '!') {
      stream.skipToEnd();
      return 'comment';
    }
    if (state.firstWord) {
      if (stream.match(/^no(?=\s)/)) return 'negation';
      const word = stream.match(/^[\w-]+/) as RegExpMatchArray | null;
      if (!word) {
        stream.next();
        return null;
      }
      state.firstWord = false;
      const command = word[0];
      if (command === 'banner') {
        const rest = stream.string.slice(stream.pos);
        // "^C", or any other non-alphanumeric delimiter (this includes the ETX character).
        const m = /^\s+\S+\s+(\^C|[^\w\s])/.exec(rest);
        if (m) {
          const delimiter = m[1]!;
          const afterOpen = rest.slice(m[0].length);
          if (!afterOpen.includes(delimiter)) state.bannerDelimiter = delimiter;
          stream.skipToEnd();
          return 'keyword';
        }
      }
      if (TEXT_COMMANDS.test(command)) state.restIsText = true;
      const indented = stream.string.slice(0, stream.start).trim() === '' && stream.start > 0;
      return indented ? 'property' : 'keyword';
    }
    if (stream.peek() === '"') {
      stream.next();
      while (!stream.eol() && stream.next() !== '"') {
        /* read until the closing quote */
      }
      return 'string';
    }
    if (stream.match(INTERFACE_NAME)) return 'type';
    if (stream.match(IPV4) || stream.match(IPV6)) return 'number';
    if (stream.match(NUMBER)) return 'number';
    if (stream.match(CISCO_ATOM)) return 'atom';
    // Words stay whole; other characters (commas in "10,20,30") one at a time.
    if (!stream.match(WORD)) stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '!' } },
  tokenTable,
};

const PROMPT = /^[A-Za-z0-9][\w.\-/:]*(?:\([^)]*\))?(?: \([^)\s]+\))?\s?[#>$]/;

const show: StreamParser<Record<string, never>> = {
  name: 'show',
  startState: () => ({}),
  token(stream) {
    if (stream.sol() && stream.match(PROMPT)) {
      stream.skipToEnd();
      return 'heading';
    }
    if (stream.eatSpace()) return null;
    if (stream.match(INTERFACE_NAME)) return 'type';
    if (stream.match(IPV4) || stream.match(IPV6)) return 'number';
    if (!stream.match(WORD)) stream.next();
    return null;
  },
  tokenTable,
};

const languages: Partial<Record<SyntaxFamily, Extension>> = {
  fortios: StreamLanguage.define(fortios),
  indent: StreamLanguage.define(cisco),
  show: StreamLanguage.define(show),
};

export function languageFor(family: SyntaxFamily): Extension {
  return languages[family] ?? [];
}

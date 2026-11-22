import { PROBLEM_CODES } from '@ncv/core';
import { describe, expect, it } from 'vitest';
import en from './en.json';
import itTranslations from './it.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const variables = (text: string) =>
  [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  const italian = flatten(itTranslations as Tree);
  const english = flatten(en as Tree);

  it('have the same keys in Italian and English', () => {
    expect([...italian.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it('have no empty texts', () => {
    for (const [key, value] of [...italian, ...english]) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('use the same placeholders in both languages', () => {
    for (const [key, value] of italian) {
      expect(variables(value), key).toEqual(variables(english.get(key) ?? ''));
    }
  });

  it('explain every problem of the consistency checks', () => {
    for (const code of PROBLEM_CODES) {
      for (const part of ['title', 'why', 'fix']) {
        const key = `problems.code.${code}.${part}`;
        expect(italian.get(key), key).toBeTruthy();
        expect(english.get(key), key).toBeTruthy();
      }
    }
  });

  it('translate every CodeMirror phrase used by the viewer', () => {
    const phrases = Object.keys((itTranslations as Tree).codemirror as Tree);
    for (const phrase of [
      'Find',
      'next',
      'previous',
      'close',
      'Fold line',
      'Unfold line',
      'folded code',
    ]) {
      expect(phrases).toContain(phrase);
    }
  });
});

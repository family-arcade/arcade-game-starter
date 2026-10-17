/**
 * The catalog and the code agree: every `'game.…'` key written in the game's code is in
 * messages/en.json, and every key in it is used. Keys are kept as quoted literals (in tables
 * where the choice is data), never built from pieces, so this check can read them.
 */
import { describe, expect, it } from 'vitest';
import messages from './messages/en.json';
import { t } from './t';

const sources = import.meta.glob(['../**/*.ts', '!../arcade/**', '!../i18n/**', '!**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const KEY = /(['"])(game(?:\.[A-Za-z0-9]+)+)\1/g;
const used = new Set<string>();
for (const text of Object.values(sources)) {
  for (const m of text.matchAll(KEY)) used.add(m[2]);
}

const catalog = Object.keys(messages);

describe('the words catalog', () => {
  it('has every key the code asks for', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    expect([...used].filter((k) => !catalog.includes(k)).sort()).toEqual([]);
  });

  it('has no key that nothing asks for', () => {
    expect(catalog.filter((k) => !used.has(k)).sort()).toEqual([]);
  });

  it('formats a message with a name and a plural', () => {
    expect(t('game.start.playingAsLabel', { name: 'Rio' })).toBe('Playing as Rio. Change player');
    expect(t('game.start.here', { count: 1 })).toBe('Just you so far. Friends can join with the code.');
    expect(t('game.start.here', { count: 3 })).toBe('3 people are here.');
  });

  it('keeps the spacing a message was written with', () => {
    expect(t('game.start.playingAs')).toBe('Playing as ');
  });
});

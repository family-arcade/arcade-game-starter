import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, MAX_SAVE_BYTES } from './storage';

function make(gameId = 'star-catch') {
  return createStore({ gameId, local: window.localStorage, session: window.sessionStorage });
}

describe('arcade storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('has no player until one is set, and remembers it across loads', () => {
    const a = make();
    expect(a.player()).toBeNull();
    a.setPlayer({ name: ' Zoë ', colour: '#E0405F' });
    expect(a.player()).toEqual({ name: 'Zoë', colour: '#e0405f' });
    expect(make().player()).toEqual({ name: 'Zoë', colour: '#e0405f' });
  });

  it('rejects an invalid player with a clear message', () => {
    expect(() => make().setPlayer({ name: '', colour: '#e0405f' })).toThrow(/name of 1 to 20/);
    expect(() => make().setPlayer({ name: 'A', colour: 'red' })).toThrow(/colour/);
  });

  it('saves and loads JSON per player under arcade-kit:<gameId>:<player>:<key>', () => {
    const s = make();
    s.setPlayer({ name: 'Klara', colour: '#e0405f' });
    s.save('best', { score: 12, tags: ['a'] });
    expect(window.localStorage.getItem('arcade-kit:star-catch:Klara:best')).toBe('{"score":12,"tags":["a"]}');
    expect(s.load('best')).toEqual({ score: 12, tags: ['a'] });
    expect(s.load('missing')).toBeUndefined();
  });

  it('keeps players and games apart', () => {
    const s = make();
    s.setPlayer({ name: 'Klara', colour: '#e0405f' });
    s.save('best', 1);
    s.setPlayer({ name: 'Zoë', colour: '#3d6bd6' });
    expect(s.load('best')).toBeUndefined();
    s.save('best', 2);
    s.setPlayer({ name: 'Klara', colour: '#e0405f' });
    expect(s.load('best')).toBe(1);

    const other = make('other-game');
    other.setPlayer({ name: 'Klara', colour: '#e0405f' });
    expect(other.load('best')).toBeUndefined();
  });

  it('a colon in a name cannot reach another key', () => {
    const s = make();
    s.setPlayer({ name: 'a:b', colour: '#e0405f' });
    s.save('x', 1);
    expect(window.localStorage.getItem('arcade-kit:star-catch:a%3Ab:x')).toBe('1');
  });

  it('removes a key when saving undefined', () => {
    const s = make();
    s.setPlayer({ name: 'K', colour: '#e0405f' });
    s.save('a', 1);
    s.save('a', undefined);
    expect(s.load('a')).toBeUndefined();
  });

  it('throws a clear error above 100 KB, counting everything the game saved', () => {
    const s = make();
    s.setPlayer({ name: 'K', colour: '#e0405f' });
    s.save('big', 'x'.repeat(60 * 1024));
    expect(() => s.save('more', 'y'.repeat(60 * 1024))).toThrow(/at most 100 KB/);
    s.save('big', 'x'.repeat(90 * 1024)); // replacing the same key is fine
    expect(MAX_SAVE_BYTES).toBe(102400);
    expect(s.load<string>('big')).toHaveLength(90 * 1024);
  });

  it('throws for values that cannot be saved, and when nobody is playing', () => {
    const s = make();
    expect(() => s.save('a', 1)).toThrow(/nobody is playing/);
    s.setPlayer({ name: 'K', colour: '#e0405f' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => s.save('a', cyclic)).toThrow(/cannot be saved/);
    expect(() => s.save('a', () => 1)).toThrow(/cannot be saved/);
  });

  it('works when localStorage is not available', () => {
    const s = createStore({ gameId: 'g', local: null, session: null });
    s.setPlayer({ name: 'K', colour: '#e0405f' });
    s.save('a', 5);
    expect(s.load('a')).toBe(5);
    expect(s.backUrl()).toBeNull();
  });

  it('reports the arcade address remembered for this tab', () => {
    window.sessionStorage.setItem('arcade-kit:back', 'https://familyarcade.eu/');
    expect(make().backUrl()).toBe('https://familyarcade.eu/');
  });
});

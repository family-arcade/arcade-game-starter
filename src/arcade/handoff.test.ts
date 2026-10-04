import { describe, expect, it } from 'vitest';
import { BACK_KEY, consumeHandoff, decodeHandoff, encodeHandoff } from './handoff';

const good = { name: 'Klara', colour: '#e0405f', back: 'https://familyarcade.eu/' };

/** Build a payload the way the arcade would, from arbitrary JSON. */
function payloadOf(obj: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('encodeHandoff / decodeHandoff', () => {
  it('round-trips', () => {
    expect(decodeHandoff(encodeHandoff(good))).toEqual(good);
  });

  it('produces base64url without padding', () => {
    const p = encodeHandoff({ ...good, name: 'a?b>c~d' });
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('matches the spec example byte for byte', () => {
    const spec = '{"v":1,"name":"Klara","colour":"#e0405f","back":"https://familyarcade.eu/"}';
    const bytes = new TextEncoder().encode(spec);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    expect(encodeHandoff(good)).toBe(btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'));
  });

  it('handles non-ASCII names such as Zoë, and emoji', () => {
    expect(decodeHandoff(encodeHandoff({ ...good, name: 'Zoë' }))?.name).toBe('Zoë');
    expect(decodeHandoff(encodeHandoff({ ...good, name: 'Åsa 🦊' }))?.name).toBe('Åsa 🦊');
  });

  it('trims the name and lower-cases the colour', () => {
    const d = decodeHandoff(payloadOf({ v: 1, name: '  Klara  ', colour: '#E0405F', back: good.back }));
    expect(d).toEqual(good);
  });

  it('accepts a name of exactly 20 characters', () => {
    expect(decodeHandoff(payloadOf({ ...good, v: 1, name: 'x'.repeat(20) }))).not.toBeNull();
  });

  describe('rejects', () => {
    const base = { v: 1, ...good };
    const cases: Array<[string, unknown]> = [
      ['wrong version', { ...base, v: 2 }],
      ['missing version', { name: good.name, colour: good.colour, back: good.back }],
      ['version as text', { ...base, v: '1' }],
      ['empty name', { ...base, name: '' }],
      ['blank name', { ...base, name: '   ' }],
      ['21-character name', { ...base, name: 'x'.repeat(21) }],
      ['name that is not text', { ...base, name: 7 }],
      ['colour without #', { ...base, colour: 'e0405f' }],
      ['short colour', { ...base, colour: '#e04' }],
      ['colour with bad digits', { ...base, colour: '#gg0000' }],
      ['colour that is not text', { ...base, colour: 123456 }],
      ['http back', { ...base, back: 'http://familyarcade.eu/' }],
      ['javascript back', { ...base, back: 'javascript:alert(1)' }],
      ['data back', { ...base, back: 'data:text/html,hi' }],
      ['back that is not a URL', { ...base, back: 'familyarcade' }],
      ['missing back', { v: 1, name: good.name, colour: good.colour }],
      ['an array', [1, 2, 3]],
      ['null', null],
      ['a string', 'hello'],
    ];
    for (const [label, value] of cases) {
      it(label, () => expect(decodeHandoff(payloadOf(value))).toBeNull());
    }

    it('empty and non-string payloads', () => {
      expect(decodeHandoff('')).toBeNull();
      expect(decodeHandoff(null)).toBeNull();
      expect(decodeHandoff(undefined)).toBeNull();
      expect(decodeHandoff(42)).toBeNull();
    });
    it('characters outside base64url, including padding and +/', () => {
      expect(decodeHandoff(encodeHandoff(good) + '=')).toBeNull();
      expect(decodeHandoff('ab+/')).toBeNull();
      expect(decodeHandoff('not base64 at all!')).toBeNull();
    });
    it('valid base64url that is not JSON', () => {
      expect(decodeHandoff(btoa('hello world').replace(/=+$/, ''))).toBeNull();
    });
    it('bytes that are not valid UTF-8', () => {
      expect(decodeHandoff('_-8')).toBeNull();
    });
    it('an impossible base64 length', () => {
      expect(decodeHandoff('QUJDR')).toBeNull();
    });
    it('absurdly long payloads', () => {
      expect(decodeHandoff('A'.repeat(5000))).toBeNull();
    });
  });
});

function fakeWindow(hash: string) {
  const calls: string[] = [];
  const win = {
    location: { hash, pathname: '/star-catch/', search: '?x=1' },
    history: { state: null, replaceState: (_s: unknown, _u: string, url: string) => void calls.push(url) },
  };
  return { win, calls };
}
function fakeSession() {
  const data = new Map<string, string>();
  return { data, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('consumeHandoff', () => {
  it('reads the player, remembers back for this tab and cleans the address bar', () => {
    const { win, calls } = fakeWindow('#arcade=' + encodeHandoff(good));
    const session = fakeSession();
    expect(consumeHandoff(win, session)).toEqual(good);
    expect(session.data.get(BACK_KEY)).toBe(good.back);
    expect(calls).toEqual(['/star-catch/?x=1']);
  });

  it('keeps any other fragment', () => {
    const { win, calls } = fakeWindow('#level=3&arcade=' + encodeHandoff(good) + '&mute=1');
    consumeHandoff(win, fakeSession());
    expect(calls).toEqual(['/star-catch/?x=1#level=3&mute=1']);
  });

  it('ignores an invalid payload: no player, nothing remembered, address bar still cleaned', () => {
    const { win, calls } = fakeWindow('#arcade=!!!');
    const session = fakeSession();
    expect(consumeHandoff(win, session)).toBeNull();
    expect(session.data.size).toBe(0);
    expect(calls).toEqual(['/star-catch/?x=1']);
  });

  it('does nothing when there is no handoff', () => {
    const { win, calls } = fakeWindow('#level=3');
    expect(consumeHandoff(win, fakeSession())).toBeNull();
    expect(calls).toEqual([]);
  });

  it('works without session storage', () => {
    const { win } = fakeWindow('#arcade=' + encodeHandoff(good));
    expect(consumeHandoff(win, null)).toEqual(good);
  });
});

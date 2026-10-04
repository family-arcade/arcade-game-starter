import { describe, expect, it } from 'vitest';
import { isWire, messageProblem, MAX_MESSAGE_BYTES } from './wire';

describe('isWire: the one place inbound data is checked', () => {
  it('accepts a game message that is a JSON object', () => {
    expect(isWire({ k: 'g', d: { type: 'input', dx: 1, nested: { a: [1, 'b', null, true] } } })).toBe(true);
  });

  it('accepts hello with a valid player', () => {
    expect(isWire({ k: 'hello', name: 'Zoë', colour: '#3d6bd6' })).toBe(true);
  });

  it('rejects hello with a bad name or colour', () => {
    expect(isWire({ k: 'hello', name: '', colour: '#3d6bd6' })).toBe(false);
    expect(isWire({ k: 'hello', name: 'x'.repeat(21), colour: '#3d6bd6' })).toBe(false);
    expect(isWire({ k: 'hello', name: 'A', colour: 'blue' })).toBe(false);
    expect(isWire({ k: 'hello', name: 'A' })).toBe(false);
  });

  it('accepts a people list and rejects a malformed one', () => {
    const p = { id: 'host', name: 'A', colour: '#3d6bd6', isHost: true };
    expect(isWire({ k: 'people', you: 'x', list: [p] })).toBe(true);
    expect(isWire({ k: 'people', you: 'x', list: [{ ...p, colour: 'x' }] })).toBe(false);
    expect(isWire({ k: 'people', you: 'x', list: 'nope' })).toBe(false);
    expect(isWire({ k: 'people', you: 'x', list: Array(9).fill(p) })).toBe(false);
  });

  it('rejects things that are not JSON objects', () => {
    for (const v of [null, undefined, 5, 'hi', [1, 2], true, () => 1]) expect(isWire(v)).toBe(false);
    expect(isWire({ k: 'g', d: [1, 2] })).toBe(false);
    expect(isWire({ k: 'g', d: 'text' })).toBe(false);
    expect(isWire({ k: 'g' })).toBe(false);
    expect(isWire({ k: 'other' })).toBe(false);
    expect(isWire({ d: { a: 1 } })).toBe(false);
  });

  it('rejects non-JSON contents', () => {
    expect(isWire({ k: 'g', d: { a: NaN } })).toBe(false);
    expect(isWire({ k: 'g', d: { a: Infinity } })).toBe(false);
    expect(isWire({ k: 'g', d: { a: undefined } })).toBe(false);
    expect(isWire({ k: 'g', d: { a: new Date() } })).toBe(false);
    expect(isWire({ k: 'g', d: { a: new Uint8Array(3) } })).toBe(false);
    expect(isWire({ k: 'g', d: JSON.parse('{"__proto__":{"x":1}}') })).toBe(false);
  });

  it('rejects cycles and very deep nesting', () => {
    const cyc: Record<string, unknown> = {};
    cyc.me = cyc;
    expect(isWire({ k: 'g', d: cyc })).toBe(false);
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) deep = { deep };
    expect(isWire({ k: 'g', d: deep })).toBe(false);
  });

  it('allows up to 16 KB and refuses more', () => {
    const fits = { s: 'x'.repeat(MAX_MESSAGE_BYTES - 20) };
    expect(messageProblem(fits)).toBeNull();
    expect(isWire({ k: 'g', d: fits })).toBe(true);
    const tooBig = { s: 'x'.repeat(MAX_MESSAGE_BYTES) };
    expect(messageProblem(tooBig)).toMatch(/limit is 16 KB/);
    expect(isWire({ k: 'g', d: tooBig })).toBe(false);
  });

  it('counts bytes, not characters', () => {
    expect(messageProblem({ s: 'é'.repeat(9000) })).toMatch(/16 KB/);
  });
});

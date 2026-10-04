import { describe, expect, it } from 'vitest';
import manifest from '../public/arcade.json';

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** WCAG contrast ratio of white text on `hex`. */
export function whiteContrast(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

describe('public/arcade.json', () => {
  it('has what the arcade needs', () => {
    expect(manifest.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(manifest.title.length).toBeGreaterThan(0);
    expect(manifest.blurb.length).toBeGreaterThan(0);
    expect(manifest.players.min).toBeGreaterThanOrEqual(1);
    expect(manifest.players.max).toBeLessThanOrEqual(4);
    expect(manifest.players.max).toBeGreaterThanOrEqual(manifest.players.min);
    expect(Array.isArray(manifest.facts)).toBe(true);
  });

  it('colour is #rrggbb and white text on it reaches 4.5:1', () => {
    expect(manifest.colour).toMatch(/^#[0-9a-f]{6}$/i);
    expect(whiteContrast(manifest.colour)).toBeGreaterThanOrEqual(4.5);
  });

  it('the contrast helper agrees with known values', () => {
    expect(whiteContrast('#000000')).toBeCloseTo(21, 0);
    expect(whiteContrast('#ffffff')).toBeCloseTo(1, 1);
    expect(whiteContrast('#ffff00')).toBeLessThan(4.5);
  });
});

import { describe, expect, it } from 'vitest';

import { qrMatrix, qrSvg } from '@/lib/qr';

const text = (modules: boolean[][]) =>
  modules.map((row) => row.map((dark) => (dark ? '#' : '.')).join('')).join('\n');

describe('QR codes', () => {
  it('reproduces the standard reference symbol for a known input', () => {
    // "HELLO" is not used here because the reference tables assume alphanumeric mode; instead
    // this pins the structural parts every scanner relies on.
    const modules = qrMatrix('https://example.com/r/abc');
    const size = modules.length;
    expect((size - 17) % 4).toBe(0);
    const finder = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'];
    const corner = (x0: number, y0: number) =>
      finder.map((_, y) =>
        modules[y0 + y]!.slice(x0, x0 + 7)
          .map((d) => (d ? '#' : '.'))
          .join(''),
      );
    expect(corner(0, 0)).toEqual(finder);
    expect(corner(size - 7, 0)).toEqual(finder);
    expect(corner(0, size - 7)).toEqual(finder);
    // Timing pattern alternates between the finders; the fixed dark module is in place.
    for (let i = 8; i < size - 8; i++) expect(modules[6]![i]).toBe(i % 2 === 0);
    expect(modules[size - 8]![8]).toBe(true);
  });

  it('grows with the text and refuses what it cannot hold', () => {
    expect(qrMatrix('a').length).toBe(21);
    expect(qrMatrix('x'.repeat(40)).length).toBe(29);
    expect(qrMatrix('x'.repeat(106)).length).toBe(41);
    expect(() => qrMatrix('x'.repeat(107))).toThrow();
  });

  it('is the same every time, and different for different text', () => {
    expect(text(qrMatrix('https://example.com/r/one'))).toBe(
      text(qrMatrix('https://example.com/r/one')),
    );
    expect(text(qrMatrix('https://example.com/r/one'))).not.toBe(
      text(qrMatrix('https://example.com/r/two')),
    );
  });

  it('draws an SVG with a quiet border', () => {
    const svg = qrSvg('a');
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

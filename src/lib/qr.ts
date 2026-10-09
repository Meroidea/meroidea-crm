/**
 * A small QR code generator (ISO/IEC 18004), written in-house so no dependency is needed for
 * the handful of short links the platform prints. Byte mode, error-correction level M,
 * versions 1–6: up to 106 bytes, which covers any address the platform generates.
 */

/** Per version at level M: error-correction codewords per block, and data codewords per block. */
const VERSIONS: { ec: number; blocks: number[] }[] = [
  { ec: 10, blocks: [16] },
  { ec: 16, blocks: [28] },
  { ec: 26, blocks: [44] },
  { ec: 18, blocks: [32, 32] },
  { ec: 24, blocks: [43, 43] },
  { ec: 16, blocks: [27, 27, 27, 27] },
];
const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

/** Multiplication in GF(2^8) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1. */
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonDivisor(degree: number): number[] {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j] ?? 0, root);
      if (j + 1 < degree) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] = (result[i] ?? 0) ^ multiply(coefficient, factor);
    });
  }
  return result;
}

/** The data codewords: mode, length, the bytes, a terminator and padding. */
function dataCodewords(bytes: Uint8Array, capacity: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let pad = 0xec; codewords.length < capacity; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Splits the data into blocks, adds error correction to each, and interleaves them. */
function withErrorCorrection(data: number[], version: (typeof VERSIONS)[number]): number[] {
  const divisor = reedSolomonDivisor(version.ec);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const length of version.blocks) {
    const block = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: block, ec: reedSolomonRemainder(block, divisor) });
  }
  const result: number[] = [];
  const longest = Math.max(...version.blocks);
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) {
      const value = block.data[i];
      if (value !== undefined) result.push(value);
    }
  }
  for (let i = 0; i < version.ec; i++) {
    for (const block of blocks) result.push(block.ec[i] ?? 0);
  }
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** How hard a pattern is for a scanner to read; lower is better (the standard's four rules). */
function penalty(modules: boolean[][]): number {
  const size = modules.length;
  const at = (x: number, y: number) => modules[y]?.[x] ?? false;
  let score = 0;
  for (let vertical = 0; vertical < 2; vertical++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      const line: boolean[] = [];
      for (let b = 0; b < size; b++) {
        const value = vertical ? at(a, b) : at(b, a);
        line.push(value);
        if (b > 0 && value === line[b - 1]) run++;
        else run = 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      }
      // Sequences that look like a finder pattern confuse scanners.
      const text = line.map((value) => (value ? '1' : '0')).join('');
      for (const pattern of ['10111010000', '00001011101']) {
        for (let i = text.indexOf(pattern); i !== -1; i = text.indexOf(pattern, i + 1)) score += 40;
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (at(x, y)) dark++;
      if (x + 1 < size && y + 1 < size) {
        const value = at(x, y);
        if (value === at(x + 1, y) && value === at(x, y + 1) && value === at(x + 1, y + 1)) {
          score += 3;
        }
      }
    }
  }
  return score + Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
}

/**
 * Encodes text as a QR code. Returns the grid of modules, `true` for dark, without the quiet
 * zone. Throws when the text is longer than this generator supports.
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const index = VERSIONS.findIndex(
    (candidate) => bytes.length + 2 <= candidate.blocks.reduce((sum, length) => sum + length, 0),
  );
  const version = VERSIONS[index];
  if (!version) throw new Error('That text is too long for a QR code here.');
  const size = 17 + 4 * (index + 1);
  const capacity = version.blocks.reduce((sum, length) => sum + length, 0);
  const codewords = withErrorCorrection(dataCodewords(bytes, capacity), version);

  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    (modules[y] as boolean[])[x] = dark;
    (reserved[y] as boolean[])[x] = true;
  };

  // Timing patterns, then the three finder patterns with their light separators.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, distance !== 2 && distance !== 4);
      }
    }
  }
  // Alignment patterns, except where a finder pattern already sits.
  const centres = ALIGNMENT[index] ?? [];
  centres.forEach((cy, row) => {
    centres.forEach((cx, column) => {
      const last = centres.length - 1;
      const onFinder =
        (row === 0 && column === 0) ||
        (row === 0 && column === last) ||
        (row === last && column === 0);
      if (onFinder) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    });
  });

  /** Writes the 15 format bits (level M and the mask) in both of their places. */
  const drawFormat = (mask: number) => {
    let remainder = mask;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((mask << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);

  // The data, zig-zagging up and down in two-module columns from the bottom-right corner.
  const dataModules: [number, number][] = [];
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (reserved[y]?.[x]) continue;
        const byte = codewords[bitIndex >>> 3] ?? 0;
        (modules[y] as boolean[])[x] = ((byte >>> (7 - (bitIndex & 7))) & 1) !== 0;
        dataModules.push([x, y]);
        bitIndex++;
      }
    }
  }

  const applyMask = (mask: number) => {
    const test = MASKS[mask] as (x: number, y: number) => boolean;
    for (const [x, y] of dataModules) {
      if (test(x, y)) (modules[y] as boolean[])[x] = !(modules[y] as boolean[])[x];
    }
  };
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const score = penalty(modules);
    if (score < lowest) {
      lowest = score;
      best = mask;
    }
    applyMask(mask); // Masking twice undoes it.
  }
  applyMask(best);
  drawFormat(best);
  return modules;
}

/** The QR code as a standalone SVG, with the four-module light border scanners need. */
export function qrSvg(text: string, options: { pixelsPerModule?: number } = {}): string {
  const modules = qrMatrix(text);
  const border = 4;
  const size = modules.length + border * 2;
  const scale = options.pixelsPerModule ?? 8;
  let path = '';
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x + border},${y + border}h1v1h-1z`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * scale}" height="${size * scale}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/**
 * Small, owned, cross-runtime pseudo-random generator.
 *
 * The state is four unsigned 32-bit words and all arithmetic is explicitly
 * truncated with >>> 0.  This keeps generation independent of browser/runtime
 * floating-point and random implementations.
 */
export interface SeededPrng {
  readonly seed: string;
  nextUint32(): number;
  nextInt(maxExclusive: number): number;
  nextBoolean(): boolean;
  fork(label: string): SeededPrng;
}

function hashString(value: string): number {
  // FNV-1a is intentionally tiny and specified in terms of uint32 operations.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function splitMix32(value: number): number {
  let next = (value + 0x9e3779b9) >>> 0;
  next = Math.imul(next ^ (next >>> 16), 0x21f0aaad) >>> 0;
  next = Math.imul(next ^ (next >>> 15), 0x735a2d97) >>> 0;
  return (next ^ (next >>> 15)) >>> 0;
}

function seedState(seed: string): [number, number, number, number] {
  const base = hashString(seed);
  const state: [number, number, number, number] = [
    splitMix32(base),
    splitMix32((base + 1) >>> 0),
    splitMix32((base + 2) >>> 0),
    splitMix32((base + 3) >>> 0),
  ];
  // xoshiro has an all-zero absorbing state.  The comparison is also useful in
  // tests with deliberately tiny/adversarial string seeds.
  if (state.every((word) => word === 0)) state[0] = 0x6d2b79f5;
  return state;
}

/** xoshiro128** with a string seed and no ambient randomness. */
export function createSeededPrng(seed: string): SeededPrng {
  const canonicalSeed = String(seed);
  const state = seedState(canonicalSeed);
  const rotateLeft = (value: number, bits: number): number =>
    ((value << bits) | (value >>> (32 - bits))) >>> 0;
  const nextUint32 = (): number => {
    const result = rotateLeft(Math.imul(state[1], 5) >>> 0, 7);
    const output = Math.imul(result, 9) >>> 0;
    const t = (state[1] << 9) >>> 0;

    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= t;
    state[3] = rotateLeft(state[3], 11);
    return output;
  };

  return {
    seed: canonicalSeed,
    nextUint32,
    nextInt(maxExclusive: number): number {
      if (
        !Number.isSafeInteger(maxExclusive) ||
        maxExclusive <= 0 ||
        maxExclusive > 0x1_0000_0000
      ) {
        throw new RangeError("maxExclusive must be a positive integer no greater than 2^32");
      }
      // Rejection avoids modulo bias while remaining entirely integer based.
      const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
      let word = nextUint32();
      while (word >= limit) word = nextUint32();
      return word % maxExclusive;
    },
    nextBoolean(): boolean {
      return (nextUint32() & 1) === 1;
    },
    fork(label: string): SeededPrng {
      // Forking from the original seed (rather than mutable state) means a
      // topology can be regenerated independently without order-dependent
      // random consumption.
      return createSeededPrng(`${canonicalSeed}:${label}`);
    },
  };
}

export const createPrng = createSeededPrng;
export const seededPrng = createSeededPrng;

/** A deterministic unsigned hash useful for stable tie-break keys. */
export function hashSeed(value: string): number {
  return hashString(String(value));
}

export const hashStringSeed = hashSeed;

/**
 * Stage 1 bucket 1.3 — canonical serialization and stable fingerprints.
 *
 * Every domain value in this package is plain data: `ProjectBrief`,
 * `NormalizedProject`, `Layout`, facts, validation results, and inspection
 * diagnostics. This module turns that data into one canonical text form so two
 * runs, two processes, or two key-insertion orders cannot disagree about what a
 * value "is":
 *
 * - object keys are sorted by UTF-16 code unit, so property order in source
 *   code cannot leak into output;
 * - arrays keep domain order, because array order is semantic (the authored
 *   program, the portal list, generated candidates);
 * - `undefined` properties are absent, the convention the brief schema already
 *   uses for optional fields;
 * - `-0` is folded to `0`, and every non-JSON value (NaN, Infinity, bigint,
 *   function, symbol, `undefined` at the root or inside an array, a class
 *   instance such as `Date`/`Map`/`Set`, or a cycle) is rejected with the path
 *   that failed instead of being silently coerced by `JSON.stringify`.
 *
 * Fingerprints are SHA-256 over the canonical text. The hash is implemented
 * here, in uint32 arithmetic, so the browser, the future worker, and Node all
 * produce identical digests without a platform crypto module; the test suite
 * cross-checks it against `node:crypto`.
 */
import { GENERATOR_ENGINE_VERSION, GENERATOR_RULE_VERSION } from "./generator.ts";
import type { NormalizedProject } from "./model.ts";
import { SCORING_VERSION } from "./scoring.ts";

/** Version of the canonical text form itself, independent of the data schema. */
export const CANONICAL_JSON_VERSION = "planlab-canonical-json-1";
/** Version of the fingerprint preimage (what is hashed, and how it is tagged). */
export const FINGERPRINT_VERSION = "planlab-fingerprint-1";

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

/** A domain value that cannot be represented canonically, reported with its path. */
export class CanonicalSerializationError extends Error {
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string) {
    super(`cannot canonicalize ${path}: ${reason}`);
    this.name = "CanonicalSerializationError";
    this.path = path;
    this.reason = reason;
  }
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Build the canonical clone of a domain value.
 *
 * The result contains only JSON primitives, plain objects with sorted keys, and
 * arrays, so `JSON.stringify` of the clone is the canonical text and no caller
 * can mutate the input through the returned tree.
 */
export function canonicalizeValue(value: unknown, path = "$"): CanonicalJsonValue {
  return canonicalize(value, path, new Set<object>());
}

function canonicalize(value: unknown, path: string, ancestors: Set<object>): CanonicalJsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalSerializationError(path, `${String(value)} is not a finite JSON number`);
      }
      // Folding -0 keeps `{ a: -0 }` and `{ a: 0 }` canonically equal.
      return Object.is(value, -0) ? 0 : value;
    }
    case "undefined":
      throw new CanonicalSerializationError(path, "undefined is not a canonical value");
    case "bigint":
    case "function":
    case "symbol":
      throw new CanonicalSerializationError(path, `${typeof value} is not a canonical value`);
    default:
      break;
  }

  const object = value as object;
  if (ancestors.has(object)) {
    throw new CanonicalSerializationError(path, "circular reference");
  }
  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      return object.map((element, index) => canonicalize(element, `${path}[${index}]`, ancestors));
    }
    if (!isPlainObject(object)) {
      const name = object.constructor?.name ?? "object";
      throw new CanonicalSerializationError(path, `${name} instances are not canonical plain data`);
    }
    const record = object as Record<string, unknown>;
    const canonical: { [key: string]: CanonicalJsonValue } = {};
    for (const key of Object.keys(record).sort(compareKeys)) {
      // Absent is the canonical spelling of an optional property.
      if (record[key] === undefined) continue;
      canonical[key] = canonicalize(record[key], `${path}.${key}`, ancestors);
    }
    return canonical;
  } finally {
    ancestors.delete(object);
  }
}

/** Code-unit ordering, so the sort is locale independent. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical text for a domain value: sorted keys, domain-ordered arrays. */
export function serializeCanonical(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

/** True when two values are canonically equal, ignoring key insertion order. */
export function isCanonicalEqual(a: unknown, b: unknown): boolean {
  return serializeCanonical(a) === serializeCanonical(b);
}

/** SHA-256 round constants, first 32 bits of the fractional cube roots of the first 64 primes. */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** UTF-8 bytes of a string, with the canvas/text encoder spelling of unpaired surrogates. */
function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/**
 * SHA-256 of a string's UTF-8 bytes, as lowercase hex.
 *
 * Deliberately dependency free: domain modules must not import Node or browser
 * crypto, and fingerprints must not depend on which runtime produced them.
 */
export function sha256Hex(value: string): string {
  return sha256BytesHex(utf8Bytes(value));
}

function sha256BytesHex(bytes: Uint8Array): string {
  const byteLength = bytes.length;
  // Pad to a 64-byte boundary with 0x80, zeros, and the 64-bit bit length.
  const paddedLength = ((byteLength + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[byteLength] = 0x80;
  const bitLengthHigh = Math.floor(byteLength / 0x2000_0000);
  const bitLengthLow = (byteLength << 3) >>> 0;
  const tail = paddedLength - 8;
  padded[tail] = (bitLengthHigh >>> 24) & 0xff;
  padded[tail + 1] = (bitLengthHigh >>> 16) & 0xff;
  padded[tail + 2] = (bitLengthHigh >>> 8) & 0xff;
  padded[tail + 3] = bitLengthHigh & 0xff;
  padded[tail + 4] = (bitLengthLow >>> 24) & 0xff;
  padded[tail + 5] = (bitLengthLow >>> 16) & 0xff;
  padded[tail + 6] = (bitLengthLow >>> 8) & 0xff;
  padded[tail + 7] = bitLengthLow & 0xff;

  const state = new Uint32Array(SHA256_INITIAL_STATE);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      schedule[index] =
        ((padded[at]! << 24) | (padded[at + 1]! << 16) | (padded[at + 2]! << 8) | padded[at + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const previous = schedule[index - 15]!;
      const recent = schedule[index - 2]!;
      const s0 = (rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ (previous >>> 3)) >>> 0;
      const s1 = (rotateRight(recent, 17) ^ rotateRight(recent, 19) ^ (recent >>> 10)) >>> 0;
      schedule[index] = (schedule[index - 16]! + s0 + schedule[index - 7]! + s1) >>> 0;
    }

    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let index = 0; index < 64; index += 1) {
      const s1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const choice = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + s1 + choice + SHA256_K[index]! + schedule[index]!) >>> 0;
      const s0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }

  let digest = "";
  for (const word of state) digest += word.toString(16).padStart(8, "0");
  return digest;
}

/**
 * Stable content fingerprint of any canonical domain value.
 *
 * The `sha256:` prefix names the algorithm so a future fingerprint can be
 * introduced without ambiguity about which one a stored value used.
 */
export function fingerprintCanonical(value: unknown): string {
  return `sha256:${sha256Hex(serializeCanonical(value))}`;
}

/** The version tags a project fingerprint is allowed to depend on. */
export interface ProjectFingerprintVersions {
  solverVersion: string;
  ruleVersion: string;
  scoringVersion: string;
}

/** Version tags of the domain code currently loaded. */
export function currentProjectFingerprintVersions(): ProjectFingerprintVersions {
  return Object.freeze({
    solverVersion: GENERATOR_ENGINE_VERSION,
    ruleVersion: GENERATOR_RULE_VERSION,
    scoringVersion: SCORING_VERSION,
  });
}

/**
 * Fingerprint of a normalized project plus the solver/rule/scoring versions
 * that would reproduce it, per `knowledge/planlab/ARCHITECTURE.md` ("a project
 * fingerprint hashes canonical normalized input plus solver/rule/scoring
 * versions").
 *
 * The versions are part of the preimage rather than of the project document, so
 * results computed by a different solver build are never confused with results
 * from the current one while the authored project keeps its own identity.
 */
export function fingerprintNormalizedProject(
  project: NormalizedProject,
  versions: ProjectFingerprintVersions = currentProjectFingerprintVersions(),
): string {
  return fingerprintCanonical({
    fingerprintVersion: FINGERPRINT_VERSION,
    input: project,
    versions: {
      ruleVersion: versions.ruleVersion,
      scoringVersion: versions.scoringVersion,
      solverVersion: versions.solverVersion,
    },
  });
}

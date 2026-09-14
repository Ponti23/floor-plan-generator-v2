/**
 * Stage 1 bucket 1.3 — canonical serialization, fingerprints, and replay.
 *
 * The canonical text form is the contract other layers (worker protocol,
 * storage, benchmark evidence) will rely on, so it is checked from four
 * directions: key-insertion independence, explicit rejection of non-JSON
 * domain values, digest equivalence with an independent SHA-256
 * implementation, and fingerprint stability across processes and replays.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  CANONICAL_PROJECT,
  CanonicalSerializationError,
  createCanonicalProject,
  currentProjectFingerprintVersions,
  fingerprintCanonical,
  fingerprintNormalizedProject,
  generateLayouts,
  isCanonicalEqual,
  normalizeProject,
  serializeCanonical,
  sha256Hex,
  type ProjectBrief,
} from "../src/domain/index.ts";

/** Fingerprint of the approved canonical fixture; a drift guard for the recorded baseline. */
const CANONICAL_PROJECT_FINGERPRINT =
  "sha256:95d89f35db8b7eea5bc52196cb70f49a8885cf37bbdde5a82a5caff50cbc061d";

const GENERATION_OPTIONS = Object.freeze({
  budget: { maxCandidatesPerTopology: 3, maxTotalCandidates: 9 },
});

/**
 * Rebuild a value with every object's keys inserted in reverse order, so any
 * dependence on insertion order shows up as a different canonical text.
 */
function reverseKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeyOrder);
  if (value === null || typeof value !== "object") return value;
  const rebuilt: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse()) {
    rebuilt[key] = reverseKeyOrder((value as Record<string, unknown>)[key]);
  }
  return rebuilt;
}

test("canonical text ignores key insertion order at every level", () => {
  const shuffledBrief = reverseKeyOrder(CANONICAL_PROJECT) as ProjectBrief;
  assert.notDeepEqual(Object.keys(shuffledBrief), Object.keys(CANONICAL_PROJECT));
  assert.equal(serializeCanonical(shuffledBrief), serializeCanonical(CANONICAL_PROJECT));
  assert.equal(
    fingerprintNormalizedProject(normalizeProject(shuffledBrief)),
    fingerprintNormalizedProject(CANONICAL_NORMALIZED_PROJECT),
  );
  assert.deepEqual(normalizeProject(shuffledBrief), CANONICAL_NORMALIZED_PROJECT);
  assert.ok(isCanonicalEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }));
});

test("canonical text keeps domain array order and drops undefined properties", () => {
  assert.equal(serializeCanonical({ b: [1, 2], a: undefined }), '{"b":[1,2]}');
  assert.equal(serializeCanonical({ a: undefined }), "{}");
  assert.notEqual(serializeCanonical([1, 2]), serializeCanonical([2, 1]));
  assert.equal(serializeCanonical({ a: -0 }), '{"a":0}');

  // Array order is semantic: a reordered program is a different project.
  const reordered = createCanonicalProject();
  reordered.program = [...reordered.program].reverse();
  assert.notEqual(serializeCanonical(reordered), serializeCanonical(CANONICAL_PROJECT));
  assert.notEqual(
    fingerprintNormalizedProject(normalizeProject(reordered)),
    CANONICAL_PROJECT_FINGERPRINT,
  );
});

test("non-canonical values are rejected with the failing path", () => {
  const cycle: Record<string, unknown> = { a: { b: 1 } };
  cycle.self = cycle;
  const cases: readonly [unknown, string][] = [
    [Number.NaN, "$"],
    [Number.POSITIVE_INFINITY, "$"],
    [Number.NEGATIVE_INFINITY, "$"],
    [1n, "$"],
    [() => 1, "$"],
    [Symbol("s"), "$"],
    [undefined, "$"],
    [{ a: [1, undefined] }, "$.a[1]"],
    [{ when: new Date(0) }, "$.when"],
    [{ seen: new Set([1]) }, "$.seen"],
    [{ map: new Map([["a", 1]]) }, "$.map"],
    [cycle, "$.self"],
  ];
  for (const [value, path] of cases) {
    assert.throws(
      () => serializeCanonical(value),
      (error: unknown) => {
        if (!(error instanceof CanonicalSerializationError)) {
          throw new Error(`expected a CanonicalSerializationError for ${path}, got ${String(error)}`);
        }
        assert.equal(error.path, path);
        return true;
      },
    );
  }
});

test("the owned sha256 matches node:crypto across block and unicode boundaries", () => {
  const samples = [
    "",
    "a",
    "abc",
    "PlanLab",
    "x".repeat(55),
    "x".repeat(56),
    "x".repeat(63),
    "x".repeat(64),
    "x".repeat(65),
    "x".repeat(119),
    "x".repeat(120),
    "π ≈ 3.14159",
    "日本語のテスト",
    "emoji 😀🎉",
    "lone \uD800 surrogate",
    "ab".repeat(8_192),
    serializeCanonical(CANONICAL_PROJECT),
  ];
  for (const sample of samples) {
    const expected = createHash("sha256").update(sample, "utf8").digest("hex");
    assert.equal(sha256Hex(sample), expected, `digest mismatch for ${sample.slice(0, 16)}`);
  }
});

test("project fingerprints are stable, version-tagged, and sensitive", () => {
  const fingerprint = fingerprintNormalizedProject(CANONICAL_NORMALIZED_PROJECT);
  assert.equal(fingerprint, CANONICAL_PROJECT_FINGERPRINT);
  assert.match(fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    fingerprint,
    fingerprintNormalizedProject(normalizeProject(createCanonicalProject())),
  );

  const versions = currentProjectFingerprintVersions();
  assert.deepEqual(Object.keys(versions).sort(), [
    "ruleVersion",
    "scoringVersion",
    "solverVersion",
  ]);
  assert.notEqual(
    fingerprintNormalizedProject(CANONICAL_NORMALIZED_PROJECT, {
      ...versions,
      solverVersion: `${versions.solverVersion}-next`,
    }),
    fingerprint,
  );
  assert.notEqual(
    fingerprintNormalizedProject(CANONICAL_NORMALIZED_PROJECT, {
      ...versions,
      scoringVersion: `${versions.scoringVersion}-next`,
    }),
    fingerprint,
  );

  const variants: readonly [string, (brief: ProjectBrief) => void][] = [
    ["one millimetre of west offset", (brief) => { brief.site.offsets.west.distanceMm += 1; }],
    ["project name", (brief) => { brief.name = `${brief.name} v2`; }],
    ["seed", (brief) => { brief.generation.seed = `${brief.generation.seed}-other`; }],
    ["planning ratio", (brief) => { brief.planning.maxUnallocatedInteriorRatio = 0.06; }],
    ["room minimum area", (brief) => { brief.program[0]!.dimensions.minAreaMm2 += 62_500; }],
    ["relationship kind", (brief) => { brief.relationships[0]!.kind = "preferNear"; }],
  ];
  for (const [label, mutate] of variants) {
    const brief = createCanonicalProject();
    mutate(brief);
    assert.notEqual(
      fingerprintNormalizedProject(normalizeProject(brief)),
      fingerprint,
      `${label} must change the fingerprint`,
    );
  }
});

test("fingerprints match a fresh process for projects and layouts", () => {
  const entry = new URL("../src/domain/index.ts", import.meta.url).href;
  const script = [
    `import { CANONICAL_NORMALIZED_PROJECT as project, fingerprintNormalizedProject, fingerprintCanonical, generateLayouts } from ${JSON.stringify(entry)};`,
    "const generated = generateLayouts(project, { seed: 'cross-process', budget: { maxCandidatesPerTopology: 2, maxTotalCandidates: 6 } });",
    "console.log(JSON.stringify({",
    "  project: fingerprintNormalizedProject(project),",
    "  layouts: generated.layouts.map((layout) => fingerprintCanonical(layout)),",
    "}));",
  ].join("\n");
  const printed = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      cwd: new URL("..", import.meta.url),
    }),
  ) as { project: string; layouts: string[] };

  assert.equal(printed.project, CANONICAL_PROJECT_FINGERPRINT);
  const local = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: "cross-process",
    budget: { maxCandidatesPerTopology: 2, maxTotalCandidates: 6 },
  });
  assert.ok(local.layouts.length > 0);
  assert.deepEqual(printed.layouts, local.layouts.map((layout) => fingerprintCanonical(layout)));
});

test("generated layouts replay byte-equivalently and stay fingerprint-sensitive", () => {
  const first = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    ...GENERATION_OPTIONS,
    seed: "fingerprint-replay",
  });
  const second = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    ...GENERATION_OPTIONS,
    seed: "fingerprint-replay",
  });
  assert.ok(first.layouts.length > 0);
  assert.equal(serializeCanonical(first.layouts), serializeCanonical(second.layouts));

  const fingerprints = first.layouts.map((layout) => fingerprintCanonical(layout));
  assert.deepEqual(fingerprints, second.layouts.map((layout) => fingerprintCanonical(layout)));
  assert.equal(new Set(fingerprints).size, fingerprints.length);

  const otherSeed = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    ...GENERATION_OPTIONS,
    seed: "fingerprint-replay-2",
  });
  assert.notDeepEqual(
    otherSeed.layouts.map((layout) => fingerprintCanonical(layout)),
    fingerprints,
  );

  // A single changed portal or space must move the fingerprint.
  const mutatedLayout = structuredClone(first.layouts[0]!);
  mutatedLayout.portals[0]!.length += 1;
  assert.notEqual(fingerprintCanonical(mutatedLayout), fingerprints[0]);
  const mutatedSpace = structuredClone(first.layouts[0]!);
  mutatedSpace.spaces[0]!.rect.x += 1;
  assert.notEqual(fingerprintCanonical(mutatedSpace), fingerprints[0]);
});

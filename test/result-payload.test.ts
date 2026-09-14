import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_NORMALIZED_PROJECT,
  GENERATION_RESULT_PAYLOAD_VERSION,
  fingerprintGenerationResult,
  generateLayouts,
  projectGenerationResult,
  serializeCanonical,
  serializeGenerationResult,
} from "../src/domain/index.ts";

/**
 * D4 (Stage 3 gate): the derived geometry indexes must stop being part of the
 * serialized generation result.  The in-memory result keeps them; the canonical
 * payload does not, because they are a pure function of the layout and brief and
 * they accounted for 99.6% of the bytes.
 */

const BUDGET = { maxCandidatesPerTopology: 2, maxTotalCandidates: 6 } as const;
const SEED = "result-payload-tests";

const result = generateLayouts(CANONICAL_NORMALIZED_PROJECT, { seed: SEED, budget: BUDGET });
if (result.layouts.length === 0) throw new Error("payload test fixture produced no layout");

test("the canonical payload carries semantics and leaves derived evidence out", () => {
  const payload = projectGenerationResult(result);
  assert.equal(payload.payloadVersion, GENERATION_RESULT_PAYLOAD_VERSION);
  assert.equal(payload.ok, result.ok);
  assert.deepEqual(payload.layouts.map((layout) => layout.id), result.layouts.map((l) => l.id));
  assert.deepEqual(payload.selection.layouts, result.selection.layouts.map((l) => l.id));
  assert.deepEqual(
    payload.selection.selected,
    result.selection.selected.map((item) => ({ strategy: item.strategy, layoutId: item.layout.id })),
  );
  assert.deepEqual(payload.metadata, result.metadata);
  assert.equal(payload.candidates.length, result.analyses.length);

  // The verdict survives (it is the reason a candidate exists) but its geometry
  // evidence does not, and neither does any raw facts/metrics tree.
  for (const [index, candidate] of payload.candidates.entries()) {
    const analysis = result.analyses[index]!;
    assert.equal(candidate.layoutId, analysis.layout.id);
    assert.equal(candidate.valid, analysis.validation.valid);
    assert.deepEqual(candidate.violationCodes, analysis.validation.violations.map((v) => v.code));
    assert.equal(candidate.scores.length, analysis.profiles.length);
  }

  const text = serializeGenerationResult(result);
  assert.equal(text.includes("\"facts\""), false, "no derived facts in the payload");
  assert.equal(text.includes("\"metrics\""), false, "no derived metrics in the payload");
  assert.equal(text.includes("sharedWallIndex"), false);
  assert.equal(text.includes("exteriorContactIndex"), false);
  // Strategy scores and their evidence references are semantics, so they stay.
  assert.equal(text.includes("\"overallScore\""), true);
  assert.equal(text.includes("\"categoryScores\""), true);
});

test("the payload is dramatically smaller than the whole result", () => {
  const whole = serializeCanonical(result);
  const payload = serializeGenerationResult(result);
  const wholeBytes = Buffer.byteLength(whole, "utf8");
  const payloadBytes = Buffer.byteLength(payload, "utf8");
  assert.ok(payloadBytes > 0);
  // Measured at ~100x on the canonical brief; assert a conservative floor so the
  // test reports a real regression rather than pinning an exact byte count.
  assert.ok(
    payloadBytes * 20 < wholeBytes,
    `payload ${payloadBytes} bytes must be far smaller than ${wholeBytes} bytes`,
  );
});

test("the payload fingerprint ignores derived data and follows real semantics", () => {
  const baseline = fingerprintGenerationResult(result);
  assert.equal(baseline, fingerprintGenerationResult(result), "deterministic for one result");
  assert.equal(
    baseline,
    fingerprintGenerationResult(generateLayouts(CANONICAL_NORMALIZED_PROJECT, { seed: SEED, budget: BUDGET })),
    "deterministic across runs of the same seed",
  );

  // Replace every candidate's derived evidence with junk. A payload that still
  // hashed facts or metrics would move here; the real one must not.
  const tampered = {
    ...result,
    analyses: result.analyses.map((analysis) => ({
      ...analysis,
      facts: { injected: "junk" },
      metrics: { injected: "junk" },
    })),
  } as unknown as typeof result;
  assert.equal(
    fingerprintGenerationResult(tampered),
    baseline,
    "the payload must not depend on the derived indexes",
  );

  // A genuinely different design must still be detectable.
  const other = generateLayouts(CANONICAL_NORMALIZED_PROJECT, {
    seed: `${SEED}-other`,
    budget: BUDGET,
  });
  assert.notEqual(fingerprintGenerationResult(other), baseline);
});

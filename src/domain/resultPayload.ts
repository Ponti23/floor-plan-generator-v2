/**
 * Canonical payload of a `GenerationResult` — the serialization contract.
 *
 * A `GenerationResult` carries two kinds of data:
 *
 * 1. **Semantics** — the authored layouts, the selected triplet, the diagnostics,
 *    the run metadata, and the strategy scores with their explanations.
 * 2. **Derived evidence** — `LayoutFacts` and `LayoutMetrics` for every one of the
 *    ~300 candidates. These are a pure function of the layout and the brief, they
 *    are recomputable on demand, and each candidate attaches the same facts object
 *    to itself *and* to each of its three scorecards.
 *
 * Serializing the second kind is what took the canonical result from ~0.9 MB of
 * layouts to **325.7 MB**, with the derived indexes accounting for **99.6%** of the
 * bytes. That is a poor worker-protocol shape for Milestone 4, where the payload
 * crosses a postMessage boundary, and a poor regression signal, because the hash
 * of the whole result is dominated by data that is fully determined by the layouts.
 *
 * This module defines the explicit projection instead: the semantic payload plus
 * the scorecard *results*, with derived evidence left out. Callers that want the
 * indexes keep using the in-memory result, or recompute them with
 * `computeLayoutFacts(layout, project)`.
 */
import type { GenerationResult } from "./generator.ts";
import { serializeCanonical, sha256Hex } from "./serialization.ts";

/** Version of this payload shape, independent of the engine and data schema. */
export const GENERATION_RESULT_PAYLOAD_VERSION = "planlab-generation-result-payload-1";

/** One strategy's displayed result for one candidate, without derived evidence. */
export interface PayloadScore {
  profileId: string;
  label: string;
  scoreModelVersion: string;
  calibrationVersion: string;
  overallScore: number;
  overallUtility: number;
  designScore: number | null;
  valid: boolean;
  categoryScores: Record<string, number>;
  explanations: Array<{
    key: string;
    impact: number;
    evidenceRefs: string[];
    message: unknown;
  }>;
}

/** One candidate's scores plus the verdict that justified them. */
export interface PayloadCandidate {
  layoutId: string;
  valid: boolean;
  violationCodes: string[];
  scores: PayloadScore[];
}

export interface GenerationResultPayload {
  payloadVersion: string;
  ok: boolean;
  layouts: GenerationResult["layouts"];
  diagnostics: GenerationResult["diagnostics"];
  selection: {
    status: string;
    threshold: number;
    complete: boolean;
    partial: boolean;
    reason: string | null;
    selected: Array<{ strategy: string; layoutId: string }>;
    layouts: string[];
    pairwiseDistances: GenerationResult["selection"]["pairwiseDistances"];
  };
  metadata: GenerationResult["metadata"];
  candidates: PayloadCandidate[];
}

/**
 * Project a generation result onto its serializable semantics.
 *
 * Hard verdicts are kept (they are the reason a candidate exists at all), and the
 * accompanying geometry evidence is dropped, because it is either recomputable or
 * already present in the layout itself.
 */
export function projectGenerationResult(result: GenerationResult): GenerationResultPayload {
  return {
    payloadVersion: GENERATION_RESULT_PAYLOAD_VERSION,
    ok: result.ok,
    layouts: result.layouts,
    diagnostics: result.diagnostics,
    selection: {
      status: result.selection.status,
      threshold: result.selection.threshold,
      complete: result.selection.complete,
      partial: result.selection.partial,
      reason: result.selection.reason ?? null,
      selected: result.selection.selected.map((item) => ({
        strategy: item.strategy,
        layoutId: item.layout.id,
      })),
      layouts: result.selection.layouts.map((layout) => layout.id),
      pairwiseDistances: result.selection.pairwiseDistances,
    },
    metadata: result.metadata,
    candidates: result.analyses.map((analysis) => ({
      layoutId: analysis.layout.id,
      valid: analysis.validation.valid,
      violationCodes: analysis.validation.violations.map((violation) => violation.code),
      scores: analysis.profiles.map((scorecard) => ({
        profileId: scorecard.profileId,
        label: scorecard.profile.label,
        scoreModelVersion: scorecard.scoreModelVersion,
        calibrationVersion: scorecard.calibrationVersion,
        overallScore: scorecard.overallScore,
        overallUtility: scorecard.overallUtility,
        designScore: scorecard.designScore,
        valid: scorecard.valid,
        categoryScores: { ...scorecard.categoryScores },
        explanations: scorecard.explanations.map((explanation) => ({
          key: explanation.key,
          impact: explanation.impact,
          evidenceRefs: [...explanation.evidenceRefs],
          message: explanation.message,
        })),
      })),
    })),
  };
}

/** Canonical JSON of the semantic payload. */
export function serializeGenerationResult(result: GenerationResult): string {
  return serializeCanonical(projectGenerationResult(result));
}

/** Stable fingerprint of the semantic payload. */
export function fingerprintGenerationResult(result: GenerationResult): string {
  return sha256Hex(serializeGenerationResult(result));
}

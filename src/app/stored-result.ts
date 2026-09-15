/**
 * The trimmed result document kept in local storage (bucket 6.5).
 *
 * The canonical payload for a full run is ~3.4 MB — 300 candidates, each with
 * three scorecards — which is too close to a browser's per-origin storage limit
 * to write on every generation. The workspace only ever displays the three
 * selected layouts, so the stored document keeps exactly those: the layouts the
 * selection names, their candidate scorecards, the selection summary and the
 * build versions that produced them.
 *
 * Anything else (the unfilled candidate pool, diagnostics detail) is dropped
 * rather than stored and then ignored.
 */

import {
  GENERATOR_BUDGET_VERSION,
  GENERATOR_DETERMINISM_VERSION,
  GENERATOR_ENGINE_VERSION,
  GENERATOR_RULE_VERSION,
} from "../domain/generator.ts";
import { CALIBRATION_VERSION } from "../domain/calibration.ts";
import { SCORING_VERSION } from "../domain/scoring.ts";
import type { GenerationResultPayload } from "../domain/resultPayload.ts";

export const STORED_RESULT_VERSION = 1;

/** Versions that decide whether a stored result can still be trusted. */
export interface ResultBuildVersions {
  payloadVersion: string;
  engineVersion: string;
  ruleVersion: string;
  scoringVersion: string;
  calibrationVersion: string;
  determinismVersion: string;
  budgetVersion: string;
}

export interface StoredResultDocument {
  storeVersion: number;
  savedAt: string;
  /**
   * Fingerprint of the authored brief this result was generated from.
   * Without it a reload cannot tell whether a stored result belongs to the
   * brief that was also loaded.
   */
  briefFingerprint: string;
  versions: ResultBuildVersions;
  payload: GenerationResultPayload;
}

/** The versions this build produces; a mismatch invalidates a stored result. */
export const CURRENT_RESULT_VERSIONS: ResultBuildVersions = Object.freeze({
  payloadVersion: "planlab-generation-result-payload-1",
  engineVersion: GENERATOR_ENGINE_VERSION,
  ruleVersion: GENERATOR_RULE_VERSION,
  scoringVersion: SCORING_VERSION,
  calibrationVersion: CALIBRATION_VERSION,
  determinismVersion: GENERATOR_DETERMINISM_VERSION,
  budgetVersion: GENERATOR_BUDGET_VERSION,
});

export function buildVersionsFromPayload(payload: GenerationResultPayload): ResultBuildVersions {
  const metadata = payload.metadata as Partial<ResultBuildVersions>;
  return {
    payloadVersion: payload.payloadVersion,
    engineVersion: metadata.engineVersion ?? "unknown",
    ruleVersion: metadata.ruleVersion ?? "unknown",
    scoringVersion: metadata.scoringVersion ?? "unknown",
    calibrationVersion: metadata.calibrationVersion ?? "unknown",
    determinismVersion: metadata.determinismVersion ?? "unknown",
    budgetVersion: metadata.budgetVersion ?? "unknown",
  };
}

/**
 * A stored result is only usable when every version that can change what a
 * score means still matches the running build.  A different engine, rule set,
 * scoring model, calibration surface, determinism policy or budget policy means
 * the old numbers describe a different program.
 */
export function versionsMatch(
  stored: Partial<ResultBuildVersions>,
  current: ResultBuildVersions = CURRENT_RESULT_VERSIONS,
): boolean {
  return (Object.keys(current) as (keyof ResultBuildVersions)[])
    .every((key) => stored[key] === current[key]);
}

export function projectStoredResult(
  payload: GenerationResultPayload,
  briefFingerprint: string,
  savedAt = new Date().toISOString(),
): StoredResultDocument {
  const selectedIds = new Set(payload.selection.selected.map((item) => item.layoutId));
  return {
    storeVersion: STORED_RESULT_VERSION,
    savedAt,
    briefFingerprint,
    versions: buildVersionsFromPayload(payload),
    payload: {
      payloadVersion: payload.payloadVersion,
      ok: payload.ok,
      layouts: payload.layouts.filter((layout) => selectedIds.has(layout.id)),
      diagnostics: [],
      selection: payload.selection,
      metadata: payload.metadata,
      candidates: payload.candidates.filter((candidate) => selectedIds.has(candidate.layoutId)),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Structural validation for a stored result payload.
 *
 * A stored value is untrusted input for the same reason a worker message is.
 * The workspace immediately dereferences `payload.ok`, `payload.selection`,
 * `payload.layouts` and `payload.candidates`, so this must be at least
 * structurally sound before `controller.restore()` is allowed to project it.
 */
function isStoredResultPayload(value: unknown): value is GenerationResultPayload {
  if (!isRecord(value)) return false;
  if (value.payloadVersion !== CURRENT_RESULT_VERSIONS.payloadVersion) return false;
  if (typeof value.ok !== "boolean") return false;
  if (!isRecord(value.selection)) return false;
  if (typeof value.selection.complete !== "boolean") return false;
  if (!Array.isArray(value.selection.selected)) return false;
  if (!value.selection.selected.every((item) =>
    isRecord(item) && typeof item.strategy === "string" && typeof item.layoutId === "string",
  )) {
    return false;
  }
  if (!Array.isArray(value.layouts)) return false;
  if (!Array.isArray(value.candidates)) return false;
  if (!Array.isArray(value.diagnostics)) return false;
  if (!isRecord(value.metadata)) return false;
  return true;
}

export type StoredResultReadOutcome =
  | { status: "empty" }
  | { status: "usable"; document: StoredResultDocument }
  /** Written by a build whose numbers would mean something different now. */
  | { status: "outdated"; stored: Partial<ResultBuildVersions> }
  | { status: "corrupt"; reason: string };

/** Classify a stored result document without trusting its shape. */
export function readStoredResult(
  raw: string | null,
  current: ResultBuildVersions = CURRENT_RESULT_VERSIONS,
): StoredResultReadOutcome {
  if (raw === null) return { status: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "corrupt", reason: "stored result is not valid JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "corrupt", reason: "stored result must be a JSON object" };
  }
  const document = parsed as Partial<StoredResultDocument>;
  if (document.storeVersion !== STORED_RESULT_VERSION) {
    return { status: "corrupt", reason: "stored result has an unknown store version" };
  }
  const payload = document.payload;
  const hasPayloadRecord = isRecord(payload);
  if (document.versions === undefined && (!hasPayloadRecord || typeof (payload as Record<string, unknown>).payloadVersion !== "string")) {
    return { status: "corrupt", reason: "stored result has no usable payload" };
  }
  if (document.versions !== undefined && !isRecord(document.versions)) {
    return { status: "corrupt", reason: "stored result has no usable version block" };
  }
  const versions = document.versions ?? (hasPayloadRecord
    ? buildVersionsFromPayload(payload as GenerationResultPayload)
    : {});

  // Version skew is classified before the full payload shape is trusted. A
  // real payload-version bump is a build change and must surface the stale
  // result notice, not a generic corrupt notice.
  if (!versionsMatch(versions, current)) return { status: "outdated", stored: versions };

  if (!isStoredResultPayload(payload)) {
    return { status: "corrupt", reason: "stored result has no usable payload" };
  }
  if (typeof document.briefFingerprint !== "string" || document.briefFingerprint.length === 0) {
    return { status: "corrupt", reason: "stored result has no brief fingerprint" };
  }
  return {
    status: "usable",
    document: {
      storeVersion: STORED_RESULT_VERSION,
      savedAt: typeof document.savedAt === "string" ? document.savedAt : new Date(0).toISOString(),
      briefFingerprint: document.briefFingerprint,
      versions: versions as ResultBuildVersions,
      payload,
    },
  };
}

/** True only when the stored result belongs to the supplied brief fingerprint. */
export function storedResultMatchesBrief(
  document: StoredResultDocument,
  briefFingerprint: string,
): boolean {
  return document.briefFingerprint === briefFingerprint;
}

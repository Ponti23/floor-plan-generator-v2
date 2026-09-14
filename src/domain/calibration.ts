import {
  METRIC_CATEGORIES,
  METRIC_CONFIG,
  type MetricCategory,
  type MetricConfig,
} from "./metrics.ts";

/**
 * Version of the inspectable scoring calibration surface.
 *
 * This is deliberately domain data rather than UI copy.  Architects can
 * review the weights, breakpoints, diversity policy, and semantic trade-off
 * descriptors together before any presentation layer is built.
 */
export const CALIBRATION_VERSION = "planlab-calibration-0.1";

export type CalibratedStrategyProfileId = "compactEfficiency" | "bestFlow" | "balanced";

export type StrategyProfileLabel = "Compact Efficiency" | "Best Flow" | "Balanced";

export interface StrategyProfileCalibration {
  id: CalibratedStrategyProfileId;
  label: StrategyProfileLabel;
  /** Category weights are normalized fractions and sum to one within float tolerance. */
  weights: Readonly<Record<MetricCategory, number>>;
}

export interface CalibrationMessageDescriptor {
  /** Semantic key; presentation adapters own localized wording. */
  key: string;
  values: Readonly<Record<string, string | number>>;
}

/**
 * Semantic strategy language.  It names what a profile emphasizes and what it
 * consequently de-emphasizes without pretending to be polished product copy.
 */
export interface StrategyTradeoffDescriptor {
  profileId: CalibratedStrategyProfileId;
  message: CalibrationMessageDescriptor;
  focusCategories: readonly MetricCategory[];
  tradeoffCategories: readonly MetricCategory[];
}

export interface DiversityCalibration {
  /** Minimum distance for two layouts to count as materially different. */
  threshold: number;
  /** Meaningful shared-wall cutoff used by the adjacency distance signal. */
  adjacencyThresholdUnits: number;
  /** Weights for the four approved distance components; these sum to one. */
  adjacencyWeight: number;
  centroidWeight: number;
  footprintWeight: number;
  circulationWeight: number;
  /** Weight of pairwise diversity in joint strategy selection. */
  selectionDiversityBonus: number;
  /** Deterministic cap on candidates considered per strategy pool. */
  shortlistSize: number;
}

export interface ExplanationCalibration {
  /** Maximum number of explanations retained after hard findings. */
  defaultLimit: number;
}

export interface ScoringCalibrationSurface {
  version: string;
  /** All normalized metric breakpoints and observation cutoffs. */
  metricConfig: Readonly<MetricConfig>;
  profiles: Readonly<Record<CalibratedStrategyProfileId, StrategyProfileCalibration>>;
  /** Language descriptors are separate so profile scores differ only by weights. */
  tradeoffs: Readonly<Record<CalibratedStrategyProfileId, StrategyTradeoffDescriptor>>;
  diversity: Readonly<DiversityCalibration>;
  explanations: Readonly<ExplanationCalibration>;
}

const PROFILE_WEIGHTS: Readonly<Record<CalibratedStrategyProfileId, Readonly<Record<MetricCategory, number>>>> = Object.freeze({
  compactEfficiency: Object.freeze({
    programSpace: 0.40,
    flow: 0.20,
    relationships: 0.15,
    liveability: 0.10,
    servicesSite: 0.15,
  }),
  bestFlow: Object.freeze({
    programSpace: 0.15,
    flow: 0.40,
    relationships: 0.25,
    liveability: 0.15,
    servicesSite: 0.05,
  }),
  balanced: Object.freeze({
    programSpace: 0.25,
    flow: 0.25,
    relationships: 0.20,
    liveability: 0.20,
    servicesSite: 0.10,
  }),
});

const PROFILES: Readonly<Record<CalibratedStrategyProfileId, StrategyProfileCalibration>> = Object.freeze({
  compactEfficiency: Object.freeze({
    id: "compactEfficiency",
    label: "Compact Efficiency",
    weights: PROFILE_WEIGHTS.compactEfficiency,
  }),
  bestFlow: Object.freeze({
    id: "bestFlow",
    label: "Best Flow",
    weights: PROFILE_WEIGHTS.bestFlow,
  }),
  balanced: Object.freeze({
    id: "balanced",
    label: "Balanced",
    weights: PROFILE_WEIGHTS.balanced,
  }),
});

/**
 * The descriptors intentionally use message keys and category values instead
 * of prose.  A UI can translate them later without hiding the calibration
 * decision in presentation code.
 */
const TRADEOFFS: Readonly<Record<CalibratedStrategyProfileId, StrategyTradeoffDescriptor>> = Object.freeze({
  compactEfficiency: Object.freeze({
    profileId: "compactEfficiency",
    message: Object.freeze({
      key: "strategy.compactEfficiency.tradeoff",
      values: Object.freeze({
        focusCategory: "programSpace",
        focusWeight: PROFILE_WEIGHTS.compactEfficiency.programSpace,
        tradeoffCategory: "flow",
        tradeoffWeight: PROFILE_WEIGHTS.compactEfficiency.flow,
      }),
    }),
    focusCategories: Object.freeze(["programSpace", "servicesSite"] as const),
    tradeoffCategories: Object.freeze(["flow", "relationships", "liveability"] as const),
  }),
  bestFlow: Object.freeze({
    profileId: "bestFlow",
    message: Object.freeze({
      key: "strategy.bestFlow.tradeoff",
      values: Object.freeze({
        focusCategory: "flow",
        focusWeight: PROFILE_WEIGHTS.bestFlow.flow,
        tradeoffCategory: "servicesSite",
        tradeoffWeight: PROFILE_WEIGHTS.bestFlow.servicesSite,
      }),
    }),
    focusCategories: Object.freeze(["flow", "relationships"] as const),
    tradeoffCategories: Object.freeze(["programSpace", "liveability", "servicesSite"] as const),
  }),
  balanced: Object.freeze({
    profileId: "balanced",
    message: Object.freeze({
      key: "strategy.balanced.tradeoff",
      values: Object.freeze({
        focusCategory: "programSpace|flow",
        focusWeight: PROFILE_WEIGHTS.balanced.programSpace,
        tradeoffCategory: "servicesSite",
        tradeoffWeight: PROFILE_WEIGHTS.balanced.servicesSite,
      }),
    }),
    focusCategories: Object.freeze(["programSpace", "flow", "relationships", "liveability"] as const),
    tradeoffCategories: Object.freeze(["servicesSite"] as const),
  }),
});

const DIVERSITY_CALIBRATION: Readonly<DiversityCalibration> = Object.freeze({
  threshold: 0.20,
  adjacencyThresholdUnits: METRIC_CONFIG.defaultAdjacencyTargetUnits,
  adjacencyWeight: 0.45,
  centroidWeight: 0.35,
  footprintWeight: 0.10,
  circulationWeight: 0.10,
  selectionDiversityBonus: 0.50,
  shortlistSize: 24,
});

const EXPLANATION_CALIBRATION: Readonly<ExplanationCalibration> = Object.freeze({
  defaultLimit: 10,
});

/** One frozen, serialisable source for all soft scoring calibration values. */
export const CALIBRATION_SURFACE: ScoringCalibrationSurface = Object.freeze({
  version: CALIBRATION_VERSION,
  metricConfig: METRIC_CONFIG,
  profiles: PROFILES,
  tradeoffs: TRADEOFFS,
  diversity: DIVERSITY_CALIBRATION,
  explanations: EXPLANATION_CALIBRATION,
});

/** Explicit name for callers that think in terms of the scoring model. */
export const SCORING_CALIBRATION = CALIBRATION_SURFACE;
export const STRATEGY_CALIBRATION = CALIBRATION_SURFACE;

export const CALIBRATED_STRATEGY_PROFILE_IDS: readonly CalibratedStrategyProfileId[] = Object.freeze([
  "compactEfficiency",
  "bestFlow",
  "balanced",
] as const);

/** Sum a profile's category fractions without rounding. */
export function strategyWeightTotal(profile: Pick<StrategyProfileCalibration, "weights">): number {
  return METRIC_CATEGORIES.reduce((total, category) => total + profile.weights[category], 0);
}

/** Stable, inspectable totals useful to diagnostics and calibration tests. */
export function strategyWeightTotals(
  surface: ScoringCalibrationSurface = CALIBRATION_SURFACE,
): Readonly<Record<CalibratedStrategyProfileId, number>> {
  return Object.freeze(Object.fromEntries(
    CALIBRATED_STRATEGY_PROFILE_IDS.map((id) => [id, strategyWeightTotal(surface.profiles[id])]),
  ) as Record<CalibratedStrategyProfileId, number>);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const expectedSet = new Set(expected);
  return actual.every((key) => expectedSet.has(key));
}

function finiteInRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

/**
 * Return all calibration-shape issues without changing or normalizing the
 * supplied object.  Keeping this as data validation makes a future editor
 * able to reject an unsafe calibration before it reaches scoring.
 */
export function calibrationIssues(surface: unknown = CALIBRATION_SURFACE): string[] {
  const issues: string[] = [];
  if (!isRecord(surface)) return ["surface must be an object"];
  if (typeof surface.version !== "string" || surface.version.length === 0) {
    issues.push("version must be a non-empty string");
  }
  if (!isRecord(surface.metricConfig)) {
    issues.push("metricConfig must be an object");
  } else {
    if (!sameKeys(Object.keys(surface.metricConfig), Object.keys(METRIC_CONFIG))) {
      issues.push("metricConfig must contain exactly the named metric breakpoints");
    }
    for (const [key, value] of Object.entries(surface.metricConfig)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        issues.push(`metricConfig.${key} must be finite and non-negative`);
      }
    }
    const config = surface.metricConfig as Partial<MetricConfig>;
    if (typeof config.defaultPreferredAspectRatio === "number" && config.defaultPreferredAspectRatio <= 0) {
      issues.push("metricConfig.defaultPreferredAspectRatio must be greater than zero");
    }
    if (typeof config.preferredAreaOversizeTolerance === "number" && config.preferredAreaOversizeTolerance < 1) {
      issues.push("metricConfig.preferredAreaOversizeTolerance must be at least one");
    }
    if (typeof config.preferredAreaZeroUtilityRatio === "number" &&
      typeof config.preferredAreaOversizeTolerance === "number" &&
      config.preferredAreaZeroUtilityRatio <= config.preferredAreaOversizeTolerance) {
      issues.push("metricConfig.preferredAreaZeroUtilityRatio must exceed oversize tolerance");
    }
    if (typeof config.defaultHardAspectRatio === "number" &&
      typeof config.defaultPreferredAspectRatio === "number" &&
      config.defaultHardAspectRatio < config.defaultPreferredAspectRatio) {
      issues.push("metricConfig.defaultHardAspectRatio must reach preferred aspect ratio");
    }
    if (typeof config.unacceptableCirculationRatio === "number" &&
      typeof config.targetCirculationRatio === "number" &&
      config.unacceptableCirculationRatio <= config.targetCirculationRatio) {
      issues.push("metricConfig.unacceptableCirculationRatio must exceed target ratio");
    }
    if (typeof config.strongObservationUtilityThreshold === "number" &&
      !finiteInRange(config.strongObservationUtilityThreshold, 0, 1)) {
      issues.push("metricConfig.strongObservationUtilityThreshold must be between zero and one");
    }
    if (typeof config.weakObservationUtilityThreshold === "number" &&
      !finiteInRange(config.weakObservationUtilityThreshold, 0, 1)) {
      issues.push("metricConfig.weakObservationUtilityThreshold must be between zero and one");
    }
    if (typeof config.strongObservationUtilityThreshold === "number" &&
      typeof config.weakObservationUtilityThreshold === "number" &&
      config.strongObservationUtilityThreshold <= config.weakObservationUtilityThreshold) {
      issues.push("metricConfig.strongObservationUtilityThreshold must exceed weak threshold");
    }
    if (typeof config.privateDepthTargetUnits === "number" && config.privateDepthTargetUnits <= 0) {
      issues.push("metricConfig.privateDepthTargetUnits must be greater than zero");
    }
    if (typeof config.deadEndBaselineComponents === "number" && config.deadEndBaselineComponents <= 0) {
      issues.push("metricConfig.deadEndBaselineComponents must be greater than zero");
    }
  }

  const profiles = surface.profiles;
  if (!isRecord(profiles)) {
    issues.push("profiles must be an object");
  } else {
    const profileKeys = Object.keys(profiles);
    if (!sameKeys(profileKeys, CALIBRATED_STRATEGY_PROFILE_IDS)) {
      issues.push("profiles must contain exactly the three calibrated strategy ids");
    }
    for (const id of CALIBRATED_STRATEGY_PROFILE_IDS) {
      const profile = profiles[id];
      if (!isRecord(profile)) {
        issues.push(`profiles.${id} must be an object`);
        continue;
      }
      if (profile.id !== id) issues.push(`profiles.${id}.id must match its key`);
      if (typeof profile.label !== "string" || profile.label.length === 0) {
        issues.push(`profiles.${id}.label must be non-empty`);
      }
      const weights = profile.weights;
      if (!isRecord(weights)) {
        issues.push(`profiles.${id}.weights must be an object`);
        continue;
      }
      if (!sameKeys(Object.keys(weights), METRIC_CATEGORIES)) {
        issues.push(`profiles.${id}.weights must contain exactly the five metric categories`);
      }
      for (const category of METRIC_CATEGORIES) {
        if (!finiteInRange(weights[category], 0, 1)) {
          issues.push(`profiles.${id}.weights.${category} must be between zero and one`);
        }
      }
      const total = METRIC_CATEGORIES.reduce((sum, category) =>
        sum + (typeof weights[category] === "number" && Number.isFinite(weights[category]) ? weights[category] : 0), 0);
      if (Math.abs(total - 1) > 1e-9) issues.push(`profiles.${id}.weights must sum to one`);
    }
  }

  const tradeoffs = surface.tradeoffs;
  if (!isRecord(tradeoffs)) {
    issues.push("tradeoffs must be an object");
  } else {
    if (!sameKeys(Object.keys(tradeoffs), CALIBRATED_STRATEGY_PROFILE_IDS)) {
      issues.push("tradeoffs must contain exactly the three calibrated strategy ids");
    }
    for (const id of CALIBRATED_STRATEGY_PROFILE_IDS) {
      const tradeoff = tradeoffs[id];
      if (!isRecord(tradeoff)) {
        issues.push(`tradeoffs.${id} must be an object`);
        continue;
      }
      if (tradeoff.profileId !== id) issues.push(`tradeoffs.${id}.profileId must match its key`);
      if (!isRecord(tradeoff.message) || typeof tradeoff.message.key !== "string") {
        issues.push(`tradeoffs.${id}.message must contain a semantic key`);
      }
      for (const field of ["focusCategories", "tradeoffCategories"] as const) {
        const values = tradeoff[field];
        if (!Array.isArray(values) || values.some((value) => !METRIC_CATEGORIES.includes(value as MetricCategory))) {
          issues.push(`tradeoffs.${id}.${field} must contain metric categories`);
        }
      }
    }
  }

  const diversity = isRecord(surface.diversity) ? surface.diversity : undefined;
  if (!diversity) {
    issues.push("diversity must be an object");
  } else {
    if (!finiteInRange(diversity.threshold, 0, 1)) issues.push("diversity.threshold must be between zero and one");
    if (typeof diversity.adjacencyThresholdUnits !== "number" ||
      !Number.isFinite(diversity.adjacencyThresholdUnits) || diversity.adjacencyThresholdUnits <= 0) {
      issues.push("diversity.adjacencyThresholdUnits must be finite and greater than zero");
    }
    const distanceWeights: unknown[] = [
      diversity.adjacencyWeight,
      diversity.centroidWeight,
      diversity.footprintWeight,
      diversity.circulationWeight,
    ];
    if (distanceWeights.some((value) => !finiteInRange(value, 0, 1))) {
      issues.push("diversity component weights must be between zero and one");
    }
    const numericDistanceWeights = distanceWeights.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (numericDistanceWeights.length === distanceWeights.length &&
      Math.abs(numericDistanceWeights.reduce((sum, value) => sum + value, 0) - 1) > 1e-9) {
      issues.push("diversity component weights must sum to one");
    }
    if (!finiteInRange(diversity.selectionDiversityBonus, 0, Number.POSITIVE_INFINITY)) {
      issues.push("diversity.selectionDiversityBonus must be finite and non-negative");
    }
    if (typeof diversity.shortlistSize !== "number" ||
      !Number.isSafeInteger(diversity.shortlistSize) || diversity.shortlistSize <= 0) {
      issues.push("diversity.shortlistSize must be a positive safe integer");
    }
  }

  const explanations = isRecord(surface.explanations) ? surface.explanations : undefined;
  if (!explanations || typeof explanations.defaultLimit !== "number" ||
    !Number.isSafeInteger(explanations.defaultLimit) || explanations.defaultLimit <= 0) {
    issues.push("explanations.defaultLimit must be a positive safe integer");
  }
  return issues;
}

/** Throw a useful error before an externally supplied calibration is used. */
export function assertCalibrationSurface(
  surface: unknown = CALIBRATION_SURFACE,
): asserts surface is ScoringCalibrationSurface {
  const issues = calibrationIssues(surface);
  if (issues.length > 0) throw new RangeError(`invalid scoring calibration: ${issues.join("; ")}`);
}

// Fail fast if a future edit makes the built-in data internally inconsistent.
assertCalibrationSurface(CALIBRATION_SURFACE);

import type { Layout, PlacedSpace } from "./layout.ts";
import type { NormalizedProject } from "./model.ts";
import {
  METRIC_CATEGORIES,
  evaluateLayoutMetrics,
  computeLayoutFacts,
  type CategoryMetrics,
  type LayoutFacts,
  type LayoutMetrics,
  type MetricCategory,
  type MetricObservation,
  type MessageDescriptor,
} from "./metrics.ts";
import {
  validateLayout,
  validationMatchesInput,
  type ValidationResult,
} from "./validation.ts";
import {
  CALIBRATION_SURFACE,
  CALIBRATED_STRATEGY_PROFILE_IDS,
  assertCalibrationSurface,
  strategyWeightTotals,
  type StrategyProfileCalibration,
  type CalibratedStrategyProfileId,
  type StrategyTradeoffDescriptor,
  type ScoringCalibrationSurface,
} from "./calibration.ts";

export const SCORING_VERSION = "planlab-scoring-0.6";

export type StrategyProfileId = CalibratedStrategyProfileId;

export type StrategyProfile = StrategyProfileCalibration;

/** Initial hypotheses from SCORING_SYSTEM.md, owned by the calibration surface. */
export const STRATEGY_PROFILES: Readonly<Record<StrategyProfileId, StrategyProfile>> = CALIBRATION_SURFACE.profiles;

export const STRATEGY_PROFILE_IDS: readonly StrategyProfileId[] = CALIBRATED_STRATEGY_PROFILE_IDS;

export const SCORE_PROFILES = STRATEGY_PROFILES;
export const strategyProfiles = STRATEGY_PROFILES;

/** The calibrated semantic strategy language shown alongside score evidence. */
export const STRATEGY_TRADEOFFS: Readonly<Record<StrategyProfileId, StrategyTradeoffDescriptor>> =
  CALIBRATION_SURFACE.tradeoffs;

/** Stable, inspectable totals for calibration review and diagnostics. */
export const STRATEGY_WEIGHT_TOTALS = Object.freeze(strategyWeightTotals(CALIBRATION_SURFACE));

export interface ScoreExplanation {
  category?: MetricCategory;
  key: string;
  impact: number;
  evidenceRefs: string[];
  message: MessageDescriptor;
}

export interface LayoutScorecard {
  scoreModelVersion: string;
  calibrationVersion: string;
  profileId: StrategyProfileId;
  profile: StrategyProfile;
  /** Display score is whole-number by design; utility keeps ranking precision. */
  overallScore: number;
  overallUtility: number;
  /** `score` and `designScore` are compatibility-friendly display aliases. */
  score: number;
  designScore: number | null;
  valid: boolean;
  validation: ValidationResult;
  ruleReport: ValidationResult;
  facts: LayoutFacts;
  metrics: LayoutMetrics;
  categories: Record<MetricCategory, CategoryMetrics>;
  categoryScores: Record<MetricCategory, number>;
  /** Semantic strategy trade-off descriptor; presentation supplies wording. */
  tradeoffs: readonly StrategyTradeoffDescriptor[];
  explanations: ScoreExplanation[];
}

export interface LayoutScorecardSet {
  layout: Layout;
  calibrationVersion: string;
  valid: boolean;
  validation: ValidationResult;
  ruleReport: ValidationResult;
  facts: LayoutFacts;
  metrics: LayoutMetrics;
  scorecards: Record<StrategyProfileId, LayoutScorecard>;
  /** Array is convenient for crude diagnostics and stable serialization. */
  profiles: LayoutScorecard[];
}

export interface ScoreCandidatesOptions {
  includeInvalid?: boolean;
  factsByLayoutId?: Readonly<Record<string, LayoutFacts>>;
  /** Optional reviewed calibration; hard validation is never sourced from it. */
  calibration?: ScoringCalibrationSurface;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function profileId(value: StrategyProfileId | string | undefined): StrategyProfileId {
  switch ((value ?? "balanced").toLowerCase().replace(/[\s_-]+/g, "")) {
    case "compact":
    case "compactefficiency":
    case "compact-efficiency":
    case "efficiency":
      return "compactEfficiency";
    case "flow":
    case "bestflow":
    case "best-flow":
      return "bestFlow";
    case "balanced":
      return "balanced";
    default:
      throw new RangeError(`unknown scoring profile: ${value}`);
  }
}

function categoryObservations(
  category: CategoryMetrics,
  weight: number,
): ScoreExplanation[] {
  return category.metrics.flatMap((metric) => metric.observations.map((observation) => ({
    category: category.category,
    key: observation.key,
    impact: observation.impact * weight,
    evidenceRefs: [...observation.evidenceRefs],
    message: observation.message,
  })));
}

function hardExplanations(validation: ValidationResult): ScoreExplanation[] {
  if (validation.valid) {
    return [{
      key: "validation.hard.pass",
      impact: 0,
      evidenceRefs: ["validation:hard"],
      message: { key: "validation.hard.pass", values: { status: "PASS" } },
    }];
  }
  return validation.violations.map((violation) => ({
    key: `validation.${violation.code.toLowerCase()}`,
    impact: -1,
    evidenceRefs: [
      `validation:${violation.code}`,
      ...violation.subjects.map((subject) => `subject:${subject}`),
    ],
    message: violation.message,
  }));
}

function explanationOrder(category: MetricCategory | undefined): number {
  if (category === undefined) return -1;
  return METRIC_CATEGORIES.indexOf(category);
}

/** Deterministic, evidence-preserving explanation selection. */
export function selectExplanations(
  validation: ValidationResult,
  metrics: LayoutMetrics,
  profile: StrategyProfile,
  limit = CALIBRATION_SURFACE.explanations.defaultLimit,
): ScoreExplanation[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("explanation limit must be a positive safe integer");
  }
  const hard = hardExplanations(validation);
  const soft = METRIC_CATEGORIES.flatMap((category) =>
    categoryObservations(metrics.categories[category], profile.weights[category]),
  );
  const dedupedSoft: ScoreExplanation[] = [];
  const keys = new Set<string>();
  for (const explanation of soft.sort((a, b) =>
    explanationOrder(a.category) - explanationOrder(b.category) ||
    Math.abs(b.impact) - Math.abs(a.impact) ||
    compareText(a.key, b.key) ||
    compareText(a.evidenceRefs.join("|"), b.evidenceRefs.join("|")),
  )) {
    const dedupeKey = `${explanation.key}|${explanation.evidenceRefs.join(",")}`;
    if (keys.has(dedupeKey)) continue;
    keys.add(dedupeKey);
    dedupedSoft.push(explanation);
  }
  // Hard findings are always retained. Soft findings are capped after them so
  // the scorecard never hides an authoritative validation result.
  const hardCount = hard.length;
  if (hardCount >= limit) return hard;
  const softLimit = Math.max(0, limit - hardCount);

  // Keep one strongest positive and one strongest negative observation in
  // every category where both exist before filling any remaining slots by
  // materiality.  This preserves an explicit trade-off in later categories
  // when an earlier category emits many findings.
  const selectedSoft: ScoreExplanation[] = [];
  const selectedKeys = new Set<string>();
  const keyFor = (item: ScoreExplanation): string => `${item.key}|${item.evidenceRefs.join(",")}`;
  const ranked = (items: ScoreExplanation[]): ScoreExplanation[] => items.slice().sort((a, b) =>
    Math.abs(b.impact) - Math.abs(a.impact) ||
    compareText(a.key, b.key) ||
    compareText(a.evidenceRefs.join("|"), b.evidenceRefs.join("|")),
  );
  for (const category of METRIC_CATEGORIES) {
    const observations = dedupedSoft.filter((item) => item.category === category);
    for (const item of [
      ranked(observations.filter((observation) => observation.impact > 0))[0],
      ranked(observations.filter((observation) => observation.impact < 0))[0],
    ]) {
      if (!item) continue;
      const key = keyFor(item);
      if (selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      selectedSoft.push(item);
    }
  }
  for (const item of dedupedSoft) {
    if (selectedSoft.length >= softLimit) break;
    const key = keyFor(item);
    if (selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    selectedSoft.push(item);
  }
  selectedSoft.sort((a, b) =>
    explanationOrder(a.category) - explanationOrder(b.category) ||
    Math.abs(b.impact) - Math.abs(a.impact) ||
    compareText(a.key, b.key) ||
    compareText(a.evidenceRefs.join("|"), b.evidenceRefs.join("|")),
  );
  return [...hard, ...selectedSoft.slice(0, softLimit)];
}

function createScorecard(
  layout: Layout,
  validation: ValidationResult,
  facts: LayoutFacts,
  metrics: LayoutMetrics,
  id: StrategyProfileId,
  calibration: ScoringCalibrationSurface = CALIBRATION_SURFACE,
): LayoutScorecard {
  assertCalibrationSurface(calibration);
  const profile = calibration.profiles[id];
  const valid = validation.valid;
  const categories = metrics.categories;
  const categoryScores = Object.fromEntries(
    METRIC_CATEGORIES.map((category) => [category, valid ? categories[category].score : 0]),
  ) as Record<MetricCategory, number>;
  const overallUtility = valid
    ? METRIC_CATEGORIES.reduce(
      (total, category) => total + categories[category].utility * profile.weights[category],
      0,
    )
    : 0;
  const overallScore = Math.round(clamp01(overallUtility) * 100);
  return {
    scoreModelVersion: SCORING_VERSION,
    calibrationVersion: calibration.version,
    profileId: id,
    profile,
    overallScore,
    overallUtility: clamp01(overallUtility),
    score: overallScore,
    designScore: valid ? overallScore : null,
    valid,
    validation,
    ruleReport: validation,
    facts,
    metrics,
    categories,
    categoryScores,
    tradeoffs: [calibration.tradeoffs[id]],
    explanations: selectExplanations(validation, metrics, profile, calibration.explanations.defaultLimit),
  };
}

/**
 * Score one candidate for one strategy. Invalid candidates get no design
 * points. Facts and metrics remain attached for debugging, but all displayed
 * category/overall scores are zero and `designScore` is null.
 */
export function scoreLayout(
  layout: Layout,
  project: NormalizedProject,
  strategy: StrategyProfileId | string = "balanced",
  facts?: LayoutFacts,
  validation?: ValidationResult,
  calibration: ScoringCalibrationSurface = CALIBRATION_SURFACE,
): LayoutScorecard {
  assertCalibrationSurface(calibration);
  const id = profileId(strategy);
  const hard = validation && validationMatchesInput(validation, layout, project)
    ? validation
    : validateLayout(layout, project);
  const derivedFacts = facts ?? computeLayoutFacts(layout, project, hard);
  const metrics = evaluateLayoutMetrics(layout, project, derivedFacts, calibration.metricConfig);
  return createScorecard(layout, hard, derivedFacts, metrics, id, calibration);
}

export const calculateScore = scoreLayout;
export const scoreCandidate = scoreLayout;

/** Compute all three strategy scorecards from one validation/facts pass. */
export function scoreLayoutProfiles(
  layout: Layout,
  project: NormalizedProject,
  facts?: LayoutFacts,
  validation?: ValidationResult,
  calibration: ScoringCalibrationSurface = CALIBRATION_SURFACE,
): LayoutScorecardSet {
  assertCalibrationSurface(calibration);
  const hard = validation && validationMatchesInput(validation, layout, project)
    ? validation
    : validateLayout(layout, project);
  const derivedFacts = facts ?? computeLayoutFacts(layout, project, hard);
  const metrics = evaluateLayoutMetrics(layout, project, derivedFacts, calibration.metricConfig);
  const scorecards = Object.fromEntries(
    STRATEGY_PROFILE_IDS.map((id) => [id, createScorecard(layout, hard, derivedFacts, metrics, id, calibration)]),
  ) as Record<StrategyProfileId, LayoutScorecard>;
  return {
    layout,
    calibrationVersion: calibration.version,
    valid: hard.valid,
    validation: hard,
    ruleReport: hard,
    facts: derivedFacts,
    metrics,
    scorecards,
    profiles: STRATEGY_PROFILE_IDS.map((id) => scorecards[id]),
  };
}

export const scoreAllProfiles = scoreLayoutProfiles;
export const calculateScorecards = scoreLayoutProfiles;

export interface ScoredLayoutCandidate extends LayoutScorecardSet {
  /** Stable convenience aliases for selection callers. */
  id: string;
  scores: Record<StrategyProfileId, number>;
}

export function scoreCandidates(
  layouts: readonly Layout[],
  project: NormalizedProject,
  options: ScoreCandidatesOptions = {},
): ScoredLayoutCandidate[] {
  const calibration = options.calibration ?? CALIBRATION_SURFACE;
  assertCalibrationSurface(calibration);
  const result: ScoredLayoutCandidate[] = [];
  for (const layout of layouts) {
    const validation = validateLayout(layout, project);
    if (!options.includeInvalid && !validation.valid) continue;
    const facts = options.factsByLayoutId?.[layout.id] ?? computeLayoutFacts(layout, project, validation);
    const set = scoreLayoutProfiles(layout, project, facts, validation, calibration);
    result.push({
      ...set,
      id: layout.id,
      scores: Object.fromEntries(
        STRATEGY_PROFILE_IDS.map((id) => [id, set.scorecards[id].overallScore]),
      ) as Record<StrategyProfileId, number>,
    });
  }
  return result;
}

export const scoreLayouts = scoreCandidates;
export const analyzeLayouts = scoreCandidates;

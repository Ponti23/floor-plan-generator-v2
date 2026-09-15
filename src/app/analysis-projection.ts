/**
 * Presentation projections for Milestone 5.3 (result selector + analysis panel).
 *
 * The canonical result payload carries the layouts, the selected triplet, the
 * category scores and the score explanations, but it deliberately omits the
 * derived evidence index.  The panel only ever speaks about the three selected
 * layouts, so this module recomputes the authoritative facts and rule
 * evaluations for exactly those layouts, on demand, and memoises the result per
 * (layout, project snapshot).
 *
 * Nothing here changes the payload shape, the worker protocol, solver
 * semantics, or any recorded verdict.  It is a read-only projection over the
 * same domain functions the generator uses, so a displayed number can always be
 * traced back to a real value rather than to a decorative placeholder.
 */

import { GRID_M2, GRID_UNIT_METRES } from "../domain/constants.ts";
import type { Layout, PlacedSpace } from "../domain/layout.ts";
import type { NormalizedProject } from "../domain/model.ts";
import { computeLayoutFacts, type LayoutFacts } from "../domain/metrics.ts";
import {
  evaluatePlanlabCoreRules,
  prepareRuleContext,
  type RuleEvaluation,
} from "../domain/rules.ts";
import type { GenerationResultPayload, PayloadCandidate } from "../domain/resultPayload.ts";
import type { PlanLabPresentationCopy } from "./presentation-copy.ts";

type Copy = PlanLabPresentationCopy;

const OPTION_SLOTS = ["A", "B", "C"] as const;

export type RuleCheckStatus = "pass" | "warning" | "fail";

export interface RuleCheckRow {
  /** Rule definition id, stable across runs. */
  id: string;
  /** Humanised label derived from the definition id. */
  label: string;
  status: RuleCheckStatus;
  enforcement: "hard" | "soft";
  /** Stable violation code for failed/warning rows. */
  code: string | null;
  subjects: string[];
  evidenceRefs: string[];
}

export interface RuleCheckProjection {
  failures: RuleCheckRow[];
  warnings: RuleCheckRow[];
  /** Rules that evaluated to `pass` for this layout. */
  passedCount: number;
  /** Rules that do not apply to this layout at all. */
  notApplicableCount: number;
}

export interface MetricRow {
  id: string;
  label: string;
  /** Formatted value including unit, or null when the fact is not a number. */
  value: string | null;
  /** How the value is derived, for the accessible name. */
  definition: string;
}

export interface CategoryRow {
  category: string;
  label: string;
  /** Whole-number category score, as displayed. */
  score: number;
}

export interface OptionCardView {
  slot: (typeof OPTION_SLOTS)[number];
  layoutId: string | null;
  strategyLabel: string;
  score: number | null;
  thumbnail: string;
  selected: boolean;
  /** Honest reason for an empty slot; null when the slot holds a layout. */
  emptyReason: string | null;
}

export interface SelectedScorecard {
  strategy: string;
  label: string;
  overallScore: number;
  categoryScores: Record<string, number>;
  explanations: GenerationResultPayload["candidates"][number]["scores"][number]["explanations"];
}

export interface CandidateEvidence {
  facts: LayoutFacts;
  rules: RuleCheckProjection;
}

const evidenceCache = new Map<string, { project: NormalizedProject; evidence: CandidateEvidence }>();

/**
 * Facts and rule evaluations for one layout, memoised per project snapshot.
 * The cache key is the layout id plus object identity of the project, so a new
 * committed brief can never reuse an earlier snapshot's evidence.
 */
export function candidateEvidence(
  layout: Layout,
  project: NormalizedProject,
): CandidateEvidence {
  const cached = evidenceCache.get(layout.id);
  if (cached && cached.project === project) return cached.evidence;
  const evidence: CandidateEvidence = {
    facts: computeLayoutFacts(layout, project),
    rules: projectRuleChecks(evaluatePlanlabCoreRules(prepareRuleContext(layout, project))),
  };
  evidenceCache.set(layout.id, { project, evidence });
  return evidence;
}

/** Test seam: forget memoised evidence. */
export function clearCandidateEvidenceCache(): void {
  evidenceCache.clear();
}

/** Turn a domain identifier into readable words without inventing a claim. */
export function humaniseIdentifier(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim();
  const words = spaced.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return value;
  const isAcronym = words.every((word) => word === word.toUpperCase());
  const sentence = words.join(" ");
  if (isAcronym) return sentence.charAt(0) + sentence.slice(1).toLowerCase();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1).toLowerCase();
}

function observationQualifierSuffix(qualifier: string, copy: Copy): string {
  const key = qualifier as keyof typeof copy.analysis.observationQualifiers;
  return copy.analysis.observationQualifiers[key] ?? humaniseIdentifier(qualifier);
}

/**
 * Readable label for a score-explanation key such as
 * `programSpace.preferredArea.strong`.  The domain key stays the source of
 * truth; only the wording is presentation.
 */
export function observationLabel(key: string, copy: Copy): string {
  const parts = key.split(".").filter((part) => part.length > 0);
  if (parts.length === 0) return key;
  const qualifiers = copy.analysis.observationQualifiers as Record<string, string>;
  const last = parts[parts.length - 1];
  const qualifier = parts.length > 1 && qualifiers[last] !== undefined ? parts.pop()! : null;
  const categoryLabel = (copy.metricLabels as Record<string, string>)[parts[0]] ?? null;
  const subjectParts = categoryLabel ? parts.slice(1) : parts;
  const subject = subjectParts.length > 0
    ? subjectParts.map((part) => humaniseIdentifier(part)).join(" · ")
    : categoryLabel ?? humaniseIdentifier(parts[0] ?? key);
  const qualifierSuffix = qualifier ? ` (${observationQualifierSuffix(qualifier, copy)})` : "";
  return `${subject}${qualifierSuffix}`;
}

function projectRuleChecks(evaluations: readonly RuleEvaluation[]): RuleCheckProjection {
  const failures: RuleCheckRow[] = [];
  const warnings: RuleCheckRow[] = [];
  let passedCount = 0;
  let notApplicableCount = 0;
  for (const evaluation of evaluations) {
    if (evaluation.status === "notApplicable") {
      notApplicableCount += 1;
      continue;
    }
    if (evaluation.status === "pass") {
      passedCount += 1;
      continue;
    }
    const row: RuleCheckRow = {
      id: evaluation.ruleDefinitionId,
      label: humaniseIdentifier(evaluation.ruleDefinitionId),
      status: evaluation.status === "warning" ? "warning" : "fail",
      enforcement: evaluation.enforcement,
      code: evaluation.code,
      subjects: evaluation.subjects.map((subject) => subject.id),
      // Subjects are placed-space ids, so a failing rule can highlight real
      // geometry through the same resolver the observations use.
      evidenceRefs: evaluation.subjects
        .map((subject) => subject.id)
        .filter((id) => id.length > 0)
        .map((id) => `space:${id}`),
    };
    if (row.status === "warning") warnings.push(row);
    else failures.push(row);
  }
  const byLabel = (a: RuleCheckRow, b: RuleCheckRow): number => a.label.localeCompare(b.label);
  failures.sort(byLabel);
  warnings.sort(byLabel);
  return { failures, warnings, passedCount, notApplicableCount };
}

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits);
}

/**
 * Raw metric rows for the selected-option summary.
 *
 * A row is produced only when the value is a finite number.  Rows are never
 * filled with a placeholder, and no row is invented for a value the brief,
 * layout, or facts object does not actually carry.
 */
export function projectMetricRows(facts: LayoutFacts, copy: Copy): MetricRow[] {
  const labels = copy.analysis.rawMetricLabels;
  const definitions = copy.analysis.rawMetricDefinitions;
  const candidates: MetricRow[] = [
    {
      id: "usableArea",
      label: labels.usableArea,
      value: finite(facts.programmedUsableAreaM2, (value) => `${formatNumber(value, 1)} ${copy.ui.units.squareMetre}`),
      definition: definitions.usableArea,
    },
    {
      id: "footprintArea",
      label: labels.footprintArea,
      value: finite(facts.footprintAreaM2, (value) => `${formatNumber(value, 1)} ${copy.ui.units.squareMetre}`),
      definition: definitions.footprintArea,
    },
    {
      id: "efficiency",
      label: labels.efficiency,
      value: finite(facts.planningEfficiency, (value) => `${formatNumber(value * 100, 1)} ${copy.ui.units.percent}`),
      definition: definitions.efficiency,
    },
    {
      id: "circulationLength",
      label: labels.circulationLength,
      value: finite(facts.circulationLengthUnits, (value) => `${formatNumber(value * GRID_UNIT_METRES, 2)} ${copy.ui.units.metre}`),
      definition: definitions.circulationLength,
    },
    {
      id: "targetGfa",
      label: labels.targetGfa,
      value: finite(facts.targetGfaUnits2, (value) => `${formatNumber(value * GRID_M2, 1)} ${copy.ui.units.squareMetre}`),
      definition: definitions.targetGfa,
    },
    {
      id: "unallocatedInterior",
      label: labels.unallocatedInterior,
      value: finite(facts.unallocatedInteriorRatio, (value) => `${formatNumber(value * 100, 1)} ${copy.ui.units.percent}`),
      definition: definitions.unallocatedInterior,
    },
  ];
  return candidates.filter((row) => row.value !== null);
}

function finite(value: number, format: (input: number) => string): string | null {
  return Number.isFinite(value) ? format(value) : null;
}

function strategyLabel(strategy: string, fallback: string | undefined, copy: Copy): string {
  return copy.strategyNames[strategy] ?? fallback ?? humaniseIdentifier(strategy);
}

function spaceKindClass(space: PlacedSpace, project: NormalizedProject): string {
  const room = project.rooms.find((candidate) => candidate.id === space.instanceId);
  if (room) return `room-kind-${room.kind}`;
  return space.role;
}

/**
 * A real thumbnail of the layout: the same room categories, walls, circulation
 * and portals the plan viewport draws, scaled into the card.  No furnishing or
 * decoration is added, because none of it is authoritative data.
 */
export function projectThumbnailSvg(layout: Layout, project: NormalizedProject, copy: Copy): string {
  const footprint = layout.footprint;
  const width = Math.max(1, footprint.width);
  const depth = Math.max(1, footprint.depth);
  const spaces = layout.spaces.map((space) => {
    const className = spaceKindClass(space, project);
    return `<rect class="thumbnail-space ${className}" x="${round(space.rect.x)}" y="${round(space.rect.y)}" width="${round(space.rect.width)}" height="${round(space.rect.depth)}"/>`;
  }).join("");
  const portals = layout.portals.map((portal) => {
    const line = thumbnailPortalLine(layout, portal);
    if (!line) return "";
    const kind = portal.kind === "vehicle" ? "vehicle" : "pedestrian";
    return `<line class="thumbnail-portal thumbnail-portal-${kind}" x1="${round(line.x1)}" y1="${round(line.y1)}" x2="${round(line.x2)}" y2="${round(line.y2)}"/>`;
  }).join("");
  return `<svg class="option-thumbnail" viewBox="${round(footprint.x)} ${round(footprint.y)} ${round(width)} ${round(depth)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttribute(`${copy.analysis.thumbnailAria} ${layout.id}`)}"><rect class="thumbnail-footprint" x="${round(footprint.x)}" y="${round(footprint.y)}" width="${round(width)}" height="${round(depth)}"/>${spaces}${portals}</svg>`;
}

function round(value: number): string {
  return String(Number(value.toFixed(3)));
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function thumbnailPortalLine(
  layout: Layout,
  portal: Layout["portals"][number],
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (portal.length <= 0) return null;
  const owner = layout.spaces.find((space) => space.instanceId === portal.a) ??
    layout.spaces.find((space) => space.instanceId === portal.b);
  const rect = owner?.rect ?? layout.footprint;
  switch (portal.wall) {
    case "north":
      return { x1: portal.start, y1: rect.y, x2: portal.start + portal.length, y2: rect.y };
    case "south":
      return { x1: portal.start, y1: rect.y + rect.depth, x2: portal.start + portal.length, y2: rect.y + rect.depth };
    case "west":
      return { x1: rect.x, y1: portal.start, x2: rect.x, y2: portal.start + portal.length };
    case "east":
      return { x1: rect.x + rect.width, y1: portal.start, x2: rect.x + rect.width, y2: portal.start + portal.length };
  }
}

function candidateFor(result: GenerationResultPayload, layoutId: string): PayloadCandidate | undefined {
  return result.candidates.find((candidate) => candidate.layoutId === layoutId);
}

/**
 * The up-to-three option cards, including honest empty slots.
 *
 * Empty slots are never filled with a duplicate plan: the slot keeps its badge
 * and carries the selection diagnostic instead.
 */
export function projectOptionCards(
  result: GenerationResultPayload,
  selectedLayoutId: string | null,
  project: NormalizedProject,
  copy: Copy,
): OptionCardView[] {
  const selected = result.selection.selected;
  const reasons = copy.analysis.selectionReasons as Record<string, string>;
  const reason = result.selection.reason
    ? reasons[result.selection.reason] ?? humaniseIdentifier(result.selection.reason)
    : copy.analysis.optionUnavailable;
  return OPTION_SLOTS.map((slot, index) => {
    const item = selected[index];
    if (!item) {
      return {
        slot,
        layoutId: null,
        strategyLabel: copy.analysis.optionUnavailableLabel,
        score: null,
        thumbnail: "",
        selected: false,
        emptyReason: reason,
      };
    }
    const layout = result.layouts.find((candidate) => candidate.id === item.layoutId);
    const candidate = candidateFor(result, item.layoutId);
    const scorecard = candidate?.scores.find((entry) => entry.profileId === item.strategy) ?? candidate?.scores[0];
    const score = scorecard && Number.isFinite(scorecard.overallScore)
      ? Math.round(scorecard.overallScore)
      : null;
    return {
      slot,
      layoutId: item.layoutId,
      strategyLabel: strategyLabel(item.strategy, scorecard?.label, copy),
      score,
      thumbnail: layout ? projectThumbnailSvg(layout, project, copy) : "",
      selected: item.layoutId === selectedLayoutId,
      emptyReason: null,
    };
  });
}

/** Whole-number category rows for the selected option, in approved order. */
export function projectCategoryRows(
  selected: SelectedScorecard | null,
  orderedCategories: readonly string[],
  copy: Copy,
): CategoryRow[] {
  if (!selected) return [];
  return orderedCategories.map((category) => ({
    category,
    label: (copy.metricLabels as Record<string, string>)[category] ?? humaniseIdentifier(category),
    score: Math.round(selected.categoryScores[category] ?? 0),
  }));
}

/**
 * The scorecard that belongs to the selected card.
 *
 * A layout is shown against the strategy that selected it, so the summary
 * heading, the score, the category bars and the observations all describe the
 * same strategy as the card the user is looking at.  Reading a fixed profile
 * (for example `balanced`) would silently print a score that belongs to a
 * different card.
 */
export function selectedScorecard(
  result: GenerationResultPayload | null,
  layoutId: string | null,
): SelectedScorecard | null {
  if (!result || !layoutId) return null;
  const item = result.selection.selected.find((entry) => entry.layoutId === layoutId);
  const candidate = candidateFor(result, layoutId);
  if (!candidate) return null;
  const scorecard = (item && candidate.scores.find((score) => score.profileId === item.strategy)) ?? candidate.scores[0];
  if (!scorecard) return null;
  return {
    strategy: scorecard.profileId,
    label: scorecard.label,
    overallScore: scorecard.overallScore,
    categoryScores: scorecard.categoryScores,
    explanations: scorecard.explanations,
  };
}

/**
 * Score explanations worth showing as observations.
 *
 * The hard-validation explanation is dropped on purpose: the rule-check
 * section states the same verdict with the validator's own evidence, so
 * repeating it here would pad the panel with a duplicate row.
 */
export function observationExplanations(
  selected: SelectedScorecard | null,
): SelectedScorecard["explanations"] {
  if (!selected) return [];
  return selected.explanations.filter((explanation) => !explanation.key.startsWith("validation."));
}

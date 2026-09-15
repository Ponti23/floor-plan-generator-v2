import { GRID_MM } from "../domain/constants.ts";
import { parseMetresToMm, type CardinalSide } from "../domain/geometry.ts";
import {
  tryNormalizeProject,
  type NormalizationIssue,
} from "../domain/normalization.ts";
import { serializeCanonical } from "../domain/serialization.ts";
import type {
  DimensionConstraintsMm,
  NormalizedProject,
  OffsetSource,
  PlanningSettings,
  ProjectBrief,
  RelationshipAggregation,
  RelationshipRequirement,
  RoomKind,
  RoomRequirement,
  RoomSelector,
  RoomTraits,
} from "../domain/model.ts";
import { PROJECT_SCHEMA_VERSION } from "../domain/model.ts";

/** The fixed project boundary orientation. It is shown, not edited, in V1. */
export const FRONT_SIDE = "south" as const;

/** Every side is present in the draft, even while one field is incomplete. */
export const CARDINAL_SIDES: readonly CardinalSide[] = ["north", "east", "south", "west"] as const;

/** Planning assumptions that are useful to show without inventing new solver inputs. */
export type PassThroughPolicy = "declared-room-traits";

export interface DraftOffset {
  /** Metres as entered in the form; blank is allowed until commit. */
  distanceM: string;
  source: OffsetSource;
  sourceRef: string;
}

export interface DraftSite {
  widthM: string;
  depthM: string;
  frontSide: typeof FRONT_SIDE;
}

export interface DraftAreaPolicy {
  targetGfaM2: string;
  maxGfaM2: string;
  maxUnallocatedInteriorPercent: string;
}

export interface DraftRoomDimensions {
  minAreaM2: string;
  preferredAreaM2: string;
  minShortSideM: string;
  minWidthM: string;
  minDepthM: string;
  maxAspectRatio: string;
}

export interface DraftRoom {
  id: string;
  label: string;
  kind: RoomKind;
  quantity: string;
  inclusion: RoomRequirement["inclusion"];
  dimensions: DraftRoomDimensions;
  traits: RoomTraits;
}

/** A selector stays structured in the draft so requirement/instance intent is not lost. */
export type DraftRoomSelector = RoomSelector;

export interface DraftRelationship {
  id: string;
  from: DraftRoomSelector;
  to: DraftRoomSelector;
  kind: RelationshipRequirement["kind"];
  source: RelationshipRequirement["source"];
  aggregation: RelationshipAggregation;
  strength: string;
  minSharedWallM: string;
  targetDistanceM: string;
}

export interface DraftPlanningAssumptions {
  minimumCirculationWidthM: string;
  /** Fixed policy label: only room traits explicitly marked pass-through are eligible. */
  passThroughPolicy: PassThroughPolicy;
  /** Informational only; changing grid resolution is outside the V1 brief contract. */
  gridResolutionMm: typeof GRID_MM;
}

/**
 * Local form state. Numeric values intentionally remain text until a commit,
 * which lets an architect clear or finish a field without mutating solver input.
 */
export interface BriefDraft {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  projectId: string;
  name: string;
  site: DraftSite;
  offsets: Record<CardinalSide, DraftOffset>;
  areaPolicy: DraftAreaPolicy;
  program: DraftRoom[];
  relationships: DraftRelationship[];
  planning: DraftPlanningAssumptions;
  generationSeed: string;
}

export interface BriefEditorState {
  /** The only mutable/incomplete representation used by form controls. */
  draft: BriefDraft;
  /** Authored values accepted at the last successful commit. */
  committedBrief: ProjectBrief;
  /** Immutable solver snapshot corresponding to committedBrief. */
  committedProject: NormalizedProject;
  /** Increments only when a semantically changed draft is committed. */
  revision: number;
  dirty: boolean;
  issues: readonly NormalizationIssue[];
  /** Revision of the result currently displayed, if one has been accepted. */
  resultRevision: number | null;
  /** Previous result exists but does not correspond to the current committed brief. */
  resultsStale: boolean;
}

export interface BriefDraftPatch {
  schemaVersion?: typeof PROJECT_SCHEMA_VERSION;
  projectId?: string;
  name?: string;
  site?: Partial<DraftSite>;
  offsets?: Partial<Record<CardinalSide, Partial<DraftOffset>>>;
  areaPolicy?: Partial<DraftAreaPolicy>;
  program?: DraftRoom[];
  relationships?: DraftRelationship[];
  planning?: Partial<DraftPlanningAssumptions>;
  generationSeed?: string;
}

export type CommitDraftResult =
  | {
      ok: true;
      state: BriefEditorState;
      project: ProjectBrief;
      normalized: NormalizedProject;
    }
  | {
      ok: false;
      state: BriefEditorState;
      issues: readonly NormalizationIssue[];
    };

function cloneTraits(traits: RoomTraits): RoomTraits {
  return {
    zone: traits.zone,
    wet: traits.wet,
    exteriorPreference: traits.exteriorPreference,
    mayBePassThrough: traits.mayBePassThrough,
    ...(traits.frontage ? { frontage: { ...traits.frontage } } : {}),
    ...(traits.vehicleSpaces === undefined ? {} : { vehicleSpaces: traits.vehicleSpaces }),
  };
}

function cloneSelector(selector: RoomSelector): DraftRoomSelector {
  if (typeof selector === "string") return selector;
  return selector.type === "kind"
    ? { type: "kind", kind: selector.kind }
    : { type: selector.type, id: selector.id };
}

function formatLengthM(millimetres: number): string {
  return (millimetres / 1_000).toString();
}

function formatAreaM2(squareMillimetres: number): string {
  return (squareMillimetres / 1_000_000).toString();
}

function formatPercent(ratio: number): string {
  return (ratio * 100).toString();
}

function optionalLengthM(value: number | undefined): string {
  return value === undefined ? "" : formatLengthM(value);
}

function optionalAreaM2(value: number | undefined): string {
  return value === undefined ? "" : formatAreaM2(value);
}

function optionalDecimal(value: number | undefined): string {
  return value === undefined ? "" : value.toString();
}

function selectorFromDraft(selector: DraftRoomSelector): RoomSelector {
  if (typeof selector === "string") return selector.trim();
  return selector.type === "kind"
    ? { type: "kind", kind: selector.kind }
    : { type: selector.type, id: selector.id.trim() };
}

/** Convert a committed authored brief to display-unit draft values. */
export function projectBriefToDraft(project: ProjectBrief): BriefDraft {
  const offsets = Object.fromEntries(
    CARDINAL_SIDES.map((side) => [side, {
      distanceM: formatLengthM(project.site.offsets[side].distanceMm),
      source: project.site.offsets[side].source,
      sourceRef: project.site.offsets[side].sourceRef ?? "",
    }]),
  ) as Record<CardinalSide, DraftOffset>;

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: project.projectId,
    name: project.name,
    site: {
      widthM: formatLengthM(project.site.widthMm),
      depthM: formatLengthM(project.site.depthMm),
      frontSide: FRONT_SIDE,
    },
    offsets,
    areaPolicy: {
      targetGfaM2: optionalAreaM2(project.planning.targetGfaMm2),
      maxGfaM2: optionalAreaM2(project.planning.maxGfaMm2),
      maxUnallocatedInteriorPercent: formatPercent(project.planning.maxUnallocatedInteriorRatio),
    },
    program: project.program.map((room) => ({
      id: room.id,
      label: room.label,
      kind: room.kind,
      quantity: room.quantity.toString(),
      inclusion: room.inclusion,
      dimensions: {
        minAreaM2: formatAreaM2(room.dimensions.minAreaMm2),
        preferredAreaM2: optionalAreaM2(room.dimensions.preferredAreaMm2),
        minShortSideM: optionalLengthM(room.dimensions.minShortSideMm),
        minWidthM: optionalLengthM(room.dimensions.minWidthMm),
        minDepthM: optionalLengthM(room.dimensions.minDepthMm),
        maxAspectRatio: optionalDecimal(room.dimensions.maxAspectRatio),
      },
      traits: cloneTraits(room.traits),
    })),
    relationships: project.relationships.map((relationship) => ({
      id: relationship.id,
      from: cloneSelector(relationship.from),
      to: cloneSelector(relationship.to),
      kind: relationship.kind,
      source: relationship.source,
      aggregation: relationship.aggregation ?? "any",
      strength: optionalDecimal(relationship.strength),
      minSharedWallM: optionalDecimal(relationship.minSharedWallM),
      targetDistanceM: optionalDecimal(relationship.targetDistanceM),
    })),
    planning: {
      minimumCirculationWidthM: formatLengthM(project.planning.minimumCirculationWidthMm),
      passThroughPolicy: "declared-room-traits",
      gridResolutionMm: GRID_MM,
    },
    generationSeed: project.generation.seed,
  };
}

function cloneDraft(draft: BriefDraft): BriefDraft {
  return structuredClone(draft);
}

function copyIssue(
  path: string,
  message: string,
  actual?: string,
): NormalizationIssue {
  return {
    code: "INVALID_BRIEF",
    path,
    message,
    ...(actual === undefined ? {} : { actual }),
  };
}

function requiredMetres(
  value: string,
  path: string,
  issues: NormalizationIssue[],
): number {
  const text = value.trim();
  if (text.length === 0) {
    issues.push(copyIssue(path, "a value is required"));
    return 0;
  }
  try {
    const millimetres = parseMetresToMm(text);
    if (millimetres <= 0) {
      issues.push(copyIssue(path, "value must be greater than zero", text));
      return 0;
    }
    return millimetres;
  } catch {
    issues.push(copyIssue(path, "enter a non-negative metre value with at most 3 decimal places", text));
    return 0;
  }
}

function optionalMetres(
  value: string,
  path: string,
  issues: NormalizationIssue[],
): number | undefined {
  const text = value.trim();
  if (text.length === 0) return undefined;
  try {
    return parseMetresToMm(text);
  } catch {
    issues.push(copyIssue(path, "enter a non-negative metre value with at most 3 decimal places", text));
    return undefined;
  }
}

function requiredInteger(
  value: string,
  path: string,
  issues: NormalizationIssue[],
): number {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text)) {
    issues.push(copyIssue(path, "enter a positive whole number", text || undefined));
    return 0;
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    issues.push(copyIssue(path, "enter a positive whole number", text));
    return 0;
  }
  return parsed;
}

function optionalDecimalValue(
  value: string,
  path: string,
  issues: NormalizationIssue[],
): number | undefined {
  const text = value.trim();
  if (text.length === 0) return undefined;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) {
    issues.push(copyIssue(path, "enter a non-negative decimal value", text));
    return undefined;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push(copyIssue(path, "enter a non-negative decimal value", text));
    return undefined;
  }
  return parsed;
}

function requiredArea(
  value: string,
  path: string,
  issues: NormalizationIssue[],
): number {
  // The draft value is an area in m², not a side length. Parsing through the
  // exact metre helper preserves up to three decimal places, then scales one
  // metre of area to 1,000,000 mm² without introducing floating point drift.
  const metresInThousandths = requiredMetres(value, path, issues);
  const squareMillimetres = metresInThousandths * 1_000;
  if (!Number.isSafeInteger(squareMillimetres) || squareMillimetres <= 0) {
    issues.push(copyIssue(path, "area is outside the supported safe range", value.trim() || undefined));
    return 0;
  }
  return squareMillimetres;
}

function optionalArea(
  value: string,
  path: string,
  issues: NormalizationIssue[],
): number | undefined {
  const metresInThousandths = optionalMetres(value, path, issues);
  if (metresInThousandths === undefined) return undefined;
  const squareMillimetres = metresInThousandths * 1_000;
  if (!Number.isSafeInteger(squareMillimetres) || squareMillimetres <= 0) {
    issues.push(copyIssue(path, "area must be greater than zero and within the supported range", value.trim()));
    return undefined;
  }
  return squareMillimetres;
}

function requiredPercent(
  value: string,
  path: string,
  issues: NormalizationIssue[],
): number {
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(text)) {
    issues.push(copyIssue(path, "enter a percentage from 0 to 100", text || undefined));
    return 0;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    issues.push(copyIssue(path, "enter a percentage from 0 to 100", text));
    return 0;
  }
  return parsed / 100;
}

function draftToProjectBriefResult(draft: BriefDraft): {
  project: ProjectBrief;
  issues: NormalizationIssue[];
} {
  const issues: NormalizationIssue[] = [];
  const siteWidthMm = requiredMetres(draft.site.widthM, "site.widthMm", issues);
  const siteDepthMm = requiredMetres(draft.site.depthM, "site.depthMm", issues);
  const offsets = Object.fromEntries(CARDINAL_SIDES.map((side) => {
    const offset = draft.offsets[side];
    const distanceMm = optionalMetres(offset.distanceM, `site.offsets.${side}.distanceMm`, issues) ?? 0;
    return [side, {
      distanceMm,
      source: offset.source,
      ...(offset.sourceRef.trim().length === 0 ? {} : { sourceRef: offset.sourceRef.trim() }),
    }];
  })) as ProjectBrief["site"]["offsets"];

  const program: RoomRequirement[] = draft.program.map((room, index) => {
    const path = `program[${index}]`;
    const dimensions: DimensionConstraintsMm = {
      minAreaMm2: requiredArea(room.dimensions.minAreaM2, `${path}.dimensions.minAreaMm2`, issues),
    };
    const preferredAreaMm2 = optionalArea(room.dimensions.preferredAreaM2, `${path}.dimensions.preferredAreaMm2`, issues);
    const minShortSideMm = optionalMetres(room.dimensions.minShortSideM, `${path}.dimensions.minShortSideMm`, issues);
    const minWidthMm = optionalMetres(room.dimensions.minWidthM, `${path}.dimensions.minWidthMm`, issues);
    const minDepthMm = optionalMetres(room.dimensions.minDepthM, `${path}.dimensions.minDepthMm`, issues);
    const maxAspectRatio = optionalDecimalValue(room.dimensions.maxAspectRatio, `${path}.dimensions.maxAspectRatio`, issues);
    if (preferredAreaMm2 !== undefined) dimensions.preferredAreaMm2 = preferredAreaMm2;
    if (minShortSideMm !== undefined) dimensions.minShortSideMm = minShortSideMm;
    if (minWidthMm !== undefined) dimensions.minWidthMm = minWidthMm;
    if (minDepthMm !== undefined) dimensions.minDepthMm = minDepthMm;
    if (maxAspectRatio !== undefined) dimensions.maxAspectRatio = maxAspectRatio;
    return {
      id: room.id.trim(),
      label: room.label.trim(),
      kind: room.kind,
      quantity: requiredInteger(room.quantity, `${path}.quantity`, issues),
      inclusion: room.inclusion,
      dimensions,
      traits: cloneTraits(room.traits),
    };
  });

  const relationships: RelationshipRequirement[] = draft.relationships.map((relationship, index) => {
    const path = `relationships[${index}]`;
    const strength = optionalDecimalValue(relationship.strength, `${path}.strength`, issues);
    const minSharedWallM = optionalDecimalValue(relationship.minSharedWallM, `${path}.minSharedWallM`, issues);
    const targetDistanceM = optionalDecimalValue(relationship.targetDistanceM, `${path}.targetDistanceM`, issues);
    return {
      id: relationship.id.trim(),
      from: selectorFromDraft(relationship.from),
      to: selectorFromDraft(relationship.to),
      kind: relationship.kind,
      source: relationship.source,
      // `any` is the model default. Keep it implicit so opening and
      // committing an untouched brief remains a semantic no-op.
      ...(relationship.aggregation === "any" ? {} : { aggregation: relationship.aggregation }),
      ...(strength === undefined ? {} : { strength }),
      ...(minSharedWallM === undefined ? {} : { minSharedWallM }),
      ...(targetDistanceM === undefined ? {} : { targetDistanceM }),
    };
  });

  const targetGfaMm2 = optionalArea(draft.areaPolicy.targetGfaM2, "planning.targetGfaMm2", issues);
  const maxGfaMm2 = optionalArea(draft.areaPolicy.maxGfaM2, "planning.maxGfaMm2", issues);
  const minimumCirculationWidthMm = requiredMetres(
    draft.planning.minimumCirculationWidthM,
    "planning.minimumCirculationWidthMm",
    issues,
  );
  const maxUnallocatedInteriorRatio = requiredPercent(
    draft.areaPolicy.maxUnallocatedInteriorPercent,
    "planning.maxUnallocatedInteriorRatio",
    issues,
  );

  return {
    project: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId: draft.projectId.trim(),
      name: draft.name.trim(),
      site: {
        widthMm: siteWidthMm,
        depthMm: siteDepthMm,
        offsets,
        frontSide: FRONT_SIDE,
      },
      program,
      relationships,
      planning: {
        minimumCirculationWidthMm,
        ...(targetGfaMm2 === undefined ? {} : { targetGfaMm2 }),
        ...(maxGfaMm2 === undefined ? {} : { maxGfaMm2 }),
        maxUnallocatedInteriorRatio,
      } satisfies PlanningSettings,
      generation: { seed: draft.generationSeed },
    },
    issues,
  };
}

function stateWithDraft(state: BriefEditorState, draft: BriefDraft): BriefEditorState {
  return {
    ...state,
    draft,
    dirty: true,
    issues: [],
    resultsStale: state.resultRevision !== null,
  };
}

/** Start an editor with one normalized immutable solver snapshot. */
export function createBriefEditorState(project: ProjectBrief): BriefEditorState {
  const committedBrief = structuredClone(project);
  const normalized = tryNormalizeProject(committedBrief);
  if (!normalized.ok) {
    throw new Error(`cannot open invalid project brief: ${normalized.issues.map((issue) => issue.message).join("; ")}`);
  }
  return {
    draft: projectBriefToDraft(committedBrief),
    committedBrief,
    committedProject: normalized.value,
    revision: 0,
    dirty: false,
    issues: [],
    resultRevision: null,
    resultsStale: false,
  };
}

/** Apply local form values without touching committedBrief or committedProject. */
export function editBriefDraft(state: BriefEditorState, patch: BriefDraftPatch): BriefEditorState {
  const draft = cloneDraft(state.draft);
  if (patch.schemaVersion !== undefined) draft.schemaVersion = patch.schemaVersion;
  if (patch.projectId !== undefined) draft.projectId = patch.projectId;
  if (patch.name !== undefined) draft.name = patch.name;
  if (patch.generationSeed !== undefined) draft.generationSeed = patch.generationSeed;
  if (patch.site !== undefined) draft.site = { ...draft.site, ...patch.site };
  if (patch.offsets !== undefined) {
    for (const side of CARDINAL_SIDES) {
      const change = patch.offsets[side];
      if (change !== undefined) draft.offsets[side] = { ...draft.offsets[side], ...change };
    }
  }
  if (patch.areaPolicy !== undefined) draft.areaPolicy = { ...draft.areaPolicy, ...patch.areaPolicy };
  if (patch.program !== undefined) draft.program = structuredClone(patch.program);
  if (patch.relationships !== undefined) draft.relationships = structuredClone(patch.relationships);
  if (patch.planning !== undefined) draft.planning = { ...draft.planning, ...patch.planning };
  return stateWithDraft(state, draft);
}

/** Revert local incomplete input to the last committed project. */
export function discardBriefDraft(state: BriefEditorState): BriefEditorState {
  return {
    ...state,
    draft: projectBriefToDraft(state.committedBrief),
    dirty: false,
    issues: [],
    resultsStale: state.resultRevision !== null && state.resultRevision !== state.revision,
  };
}

/**
 * Validate and promote the draft. A failed commit keeps the draft and the
 * previous normalized snapshot intact so the form can show all issues.
 */
export function commitBriefDraft(state: BriefEditorState): CommitDraftResult {
  const parsed = draftToProjectBriefResult(state.draft);
  if (parsed.issues.length > 0) {
    return {
      ok: false,
      state: {
        ...state,
        dirty: true,
        issues: parsed.issues,
        resultsStale: state.resultRevision !== null,
      },
      issues: parsed.issues,
    };
  }

  const normalized = tryNormalizeProject(parsed.project);
  if (!normalized.ok) {
    return {
      ok: false,
      state: {
        ...state,
        dirty: true,
        issues: normalized.issues,
        resultsStale: state.resultRevision !== null,
      },
      issues: normalized.issues,
    };
  }

  // Compare normalized snapshots so representation-only differences (for
  // example an omitted relationship aggregation whose default is `any`) do
  // not manufacture a new generation revision.
  const changed = serializeCanonical(normalized.value) !== serializeCanonical(state.committedProject);
  const revision = changed ? state.revision + 1 : state.revision;
  const committedBrief = changed ? parsed.project : state.committedBrief;
  const committedProject = changed ? normalized.value : state.committedProject;
  const nextState: BriefEditorState = {
    draft: projectBriefToDraft(committedBrief),
    committedBrief: structuredClone(committedBrief),
    committedProject,
    revision,
    dirty: false,
    issues: [],
    resultRevision: state.resultRevision,
    resultsStale: state.resultRevision !== null && state.resultRevision !== revision,
  };
  return { ok: true, state: nextState, project: nextState.committedBrief, normalized: nextState.committedProject };
}

/** Accept a result only when it was generated from the current committed revision. */
export function markBriefResultCurrent(
  state: BriefEditorState,
  resultRevision: number,
): BriefEditorState {
  if (state.dirty || resultRevision !== state.revision) return state;
  return { ...state, resultRevision, resultsStale: false };
}

/**
 * Next variation seed for an explicit "new variations" run.
 *
 * A trailing number is incremented; anything else gains a `-2` suffix, then
 * `-3`, and so on.  The result is a plain deterministic string so the same
 * starting seed always produces the same sequence of variations — "new
 * variations" must not silently become "random".
 */
export function bumpVariationSeed(seed: string): string {
  const trimmed = seed.trim();
  const match = /^(.*?)(\d+)$/.exec(trimmed);
  if (!match) return trimmed.length === 0 ? "1" : `${trimmed}-2`;
  const prefix = match[1] ?? "";
  const next = Number(match[2]) + 1;
  return `${prefix}${next}`;
}

/**
 * Stage 2 bucket 2.3 — typed evaluator registry and ordered validation
 * pipeline.
 *
 * A rule definition is executable application code; a rule instance is
 * serializable pack configuration.  The MVP ships one built-in pack,
 * `planlab-core`, with immutable definition ids/versions and one hard instance
 * per definition, evaluated in the stable order specified by
 * `knowledge/planlab/RULE_ENGINE.md`.  Unknown definitions or version
 * mismatches report `unsupported` and fail — they never pass silently.
 *
 * `validateLayout` remains the backward-compatible façade: it builds the shared
 * evaluation context, runs this registry, and projects `fail` evaluations onto
 * the legacy violation shape without changing any existing verdict.
 */

import {
  GARAGE_MIN_DEPTH_UNITS,
  GARAGE_MIN_WIDTH_UNITS,
  GRID_MM,
  GRID_UNIT_METRES,
  MAX_GFA_M2,
  MAX_UNALLOCATED_INTERIOR_RATIO,
  MIN_MEANINGFUL_SHARED_WALL_UNITS,
  MIN_PORTAL_WIDTH_UNITS,
} from "./constants.ts";
import { buildLayoutIndexes, type LayoutIndexes } from "./facts.ts";
import {
  area,
  containsRect,
  isGridRect,
  sharedWallLength,
  type GridRect,
} from "./geometry.ts";
import {
  EXTERIOR_SPACE_ID,
  type AccessPortal,
  type Layout,
  type PlacedSpace,
} from "./layout.ts";
import {
  PROJECT_SCHEMA_VERSION,
  roomSelectorKey,
  type NormalizedProject,
  type RoomInstance,
  type RoomSelector,
} from "./model.ts";
import {
  buildPedestrianPortalGraph,
  isTransitNode,
  portalSpanValid,
  reachableSpaceIds,
  transitReachability,
  type PortalGraph,
} from "./portalGraph.ts";

/** Version shared by every built-in `planlab-core` definition. */
export const PLANLAB_CORE_RULE_VERSION = 2;
export const PLANLAB_CORE_RULE_PACK = "planlab-core";
export const PLANLAB_CORE_RULE_REFERENCE = "knowledge/planlab/RULE_ENGINE.md";

const DEFAULT_MAX_UNALLOCATED_RATIO = 0.05;

export type RuleEnforcement = "hard" | "soft";
export type RuleSourceKind =
  | "architect"
  | "planlab"
  | "planning"
  | "building_code"
  | "custom";

export interface RuleSource {
  kind: RuleSourceKind;
  issuer?: string;
  reference?: string;
  version?: string;
}

export type RuleCategory =
  | "schema"
  | "site"
  | "geometry"
  | "coverage"
  | "program"
  | "portal"
  | "access"
  | "garage"
  | "relationship";

export type RuleScopeKind = "layout" | "space" | "room" | "portal" | "relationship";

export interface RuleScope {
  kind: RuleScopeKind;
}

export type RuleParameters = Record<string, unknown>;

export interface RuleInstance<P = RuleParameters> {
  id: string;
  definitionId: string;
  definitionVersion: number;
  enabled: boolean;
  enforcement: RuleEnforcement;
  source: RuleSource;
  parameters: P;
  scope: RuleScope;
}

export type RuleEvaluationStatus = "pass" | "fail" | "warning" | "notApplicable";

export type EntityRefKind =
  | "layout"
  | "space"
  | "room"
  | "portal"
  | "relationship"
  | "rule";

export interface EntityRef {
  kind: EntityRefKind;
  id: string;
}

export interface ScalarEvidenceValue {
  kind: "scalar";
  key: string;
  value: string | number | boolean;
}

export interface GeometryEvidenceValue {
  kind: "geometry";
  label: string;
  rect: GridRect;
}

export type EvidenceValue = ScalarEvidenceValue | GeometryEvidenceValue;

export interface RuleMessageDescriptor {
  key: string;
  values: Record<string, string | number>;
}

/** Stable hard-validation codes, kept uppercase for legacy compatibility. */
export type ViolationCode =
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "INVALID_FOOTPRINT_GEOMETRY"
  | "FOOTPRINT_OUTSIDE_ENVELOPE"
  | "FOOTPRINT_EXCEEDS_MAX_GFA"
  | "INVALID_SPACE_ROLE"
  | "INVALID_SPACE_GEOMETRY"
  | "DUPLICATE_SPACE_ID"
  | "SPACE_OUTSIDE_FOOTPRINT"
  | "UNKNOWN_ROOM_INSTANCE"
  | "SPACE_OVERLAP"
  | "UNALLOCATED_INTERIOR_EXCEEDS_CAP"
  | "REQUIRED_ROOM_MISSING"
  | "ROOM_DIMENSIONS_INVALID"
  | "CIRCULATION_WIDTH_INVALID"
  | "DUPLICATE_PORTAL_ID"
  | "PORTAL_WALL_INVALID"
  | "PORTAL_KIND_INVALID"
  | "PORTAL_WIDTH_INVALID"
  | "PORTAL_UNKNOWN_SPACE"
  | "PORTAL_NOT_ON_SHARED_EDGE"
  | "ENTRANCE_COUNT_INVALID"
  | "ENTRANCE_PORTAL_INVALID"
  | "ENTRANCE_TARGET_INVALID"
  | "GARAGE_VEHICLE_PORTAL_MISSING"
  | "FORBIDDEN_PASS_THROUGH"
  | "ROOM_UNREACHABLE"
  | "CIRCULATION_UNREACHABLE"
  | "GARAGE_FRONTAGE_POLICY_INVALID"
  | "GARAGE_PRESET_DIMENSIONS_INVALID"
  | "GARAGE_MISSING_SOUTH_FRONTAGE"
  | "RELATIONSHIP_SELECTOR_UNRESOLVED"
  | "MUST_SHARE_WALL_UNSATISFIED"
  | "RULE_DEFINITION_UNSUPPORTED";

export interface RuleEvaluation {
  ruleInstanceId: string;
  ruleDefinitionId: string;
  ruleDefinitionVersion: number;
  enforcement: RuleEnforcement;
  status: RuleEvaluationStatus;
  /** Stable uppercase violation code; derived from the definition id. */
  code: ViolationCode;
  subjects: EntityRef[];
  evidence: EvidenceValue[];
  expected?: string | number | boolean;
  actual?: string | number | boolean;
  message: RuleMessageDescriptor;
}

export interface RuleDefinition<P = RuleParameters> {
  readonly id: string;
  readonly version: number;
  readonly category: RuleCategory;
  readonly validateParameters: (value: unknown) => P;
  readonly evaluate: (
    context: RuleContext,
    rule: RuleInstance<P>,
  ) => readonly RuleEvaluation[];
}

export interface PortalFinding {
  code: ViolationCode;
  subjects: string[];
  expected?: string | number | boolean;
  actual?: string | number | boolean;
  evidence: EvidenceValue[];
}

export interface PortalInspection {
  validPortals: AccessPortal[];
  findings: PortalFinding[];
}

/**
 * Everything the ordered pipeline needs about one candidate.  The context is
 * prepared once per validation run; rule definitions read it and never
 * recompute pairwise geometry.
 */
export interface RuleContext {
  layout: Layout;
  project: NormalizedProject;
  indexes: LayoutIndexes;
  spaces: readonly PlacedSpace[];
  roomById: ReadonlyMap<string, RoomInstance>;
  /** First occurrence wins for duplicate space ids, matching the legacy loop. */
  spaceById: ReadonlyMap<string, PlacedSpace>;
  roomSpaces: ReadonlyMap<string, PlacedSpace>;
  portalInspection: PortalInspection;
  validPortals: readonly AccessPortal[];
  graph: PortalGraph;
  reachable: ReadonlySet<string>;
  transitReachable: ReadonlySet<string>;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RangeError("rule parameters must be a plain object");
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function positiveNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return value;
}

function emptyParameters(value: unknown): RuleParameters {
  return { ...requireRecord(value) };
}

function singleIntegerParameter(name: string): (value: unknown) => RuleParameters {
  return (value) => {
    const record = requireRecord(value);
    positiveInteger(record[name], name);
    return { ...record };
  };
}

function maximumRatioParameter(value: unknown): RuleParameters {
  const record = requireRecord(value);
  positiveNumber(record.maximumRatio, "maximumRatio");
  return { ...record };
}

function garagePresetParameters(value: unknown): RuleParameters {
  const record = requireRecord(value);
  positiveInteger(record.minimumWidthUnits, "minimumWidthUnits");
  positiveInteger(record.minimumDepthUnits, "minimumDepthUnits");
  return { ...record };
}

function scalarEvidence(key: string, value: string | number | boolean): ScalarEvidenceValue {
  return { kind: "scalar", key, value };
}

function geometryEvidence(label: string, rect: GridRect): GeometryEvidenceValue {
  return {
    kind: "geometry",
    label,
    rect: Object.freeze({ x: rect.x, y: rect.y, width: rect.width, depth: rect.depth }),
  };
}

function violationCodeFor(definitionId: string): ViolationCode {
  return definitionId.replaceAll("-", "_").toUpperCase() as ViolationCode;
}

function entityKindFor(scopeKind: RuleScopeKind): EntityRefKind {
  switch (scopeKind) {
    case "layout": return "layout";
    case "space": return "space";
    case "room": return "room";
    case "portal": return "portal";
    case "relationship": return "relationship";
  }
}

function passEvaluation(rule: RuleInstance): RuleEvaluation {
  const code = violationCodeFor(rule.definitionId);
  return {
    ruleInstanceId: rule.id,
    ruleDefinitionId: rule.definitionId,
    ruleDefinitionVersion: rule.definitionVersion,
    enforcement: rule.enforcement,
    status: "pass",
    code,
    subjects: [],
    evidence: [],
    message: { key: `validation.${code.toLowerCase()}.pass`, values: {} },
  };
}

function failEvaluation(
  rule: RuleInstance,
  code: ViolationCode,
  subjects: readonly string[] = [],
  evidence: readonly EvidenceValue[] = [],
  expected?: string | number | boolean,
  actual?: string | number | boolean,
): RuleEvaluation {
  const subjectKind = entityKindFor(rule.scope.kind);
  return {
    ruleInstanceId: rule.id,
    ruleDefinitionId: rule.definitionId,
    ruleDefinitionVersion: rule.definitionVersion,
    enforcement: rule.enforcement,
    status: "fail",
    code,
    subjects: subjects.map((id) => ({ kind: subjectKind, id })),
    evidence: evidence.slice(),
    ...(expected !== undefined ? { expected } : {}),
    ...(actual !== undefined ? { actual } : {}),
    message: { key: `validation.${code.toLowerCase()}`, values: {} },
  };
}

function notApplicableEvaluation(rule: RuleInstance): RuleEvaluation {
  const code = violationCodeFor(rule.definitionId);
  return {
    ruleInstanceId: rule.id,
    ruleDefinitionId: rule.definitionId,
    ruleDefinitionVersion: rule.definitionVersion,
    enforcement: rule.enforcement,
    status: "notApplicable",
    code,
    subjects: [],
    evidence: [],
    message: { key: `validation.${code.toLowerCase()}.not-applicable`, values: {} },
  };
}

function unsupportedEvaluation(rule: RuleInstance): RuleEvaluation {
  return {
    ruleInstanceId: rule.id,
    ruleDefinitionId: rule.definitionId,
    ruleDefinitionVersion: rule.definitionVersion,
    enforcement: rule.enforcement,
    status: "fail",
    code: "RULE_DEFINITION_UNSUPPORTED",
    subjects: [{ kind: "rule", id: rule.definitionId }],
    evidence: [scalarEvidence("definitionVersion", rule.definitionVersion)],
    message: {
      key: "validation.rule-definition-unsupported",
      values: {
        definitionId: rule.definitionId,
        definitionVersion: rule.definitionVersion,
      },
    },
  };
}

function defineRule(
  id: string,
  category: RuleCategory,
  validateParameters: (value: unknown) => RuleParameters,
  evaluate: (context: RuleContext, rule: RuleInstance) => readonly RuleEvaluation[],
): RuleDefinition {
  return Object.freeze({
    id,
    version: PLANLAB_CORE_RULE_VERSION,
    category,
    validateParameters,
    evaluate,
  });
}

function maxGfaUnits(project: NormalizedProject): number {
  const approvedMaxGfaMm2 = MAX_GFA_M2 * 1_000_000;
  const maxGfaMm2 = Math.min(
    project.planning.maxGfaMm2 ?? approvedMaxGfaMm2,
    approvedMaxGfaMm2,
  );
  return Math.floor(maxGfaMm2 / (GRID_MM * GRID_MM));
}

function isGarageRoom(room: RoomInstance): boolean {
  return room.kind === "garage" || room.traits.frontage?.kind === "vehicle";
}

function roomDimensionsValid(room: RoomInstance, rect: GridRect): boolean {
  const dimensions = room.dimensions;
  if (area(rect) < dimensions.minAreaUnits2) return false;
  if (
    dimensions.minShortSideUnits !== undefined &&
    Math.min(rect.width, rect.depth) < dimensions.minShortSideUnits
  ) {
    return false;
  }
  const directOrientation =
    (dimensions.minWidthUnits === undefined || rect.width >= dimensions.minWidthUnits) &&
    (dimensions.minDepthUnits === undefined || rect.depth >= dimensions.minDepthUnits);
  const rotatedOrientation =
    dimensions.minWidthUnits !== undefined &&
    dimensions.minDepthUnits !== undefined &&
    rect.width >= dimensions.minDepthUnits &&
    rect.depth >= dimensions.minWidthUnits;
  if (!directOrientation && !rotatedOrientation) return false;
  if (
    dimensions.maxAspectRatio !== undefined &&
    Math.max(rect.width / rect.depth, rect.depth / rect.width) > dimensions.maxAspectRatio
  ) {
    return false;
  }
  return true;
}

function roomSelectorMatches(room: RoomInstance, selector: RoomSelector): boolean {
  const key = roomSelectorKey(selector);
  return room.id === key || room.requirementId === key || room.kind === key;
}

function selectedSpaces(
  selector: RoomSelector,
  project: NormalizedProject,
  roomSpaces: ReadonlyMap<string, PlacedSpace>,
): PlacedSpace[] {
  return project.rooms
    .filter((room) => roomSelectorMatches(room, selector))
    .map((room) => roomSpaces.get(room.id))
    .filter((space): space is PlacedSpace => space !== undefined);
}

/**
 * Portal geometry inspection shared by context preparation and the portal
 * rules.  Findings keep the legacy per-portal short-circuit order: the first
 * failure wins for each portal, exactly as the pre-registry validator behaved.
 */
export function inspectPortals(
  layout: Layout,
  spaceById: ReadonlyMap<string, PlacedSpace>,
  footprint: GridRect | null,
): PortalInspection {
  const validPortals: AccessPortal[] = [];
  const findings: PortalFinding[] = [];
  const portalIds = new Set<string>();
  for (const portal of Array.isArray(layout.portals) ? layout.portals : []) {
    if (portalIds.has(portal.id)) {
      findings.push({ code: "DUPLICATE_PORTAL_ID", subjects: [portal.id], evidence: [] });
      continue;
    }
    portalIds.add(portal.id);
    if (!["north", "east", "south", "west"].includes(portal.wall)) {
      findings.push({ code: "PORTAL_WALL_INVALID", subjects: [portal.id], evidence: [] });
      continue;
    }
    if (portal.kind !== "pedestrian" && portal.kind !== "vehicle") {
      findings.push({ code: "PORTAL_KIND_INVALID", subjects: [portal.id], evidence: [] });
      continue;
    }
    if (
      !Number.isSafeInteger(portal.start) ||
      !Number.isSafeInteger(portal.length) ||
      portal.length < MIN_PORTAL_WIDTH_UNITS
    ) {
      findings.push({
        code: "PORTAL_WIDTH_INVALID",
        subjects: [portal.id],
        evidence: [scalarEvidence("minimumUnits", MIN_PORTAL_WIDTH_UNITS)],
      });
      continue;
    }
    const a = portal.a === EXTERIOR_SPACE_ID ? undefined : spaceById.get(portal.a);
    const b = portal.b === EXTERIOR_SPACE_ID ? undefined : spaceById.get(portal.b);
    if (portal.a !== EXTERIOR_SPACE_ID && !a) {
      findings.push({
        code: "PORTAL_UNKNOWN_SPACE",
        subjects: [portal.id, portal.a],
        evidence: [],
      });
      continue;
    }
    if (portal.b !== EXTERIOR_SPACE_ID && !b) {
      findings.push({
        code: "PORTAL_UNKNOWN_SPACE",
        subjects: [portal.id, portal.b],
        evidence: [],
      });
      continue;
    }
    // Same predicate the access graph uses, so "valid enough to validate" and
    // "valid enough to walk through" can never drift apart.
    if (!portalSpanValid(portal, spaceById, footprint)) {
      findings.push({
        code: "PORTAL_NOT_ON_SHARED_EDGE",
        subjects: [portal.id],
        evidence: [],
      });
      continue;
    }
    validPortals.push(portal);
  }
  return { validPortals, findings };
}

/**
 * Prepare the shared evaluation context.  Map construction keeps the legacy
 * loop semantics exactly: malformed rectangles are skipped, duplicate space
 * ids resolve to their first occurrence, and only known room instances join
 * `roomSpaces`.
 */
export function prepareRuleContext(layout: Layout, project: NormalizedProject): RuleContext {
  const footprint = layout.footprint;
  const spaces = Array.isArray(layout.spaces) ? layout.spaces : [];
  const roomById = new Map(project.rooms.map((room) => [room.id, room]));
  const spaceById = new Map<string, PlacedSpace>();
  const roomSpaces = new Map<string, PlacedSpace>();
  const indexes = buildLayoutIndexes(layout);

  for (const space of spaces) {
    if (!isGridRect(space.rect)) continue;
    if (!spaceById.has(space.instanceId)) spaceById.set(space.instanceId, space);
    if (space.role === "room" && roomById.has(space.instanceId)) {
      roomSpaces.set(space.instanceId, space);
    }
  }

  const portalInspection = inspectPortals(
    layout,
    spaceById,
    isGridRect(footprint) ? footprint : null,
  );
  const graph = buildPedestrianPortalGraph({ ...layout, portals: portalInspection.validPortals });
  const reachable = new Set(reachableSpaceIds(graph));
  const transitReachable = transitReachability(graph, spaces, roomById);

  return {
    layout,
    project,
    indexes,
    spaces,
    roomById,
    spaceById,
    roomSpaces,
    portalInspection,
    validPortals: portalInspection.validPortals,
    graph,
    reachable,
    transitReachable,
  };
}

function portalRule(
  id: string,
  code: ViolationCode,
  validateParameters: (value: unknown) => RuleParameters = emptyParameters,
): RuleDefinition {
  return defineRule(id, "portal", validateParameters, (context, rule) => {
    const findings = context.portalInspection.findings.filter((finding) => finding.code === code);
    if (findings.length === 0) return [passEvaluation(rule)];
    return findings.map((finding) =>
      failEvaluation(
        rule,
        finding.code,
        finding.subjects,
        finding.evidence,
        finding.expected,
        finding.actual,
      ));
  });
}

const PLANLAB_CORE_DEFINITIONS_ARRAY: readonly RuleDefinition[] = [
  defineRule("unsupported-schema-version", "schema", emptyParameters, (context, rule) =>
    context.project.schemaVersion !== PROJECT_SCHEMA_VERSION
      ? [failEvaluation(rule, "UNSUPPORTED_SCHEMA_VERSION", [context.layout.id])]
      : [passEvaluation(rule)]),

  defineRule("invalid-footprint-geometry", "site", emptyParameters, (context, rule) =>
    !isGridRect(context.layout.footprint)
      ? [failEvaluation(rule, "INVALID_FOOTPRINT_GEOMETRY", [context.layout.id])]
      : [passEvaluation(rule)]),

  defineRule("footprint-outside-envelope", "site", emptyParameters, (context, rule) => {
    const footprint = context.layout.footprint;
    if (isGridRect(footprint) && !containsRect(context.project.site.envelope, footprint)) {
      return [failEvaluation(rule, "FOOTPRINT_OUTSIDE_ENVELOPE", [context.layout.id])];
    }
    return [passEvaluation(rule)];
  }),

  defineRule("footprint-exceeds-max-gfa", "site", singleIntegerParameter("maximumGfaUnits2"), (
    context,
    rule,
  ) => {
    const footprint = context.layout.footprint;
    const maximumGfaUnits2 = rule.parameters.maximumGfaUnits2 as number;
    if (isGridRect(footprint) && area(footprint) > maximumGfaUnits2) {
      return [failEvaluation(
        rule,
        "FOOTPRINT_EXCEEDS_MAX_GFA",
        [context.layout.id],
        [scalarEvidence("maxGfaUnits", maximumGfaUnits2)],
        maximumGfaUnits2,
        area(footprint),
      )];
    }
    return [passEvaluation(rule)];
  }),

  defineRule("invalid-space-role", "geometry", emptyParameters, (context, rule) => {
    const failures = context.spaces
      .filter((space) => !["room", "circulation", "entry"].includes(space.role))
      .map((space) => failEvaluation(rule, "INVALID_SPACE_ROLE", [space.instanceId]));
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("invalid-space-geometry", "geometry", emptyParameters, (context, rule) => {
    const failures = context.spaces
      .filter((space) => !isGridRect(space.rect))
      .map((space) => failEvaluation(rule, "INVALID_SPACE_GEOMETRY", [space.instanceId]));
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("duplicate-space-id", "geometry", emptyParameters, (context, rule) => {
    const seen = new Set<string>();
    const failures: RuleEvaluation[] = [];
    for (const space of context.spaces) {
      if (!isGridRect(space.rect)) continue;
      if (seen.has(space.instanceId)) {
        failures.push(failEvaluation(rule, "DUPLICATE_SPACE_ID", [space.instanceId]));
      } else {
        seen.add(space.instanceId);
      }
    }
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("space-outside-footprint", "geometry", emptyParameters, (context, rule) => {
    const footprint = context.layout.footprint;
    if (!isGridRect(footprint)) return [passEvaluation(rule)];
    const failures = context.spaces
      .filter((space) => isGridRect(space.rect) && !containsRect(footprint, space.rect))
      .map((space) => failEvaluation(
        rule,
        "SPACE_OUTSIDE_FOOTPRINT",
        [space.instanceId],
        [geometryEvidence("space", space.rect)],
      ));
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("unknown-room-instance", "geometry", emptyParameters, (context, rule) => {
    const failures = context.spaces
      .filter(
        (space) =>
          isGridRect(space.rect) &&
          space.role === "room" &&
          !context.roomById.has(space.instanceId),
      )
      .map((space) => failEvaluation(rule, "UNKNOWN_ROOM_INSTANCE", [space.instanceId]));
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("space-overlap", "coverage", emptyParameters, (context, rule) => {
    const failures = context.indexes.overlaps.map((overlap) => failEvaluation(
      rule,
      "SPACE_OVERLAP",
      [overlap.a, overlap.b],
      [
        scalarEvidence("overlapUnits2", overlap.areaUnits2),
        geometryEvidence("overlap", overlap.rect),
      ],
    ));
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("unallocated-interior-exceeds-cap", "coverage", maximumRatioParameter, (
    context,
    rule,
  ) => {
    const footprint = context.layout.footprint;
    if (!isGridRect(footprint)) return [passEvaluation(rule)];
    const unallocated = context.indexes.unallocatedInteriorAreaUnits2;
    const ratio = unallocated / area(footprint);
    const maximum = rule.parameters.maximumRatio as number;
    if (ratio > maximum) {
      return [failEvaluation(
        rule,
        "UNALLOCATED_INTERIOR_EXCEEDS_CAP",
        [context.layout.id],
        [
          scalarEvidence("unallocatedUnits2", unallocated),
          scalarEvidence("ratio", ratio),
        ],
        maximum,
        ratio,
      )];
    }
    return [passEvaluation(rule)];
  }),

  defineRule("required-room-missing", "program", emptyParameters, (context, rule) => {
    const failures = context.project.rooms
      .filter((room) => room.inclusion === "required" && !context.roomSpaces.has(room.id))
      .map((room) => failEvaluation(rule, "REQUIRED_ROOM_MISSING", [room.id]));
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("room-dimensions-invalid", "program", emptyParameters, (context, rule) => {
    const failures: RuleEvaluation[] = [];
    for (const room of context.project.rooms) {
      const space = context.roomSpaces.get(room.id);
      if (!space) continue;
      if (!roomDimensionsValid(room, space.rect)) {
        failures.push(failEvaluation(
          rule,
          "ROOM_DIMENSIONS_INVALID",
          [room.id],
          [geometryEvidence("space", space.rect)],
        ));
      }
    }
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("circulation-width-invalid", "program", singleIntegerParameter("minimumWidthUnits"), (
    context,
    rule,
  ) => {
    const minimumUnits = rule.parameters.minimumWidthUnits as number;
    const failures = context.spaces
      .filter((space) => space.role === "circulation" || space.role === "entry")
      .filter((space) => Math.min(space.rect.width, space.rect.depth) < minimumUnits)
      .map((space) => failEvaluation(
        rule,
        "CIRCULATION_WIDTH_INVALID",
        [space.instanceId],
        [
          scalarEvidence("minimumUnits", minimumUnits),
          geometryEvidence("space", space.rect),
        ],
      ));
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  portalRule("duplicate-portal-id", "DUPLICATE_PORTAL_ID"),
  portalRule("portal-wall-invalid", "PORTAL_WALL_INVALID"),
  portalRule("portal-kind-invalid", "PORTAL_KIND_INVALID"),
  portalRule(
    "portal-width-invalid",
    "PORTAL_WIDTH_INVALID",
    singleIntegerParameter("minimumWidthUnits"),
  ),
  portalRule("portal-unknown-space", "PORTAL_UNKNOWN_SPACE"),
  portalRule("portal-not-on-shared-edge", "PORTAL_NOT_ON_SHARED_EDGE"),

  defineRule("entrance-count-invalid", "portal", emptyParameters, (context, rule) => {
    const externalPedestrian = context.validPortals.filter(
      (portal) =>
        portal.kind === "pedestrian" &&
        (portal.a === EXTERIOR_SPACE_ID || portal.b === EXTERIOR_SPACE_ID),
    );
    if (externalPedestrian.length !== 1) {
      return [failEvaluation(
        rule,
        "ENTRANCE_COUNT_INVALID",
        externalPedestrian.map((portal) => portal.id),
        [
          scalarEvidence("expectedCount", 1),
          scalarEvidence("actualCount", externalPedestrian.length),
        ],
        1,
        externalPedestrian.length,
      )];
    }
    return [passEvaluation(rule)];
  }),

  defineRule("entrance-portal-invalid", "portal", emptyParameters, (context, rule) => {
    const entrance = context.validPortals.find(
      (portal) => portal.id === context.layout.entrancePortalId,
    );
    if (
      !entrance ||
      entrance.kind !== "pedestrian" ||
      entrance.a !== EXTERIOR_SPACE_ID && entrance.b !== EXTERIOR_SPACE_ID ||
      entrance.wall !== "south"
    ) {
      return [failEvaluation(
        rule,
        "ENTRANCE_PORTAL_INVALID",
        [context.layout.entrancePortalId],
      )];
    }
    return [passEvaluation(rule)];
  }),

  defineRule("entrance-target-invalid", "portal", emptyParameters, (context, rule) => {
    const entrance = context.validPortals.find(
      (portal) => portal.id === context.layout.entrancePortalId,
    );
    if (
      !entrance ||
      entrance.kind !== "pedestrian" ||
      entrance.a !== EXTERIOR_SPACE_ID && entrance.b !== EXTERIOR_SPACE_ID ||
      entrance.wall !== "south"
    ) {
      return [passEvaluation(rule)];
    }
    const targetId = entrance.a === EXTERIOR_SPACE_ID ? entrance.b : entrance.a;
    const target = context.spaceById.get(targetId);
    if (
      !target ||
      (target.role !== "entry" && target.role !== "circulation")
    ) {
      return [failEvaluation(
        rule,
        "ENTRANCE_TARGET_INVALID",
        [context.layout.entrancePortalId, targetId],
        target ? [geometryEvidence("target", target.rect)] : [],
      )];
    }
    return [passEvaluation(rule)];
  }),

  defineRule("forbidden-pass-through", "access", emptyParameters, (context, rule) => {
    const failures: RuleEvaluation[] = [];
    for (const room of context.project.rooms) {
      const roomSpace = context.roomSpaces.get(room.id);
      if (!roomSpace) continue;
      if (!isTransitNode(roomSpace, room)) {
        const pedestrianIncidents = context.graph.edges.filter(
          (edge) =>
            edge.kind === "pedestrian" &&
            (edge.a === room.id || edge.b === room.id),
        );
        if (pedestrianIncidents.length > 1) {
          failures.push(failEvaluation(rule, "FORBIDDEN_PASS_THROUGH", [room.id]));
        }
      }
      if (context.reachable.has(room.id) && !context.transitReachable.has(room.id)) {
        failures.push(failEvaluation(rule, "FORBIDDEN_PASS_THROUGH", [room.id]));
      }
    }
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("room-unreachable", "access", emptyParameters, (context, rule) => {
    const failures = context.project.rooms
      .filter((room) => context.roomSpaces.has(room.id) && !context.reachable.has(room.id))
      .map((room) => failEvaluation(rule, "ROOM_UNREACHABLE", [room.id]));
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("circulation-unreachable", "access", emptyParameters, (context, rule) => {
    const failures = context.spaces
      .filter((space) => space.role === "circulation" && !context.reachable.has(space.instanceId))
      .map((space) => failEvaluation(rule, "CIRCULATION_UNREACHABLE", [space.instanceId]));
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("garage-vehicle-portal-missing", "garage", emptyParameters, (context, rule) => {
    const vehicleExternal = context.validPortals.filter(
      (portal) =>
        portal.kind === "vehicle" &&
        (portal.a === EXTERIOR_SPACE_ID || portal.b === EXTERIOR_SPACE_ID),
    );
    const failures = context.project.rooms
      .filter(
        (room) =>
          room.traits.frontage?.kind === "vehicle" &&
          (room.inclusion === "required" || context.roomSpaces.has(room.id)),
      )
      .flatMap((room) => {
        const garagePortal = vehicleExternal.find(
          (portal) =>
            (portal.a === room.id || portal.b === room.id) &&
            portal.wall === "south",
        );
        return garagePortal
          ? []
          : [failEvaluation(rule, "GARAGE_VEHICLE_PORTAL_MISSING", [room.id])];
      });
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("garage-frontage-policy-invalid", "garage", emptyParameters, (context, rule) => {
    const failures: RuleEvaluation[] = [];
    for (const room of context.project.rooms) {
      if (!context.roomSpaces.has(room.id) || !isGarageRoom(room)) continue;
      if (
        room.traits.frontage?.kind !== "vehicle" ||
        room.traits.frontage.side !== "south"
      ) {
        failures.push(failEvaluation(rule, "GARAGE_FRONTAGE_POLICY_INVALID", [room.id]));
      }
    }
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("garage-preset-dimensions-invalid", "garage", garagePresetParameters, (
    context,
    rule,
  ) => {
    const minimumWidthUnits = rule.parameters.minimumWidthUnits as number;
    const minimumDepthUnits = rule.parameters.minimumDepthUnits as number;
    const failures: RuleEvaluation[] = [];
    for (const room of context.project.rooms) {
      const space = context.roomSpaces.get(room.id);
      if (!space || !isGarageRoom(room)) continue;
      if (space.rect.width < minimumWidthUnits || space.rect.depth < minimumDepthUnits) {
        failures.push(failEvaluation(
          rule,
          "GARAGE_PRESET_DIMENSIONS_INVALID",
          [room.id],
          [
            scalarEvidence("minimumWidthUnits", minimumWidthUnits),
            scalarEvidence("minimumDepthUnits", minimumDepthUnits),
            geometryEvidence("space", space.rect),
          ],
        ));
      }
    }
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("garage-missing-south-frontage", "garage", emptyParameters, (context, rule) => {
    const footprint = context.layout.footprint;
    if (!isGridRect(footprint)) return [passEvaluation(rule)];
    const failures: RuleEvaluation[] = [];
    for (const room of context.project.rooms) {
      const space = context.roomSpaces.get(room.id);
      if (!space || !isGarageRoom(room)) continue;
      if (space.rect.y + space.rect.depth !== footprint.y + footprint.depth) {
        failures.push(failEvaluation(
          rule,
          "GARAGE_MISSING_SOUTH_FRONTAGE",
          [room.id],
          [geometryEvidence("space", space.rect)],
        ));
      }
    }
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("relationship-selector-unresolved", "relationship", emptyParameters, (
    context,
    rule,
  ) => {
    const failures: RuleEvaluation[] = [];
    for (const relationship of context.project.relationships) {
      if (relationship.kind !== "mustShareWall") continue;
      const from = selectedSpaces(relationship.from, context.project, context.roomSpaces);
      const to = selectedSpaces(relationship.to, context.project, context.roomSpaces);
      if (from.length === 0 || to.length === 0) {
        failures.push(failEvaluation(
          rule,
          "RELATIONSHIP_SELECTOR_UNRESOLVED",
          [relationship.id],
          [
            scalarEvidence("from", roomSelectorKey(relationship.from)),
            scalarEvidence("to", roomSelectorKey(relationship.to)),
          ],
        ));
      }
    }
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),

  defineRule("must-share-wall-unsatisfied", "relationship", emptyParameters, (context, rule) => {
    const failures: RuleEvaluation[] = [];
    for (const relationship of context.project.relationships) {
      if (relationship.kind !== "mustShareWall") continue;
      const from = selectedSpaces(relationship.from, context.project, context.roomSpaces);
      const to = selectedSpaces(relationship.to, context.project, context.roomSpaces);
      if (from.length === 0 || to.length === 0) continue;
      const threshold = Math.max(
        MIN_MEANINGFUL_SHARED_WALL_UNITS,
        relationship.minSharedWallM === undefined
          ? 0
          : Math.ceil(relationship.minSharedWallM / GRID_UNIT_METRES),
      );
      let satisfied = false;
      for (const a of from) {
        for (const b of to) {
          if (a.instanceId === b.instanceId) continue;
          if (sharedWallLength(a.rect, b.rect) >= threshold) satisfied = true;
        }
      }
      if (!satisfied) {
        failures.push(failEvaluation(
          rule,
          "MUST_SHARE_WALL_UNSATISFIED",
          [relationship.id],
          [scalarEvidence("thresholdUnits", threshold)],
        ));
      }
    }
    return failures.length > 0 ? failures : [passEvaluation(rule)];
  }),
];

export const PLANLAB_CORE_DEFINITIONS: ReadonlyMap<string, RuleDefinition> = new Map(
  PLANLAB_CORE_DEFINITIONS_ARRAY.map((definition) => [definition.id, definition]),
);

/** Stable pipeline order from `RULE_ENGINE.md` (schema → … → relationships). */
export const PLANLAB_CORE_PIPELINE: readonly string[] = Object.freeze(
  PLANLAB_CORE_DEFINITIONS_ARRAY.map((definition) => definition.id),
);

const SCOPE_BY_DEFINITION_ID: Readonly<Record<string, RuleScope>> = Object.freeze({
  "unsupported-schema-version": { kind: "layout" },
  "invalid-footprint-geometry": { kind: "layout" },
  "footprint-outside-envelope": { kind: "layout" },
  "footprint-exceeds-max-gfa": { kind: "layout" },
  "invalid-space-role": { kind: "space" },
  "invalid-space-geometry": { kind: "space" },
  "duplicate-space-id": { kind: "space" },
  "space-outside-footprint": { kind: "space" },
  "unknown-room-instance": { kind: "space" },
  "space-overlap": { kind: "space" },
  "unallocated-interior-exceeds-cap": { kind: "layout" },
  "required-room-missing": { kind: "room" },
  "room-dimensions-invalid": { kind: "room" },
  "circulation-width-invalid": { kind: "space" },
  "duplicate-portal-id": { kind: "portal" },
  "portal-wall-invalid": { kind: "portal" },
  "portal-kind-invalid": { kind: "portal" },
  "portal-width-invalid": { kind: "portal" },
  "portal-unknown-space": { kind: "portal" },
  "portal-not-on-shared-edge": { kind: "portal" },
  "entrance-count-invalid": { kind: "portal" },
  "entrance-portal-invalid": { kind: "portal" },
  "entrance-target-invalid": { kind: "portal" },
  "garage-vehicle-portal-missing": { kind: "room" },
  "forbidden-pass-through": { kind: "room" },
  "room-unreachable": { kind: "room" },
  "circulation-unreachable": { kind: "space" },
  "garage-frontage-policy-invalid": { kind: "room" },
  "garage-preset-dimensions-invalid": { kind: "room" },
  "garage-missing-south-frontage": { kind: "room" },
  "relationship-selector-unresolved": { kind: "relationship" },
  "must-share-wall-unsatisfied": { kind: "relationship" },
});

function projectParameters(project: NormalizedProject): Readonly<Record<string, RuleParameters>> {
  const maximumUnallocated = Math.min(
    project.planning.maxUnallocatedInteriorRatio ?? DEFAULT_MAX_UNALLOCATED_RATIO,
    MAX_UNALLOCATED_INTERIOR_RATIO,
  );
  return Object.freeze({
    "footprint-exceeds-max-gfa": Object.freeze({ maximumGfaUnits2: maxGfaUnits(project) }),
    "unallocated-interior-exceeds-cap": Object.freeze({ maximumRatio: maximumUnallocated }),
    "circulation-width-invalid": Object.freeze({
      minimumWidthUnits: project.planning.minimumCirculationWidthUnits,
    }),
    "portal-width-invalid": Object.freeze({ minimumWidthUnits: MIN_PORTAL_WIDTH_UNITS }),
    "garage-preset-dimensions-invalid": Object.freeze({
      minimumWidthUnits: GARAGE_MIN_WIDTH_UNITS,
      minimumDepthUnits: GARAGE_MIN_DEPTH_UNITS,
    }),
  });
}

/**
 * The built-in `planlab-core` pack: one enabled hard instance per definition,
 * with project-derived parameters validated against the definition.
 */
export function createPlanlabCoreRuleInstances(
  project: NormalizedProject,
): readonly RuleInstance[] {
  // One pack per project: candidates in a generation share the same
  // normalized parameters, so instances are derived once and reused.
  const cached = INSTANCES_BY_PROJECT.get(project);
  if (cached) return cached;
  const parameters = projectParameters(project);
  const instances = Object.freeze(
    PLANLAB_CORE_DEFINITIONS_ARRAY.map((definition) => Object.freeze({
      id: `${PLANLAB_CORE_RULE_PACK}.${definition.id}.v${definition.version}`,
      definitionId: definition.id,
      definitionVersion: definition.version,
      enabled: true,
      enforcement: "hard",
      source: PLANLAB_CORE_SOURCE,
      parameters: definition.validateParameters(parameters[definition.id] ?? {}),
      scope: SCOPE_BY_DEFINITION_ID[definition.id],
    })),
  );
  INSTANCES_BY_PROJECT.set(project, instances);
  return instances;
}

const PLANLAB_CORE_SOURCE: RuleSource = Object.freeze({
  kind: "planlab",
  reference: PLANLAB_CORE_RULE_REFERENCE,
});

const INSTANCES_BY_PROJECT = new WeakMap<NormalizedProject, readonly RuleInstance[]>();

/**
 * Evaluate one instance.  Disabled instances are notApplicable; unknown
 * definitions or version mismatches fail with `RULE_DEFINITION_UNSUPPORTED` —
 * unsupported evaluators never pass silently.
 */
export function evaluateRuleInstance(
  instance: RuleInstance,
  context: RuleContext,
  definitions: ReadonlyMap<string, RuleDefinition> = PLANLAB_CORE_DEFINITIONS,
): readonly RuleEvaluation[] {
  if (!instance.enabled) return [notApplicableEvaluation(instance)];
  const definition = definitions.get(instance.definitionId);
  if (!definition || definition.version !== instance.definitionVersion) {
    return [unsupportedEvaluation(instance)];
  }
  return definition.evaluate(context, instance);
}

/** Evaluate instances in the order given, preserving each rule's own order. */
export function evaluateRuleInstances(
  instances: readonly RuleInstance[],
  context: RuleContext,
  definitions: ReadonlyMap<string, RuleDefinition> = PLANLAB_CORE_DEFINITIONS,
): RuleEvaluation[] {
  const evaluations: RuleEvaluation[] = [];
  for (const instance of instances) {
    evaluations.push(...evaluateRuleInstance(instance, context, definitions));
  }
  return evaluations;
}

/** Run the full built-in hard pipeline for one candidate. */
export function evaluatePlanlabCoreRules(context: RuleContext): readonly RuleEvaluation[] {
  return evaluateRuleInstances(createPlanlabCoreRuleInstances(context.project), context);
}

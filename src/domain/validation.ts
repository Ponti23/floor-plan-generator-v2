/**
 * Independent hard validator.
 *
 * Stage 2 bucket 2.3 replaced this module's inline check sequence with the
 * typed evaluator registry in `rules.ts`.  This file now prepares one shared
 * `RuleContext` per candidate, runs the ordered `planlab-core` pipeline, and
 * projects fail evaluations onto the legacy `ValidationResult` shape consumed
 * by the generator, metrics, scoring, and diagnostics.
 *
 * The public result shape is unchanged on purpose: valid canonical layouts
 * serialize byte-for-byte as they did before the refactor, and every existing
 * violation code is preserved.
 */

import type { Layout } from "./layout.ts";
import type { NormalizedProject } from "./model.ts";
import {
  type PortalGraph,
} from "./portalGraph.ts";
import {
  evaluatePlanlabCoreRules,
  prepareRuleContext,
  type GeometryEvidenceValue,
  type RuleEvaluation,
  type ScalarEvidenceValue,
} from "./rules.ts";

export type ValidationSeverity = "hard" | "soft";

export interface ValidationEvidence {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ValidationViolation {
  code: string;
  ruleId: string;
  ruleVersion: number;
  severity: ValidationSeverity;
  subjects: string[];
  expected?: string | number | boolean;
  actual?: string | number | boolean;
  evidence?: ValidationEvidence;
  /** Rectangles relevant to the finding, for UI highlighting. */
  geometryEvidence?: GeometryEvidenceValue[];
  message: { key: string; values: Record<string, string | number> };
}

export interface ValidationResult {
  valid: boolean;
  violations: ValidationViolation[];
  counts: { errors: number; warnings: number };
  /** Pedestrian-only access graph used to establish human reachability. */
  graph: PortalGraph;
  reachableSpaceIds: string[];
}

// Portal graph and reachability helpers historically lived here and remain
// available through this module for backward compatibility.
export {
  buildAccessGraph,
  buildPedestrianPortalGraph,
  buildPortalGraph,
  computeReachability,
  createPortalGraph,
  portalSpanValid,
  reachableSpaceIds,
} from "./portalGraph.ts";
export type {
  AccessGraph,
  PortalGraph,
  PortalGraphEdge,
  PortalGraphOptions,
} from "./portalGraph.ts";

function isNormalizedProject(value: unknown): value is NormalizedProject {
  return (
    value !== null &&
    typeof value === "object" &&
    "site" in value &&
    typeof (value as { site?: unknown }).site === "object" &&
    Array.isArray((value as { rooms?: unknown }).rooms)
  );
}

function resolveArguments(
  first: Layout | NormalizedProject,
  second: Layout | NormalizedProject,
): { layout: Layout; project: NormalizedProject } {
  if (isNormalizedProject(first)) {
    return { project: first, layout: second as Layout };
  }
  return { layout: first as Layout, project: second as NormalizedProject };
}

function evaluationToViolation(evaluation: RuleEvaluation): ValidationViolation {
  const scalarEvidence: ValidationEvidence = {};
  const geometryEvidence: GeometryEvidenceValue[] = [];
  for (const item of evaluation.evidence) {
    if (item.kind === "scalar") {
      const scalar = item as ScalarEvidenceValue;
      scalarEvidence[scalar.key] = scalar.value;
    } else {
      geometryEvidence.push(item);
    }
  }
  return {
    code: evaluation.code,
    ruleId: `planlab-core.${evaluation.ruleDefinitionId}`,
    ruleVersion: evaluation.ruleDefinitionVersion,
    severity: evaluation.enforcement,
    subjects: evaluation.subjects.map((subject) => subject.id),
    ...(evaluation.expected !== undefined ? { expected: evaluation.expected } : {}),
    ...(evaluation.actual !== undefined ? { actual: evaluation.actual } : {}),
    ...(Object.keys(scalarEvidence).length > 0 ? { evidence: scalarEvidence } : {}),
    ...(geometryEvidence.length > 0 ? { geometryEvidence } : {}),
    message: evaluation.message,
  };
}

/**
 * Independent hard validator.  It intentionally does not trust generator
 * metadata, constructor state, or a precomputed graph.
 *
 * Both `(layout, project)` and `(project, layout)` are accepted to make the
 * domain helper pleasant to use from small spike scripts.
 */
export function validateLayout(
  layoutOrProject: Layout | NormalizedProject,
  projectOrLayout: Layout | NormalizedProject,
): ValidationResult {
  const { layout, project } = resolveArguments(layoutOrProject, projectOrLayout);
  const context = prepareRuleContext(layout, project);
  const evaluations = evaluatePlanlabCoreRules(context);
  const violations = evaluations
    .filter((evaluation) => evaluation.status === "fail")
    .map(evaluationToViolation);

  return {
    valid: violations.length === 0,
    violations,
    counts: { errors: violations.length, warnings: 0 },
    graph: context.graph,
    reachableSpaceIds: [...context.reachable],
  };
}

export const hardValidateLayout = validateLayout;
export const validateGeneratedLayout = validateLayout;
export const independentlyValidateLayout = validateLayout;

/**
 * S01 frontend contract tests.
 *
 * The same fixture corpus that `services/generation/tests/unit/test_contracts.py`
 * runs is executed here against the TypeScript guards, so both languages accept
 * and reject identical payloads.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CONTRACT_VERSION,
  type BriefV1,
  type GenerationRequestV1,
  type LayoutV1,
} from "../../src/integration/contracts.ts";
import {
  ERROR_SHAPE,
  assertBriefV1,
  assertLayoutV1,
  validateBriefV1,
  validateEditorDocumentV2,
  validateGenerationRequestV1,
  validateJobV1,
  validateLayoutV1,
  validateProblemV1,
} from "../../src/integration/contract-validation.ts";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = resolve(REPO_ROOT, "test", "integration", "fixtures");
const CONTRACTS_DIR = resolve(REPO_ROOT, "contracts");

type Json = Record<string, unknown>;

interface FixtureFile {
  fixtureVersion: number;
  kind: string;
  origin: Json;
  notes?: string[];
  payload: Json;
}

interface CaseFile {
  fixtureVersion: number;
  kind: string;
  builders: Record<string, string>;
  cases: {
    name: string;
    target: "brief" | "layout" | "request" | "job" | "problem" | "editor";
    base: string;
    expect: "accept" | "reject";
    reason: string;
    patch?: { op: string; path: (string | number)[]; value?: unknown }[];
    builder?: string;
  }[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function load(name: string): FixtureFile {
  return readJson<FixtureFile>(resolve(FIXTURES, name));
}

const PLACEHOLDERS: Record<string, number> = {
  NaN: Number.NaN,
  Infinity: Number.POSITIVE_INFINITY,
  "-Infinity": Number.NEGATIVE_INFINITY,
};

function resolveValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value as object);
    if (keys.length === 1 && keys[0] === "$number") {
      const key = (value as Json).$number as string;
      if (!(key in PLACEHOLDERS)) {
        throw new Error(`unknown number placeholder ${key}`);
      }
      return PLACEHOLDERS[key];
    }
    const out: Json = {};
    for (const [key, item] of Object.entries(value as Json)) {
      out[key] = resolveValue(item) as never;
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item));
  }
  return value;
}

function applyPatch(payload: Json, patch: CaseFile["cases"][number]["patch"]): Json {
  const target = structuredClone(payload);
  for (const op of patch ?? []) {
    let node: unknown = target;
    for (const step of op.path.slice(0, -1)) {
      node = (node as Record<string | number, unknown>)[step];
    }
    const leaf = op.path[op.path.length - 1];
    const container = node as Record<string | number, unknown>;
    if (op.op === "set") {
      container[leaf] = resolveValue(structuredClone(op.value));
    } else if (op.op === "delete") {
      delete container[leaf];
    } else if (op.op === "append") {
      (container[leaf] as unknown[]).push(resolveValue(structuredClone(op.value)));
    } else {
      throw new Error(`unknown patch op ${op.op}`);
    }
  }
  return target;
}

function briefRoom(overrides: Partial<BriefV1["rooms"][number]> = {}): BriefV1["rooms"][number] {
  return {
    id: "B1",
    label: "Bedroom 1",
    type: "bedroom",
    roomClass: "standard",
    sourceRequirementId: "bedroom",
    ordinal: 0,
    required: true,
    targetAreaM2: 14,
    minAreaM2: 11,
    maxAreaM2: 16.1,
    minShortSideMm: 3200,
    minWidthMm: 3200,
    minHeightMm: 3200,
    maxAspectRatio: 1.8,
    ...overrides,
  };
}

function relationship(id: string, a: string, b: string, kind = "mustShareWall") {
  return { id, a, b, kind, minSharedWallMm: 900, minOpeningWidthMm: 820 };
}

function editorDocument(brief: Json, pad = false) {
  const rooms = brief.rooms as Json[];
  const groups = rooms.map((room) => ({
    requirementId: room.sourceRequirementId as string,
    label: room.label as string,
    type: room.type as string,
    roomClass: room.roomClass as string,
    quantity: 1,
    required: room.required as boolean,
    instanceIds: [room.id as string],
    retiredInstanceIds: pad
      ? Array.from({ length: 64 }, (_unused, index) => `Retired${String(index).padStart(32, "0")}`)
      : [],
  }));
  return {
    schemaVersion: "planlab.editor/2",
    name: "Fixture project",
    roomGroups: groups,
    legacyImport: null,
  };
}

function buildCase(builder: string, base: Json): Json {
  const payload = structuredClone(base);
  switch (builder) {
    case "brief-too-many-rooms":
      payload.rooms = Array.from({ length: 25 }, (_unused, index) =>
        briefRoom({ id: `B${index + 1}`, ordinal: index }),
      );
      payload.relationships = [];
      break;
    case "brief-fine-type-cap": {
      const rooms = Array.from({ length: 9 }, (_unused, index) =>
        briefRoom({ id: `B${index + 1}`, ordinal: index }),
      );
      rooms.push(
        briefRoom({
          id: "L1",
          label: "Living Room 1",
          type: "living",
          sourceRequirementId: "living",
          targetAreaM2: 22,
          minAreaM2: 16,
          maxAreaM2: 25.3,
          minShortSideMm: 3400,
          minWidthMm: 3400,
          minHeightMm: 3400,
          maxAspectRatio: 2,
        }),
      );
      payload.rooms = rooms;
      payload.relationships = [];
      break;
    }
    case "brief-too-many-relationships": {
      const rooms = Array.from({ length: 23 }, (_unused, index) =>
        briefRoom({ id: `R${index + 1}`, ordinal: index }),
      );
      rooms.push(
        briefRoom({
          id: "L1",
          label: "Living Room 1",
          type: "living",
          sourceRequirementId: "living",
          targetAreaM2: 22,
          minAreaM2: 16,
          maxAreaM2: 25.3,
          minShortSideMm: 3400,
          minWidthMm: 3400,
          minHeightMm: 3400,
          maxAspectRatio: 2,
        }),
      );
      payload.rooms = rooms;
      const ids = rooms.map((room) => room.id);
      const relationships: ReturnType<typeof relationship>[] = [];
      for (let first = 0; first < ids.length && relationships.length < 65; first += 1) {
        for (let second = first + 1; second < ids.length && relationships.length < 65; second += 1) {
          relationships.push(relationship(`REL-${ids[first]}-${ids[second]}`, ids[first], ids[second]));
        }
      }
      payload.relationships = relationships;
      break;
    }
    case "brief-relationship-self-edge":
      payload.relationships = [relationship("REL-self", "B1", "B1")];
      break;
    case "brief-relationship-unknown-endpoint":
      payload.relationships = [relationship("REL-unknown", "B1", "ZZ9")];
      break;
    case "brief-duplicate-relationship-pair":
      payload.relationships = [
        relationship("REL-one", "B1", "B2"),
        relationship("REL-two", "B2", "B1"),
      ];
      break;
    case "brief-target-gfa-above-max":
      payload.building = { targetGfaM2: 200, maxGfaM2: 150 };
      break;
    case "brief-topn-above-topk":
      payload.settings = { ...(payload.settings as Json), topK: 2, topN: 3 };
      break;
    case "brief-min-area-above-target":
      (payload.rooms as Json[])[0].minAreaM2 = 20;
      break;
    case "brief-axis-minimum-below-short-side":
      (payload.rooms as Json[])[0].minWidthMm = 2000;
      break;
    case "brief-no-living-or-dining":
      for (const room of payload.rooms as Json[]) {
        if (room.type === "living" || room.type === "dining") {
          room.type = "store";
        }
      }
      break;
    case "brief-no-required-room":
      for (const room of payload.rooms as Json[]) {
        room.required = false;
      }
      break;
    case "brief-min-site-axis-ok":
      payload.site = { ...(payload.site as Json), widthMm: 3000, heightMm: 3000 };
      break;
    case "brief-three-decimals-ok":
      (payload.rooms as Json[])[0].targetAreaM2 = 14.001;
      break;
    case "editor-document-over-64k":
      return editorDocument(base, true) as unknown as Json;
    case "layout-below-authored-axis-minimum": {
      const room = (payload.rooms as Json[])[0];
      const rect = room.rect as Json;
      room.rect = { xMm: rect.xMm, yMm: rect.yMm, widthMm: 3100, heightMm: 4000 };
      room.areaM2 = (3100 * 4000) / 1_000_000;
      break;
    }
    case "layout-omitted-room-also-present":
      payload.omittedRoomIds = [(payload.rooms as Json[])[0].id as string];
      break;
    case "layout-zero-width-wall":
      ((payload.walls as Json[])[0].rect as Json).widthMm = 0;
      break;
    default:
      throw new Error(`unknown builder ${builder}`);
  }
  return payload;
}

function prepare(entry: CaseFile["cases"][number]): { target: string; payload: unknown } {
  const base = load(entry.base).payload;
  let payload: unknown;
  if (entry.target === "request") {
    const request: GenerationRequestV1 = {
      schemaVersion: CONTRACT_VERSION,
      projectId: base.projectId as string,
      briefVersionId: base.briefVersionId as string,
      idempotencyKey: "idem-fixture-key",
    };
    payload = request;
  } else if (entry.target === "editor") {
    payload = editorDocument(base);
  } else {
    payload = structuredClone(base);
  }
  if (entry.builder) {
    payload = buildCase(entry.builder, entry.target === "editor" ? base : (payload as Json));
  }
  if (entry.patch) {
    payload = applyPatch(payload as Json, entry.patch);
  }
  return { target: entry.target, payload };
}

function validate(target: string, payload: unknown): { ok: boolean; issues: unknown[] } {
  switch (target) {
    case "brief":
      return validateBriefV1(payload);
    case "layout":
      return validateLayoutV1(payload);
    case "request":
      return validateGenerationRequestV1(payload);
    case "job":
      return validateJobV1(payload);
    case "problem":
      return validateProblemV1(payload);
    case "editor":
      return validateEditorDocumentV2(payload);
    default:
      throw new Error(`unknown target ${target}`);
  }
}

test("golden fixtures validate and the layout carries its engine provenance", () => {
  const briefB = assertBriefV1(load("brief-B.json").payload);
  assert.equal(briefB.rooms.length, 9);
  assert.deepEqual(
    briefB.rooms.map((room) => room.id),
    ["B1", "B2", "B3", "BA1", "BA2", "K1", "L1", "G1", "LA1"],
  );

  assertBriefV1(load("brief-D.json").payload);

  const fixture = load("layout-B.json");
  const layout = assertLayoutV1(fixture.payload);
  assert.equal(layout.provenance.topologySource, "topology_model_v1");
  assert.equal(layout.validation.checks.length, 20);
  assert.equal(layout.rank, 1);
  assert.equal(
    layout.versions.checkpointSha256,
    "3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8",
  );
  assert.equal(fixture.origin.engineTransportSource, "brief_provided");
});

test("the shared corpus is accepted or rejected identically in TypeScript", () => {
  const corpus = readJson<CaseFile>(resolve(FIXTURES, "invalid-cases.json"));
  assert.ok(corpus.cases.length >= 40, "the corpus should stay comprehensive");
  const seen = new Set<string>();
  for (const entry of corpus.cases) {
    assert.ok(!seen.has(entry.name), `duplicate case name ${entry.name}`);
    seen.add(entry.name);
    const { target, payload } = prepare(entry);
    const result = validate(target, payload);
    if (entry.expect === "reject") {
      assert.equal(result.ok, false, `${entry.name} should be rejected: ${entry.reason}`);
      assert.ok(result.issues.length > 0, `${entry.name} should explain its rejection`);
    } else {
      assert.equal(
        result.ok,
        true,
        `${entry.name} should be accepted (${JSON.stringify(result.issues)})`,
      );
    }
  }
});

test("every corpus builder is implemented here", () => {
  const corpus = readJson<CaseFile>(resolve(FIXTURES, "invalid-cases.json"));
  const declared = new Set(Object.keys(corpus.builders));
  const used = new Set(corpus.cases.map((entry) => entry.builder).filter(Boolean) as string[]);
  assert.deepEqual([...used].sort(), [...declared].sort());
});

test("unknown fields and coercion are refused before anything renders", () => {
  const brief = load("brief-B.json").payload;
  const withExtra = { ...brief, engineRoot: "E:/secrets" };
  assert.equal(validateBriefV1(withExtra).ok, false);
  const stringSite = { ...brief, site: { ...(brief.site as Json), widthMm: "14117" } };
  assert.equal(validateBriefV1(stringSite).ok, false);
  assert.throws(() => assertBriefV1(withExtra), /contract check/);
});

test("error codes carry their normative category, retryability and proof", () => {
  assert.deepEqual(ERROR_SHAPE.NO_VALID_LAYOUT, {
    category: "architectural",
    retryable: false,
    proof: "limited_search",
  });
  assert.equal(ERROR_SHAPE.SOLVER_TIMEOUT.retryable, true);
  assert.equal(ERROR_SHAPE.INVALID_BRIEF.category, "input");

  const mismatched = {
    code: "NO_VALID_LAYOUT",
    category: "technical",
    message: "wrong category",
    retryable: false,
    proof: "limited_search",
    fieldErrors: [],
    remediation: [],
    correlationId: "corr-1",
  };
  assert.equal(validateProblemV1(mismatched).ok, false);
});

test("a completed job must carry layouts and versions", () => {
  const layout = load("layout-B.json").payload as unknown as LayoutV1;
  const job = {
    schemaVersion: CONTRACT_VERSION,
    generationId: layout.generationId,
    projectId: layout.projectId,
    briefVersionId: layout.briefVersionId,
    briefHash: layout.briefHash,
    status: "COMPLETED",
    stateVersion: 4,
    progress: {
      stage: "COMPLETED",
      candidateId: null,
      candidatesCompleted: 5,
      candidatesTotal: 5,
    },
    createdAt: layout.createdAt,
    startedAt: layout.createdAt,
    finishedAt: layout.createdAt,
    elapsedMs: 75_460,
    cancelRequested: false,
    layoutIds: [layout.layoutId],
    versions: layout.versions,
    error: null,
    warnings: [],
  };
  assert.equal(validateJobV1(job).ok, true);
  assert.equal(validateJobV1({ ...job, layoutIds: [] }).ok, false);
  assert.equal(validateJobV1({ ...job, versions: null }).ok, false);
  assert.equal(
    validateJobV1({ ...job, status: "FAILED", error: null, layoutIds: [] }).ok,
    false,
  );
});

test("the checked-in room policy table matches the engine factors once", () => {
  const policy = readJson<Json>(resolve(CONTRACTS_DIR, "room-policy-v1.json"));
  const types = policy.types as Json;
  assert.deepEqual(
    Object.keys(types).sort(),
    ["bathroom", "bedroom", "dining", "garage", "kitchen", "laundry", "living", "store", "study", "wc"],
  );
  const source = policy.source as Json;
  const factors = source.roomClassFactors as Record<string, { area: number; short_side: number; aspect: number }>;
  const fallback = source.typeFallback as Record<string, { target_area_m2: number; min_area_m2: number; min_short_side_mm: number; max_aspect_ratio: number }>;

  for (const [roomType, entry] of Object.entries(types)) {
    const definition = entry as Json;
    const engineType = definition.engineType as string;
    const base = fallback[engineType];
    for (const [className, raw] of Object.entries(definition.classes as Json)) {
      const resolved = raw as { targetAreaM2: number; minAreaM2: number; minShortSideMm: number; maxAspectRatio: number; maxAreaM2: number };
      const factor = factors[className];
      const expectedTarget = Math.round(base.target_area_m2 * factor.area * 1000) / 1000;
      const expectedMin = Math.round(base.min_area_m2 * factor.area * 1000) / 1000;
      const expectedShort = Math.round(base.min_short_side_mm * factor.short_side);
      const expectedAspect = Math.round(base.max_aspect_ratio * factor.aspect * 1000) / 1000;
      assert.equal(
        resolved.targetAreaM2,
        expectedTarget,
        `${roomType}/${className} target area must be the base multiplied once`,
      );
      assert.equal(resolved.minAreaM2, expectedMin, `${roomType}/${className} min area`);
      assert.equal(resolved.minShortSideMm, expectedShort, `${roomType}/${className} short side`);
      assert.equal(resolved.maxAspectRatio, expectedAspect, `${roomType}/${className} aspect`);
      assert.ok(resolved.maxAreaM2 >= resolved.targetAreaM2, `${roomType}/${className} max >= target`);
    }
  }

  const limits = policy.limits as Record<string, unknown>;
  assert.deepEqual(limits.siteAxisMm, [3000, 60000]);
  assert.deepEqual(limits.rooms, [2, 24]);
  assert.equal(limits.editorDocumentBytes, 65536);
});

test("the exported schema covers every public payload", () => {
  const schema = readJson<Json>(resolve(CONTRACTS_DIR, "generation-v1.schema.json"));
  const defs = schema.$defs as Json;
  for (const name of [
    "BriefV1",
    "GenerationRequestV1",
    "JobV1",
    "LayoutV1",
    "ProblemV1",
    "ProjectV1",
    "ProjectDetailV1",
    "EditorDocumentV2",
    "EngineVersionsV1",
  ]) {
    assert.ok(defs[name], `${name} must be exported in the schema`);
  }
  assert.equal((defs.BriefV1 as Json).additionalProperties, false);
});

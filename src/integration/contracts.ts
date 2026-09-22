/**
 * Public PlanLab generation contracts, mirroring
 * `services/generation/planlab_service/contracts.py`.
 *
 * One contract version: `planlab.generation/1`. Engine dictionaries never cross
 * this boundary; a layout DTO is complete enough to render on its own.
 */

export const CONTRACT_VERSION = "planlab.generation/1";
export const BRIEF_SCHEMA_VERSION = "planlab.brief/1";
export const LAYOUT_SCHEMA_VERSION = "planlab.layout/1";
export const EDITOR_SCHEMA_VERSION = "planlab.editor/2";

export type Side = "north" | "east" | "south" | "west";
export type RoomType =
  | "bedroom"
  | "bathroom"
  | "wc"
  | "kitchen"
  | "living"
  | "dining"
  | "garage"
  | "laundry"
  | "study"
  | "store";
export type RoomClass = "compact" | "standard" | "spacious";
export type RelationshipKind = "mustShareWall" | "directAccess";
export type GenerationStatus =
  | "QUEUED"
  | "LOADING_MODEL"
  | "GENERATING_TOPOLOGIES"
  | "SOLVING"
  | "VALIDATING"
  | "RANKING"
  | "COMPLETED"
  | "INFEASIBLE"
  | "FAILED"
  | "CANCELLED";
export type ErrorCode =
  | "INVALID_BRIEF"
  | "PROGRAMME_TOO_LARGE"
  | "NO_VALID_LAYOUT"
  | "ENGINE_UNAVAILABLE"
  | "MODEL_LOAD_FAILURE"
  | "SOLVER_TIMEOUT"
  | "VALIDATION_FAILURE"
  | "INTERNAL_GENERATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "QUEUE_FULL";
export type ProblemCategory = "input" | "architectural" | "technical" | "conflict";
export type ProblemProof = "necessary_condition" | "limited_search" | null;
export type RemediationCode =
  | "REDUCE_PROGRAMME"
  | "REVIEW_DIMENSIONS"
  | "REVIEW_SITE_OR_SETBACKS"
  | "REVIEW_RELATIONSHIPS"
  | "RETRY_GENERATION";
export type WallType = "external" | "internal";
export type WallOrientation = "horizontal" | "vertical";
export type OpeningKind = "entry" | "room_to_corridor" | "direct_access";

export interface RectMm {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface SiteV1 {
  widthMm: number;
  heightMm: number;
  front: Side;
}

export interface SetbacksV1 {
  northMm: number;
  eastMm: number;
  southMm: number;
  westMm: number;
}

export interface WallsV1 {
  externalMm: number;
  internalMm: number;
}

export interface RoomV1 {
  id: string;
  label: string;
  type: RoomType;
  roomClass: RoomClass;
  sourceRequirementId: string;
  ordinal: number;
  required: boolean;
  targetAreaM2: number;
  minAreaM2: number;
  maxAreaM2: number;
  minShortSideMm: number;
  minWidthMm: number;
  minHeightMm: number;
  maxAspectRatio: number;
}

export interface RelationshipV1 {
  id: string;
  a: string;
  b: string;
  kind: RelationshipKind;
  minSharedWallMm: number;
  minOpeningWidthMm: number;
}

export interface BriefV1 {
  schemaVersion: typeof BRIEF_SCHEMA_VERSION;
  units: "mm";
  site: SiteV1;
  setbacks: SetbacksV1;
  walls: WallsV1;
  circulation: { minWidthMm: number };
  doors: { minWidthMm: number };
  rooms: RoomV1[];
  relationships: RelationshipV1[];
  building: { targetGfaM2: number | null; maxGfaM2: number | null };
  settings: { topK: number; topN: number; solverTimeLimitS: number; seed: number };
}

export interface GenerationRequestV1 {
  schemaVersion: typeof CONTRACT_VERSION;
  projectId: string;
  briefVersionId: string;
  idempotencyKey: string;
}

export interface RemediationV1 {
  code: RemediationCode;
  message: string;
  roomIds: string[];
  fieldPaths: string[];
}

export interface FieldErrorV1 {
  path: string;
  message: string;
}

export interface ProblemV1 {
  code: ErrorCode;
  category: ProblemCategory;
  message: string;
  retryable: boolean;
  proof: ProblemProof;
  fieldErrors: FieldErrorV1[];
  remediation: RemediationV1[];
  correlationId: string;
}

export interface EngineVersionsV1 {
  engineVersion: string;
  engineSourceSha256: string;
  modelVersion: "topology_v1";
  checkpointId: "full_v1a/best";
  checkpointSha256: string;
  vocabularySha256: string;
  serviceVersion: string;
  contractVersion: typeof CONTRACT_VERSION;
  pythonVersion: string;
  torchVersion: string;
  ortoolsVersion: string;
}

export interface JobProgressV1 {
  stage: GenerationStatus;
  candidateId: string | null;
  candidatesCompleted: number | null;
  candidatesTotal: number | null;
}

export interface JobV1 {
  schemaVersion: typeof CONTRACT_VERSION;
  generationId: string;
  projectId: string;
  briefVersionId: string;
  briefHash: string;
  status: GenerationStatus;
  stateVersion: number;
  progress: JobProgressV1;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number;
  cancelRequested: boolean;
  layoutIds: string[];
  versions: EngineVersionsV1 | null;
  error: ProblemV1 | null;
  warnings: string[];
}

export interface ValidationCheckV1 {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

export interface LayoutRoomV1 extends RoomV1 {
  present: true;
  rect: RectMm;
  areaM2: number;
}

export interface WallV1 {
  id: string;
  type: WallType;
  thicknessMm: number;
  rect: RectMm;
  orientation: WallOrientation;
  between: string[];
}

export interface OpeningV1 {
  id: string;
  wallId: string;
  kind: OpeningKind;
  a: string;
  b: string;
  rect: RectMm;
  orientation: WallOrientation;
  fits: true;
}

export interface CirculationV1 {
  id: "CORRIDOR";
  rect: RectMm;
  minWidthMm: number;
  measuredMinWidthMm: number;
  areaM2: number;
  entry: { side: Side; xMm: number; yMm: number; widthMm: number };
}

export interface LayoutScoresV1 {
  final: number;
  topology: number;
  geometry: number;
  circulation: number;
  preference: number;
  constraint: number;
}

export interface LayoutV1 {
  schemaVersion: typeof LAYOUT_SCHEMA_VERSION;
  layoutId: string;
  generationId: string;
  projectId: string;
  briefVersionId: string;
  briefHash: string;
  rank: number;
  createdAt: string;
  solverStatus: "FEASIBLE" | "OPTIMAL";
  validationStatus: "PASSED";
  coordinateSystem: "site-sw-x-east-y-north-mm";
  site: SiteV1;
  setbacks: SetbacksV1;
  setbackEnvelope: RectMm;
  buildingEnvelope: RectMm;
  buildableEnvelope: RectMm;
  rooms: LayoutRoomV1[];
  omittedRoomIds: string[];
  circulation: CirculationV1;
  walls: WallV1[];
  openings: OpeningV1[];
  scores: LayoutScoresV1;
  areas: {
    grossExternalM2: number;
    roomRectangleM2: number;
    circulationM2: number;
    residualM2: number;
  };
  validation: { allPassed: true; checks: ValidationCheckV1[] };
  warnings: string[];
  remediation: RemediationV1[];
  relaxations: { code: string; description: string }[];
  versions: EngineVersionsV1;
  provenance: {
    topologyCandidateId: string;
    topologySource: "topology_model_v1";
    solverTimeLimitS: number;
    solverWorkers: number;
    seed: number;
    attempts: number;
  };
}

export interface ProjectV1 {
  projectId: string;
  name: string;
  revision: number;
  currentBriefVersionId: string | null;
  selectedLayoutId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoomGroupV2 {
  requirementId: string;
  label: string;
  type: RoomType;
  roomClass: RoomClass;
  quantity: number;
  required: boolean;
  instanceIds: string[];
  retiredInstanceIds: string[];
}

export interface UnsupportedItemV2 {
  path: string;
  message: string;
  acknowledged: boolean;
}

export interface EditorDocumentV2 {
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
  name: string;
  roomGroups: RoomGroupV2[];
  legacyImport: {
    sourceVersion: 1;
    sourceProjectId: string;
    unsupportedItems: UnsupportedItemV2[];
  } | null;
}

export const VIRTUAL_NODES: readonly string[] = ["CORRIDOR", "EXTERIOR", "OUTSIDE"];
export const RESERVED_IDS: readonly string[] = ["CORRIDOR", "EXTERIOR"];

/** Limits shared with the service; the checked-in copy is contracts/room-policy-v1.json. */
export const CONTRACT_LIMITS = {
  siteAxisMm: [3_000, 60_000] as const,
  rooms: [2, 24] as const,
  fineTypeRooms: 8,
  setbackMm: [0, 30_000] as const,
  externalWallMm: [100, 500] as const,
  internalWallMm: [50, 300] as const,
  circulationMm: [1_000, 3_000] as const,
  doorMm: [600, 1_500] as const,
  roomAreaM2: [1, 300] as const,
  roomLengthMm: [500, 20_000] as const,
  aspectRatio: [1, 4] as const,
  relationships: 64,
  relationshipMm: [600, 5_000] as const,
  seed: [0, 2_147_483_647] as const,
  buildingGfaM2: [10, 1_000] as const,
  topK: [1, 5] as const,
  topN: [1, 3] as const,
  solverTimeLimitS: [5, 30] as const,
  labelCharacters: [1, 80] as const,
  editorDocumentBytes: 64 * 1024,
} as const;

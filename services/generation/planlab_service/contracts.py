"""Canonical public contracts for the PlanLab generation service (planlab.generation/1)."""
from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

CONTRACT_VERSION = "planlab.generation/1"
BRIEF_SCHEMA_VERSION = "planlab.brief/1"
LAYOUT_SCHEMA_VERSION = "planlab.layout/1"
EDITOR_SCHEMA_VERSION = "planlab.editor/2"

Side = Literal["north", "east", "south", "west"]
RoomType = Literal[
    "bedroom",
    "bathroom",
    "wc",
    "kitchen",
    "living",
    "dining",
    "garage",
    "laundry",
    "study",
    "store",
]
RoomClass = Literal["compact", "standard", "spacious"]
RelationshipKind = Literal["mustShareWall", "directAccess"]
GenerationStatus = Literal[
    "QUEUED",
    "LOADING_MODEL",
    "GENERATING_TOPOLOGIES",
    "SOLVING",
    "VALIDATING",
    "RANKING",
    "COMPLETED",
    "INFEASIBLE",
    "FAILED",
    "CANCELLED",
]
ErrorCode = Literal[
    "INVALID_BRIEF",
    "PROGRAMME_TOO_LARGE",
    "NO_VALID_LAYOUT",
    "ENGINE_UNAVAILABLE",
    "MODEL_LOAD_FAILURE",
    "SOLVER_TIMEOUT",
    "VALIDATION_FAILURE",
    "INTERNAL_GENERATION_ERROR",
    "NOT_FOUND",
    "CONFLICT",
    "QUEUE_FULL",
]
RemediationCode = Literal[
    "REDUCE_PROGRAMME",
    "REVIEW_DIMENSIONS",
    "REVIEW_SITE_OR_SETBACKS",
    "REVIEW_RELATIONSHIPS",
    "RETRY_GENERATION",
]
ProblemCategory = Literal["input", "architectural", "technical", "conflict"]
ProblemProof = Literal["necessary_condition", "limited_search"]
CandidateCount = Literal[2, 3]
SolverStatus = Literal["FEASIBLE", "OPTIMAL"]
WallType = Literal["external", "internal"]
WallOrientation = Literal["horizontal", "vertical"]
OpeningKind = Literal["entry", "room_to_corridor", "direct_access"]
TopologySource = Literal["topology_model_v1"]

# Validation limits, plan section 4.1.
SITE_AXIS_MIN_MM = 3_000
SITE_AXIS_MAX_MM = 60_000
ROOM_COUNT_MIN = 2
ROOM_COUNT_MAX = 24
FINE_TYPE_MAX = 8
SETBACK_MIN_MM = 0
SETBACK_MAX_MM = 30_000
EXTERNAL_WALL_MIN_MM = 100
EXTERNAL_WALL_MAX_MM = 500
INTERNAL_WALL_MIN_MM = 50
INTERNAL_WALL_MAX_MM = 300
CORRIDOR_MIN_MM = 1_000
CORRIDOR_MAX_MM = 3_000
OPENING_MIN_MM = 600
OPENING_MAX_MM = 1_500
ROOM_AREA_MIN_M2 = 1
ROOM_AREA_MAX_M2 = 300
LENGTH_MIN_MM = 500
LENGTH_MAX_MM = 20_000
ASPECT_MIN = 1
ASPECT_MAX = 4
RELATIONSHIP_MAX = 64
RELATIONSHIP_THRESHOLD_MIN_MM = 600
RELATIONSHIP_THRESHOLD_MAX_MM = 5_000
SEED_MAX = 2_147_483_647
GFA_MIN_M2 = 10
GFA_MAX_M2 = 1_000
TOP_K_MIN, TOP_K_MAX = 1, 5
TOP_N_MIN, TOP_N_MAX = 1, 3
SOLVER_TIME_LIMIT_MIN_S, SOLVER_TIME_LIMIT_MAX_S = 5, 30
LABEL_MIN, LABEL_MAX = 1, 80
EDITOR_DOCUMENT_MAX_BYTES = 64 * 1024

ID_PATTERN = r"^[A-Za-z][A-Za-z0-9_-]{0,39}$"
RESERVED_IDS = frozenset({"CORRIDOR", "EXTERIOR"})
# Virtual endpoints the engine uses for openings that do not join two authored
# rooms: the corridor and the outside face of an external wall.
VIRTUAL_NODES = frozenset({"CORRIDOR", "EXTERIOR", "OUTSIDE"})
UTC_TIMESTAMP_PATTERN = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$"
SHA256_PATTERN = r"^[0-9a-f]{64}$"
_ID_RE = re.compile(ID_PATTERN)

IdStr = Annotated[str, Field(pattern=ID_PATTERN)]
UuidStr = Annotated[
    str,
    Field(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    ),
]
Sha256Str = Annotated[str, Field(pattern=SHA256_PATTERN)]
TimestampStr = Annotated[str, Field(pattern=UTC_TIMESTAMP_PATTERN)]
LabelStr = Annotated[str, Field(min_length=LABEL_MIN, max_length=LABEL_MAX)]


def _three_decimals(value: float) -> float:
    scaled = value * 1000
    if abs(scaled - round(scaled)) > 1e-6:
        raise ValueError("at most three decimal places are allowed")
    return value


def _thousandths(value: float) -> int:
    """Deterministic integer representation used by canonical hashing."""
    scaled = round(value * 1000)
    if abs(value * 1000 - scaled) > 1e-6:
        raise ValueError("value is not representable in thousandths")
    return int(scaled)


BriefAreaM2 = Annotated[
    float,
    Field(ge=ROOM_AREA_MIN_M2, le=ROOM_AREA_MAX_M2, allow_inf_nan=False),
    AfterValidator(_three_decimals),
]
GfaM2 = Annotated[
    float,
    Field(ge=GFA_MIN_M2, le=GFA_MAX_M2, allow_inf_nan=False),
    AfterValidator(_three_decimals),
]
AspectRatio = Annotated[
    float,
    Field(ge=ASPECT_MIN, le=ASPECT_MAX, allow_inf_nan=False),
    AfterValidator(_three_decimals),
]
MmRange = Annotated[int, Field(ge=LENGTH_MIN_MM, le=LENGTH_MAX_MM)]
MeasuredAreaM2 = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Score01 = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class ContractModel(BaseModel):
    """Strict base: no unknown fields, no coercion, no NaN or infinity."""

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        allow_inf_nan=False,
        validate_default=True,
        use_enum_values=True,
    )


class RectMm(ContractModel):
    """Integer-millimetre rectangle. Openings may have a zero symbolic extent."""

    xMm: int = Field(ge=0)
    yMm: int = Field(ge=0)
    widthMm: int = Field(ge=0)
    heightMm: int = Field(ge=0)


class PositiveRectMm(RectMm):
    """Rectangles for rooms, walls and circulation must have positive extents."""

    widthMm: int = Field(gt=0)
    heightMm: int = Field(gt=0)


class SiteV1(ContractModel):
    widthMm: int = Field(ge=SITE_AXIS_MIN_MM, le=SITE_AXIS_MAX_MM)
    heightMm: int = Field(ge=SITE_AXIS_MIN_MM, le=SITE_AXIS_MAX_MM)
    front: Side


class SetbacksV1(ContractModel):
    northMm: int = Field(ge=SETBACK_MIN_MM, le=SETBACK_MAX_MM)
    eastMm: int = Field(ge=SETBACK_MIN_MM, le=SETBACK_MAX_MM)
    southMm: int = Field(ge=SETBACK_MIN_MM, le=SETBACK_MAX_MM)
    westMm: int = Field(ge=SETBACK_MIN_MM, le=SETBACK_MAX_MM)


class WallsV1(ContractModel):
    externalMm: int = Field(ge=EXTERNAL_WALL_MIN_MM, le=EXTERNAL_WALL_MAX_MM)
    internalMm: int = Field(ge=INTERNAL_WALL_MIN_MM, le=INTERNAL_WALL_MAX_MM)


class BriefCirculationV1(ContractModel):
    minWidthMm: int = Field(ge=CORRIDOR_MIN_MM, le=CORRIDOR_MAX_MM)


class DoorsV1(ContractModel):
    minWidthMm: int = Field(ge=OPENING_MIN_MM, le=OPENING_MAX_MM)


class BuildingV1(ContractModel):
    targetGfaM2: GfaM2 | None = None
    maxGfaM2: GfaM2 | None = None

    @model_validator(mode="after")
    def _target_within_max(self) -> "BuildingV1":
        if self.targetGfaM2 is not None and self.maxGfaM2 is not None:
            if self.targetGfaM2 > self.maxGfaM2:
                raise ValueError("building.targetGfaM2 must not exceed building.maxGfaM2")
        return self


class SettingsV1(ContractModel):
    topK: int = Field(ge=TOP_K_MIN, le=TOP_K_MAX)
    topN: int = Field(ge=TOP_N_MIN, le=TOP_N_MAX)
    solverTimeLimitS: int = Field(ge=SOLVER_TIME_LIMIT_MIN_S, le=SOLVER_TIME_LIMIT_MAX_S)
    seed: int = Field(ge=0, le=SEED_MAX)

    @model_validator(mode="after")
    def _top_n_within_top_k(self) -> "SettingsV1":
        if self.topN > self.topK:
            raise ValueError("settings.topN must not exceed settings.topK")
        return self


class RoomV1(ContractModel):
    id: IdStr
    label: LabelStr
    type: RoomType
    roomClass: RoomClass
    sourceRequirementId: IdStr
    ordinal: int = Field(ge=0, le=99)
    required: bool
    targetAreaM2: BriefAreaM2
    minAreaM2: BriefAreaM2
    maxAreaM2: BriefAreaM2
    minShortSideMm: MmRange
    minWidthMm: MmRange
    minHeightMm: MmRange
    maxAspectRatio: AspectRatio

    @model_validator(mode="after")
    def _consistent_bounds(self) -> "RoomV1":
        if self.id in RESERVED_IDS:
            raise ValueError(f"room id {self.id!r} is reserved")
        if not self.minAreaM2 <= self.targetAreaM2 <= self.maxAreaM2:
            raise ValueError(
                f"room {self.id}: minAreaM2 <= targetAreaM2 <= maxAreaM2 is required "
                f"({self.minAreaM2}, {self.targetAreaM2}, {self.maxAreaM2})"
            )
        if self.minWidthMm < self.minShortSideMm:
            raise ValueError(f"room {self.id}: minWidthMm must be >= minShortSideMm")
        if self.minHeightMm < self.minShortSideMm:
            raise ValueError(f"room {self.id}: minHeightMm must be >= minShortSideMm")
        return self


class RelationshipV1(ContractModel):
    id: IdStr
    a: IdStr
    b: IdStr
    kind: RelationshipKind
    minSharedWallMm: int = Field(
        ge=RELATIONSHIP_THRESHOLD_MIN_MM, le=RELATIONSHIP_THRESHOLD_MAX_MM
    )
    minOpeningWidthMm: int = Field(ge=OPENING_MIN_MM, le=RELATIONSHIP_THRESHOLD_MAX_MM)

    @model_validator(mode="after")
    def _distinct_endpoints(self) -> "RelationshipV1":
        if self.a == self.b:
            raise ValueError(f"relationship {self.id}: a and b must be different rooms")
        if self.a in RESERVED_IDS or self.b in RESERVED_IDS:
            raise ValueError(f"relationship {self.id}: endpoints must be authored rooms")
        return self


class BriefV1(ContractModel):
    schemaVersion: Literal["planlab.brief/1"]
    units: Literal["mm"]
    site: SiteV1
    setbacks: SetbacksV1
    walls: WallsV1
    circulation: BriefCirculationV1
    doors: DoorsV1
    rooms: list[RoomV1]
    relationships: list[RelationshipV1]
    building: BuildingV1
    settings: SettingsV1

    @model_validator(mode="after")
    def _programme_rules(self) -> "BriefV1":
        rooms = self.rooms
        if not (ROOM_COUNT_MIN <= len(rooms) <= ROOM_COUNT_MAX):
            raise ValueError(
                f"rooms must contain between {ROOM_COUNT_MIN} and {ROOM_COUNT_MAX} nodes"
            )

        room_ids = [room.id for room in rooms]
        duplicates = sorted({rid for rid in room_ids if room_ids.count(rid) > 1})
        if duplicates:
            raise ValueError(f"duplicate room ids: {', '.join(duplicates)}")

        pairs = [(room.sourceRequirementId, room.ordinal) for room in rooms]
        if len(set(pairs)) != len(pairs):
            raise ValueError("room (sourceRequirementId, ordinal) pairs must be unique")

        fine_counts: dict[str, int] = {}
        for room in rooms:
            key = "bathroom" if room.type in ("bathroom", "wc") else room.type
            fine_counts[key] = fine_counts.get(key, 0) + 1
        over = {k: v for k, v in fine_counts.items() if v > FINE_TYPE_MAX}
        if over:
            detail = ", ".join(f"{k}={v}" for k, v in sorted(over.items()))
            raise ValueError(f"at most {FINE_TYPE_MAX} rooms of one topology fine type ({detail})")

        if not any(room.required for room in rooms):
            raise ValueError("at least one room must be required")
        if not any(room.type in ("living", "dining") for room in rooms):
            raise ValueError("at least one living or dining room is required")

        if len(self.relationships) > RELATIONSHIP_MAX:
            raise ValueError(f"relationships must contain at most {RELATIONSHIP_MAX} entries")

        known = set(room_ids)
        rel_ids = [rel.id for rel in self.relationships]
        rel_duplicates = sorted({rid for rid in rel_ids if rel_ids.count(rid) > 1})
        if rel_duplicates:
            raise ValueError(f"duplicate relationship ids: {', '.join(rel_duplicates)}")

        seen_pairs: set[tuple[str, str]] = set()
        for rel in self.relationships:
            for endpoint in (rel.a, rel.b):
                if endpoint not in known:
                    raise ValueError(f"relationship {rel.id}: unknown room {endpoint}")
            pair = tuple(sorted((rel.a, rel.b)))
            if pair in seen_pairs:
                raise ValueError(
                    f"relationships must be unique per unordered pair ({rel.a}, {rel.b})"
                )
            seen_pairs.add(pair)
        return self

    def engine_room_ids(self) -> list[str]:
        return [room.id for room in self.rooms]

    def room_by_id(self, room_id: str) -> RoomV1:
        for room in self.rooms:
            if room.id == room_id:
                return room
        raise KeyError(room_id)


class GenerationRequestV1(ContractModel):
    schemaVersion: Literal["planlab.generation/1"]
    projectId: UuidStr
    briefVersionId: UuidStr
    idempotencyKey: str = Field(min_length=1, max_length=128)


class JobProgressV1(ContractModel):
    stage: GenerationStatus
    candidateId: IdStr | None = None
    candidatesCompleted: int | None = Field(default=None, ge=0, le=64)
    candidatesTotal: int | None = Field(default=None, ge=0, le=64)


class ValidationCheckV1(ContractModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    passed: bool
    detail: str = Field(min_length=0, max_length=500)


class RemediationV1(ContractModel):
    code: RemediationCode
    message: str = Field(min_length=1, max_length=400)
    roomIds: list[IdStr] = Field(default_factory=list, max_length=ROOM_COUNT_MAX)
    fieldPaths: list[str] = Field(default_factory=list, max_length=32)


class FieldErrorV1(ContractModel):
    path: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=400)


class ProblemV1(ContractModel):
    code: ErrorCode
    category: ProblemCategory
    message: str = Field(min_length=1, max_length=500)
    retryable: bool
    proof: ProblemProof | None = None
    fieldErrors: list[FieldErrorV1] = Field(default_factory=list, max_length=32)
    remediation: list[RemediationV1] = Field(default_factory=list, max_length=8)
    correlationId: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def _category_matches_code(self) -> "ProblemV1":
        from .errors import ERROR_SHAPE

        expected = ERROR_SHAPE.get(self.code)
        if expected is None:
            raise ValueError(f"unknown error code {self.code}")
        if self.category != expected.category:
            raise ValueError(
                f"error {self.code} must use category {expected.category!r}, got {self.category!r}"
            )
        if self.proof != expected.proof:
            raise ValueError(
                f"error {self.code} must use proof {expected.proof!r}, got {self.proof!r}"
            )
        if self.retryable is not expected.retryable:
            raise ValueError(f"error {self.code} must set retryable={expected.retryable}")
        return self


class EngineVersionsV1(ContractModel):
    engineVersion: str = Field(min_length=1, max_length=80)
    engineSourceSha256: Sha256Str
    modelVersion: Literal["topology_v1"]
    checkpointId: Literal["full_v1a/best"]
    checkpointSha256: Sha256Str
    vocabularySha256: Sha256Str
    serviceVersion: str = Field(min_length=1, max_length=40)
    contractVersion: Literal["planlab.generation/1"]
    pythonVersion: str = Field(min_length=1, max_length=40)
    torchVersion: str = Field(min_length=1, max_length=40)
    ortoolsVersion: str = Field(min_length=1, max_length=40)


class JobV1(ContractModel):
    schemaVersion: Literal["planlab.generation/1"]
    generationId: UuidStr
    projectId: UuidStr
    briefVersionId: UuidStr
    briefHash: Sha256Str
    status: GenerationStatus
    stateVersion: int = Field(ge=0)
    progress: JobProgressV1
    createdAt: TimestampStr
    startedAt: TimestampStr | None = None
    finishedAt: TimestampStr | None = None
    elapsedMs: int = Field(ge=0)
    cancelRequested: bool
    layoutIds: list[UuidStr] = Field(default_factory=list, max_length=3)
    versions: EngineVersionsV1 | None = None
    error: ProblemV1 | None = None
    warnings: list[str] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def _terminal_consistency(self) -> "JobV1":
        terminal = self.status in ("COMPLETED", "INFEASIBLE", "FAILED", "CANCELLED")
        if terminal and self.finishedAt is None:
            raise ValueError("finishedAt is required for a terminal job")
        if not terminal and self.finishedAt is not None:
            raise ValueError("finishedAt must be null while the job is still running")
        if self.status == "COMPLETED":
            if not self.layoutIds:
                raise ValueError("a COMPLETED job must carry at least one layout id")
            if self.versions is None:
                raise ValueError("a COMPLETED job must carry engine versions")
            if self.error is not None:
                raise ValueError("a COMPLETED job must not carry an error")
        if self.status in ("INFEASIBLE", "FAILED") and self.error is None:
            raise ValueError(f"a {self.status} job must carry a ProblemV1")
        if self.progress.stage != self.status and not terminal:
            raise ValueError("progress.stage must match status while the job is running")
        return self


class ScoresV1(ContractModel):
    final: Score01
    topology: Score01
    geometry: Score01
    circulation: Score01
    preference: Score01
    constraint: Score01


class LayoutAreasV1(ContractModel):
    grossExternalM2: MeasuredAreaM2
    roomRectangleM2: MeasuredAreaM2
    circulationM2: MeasuredAreaM2
    residualM2: MeasuredAreaM2


class LayoutValidationV1(ContractModel):
    allPassed: Literal[True]
    checks: list[ValidationCheckV1] = Field(min_length=1)

    @model_validator(mode="after")
    def _every_check_passed(self) -> "LayoutValidationV1":
        failed = [check.id for check in self.checks if not check.passed]
        if failed:
            raise ValueError(f"a persisted layout cannot carry failed checks: {', '.join(failed)}")
        return self


class RelaxationV1(ContractModel):
    code: str = Field(min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=200)


class LayoutProvenanceV1(ContractModel):
    topologyCandidateId: str = Field(min_length=1, max_length=80)
    topologySource: TopologySource
    solverTimeLimitS: int = Field(ge=SOLVER_TIME_LIMIT_MIN_S, le=SOLVER_TIME_LIMIT_MAX_S)
    solverWorkers: int = Field(ge=1, le=8)
    seed: int = Field(ge=0, le=SEED_MAX)
    attempts: int = Field(ge=1, le=16)


class WallV1(ContractModel):
    id: str = Field(min_length=1, max_length=40)
    type: WallType
    thicknessMm: int = Field(gt=0, le=EXTERNAL_WALL_MAX_MM)
    rect: PositiveRectMm
    orientation: WallOrientation
    between: list[IdStr] = Field(default_factory=list, max_length=2)


class OpeningV1(ContractModel):
    id: str = Field(min_length=1, max_length=40)
    wallId: str = Field(min_length=1, max_length=40)
    kind: OpeningKind
    a: IdStr
    b: IdStr
    rect: RectMm
    orientation: WallOrientation
    fits: Literal[True]


class CorridorEntryV1(ContractModel):
    side: Side
    xMm: int = Field(ge=0)
    yMm: int = Field(ge=0)
    # The entry anchor is a geometric opening through the external wall, not an
    # authored door width, so it is bounded by the site rather than by doors.minWidthMm.
    widthMm: int = Field(gt=0, le=LENGTH_MAX_MM)


class LayoutCirculationV1(ContractModel):
    id: Literal["CORRIDOR"]
    rect: PositiveRectMm
    minWidthMm: int = Field(ge=CORRIDOR_MIN_MM, le=CORRIDOR_MAX_MM)
    measuredMinWidthMm: int = Field(gt=0)
    areaM2: MeasuredAreaM2
    entry: CorridorEntryV1

    @model_validator(mode="after")
    def _measured_respects_requirement(self) -> "LayoutCirculationV1":
        if self.measuredMinWidthMm < self.minWidthMm:
            raise ValueError("circulation.measuredMinWidthMm is below the brief minimum")
        return self


class LayoutRoomV1(RoomV1):
    present: Literal[True]
    rect: PositiveRectMm
    areaM2: MeasuredAreaM2

    @model_validator(mode="after")
    def _area_matches_rect(self) -> "LayoutRoomV1":
        expected = self.rect.widthMm * self.rect.heightMm / 1_000_000
        if abs(expected - self.areaM2) > 1e-9:
            raise ValueError(
                f"room {self.id}: areaM2 must equal width*height/1e6 ({expected})"
            )
        if self.areaM2 < self.minAreaM2 - 1e-9 or self.areaM2 > self.maxAreaM2 + 1e-9:
            raise ValueError(f"room {self.id}: returned area is outside the authored bounds")
        if min(self.rect.widthMm, self.rect.heightMm) < self.minShortSideMm:
            raise ValueError(f"room {self.id}: returned short side is below the authored minimum")
        if self.rect.widthMm < self.minWidthMm or self.rect.heightMm < self.minHeightMm:
            raise ValueError(f"room {self.id}: returned axis extent is below the authored minimum")
        return self


class LayoutV1(ContractModel):
    schemaVersion: Literal["planlab.layout/1"]
    layoutId: UuidStr
    generationId: UuidStr
    projectId: UuidStr
    briefVersionId: UuidStr
    briefHash: Sha256Str
    rank: int = Field(ge=1, le=3)
    createdAt: TimestampStr
    solverStatus: SolverStatus
    validationStatus: Literal["PASSED"]
    coordinateSystem: Literal["site-sw-x-east-y-north-mm"]
    site: SiteV1
    setbacks: SetbacksV1
    setbackEnvelope: RectMm
    buildingEnvelope: PositiveRectMm
    buildableEnvelope: PositiveRectMm
    rooms: list[LayoutRoomV1]
    omittedRoomIds: list[IdStr] = Field(default_factory=list, max_length=ROOM_COUNT_MAX)
    circulation: LayoutCirculationV1
    walls: list[WallV1]
    openings: list[OpeningV1]
    scores: ScoresV1
    areas: LayoutAreasV1
    validation: LayoutValidationV1
    warnings: list[str] = Field(default_factory=list, max_length=32)
    remediation: list[RemediationV1] = Field(default_factory=list, max_length=8)
    relaxations: list[RelaxationV1] = Field(default_factory=list, max_length=8)
    versions: EngineVersionsV1
    provenance: LayoutProvenanceV1

    @model_validator(mode="after")
    def _geometry_consistency(self) -> "LayoutV1":
        if not self.rooms:
            raise ValueError("a layout must contain at least one room")

        room_ids = [room.id for room in self.rooms]
        duplicates = sorted({rid for rid in room_ids if room_ids.count(rid) > 1})
        if duplicates:
            raise ValueError(f"duplicate layout room ids: {', '.join(duplicates)}")

        overlap = sorted(set(room_ids) & set(self.omittedRoomIds))
        if overlap:
            raise ValueError(f"rooms cannot be both present and omitted: {', '.join(overlap)}")

        wall_ids = [wall.id for wall in self.walls]
        if len(set(wall_ids)) != len(wall_ids):
            raise ValueError("wall ids must be unique")
        opening_ids = [opening.id for opening in self.openings]
        if len(set(opening_ids)) != len(opening_ids):
            raise ValueError("opening ids must be unique")

        known_walls = set(wall_ids)
        for opening in self.openings:
            if opening.wallId not in known_walls:
                raise ValueError(f"opening {opening.id}: unknown wall {opening.wallId}")
            if opening.a not in room_ids and opening.a not in VIRTUAL_NODES:
                raise ValueError(f"opening {opening.id}: unknown room {opening.a}")
            if opening.b not in room_ids and opening.b not in VIRTUAL_NODES:
                raise ValueError(f"opening {opening.id}: unknown room {opening.b}")

        outer = self.buildingEnvelope
        inner = self.buildableEnvelope
        if not (
            inner.xMm >= outer.xMm
            and inner.yMm >= outer.yMm
            and inner.xMm + inner.widthMm <= outer.xMm + outer.widthMm
            and inner.yMm + inner.heightMm <= outer.yMm + outer.heightMm
        ):
            raise ValueError("buildableEnvelope must sit inside buildingEnvelope")

        max_x = self.site.widthMm
        max_y = self.site.heightMm
        if outer.xMm + outer.widthMm > max_x or outer.yMm + outer.heightMm > max_y:
            raise ValueError("buildingEnvelope must sit inside the site")
        return self


class RoomGroupV2(ContractModel):
    requirementId: IdStr
    label: LabelStr
    type: RoomType
    roomClass: RoomClass
    quantity: int = Field(ge=1, le=ROOM_COUNT_MAX)
    required: bool
    instanceIds: list[IdStr] = Field(min_length=1, max_length=ROOM_COUNT_MAX)
    retiredInstanceIds: list[IdStr] = Field(default_factory=list, max_length=64)


class UnsupportedItemV2(ContractModel):
    path: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=400)
    acknowledged: bool


class LegacyImportV2(ContractModel):
    sourceVersion: Literal[1]
    sourceProjectId: str = Field(min_length=1, max_length=120)
    unsupportedItems: list[UnsupportedItemV2] = Field(default_factory=list, max_length=64)


class EditorDocumentV2(ContractModel):
    schemaVersion: Literal["planlab.editor/2"]
    name: LabelStr
    roomGroups: list[RoomGroupV2] = Field(min_length=1, max_length=ROOM_COUNT_MAX)
    legacyImport: LegacyImportV2 | None = None

    @model_validator(mode="after")
    def _groups_are_consistent(self) -> "EditorDocumentV2":
        requirement_ids = [group.requirementId for group in self.roomGroups]
        duplicates = sorted({rid for rid in requirement_ids if requirement_ids.count(rid) > 1})
        if duplicates:
            raise ValueError(f"duplicate requirementIds: {', '.join(duplicates)}")
        for group in self.roomGroups:
            if len(group.instanceIds) != group.quantity:
                raise ValueError(
                    f"group {group.requirementId}: quantity must equal instanceIds length"
                )
            clash = sorted(set(group.instanceIds) & set(group.retiredInstanceIds))
            if clash:
                raise ValueError(
                    f"group {group.requirementId}: instance ids cannot be retired as well: "
                    f"{', '.join(clash)}"
                )
        return self

    @model_validator(mode="after")
    def _within_size_limit(self) -> "EditorDocumentV2":
        size = len(canonical_json(self.model_dump(mode="json")).encode("utf-8"))
        if size > EDITOR_DOCUMENT_MAX_BYTES:
            raise ValueError(
                f"editor document exceeds {EDITOR_DOCUMENT_MAX_BYTES} bytes (got {size})"
            )
        return self


class ProjectV1(ContractModel):
    projectId: UuidStr
    name: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=1)
    currentBriefVersionId: UuidStr | None = None
    selectedLayoutId: UuidStr | None = None
    createdAt: TimestampStr
    updatedAt: TimestampStr


class ProjectDetailV1(ProjectV1):
    brief: BriefV1 | None = None
    editorDocument: EditorDocumentV2 | None = None
    selectedLayout: LayoutV1 | None = None
    activeGenerationId: UuidStr | None = None


# --------------------------------------------------------------------- hashing


def _mm(value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise TypeError("lengths must be integers")
    return int(value)


def canonical_brief_payload(brief: BriefV1) -> dict[str, Any]:
    """Canonical preimage for the brief hash (plan section 6)."""
    rooms = sorted(
        (
            {
                "id": room.id,
                "label": room.label,
                "type": room.type,
                "roomClass": room.roomClass,
                "sourceRequirementId": room.sourceRequirementId,
                "ordinal": room.ordinal,
                "required": room.required,
                "targetAreaThousandths": _thousandths(room.targetAreaM2),
                "minAreaThousandths": _thousandths(room.minAreaM2),
                "maxAreaThousandths": _thousandths(room.maxAreaM2),
                "minShortSideMm": _mm(room.minShortSideMm),
                "minWidthMm": _mm(room.minWidthMm),
                "minHeightMm": _mm(room.minHeightMm),
                "maxAspectThousandths": _thousandths(room.maxAspectRatio),
            }
            for room in brief.rooms
        ),
        key=lambda item: item["id"],
    )
    relationships = sorted(
        (
            {
                "id": rel.id,
                "a": rel.a,
                "b": rel.b,
                "kind": rel.kind,
                "minSharedWallMm": _mm(rel.minSharedWallMm),
                "minOpeningWidthMm": _mm(rel.minOpeningWidthMm),
            }
            for rel in brief.relationships
        ),
        key=lambda item: item["id"],
    )
    return {
        "schemaVersion": brief.schemaVersion,
        "units": brief.units,
        "site": {
            "widthMm": _mm(brief.site.widthMm),
            "heightMm": _mm(brief.site.heightMm),
            "front": brief.site.front,
        },
        "setbacks": {
            "northMm": _mm(brief.setbacks.northMm),
            "eastMm": _mm(brief.setbacks.eastMm),
            "southMm": _mm(brief.setbacks.southMm),
            "westMm": _mm(brief.setbacks.westMm),
        },
        "walls": {
            "externalMm": _mm(brief.walls.externalMm),
            "internalMm": _mm(brief.walls.internalMm),
        },
        "circulation": {"minWidthMm": _mm(brief.circulation.minWidthMm)},
        "doors": {"minWidthMm": _mm(brief.doors.minWidthMm)},
        "rooms": rooms,
        "relationships": relationships,
        "building": {
            "targetGfaThousandths": (
                _thousandths(brief.building.targetGfaM2)
                if brief.building.targetGfaM2 is not None
                else None
            ),
            "maxGfaThousandths": (
                _thousandths(brief.building.maxGfaM2)
                if brief.building.maxGfaM2 is not None
                else None
            ),
        },
        "settings": {
            "topK": brief.settings.topK,
            "topN": brief.settings.topN,
            "solverTimeLimitS": brief.settings.solverTimeLimitS,
            "seed": brief.settings.seed,
        },
    }


def canonical_json(payload: Any) -> str:
    """Compact, key-sorted JSON with no NaN and no whitespace."""
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        ensure_ascii=False,
    )


def brief_sha256(brief: BriefV1) -> str:
    preimage = canonical_json(canonical_brief_payload(brief))
    return hashlib.sha256(preimage.encode("utf-8")).hexdigest()


def structural_footprint_check(brief: BriefV1) -> str | None:
    """Non-positive legal envelope is a preflight issue, not a schema error."""
    legal_w = brief.site.widthMm - brief.setbacks.westMm - brief.setbacks.eastMm
    legal_h = brief.site.heightMm - brief.setbacks.southMm - brief.setbacks.northMm
    if legal_w <= 0 or legal_h <= 0:
        return (
            "the authored setbacks leave no legal building envelope "
            f"({legal_w} mm x {legal_h} mm)"
        )
    return None


def is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

"""Brief compilation, real-engine generation, normalization and outcome mapping (S03)."""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Callable

from . import errors as E
from .contracts import (
    BriefV1,
    EngineVersionsV1,
    LayoutV1,
    ProblemV1,
    brief_sha256,
)
from .engine_runtime import (
    MAX_ATTEMPTS_PER_CANDIDATE,
    EngineDeadline,
    EngineError,
    EngineRuntime,
    EngineUnavailable,
    ModelLoadFailure,
)
from .footprint import Footprint, choose_footprint
from .normalization import LayoutIds, geometry_hash, normalize_layout, revalidate

ATTEMPT_TECHNICAL = {"UNKNOWN", "MODEL_INVALID"}
ATTEMPT_INFEASIBLE = {"INFEASIBLE"}


@dataclass
class NormalizedResult:
    """Exactly one of `layouts` (non-empty) or `error` (terminal), per section 5.2."""

    layouts: list[LayoutV1] = field(default_factory=list)
    error: ProblemV1 | None = None
    warnings: list[str] = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)
    versions: EngineVersionsV1 | None = None
    status: str = "FAILED"

    @property
    def ok(self) -> bool:
        return bool(self.layouts) and self.error is None


def compile_engine_brief(
    brief: BriefV1,
    footprint: Footprint,
    *,
    seed: int,
    solver_time_limit_s: int,
    solver_workers: int,
    max_attempts: int = MAX_ATTEMPTS_PER_CANDIDATE,
) -> dict:
    """Canonical BriefV1 -> engine brief. Final sizes are explicit, class is standard."""
    rooms = []
    for room in brief.rooms:
        rooms.append(
            {
                "id": room.id,
                "type": room.type,
                # final sizes are resolved once by the product; never rescaled here
                "class": "standard",
                "target_area_m2": room.targetAreaM2,
                "min_area_m2": room.minAreaM2,
                "max_area_m2": room.maxAreaM2,
                "min_short_side_mm": room.minShortSideMm,
                "min_width_mm": room.minWidthMm,
                "min_height_mm": room.minHeightMm,
                "max_aspect_ratio": room.maxAspectRatio,
                "required": room.required,
                "zone_preference": "any",
                "notes": f"{room.label} [{room.roomClass}]",
            }
        )
    adjacency = [
        {
            "a": rel.a,
            "b": rel.b,
            "min_shared_wall_mm": rel.minSharedWallMm,
            "note": f"{rel.kind} (authored)",
        }
        for rel in brief.relationships
        if rel.kind == "mustShareWall"
    ]
    doors_required = [
        {
            "a": rel.a,
            "b": rel.b,
            "min_width_mm": rel.minOpeningWidthMm,
            "note": f"{rel.kind} (authored)",
        }
        for rel in brief.relationships
        if rel.kind == "directAccess"
    ]
    return {
        "brief_id": f"svc-{brief_sha256(brief)[:12]}",
        "description": "PlanLab service brief compiled from planlab.brief/1",
        "site": {
            "width_mm": brief.site.widthMm,
            "height_mm": brief.site.heightMm,
            "front": brief.site.front,
        },
        # effective offsets only: the authored setbacks stay untouched on the brief
        "setbacks": {
            "north_mm": footprint.effective_offsets["northMm"],
            "east_mm": footprint.effective_offsets["eastMm"],
            "south_mm": footprint.effective_offsets["southMm"],
            "west_mm": footprint.effective_offsets["westMm"],
        },
        "walls": {
            "external_mm": brief.walls.externalMm,
            "internal_mm": brief.walls.internalMm,
        },
        "circulation": {"min_width_mm": brief.circulation.minWidthMm},
        "doors": {"min_width_mm": brief.doors.minWidthMm},
        "rooms": rooms,
        "adjacency": adjacency,
        "doors_required": doors_required,
        "building": {
            "target_gfa_m2": brief.building.targetGfaM2,
            "max_gfa_m2": brief.building.maxGfaM2,
        },
        "settings": {
            "solver": {
                "time_limit_s": float(solver_time_limit_s),
                "num_search_workers": int(solver_workers),
                "random_seed": int(seed),
                "max_attempts_per_candidate": int(max_attempts),
            }
        },
    }


class EngineAdapter:
    """Turns a canonical brief into a NormalizedResult through the real engine."""

    def __init__(self, runtime: EngineRuntime) -> None:
        self.runtime = runtime

    # ------------------------------------------------------------------ job
    def generate(
        self,
        brief: BriefV1,
        *,
        generation_id: str,
        project_id: str,
        brief_version_id: str,
        correlation_id: str = "",
        on_stage: Callable[[str], None] | None = None,
        created_at: str | None = None,
    ) -> NormalizedResult:
        emit = on_stage or (lambda stage: None)
        started = time.time()
        warnings: list[str] = []
        diagnostics: dict = {"briefHash": brief_sha256(brief)}
        versions = self.runtime.versions if self.runtime.ready else None

        footprint = choose_footprint(brief)
        diagnostics["footprint"] = {
            "reason": footprint.reason,
            "outerRect": footprint.outer_rect,
            "effectiveOffsets": footprint.effective_offsets,
            "gfaM2": footprint.gfa_m2,
        }

        required_min = sum(
            round(room.minAreaM2 * 1e6) for room in brief.rooms if room.required
        )
        inner = footprint.inner_rect
        preflight = E.programme_preflight(
            minimum_area_mm2=required_min,
            legal_inner_area_mm2=inner["widthMm"] * inner["heightMm"],
            required_room_ids=tuple(room.id for room in brief.rooms if room.required),
            gfa_cap_mm2=round(brief.building.maxGfaM2 * 1e6) if brief.building.maxGfaM2 else None,
            outer_area_mm2=footprint.outer_rect["widthMm"] * footprint.outer_rect["heightMm"],
        )
        if preflight:
            return NormalizedResult(
                error=E.problem(
                    preflight[0],
                    preflight[1],
                    correlation_id,
                    remediations=E.default_remediation("PROGRAMME_TOO_LARGE"),
                ),
                diagnostics=diagnostics,
                versions=versions,
                status="INFEASIBLE",
            )

        seed = brief.settings.seed
        engine_brief = compile_engine_brief(
            brief,
            footprint,
            seed=seed,
            solver_time_limit_s=brief.settings.solverTimeLimitS,
            solver_workers=self.runtime.solver_workers,
        )

        emit("GENERATING_TOPOLOGIES")
        try:
            candidates = self.runtime.warm_candidates(engine_brief, brief.settings.topK)
        except (EngineUnavailable, ModelLoadFailure) as exc:
            return self._failed("MODEL_LOAD_FAILURE", str(exc), correlation_id, diagnostics, versions)
        except EngineError as exc:
            return self._failed("ENGINE_UNAVAILABLE", str(exc), correlation_id, diagnostics, versions)
        except Exception as exc:  # noqa: BLE001
            return self._failed(
                "INTERNAL_GENERATION_ERROR", f"{type(exc).__name__}: {exc}",
                correlation_id, diagnostics, versions,
            )
        diagnostics["candidateCount"] = len(candidates)
        if not candidates:
            return NormalizedResult(
                error=E.problem(
                    "NO_VALID_LAYOUT",
                    "No valid layout found for this brief within this engine's current search.",
                    correlation_id,
                    remediations=E.default_remediation("NO_VALID_LAYOUT"),
                ),
                diagnostics=diagnostics,
                versions=versions,
                status="INFEASIBLE",
            )

        engine_brief["topology_candidates"] = [
            {key: cand[key] for key in ("candidate_id", "rank", "edges") if key in cand}
            for cand in candidates
        ]
        emit("SOLVING")
        deadline_exceeded = False
        try:
            raw = self.runtime.generate(
                engine_brief,
                top_k=brief.settings.topK,
                top_n=brief.settings.topN,
                time_limit_s=brief.settings.solverTimeLimitS,
            )
        except EngineDeadline:
            deadline_exceeded = True
            raw = {"layouts": [], "attempts": []}
        except Exception as exc:  # noqa: BLE001
            return self._failed(
                "INTERNAL_GENERATION_ERROR", f"{type(exc).__name__}: {exc}",
                correlation_id, diagnostics, versions,
            )

        emit("VALIDATING")
        raw_layouts = list(raw.get("layouts") or [])
        attempts = list(raw.get("attempts") or [])
        diagnostics["attemptStatuses"] = [a.get("solver_status") for a in attempts]
        diagnostics["timings"] = raw.get("timings", {})
        diagnostics["gate"] = raw.get("gate", {})

        created = created_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        accepted: list[tuple[float, str, LayoutV1]] = []
        seen_geometry: set[str] = set()
        validation_failures = 0
        for record in raw_layouts:
            checks = revalidate(record, brief, footprint)
            failed = [check for check in checks if not check["passed"]]
            if failed:
                validation_failures += 1
                warnings.append(
                    f"candidate {record.get('layout_id')} rejected by independent validation: "
                    + "; ".join(f"{c['id']} {c['name']}" for c in failed[:3])
                )
                continue
            digest = geometry_hash(record)
            if digest in seen_geometry:
                warnings.append(f"candidate {record.get('layout_id')} repeated returned geometry")
                continue
            seen_geometry.add(digest)
            score = float((record.get("scores") or {}).get("final_score", 0.0))
            accepted.append((score, str(record.get("layout_id") or ""), record))

        emit("RANKING")
        accepted.sort(key=lambda item: (-item[0], item[1]))
        layouts: list[LayoutV1] = []
        for index, (_score, _raw_id, record) in enumerate(accepted[: brief.settings.topN], start=1):
            ids = LayoutIds(
                layoutId=str(uuid.uuid5(uuid.NAMESPACE_URL, f"{generation_id}:{index}:{geometry_hash(record)}")),
                generationId=generation_id,
                projectId=project_id,
                briefVersionId=brief_version_id,
                briefHash=brief_sha256(brief),
                rank=index,
            )
            layouts.append(
                normalize_layout(
                    record,
                    brief=brief,
                    footprint=footprint,
                    ids=ids,
                    versions=versions,
                    created_at=created,
                    solver_time_limit_s=brief.settings.solverTimeLimitS,
                    solver_workers=self.runtime.solver_workers,
                    seed=seed,
                )
            )

        evidence = E.OutcomeEvidence(
            model_loaded=bool(versions),
            engine_error=(
                "the engine reported a failure before any candidate was solved"
                if (raw.get("failures") and not attempts)
                else None
            ),
            deadline_exceeded=deadline_exceeded,
            candidates=len(candidates),
            valid_layouts=len(layouts),
            validation_failures=validation_failures,
            attempt_statuses=tuple(str(a.get("solver_status") or "") for a in attempts),
        )
        status, problem = E.classify_outcome(evidence, correlation_id)
        diagnostics["elapsedMs"] = int((time.time() - started) * 1000)
        if problem and validation_failures:
            problem = problem.model_copy(
                update={"message": problem.message + f" ({validation_failures} candidate(s) failed checks)"}
            )
        return NormalizedResult(
            layouts=layouts,
            error=problem,
            warnings=warnings,
            diagnostics=diagnostics,
            versions=versions,
            status=status,
        )

    def _failed(
        self,
        code: str,
        detail: str,
        correlation_id: str,
        diagnostics: dict,
        versions: EngineVersionsV1 | None,
    ) -> NormalizedResult:
        problem = E.problem(
            code,
            detail[:500] if code != "INTERNAL_GENERATION_ERROR" else
            "The engine failed while generating this brief.",
            correlation_id,
            remediations=E.default_remediation(code),
        )
        public_diagnostics = dict(diagnostics)
        if code == "INTERNAL_GENERATION_ERROR":
            public_diagnostics["engineDetail"] = detail[:500]
        return NormalizedResult(
            error=problem,
            diagnostics=public_diagnostics,
            versions=versions,
            status="FAILED",
        )

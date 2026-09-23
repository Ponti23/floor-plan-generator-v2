"""Error codes, categories and remediation helpers for planlab.generation/1."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

from .contracts import (
    ErrorCode,
    FieldErrorV1,
    ProblemV1,
    ProblemCategory,
    ProblemProof,
    RemediationCode,
    RemediationV1,
)


@dataclass(frozen=True)
class ErrorShape:
    category: ProblemCategory
    retryable: bool
    proof: ProblemProof | None


# Normative mapping from plan sections 4.2 and 5.4.
ERROR_SHAPE: dict[str, ErrorShape] = {
    "INVALID_BRIEF": ErrorShape("input", False, None),
    "PROGRAMME_TOO_LARGE": ErrorShape("architectural", False, "necessary_condition"),
    "NO_VALID_LAYOUT": ErrorShape("architectural", False, "limited_search"),
    "ENGINE_UNAVAILABLE": ErrorShape("technical", True, None),
    "MODEL_LOAD_FAILURE": ErrorShape("technical", True, None),
    "SOLVER_TIMEOUT": ErrorShape("technical", True, None),
    "VALIDATION_FAILURE": ErrorShape("technical", True, None),
    "INTERNAL_GENERATION_ERROR": ErrorShape("technical", True, None),
    "NOT_FOUND": ErrorShape("conflict", False, None),
    "CONFLICT": ErrorShape("conflict", False, None),
    "QUEUE_FULL": ErrorShape("conflict", True, None),
}

REMEDIATION_CODES: frozenset[str] = frozenset(
    {
        "REDUCE_PROGRAMME",
        "REVIEW_DIMENSIONS",
        "REVIEW_SITE_OR_SETBACKS",
        "REVIEW_RELATIONSHIPS",
        "RETRY_GENERATION",
    }
)

# Which remediation offers make sense for each architectural/technical outcome.
OUTCOME_REMEDIATION: dict[str, tuple[RemediationCode, ...]] = {
    "INVALID_BRIEF": ("REVIEW_DIMENSIONS",),
    "PROGRAMME_TOO_LARGE": (
        "REDUCE_PROGRAMME",
        "REVIEW_SITE_OR_SETBACKS",
        "REVIEW_DIMENSIONS",
    ),
    "NO_VALID_LAYOUT": (
        "REDUCE_PROGRAMME",
        "REVIEW_RELATIONSHIPS",
        "REVIEW_DIMENSIONS",
    ),
    "ENGINE_UNAVAILABLE": ("RETRY_GENERATION",),
    "MODEL_LOAD_FAILURE": ("RETRY_GENERATION",),
    "SOLVER_TIMEOUT": ("RETRY_GENERATION",),
    "VALIDATION_FAILURE": ("RETRY_GENERATION",),
    "INTERNAL_GENERATION_ERROR": ("RETRY_GENERATION",),
    "NOT_FOUND": (),
    "CONFLICT": (),
    "QUEUE_FULL": ("RETRY_GENERATION",),
}


def remediation(code: RemediationCode, message: str, *, room_ids: Iterable[str] = (),
                field_paths: Iterable[str] = ()) -> RemediationV1:
    if code not in REMEDIATION_CODES:
        raise ValueError(f"unknown remediation code {code!r}")
    return RemediationV1(
        code=code,
        message=message,
        roomIds=list(room_ids),
        fieldPaths=list(field_paths),
    )


def problem(
    code: ErrorCode,
    message: str,
    correlation_id: str,
    *,
    field_errors: Iterable[FieldErrorV1] = (),
    remediations: Iterable[RemediationV1] = (),
) -> ProblemV1:
    shape = ERROR_SHAPE[code]
    return ProblemV1(
        code=code,
        category=shape.category,
        message=message,
        retryable=shape.retryable,
        proof=shape.proof,
        fieldErrors=list(field_errors),
        remediation=list(remediations),
        correlationId=correlation_id,
    )


def default_remediation(code: ErrorCode) -> list[RemediationV1]:
    """Evidence-independent starting offers; callers add measured detail."""
    messages: dict[str, str] = {
        "REDUCE_PROGRAMME": "Reduce the number or size of rooms, or mark a room optional.",
        "REVIEW_DIMENSIONS": "Review the room dimensions flagged in this message.",
        "REVIEW_SITE_OR_SETBACKS": (
            "Review the site size and the setbacks you entered; this is not regulatory advice."
        ),
        "REVIEW_RELATIONSHIPS": "Review the required relationships between rooms.",
        "RETRY_GENERATION": "Retry the generation. If it fails again, the engine was unavailable.",
    }
    return [
        remediation(rc, messages[rc])
        for rc in OUTCOME_REMEDIATION.get(code, ())
    ]


def field_errors_from_validation_error(exc) -> list[FieldErrorV1]:
    """Map a Pydantic ValidationError onto the public fieldErrors shape."""
    items: list[FieldErrorV1] = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ()))
        items.append(
            FieldErrorV1(
                path=location or "body",
                message=str(error.get("msg", "invalid value"))[:400],
            )
        )
        if len(items) >= 32:
            break
    return items


TechnicalOrArchitectural = Literal["technical", "architectural"]


@dataclass(frozen=True)
class OutcomeEvidence:
    """Everything the classifier is allowed to look at (plan section 5.4)."""

    model_loaded: bool = True
    model_error: str | None = None
    engine_error: str | None = None
    deadline_exceeded: bool = False
    candidates: int = 0
    valid_layouts: int = 0
    validation_failures: int = 0
    attempt_statuses: tuple[str, ...] = ()
    programme_defect: str | None = None
    programme_detail: str = ""
    room_ids: tuple[str, ...] = ()


def classify_outcome(
    evidence: OutcomeEvidence,
    correlation_id: str,
) -> tuple[str, ProblemV1 | None]:
    """Map evidence to (job status, problem) using the section-5.4 precedence.

    Technical conditions are always evaluated before architectural conclusions,
    and a timeout or an UNKNOWN solver status is never reported as impossibility.
    """
    statuses = {str(status).upper() for status in evidence.attempt_statuses}

    if evidence.programme_defect:
        return "INFEASIBLE", problem(
            "PROGRAMME_TOO_LARGE",
            evidence.programme_detail
            or "The required rooms cannot fit inside the legal building envelope.",
            correlation_id,
            remediations=default_remediation("PROGRAMME_TOO_LARGE"),
        )

    if not evidence.model_loaded or evidence.model_error:
        return "FAILED", problem(
            "MODEL_LOAD_FAILURE",
            "The topology model or its vocabulary could not be loaded.",
            correlation_id,
            remediations=default_remediation("MODEL_LOAD_FAILURE"),
        )

    if evidence.engine_error:
        return "FAILED", problem(
            "INTERNAL_GENERATION_ERROR",
            "The engine failed while generating this brief.",
            correlation_id,
            remediations=default_remediation("INTERNAL_GENERATION_ERROR"),
        )

    if evidence.valid_layouts > 0:
        return "COMPLETED", None

    if evidence.deadline_exceeded or "UNKNOWN" in statuses:
        return "FAILED", problem(
            "SOLVER_TIMEOUT",
            "Generation ran out of time before a validated layout was found. "
            "This is not proof that the brief is impossible.",
            correlation_id,
            remediations=default_remediation("SOLVER_TIMEOUT"),
        )

    if evidence.candidates == 0:
        return "INFEASIBLE", problem(
            "NO_VALID_LAYOUT",
            "No valid layout found for this brief within this engine's current search.",
            correlation_id,
            remediations=default_remediation("NO_VALID_LAYOUT"),
        )

    if evidence.validation_failures > 0:
        return "FAILED", problem(
            "VALIDATION_FAILURE",
            "The solver produced geometry, but every candidate failed independent validation.",
            correlation_id,
            remediations=default_remediation("VALIDATION_FAILURE"),
        )

    if statuses and statuses <= {"INFEASIBLE"}:
        return "INFEASIBLE", problem(
            "NO_VALID_LAYOUT",
            "No valid layout found for this brief within this engine's current search.",
            correlation_id,
            remediations=default_remediation("NO_VALID_LAYOUT"),
        )

    return "FAILED", problem(
        "INTERNAL_GENERATION_ERROR",
        "Generation ended without a usable result.",
        correlation_id,
        remediations=default_remediation("INTERNAL_GENERATION_ERROR"),
    )


def programme_preflight(
    *,
    minimum_area_mm2: int,
    legal_inner_area_mm2: int,
    required_room_ids: Iterable[str] = (),
    gfa_cap_mm2: int | None = None,
    outer_area_mm2: int | None = None,
) -> tuple[str, str] | None:
    """Necessary-condition check: the required minima alone cannot fit.

    Returns (defect_code, detail) or None. This is a proof, not a search result:
    it is only reported when the lower bound itself exceeds the envelope.
    """
    capped = legal_inner_area_mm2
    cap_detail = ""
    if gfa_cap_mm2 is not None and outer_area_mm2 is not None and outer_area_mm2 > gfa_cap_mm2:
        capped = min(capped, gfa_cap_mm2)
        cap_detail = f" and the max GFA cap of {gfa_cap_mm2 / 1e6:.2f} m2"
    if minimum_area_mm2 <= capped:
        return None
    deficit = minimum_area_mm2 - capped
    detail = (
        f"The required room minima need {minimum_area_mm2 / 1e6:.2f} m2 of inner area, but the "
        f"legal envelope{cap_detail} provides {capped / 1e6:.2f} m2: a deficit of "
        f"{deficit / 1e6:.2f} m2."
    )
    return "PROGRAMME_TOO_LARGE", detail

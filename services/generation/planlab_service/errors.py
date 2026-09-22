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

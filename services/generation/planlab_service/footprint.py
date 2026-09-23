"""Deterministic building-footprint selection inside the legal envelope (S03, plan 5.3)."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .contracts import BriefV1

CIRCULATION_SHARE = 0.15
MINIMUM_HEADROOM = 1.05
PREFERRED_ASPECT = 1.05


class FootprintError(ValueError):
    """The authored site and setbacks leave no legal building envelope."""


@dataclass(frozen=True)
class Footprint:
    authored_setbacks: dict[str, int]
    legal_rect: dict[str, int]
    outer_rect: dict[str, int]
    inner_rect: dict[str, int]
    effective_offsets: dict[str, int]
    gfa_m2: float
    reason: str


def _inset(rect: dict[str, int], by: int) -> dict[str, int]:
    return {
        "xMm": rect["xMm"] + by,
        "yMm": rect["yMm"] + by,
        "widthMm": rect["widthMm"] - 2 * by,
        "heightMm": rect["heightMm"] - 2 * by,
    }


def _ceil_div(numerator: int, denominator: int) -> int:
    return -(-int(numerator) // int(denominator))


def _inner_for_area(
    area_mm2: int, aspect: float, fit_w: int, fit_h: int
) -> tuple[int, int]:
    """Largest integer inner rectangle near `aspect` holding at least area_mm2."""
    width = min(fit_w, _ceil_div(math.ceil(math.sqrt(max(area_mm2, 1) * aspect)), 1))
    height = min(fit_h, _ceil_div(area_mm2, max(width, 1)))
    if height > fit_h:
        height = fit_h
        width = min(fit_w, _ceil_div(area_mm2, height))
    return max(1, width), max(1, height)


def _feasible_bounds(area_mm2: int, fit_w: int, fit_h: int) -> tuple[float, float] | None:
    """Aspect interval in which `area_mm2` fits the inner capacity, if any."""
    low = area_mm2 / (fit_h * fit_h)
    high = (fit_w * fit_w) / area_mm2
    if low > high:
        return None
    return low, high


def _clamp_aspect(area_mm2: int, fit_w: int, fit_h: int) -> float:
    bounds = _feasible_bounds(area_mm2, fit_w, fit_h)
    if bounds is None:
        return PREFERRED_ASPECT
    low, high = bounds
    return min(max(PREFERRED_ASPECT, low), high)


def program_area_mm2(brief: BriefV1) -> tuple[int, int, int]:
    """(T, N, A) in mm2 over the REQUIRED rooms; optional rooms never inflate A."""
    target = sum(round(room.targetAreaM2 * 1e6) for room in brief.rooms if room.required)
    minimum = sum(round(room.minAreaM2 * 1e6) for room in brief.rooms if room.required)
    desired = max(
        math.ceil(target / (1.0 - CIRCULATION_SHARE)),
        math.ceil(minimum * MINIMUM_HEADROOM),
    )
    return target, minimum, max(desired, 1)


def choose_footprint(brief: BriefV1) -> Footprint:
    """Pick one deterministic footprint; the authored site and setbacks never change."""
    if not isinstance(brief, BriefV1):  # tolerate a pre-validated mapping
        brief = BriefV1.model_validate(brief)

    authored = {
        "northMm": brief.setbacks.northMm,
        "eastMm": brief.setbacks.eastMm,
        "southMm": brief.setbacks.southMm,
        "westMm": brief.setbacks.westMm,
    }
    legal = {
        "xMm": authored["westMm"],
        "yMm": authored["southMm"],
        "widthMm": brief.site.widthMm - authored["westMm"] - authored["eastMm"],
        "heightMm": brief.site.heightMm - authored["southMm"] - authored["northMm"],
    }
    if legal["widthMm"] <= 0 or legal["heightMm"] <= 0:
        raise FootprintError(
            "the authored setbacks leave no legal building envelope "
            f"({legal['widthMm']} mm x {legal['heightMm']} mm)"
        )

    external = brief.walls.externalMm
    fit_w = legal["widthMm"] - 2 * external
    fit_h = legal["heightMm"] - 2 * external
    if fit_w <= 0 or fit_h <= 0:
        raise FootprintError(
            "the legal envelope is thinner than two external walls "
            f"({fit_w} mm x {fit_h} mm inner capacity)"
        )

    _target, _minimum, desired = program_area_mm2(brief)
    cap_mm2 = round(brief.building.maxGfaM2 * 1e6) if brief.building.maxGfaM2 else None
    full_outer_area = legal["widthMm"] * legal["heightMm"]
    full_inner_area = fit_w * fit_h

    reason = "full-legal-envelope"
    needs_shrink = full_inner_area > MINIMUM_HEADROOM * desired
    cap_binds = cap_mm2 is not None and full_outer_area > cap_mm2

    if not needs_shrink and not cap_binds:
        inner_w, inner_h = fit_w, fit_h
    else:
        inner_w, inner_h = _inner_for_area(desired, PREFERRED_ASPECT, fit_w, fit_h)
        reason = "shrink-for-programme"
        if inner_w * inner_h > MINIMUM_HEADROOM * desired:
            inner_w, inner_h = _inner_for_area(
                desired, _clamp_aspect(desired, fit_w, fit_h), fit_w, fit_h
            )
        if cap_binds:
            reason = "shrink-for-gfa-cap"
            # monotone search on the desired area: the only shrinking lever is A
            low, high = 1, desired
            best = (1, 1)
            while low <= high:
                mid = (low + high) // 2
                aspect = _clamp_aspect(mid, fit_w, fit_h)
                width, height = _inner_for_area(mid, aspect, fit_w, fit_h)
                outer_area = (width + 2 * external) * (height + 2 * external)
                if outer_area <= cap_mm2:
                    best = (width, height)
                    low = mid + 1
                else:
                    high = mid - 1
            inner_w, inner_h = best
            if (inner_w + 2 * external) * (inner_h + 2 * external) > cap_mm2:
                # keep stepping one millimetre at a time until the integer cap holds
                while inner_w > 1 and (
                    inner_w + 2 * external
                ) * (inner_h + 2 * external) > cap_mm2:
                    inner_w -= 1
                    inner_h = min(inner_h, max(1, _ceil_div(desired, inner_w)))
                reason = "largest-available"

    inner_w = max(1, min(inner_w, fit_w))
    inner_h = max(1, min(inner_h, fit_h))
    outer_w, outer_h = inner_w + 2 * external, inner_h + 2 * external

    front = brief.site.front
    if front == "south":
        x = (brief.site.widthMm - outer_w) // 2
        y = authored["southMm"]
    elif front == "north":
        x = (brief.site.widthMm - outer_w) // 2
        y = brief.site.heightMm - authored["northMm"] - outer_h
    elif front == "west":
        x = authored["westMm"]
        y = (brief.site.heightMm - outer_h) // 2
    else:  # east
        x = brief.site.widthMm - authored["eastMm"] - outer_w
        y = (brief.site.heightMm - outer_h) // 2

    x = max(legal["xMm"], min(x, legal["xMm"] + legal["widthMm"] - outer_w))
    y = max(legal["yMm"], min(y, legal["yMm"] + legal["heightMm"] - outer_h))

    outer = {"xMm": int(x), "yMm": int(y), "widthMm": int(outer_w), "heightMm": int(outer_h)}
    inner = _inset(outer, external)
    effective = {
        "northMm": brief.site.heightMm - (outer["yMm"] + outer["heightMm"]),
        "eastMm": brief.site.widthMm - (outer["xMm"] + outer["widthMm"]),
        "southMm": outer["yMm"],
        "westMm": outer["xMm"],
    }
    for side, value in effective.items():
        if value < authored[side]:
            raise FootprintError(
                f"effective {side} offset {value} mm is smaller than the authored "
                f"{authored[side]} mm"
            )

    return Footprint(
        authored_setbacks=authored,
        legal_rect=legal,
        outer_rect=outer,
        inner_rect=inner,
        effective_offsets=effective,
        gfa_m2=outer["widthMm"] * outer["heightMm"] / 1_000_000,
        reason=reason,
    )

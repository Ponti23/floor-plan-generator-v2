"""S03 tests: deterministic footprint selection inside the legal envelope."""
import copy
import json
import sys
import unittest
from pathlib import Path

UNIT = Path(__file__).resolve().parent
SERVICE = UNIT.parents[1]
REPO = UNIT.parents[3]
for candidate in (SERVICE, REPO / ".runtime" / "generation" / "site-packages"):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from planlab_service.contracts import BriefV1  # noqa: E402
from planlab_service.footprint import FootprintError, choose_footprint  # noqa: E402

FIXTURES = REPO / "test" / "integration" / "fixtures"


def brief_payload(name="brief-B.json"):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))["payload"]


def brief(**overrides):
    payload = copy.deepcopy(brief_payload())
    for key, value in overrides.items():
        if key in ("site", "setbacks", "building"):
            payload[key].update(value)
        else:
            payload[key] = value
    return BriefV1.model_validate(payload)


class FootprintTests(unittest.TestCase):
    def test_golden_brief_keeps_the_full_legal_envelope(self):
        model = brief()
        foot = choose_footprint(model)
        self.assertEqual(foot.reason, "full-legal-envelope")
        self.assertEqual(foot.outer_rect, foot.legal_rect)
        self.assertEqual(foot.effective_offsets, foot.authored_setbacks)
        self.assertEqual(
            foot.inner_rect["widthMm"], foot.legal_rect["widthMm"] - 2 * model.walls.externalMm
        )
        self.assertEqual(
            foot.gfa_m2,
            foot.outer_rect["widthMm"] * foot.outer_rect["heightMm"] / 1e6,
        )

    def test_large_lot_shrinks_but_never_breaks_an_authored_setback(self):
        model = brief(site={"widthMm": 40000, "heightMm": 40000})
        foot = choose_footprint(model)
        self.assertNotEqual(foot.reason, "full-legal-envelope")
        self.assertLess(foot.outer_rect["widthMm"], foot.legal_rect["widthMm"])
        for side, authored in foot.authored_setbacks.items():
            self.assertGreaterEqual(foot.effective_offsets[side], authored, side)
        for key in ("xMm", "yMm"):
            self.assertGreaterEqual(foot.outer_rect[key], foot.legal_rect[key], key)
        self.assertLessEqual(
            foot.outer_rect["xMm"] + foot.outer_rect["widthMm"],
            foot.legal_rect["xMm"] + foot.legal_rect["widthMm"],
        )
        self.assertLessEqual(
            foot.outer_rect["yMm"] + foot.outer_rect["heightMm"],
            foot.legal_rect["yMm"] + foot.legal_rect["heightMm"],
        )

    def test_gfa_cap_is_respected_in_integer_areas(self):
        model = brief(building={"targetGfaM2": None, "maxGfaM2": 90.0})
        foot = choose_footprint(model)
        outer_mm2 = foot.outer_rect["widthMm"] * foot.outer_rect["heightMm"]
        self.assertLessEqual(outer_mm2, round(90.0 * 1e6))
        self.assertIn(foot.reason, ("shrink-for-gfa-cap", "largest-available"))

    def test_front_anchor_for_all_four_fronts(self):
        for front in ("south", "north", "west", "east"):
            with self.subTest(front=front):
                model = brief(site={"front": front}, site_width=None) if False else brief()
                payload = copy.deepcopy(brief_payload())
                payload["site"]["front"] = front
                model = BriefV1.model_validate(payload)
                foot = choose_footprint(model)
                if front == "south":
                    self.assertEqual(foot.outer_rect["yMm"], model.setbacks.southMm)
                elif front == "north":
                    self.assertEqual(
                        foot.outer_rect["yMm"] + foot.outer_rect["heightMm"],
                        model.site.heightMm - model.setbacks.northMm,
                    )
                elif front == "west":
                    self.assertEqual(foot.outer_rect["xMm"], model.setbacks.westMm)
                else:
                    self.assertEqual(
                        foot.outer_rect["xMm"] + foot.outer_rect["widthMm"],
                        model.site.widthMm - model.setbacks.eastMm,
                    )

    def test_optional_rooms_do_not_inflate_the_target(self):
        base = copy.deepcopy(brief_payload())
        with_optional = copy.deepcopy(base)
        optional = copy.deepcopy(base["rooms"][-1])
        optional.update(
            {
                "id": "S1",
                "label": "Study 1",
                "type": "study",
                "sourceRequirementId": "study",
                "ordinal": 0,
                "required": False,
                "targetAreaM2": 60.0,
                "minAreaM2": 40.0,
                "maxAreaM2": 70.0,
            }
        )
        with_optional["rooms"].append(optional)
        with_optional["site"] = {"widthMm": 40000, "heightMm": 40000, "front": "south"}
        base["site"] = {"widthMm": 40000, "heightMm": 40000, "front": "south"}
        plain = choose_footprint(BriefV1.model_validate(base))
        inflated = choose_footprint(BriefV1.model_validate(with_optional))
        self.assertEqual(
            plain.inner_rect["widthMm"] * plain.inner_rect["heightMm"],
            inflated.inner_rect["widthMm"] * inflated.inner_rect["heightMm"],
        )

    def test_deterministic(self):
        model = brief(site={"widthMm": 40000, "heightMm": 30000})
        self.assertEqual(choose_footprint(model), choose_footprint(model))

    def test_impossible_setbacks_raise(self):
        payload = copy.deepcopy(brief_payload())
        payload["setbacks"]["westMm"] = 7000
        payload["setbacks"]["eastMm"] = 7000
        with self.assertRaises(FootprintError):
            choose_footprint(BriefV1.model_validate(payload))


if __name__ == "__main__":
    unittest.main()

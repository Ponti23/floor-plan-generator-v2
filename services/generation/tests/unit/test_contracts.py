"""S01 contract tests: the shared corpus, hashing vectors and error shapes."""
import copy
import json
import sys
import unittest
from pathlib import Path

UNIT_DIR = Path(__file__).resolve().parent
SERVICE_ROOT = UNIT_DIR.parents[1]
REPO_ROOT = UNIT_DIR.parents[3]
FIXTURES = REPO_ROOT / "test" / "integration" / "fixtures"

for candidate in (SERVICE_ROOT, REPO_ROOT / ".runtime" / "generation" / "site-packages"):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from planlab_service import contracts as C  # noqa: E402
from planlab_service import errors as E  # noqa: E402

PLACEHOLDERS = {
    "NaN": float("nan"),
    "Infinity": float("inf"),
    "-Infinity": float("-inf"),
}

MODELS = {
    "brief": C.BriefV1,
    "layout": C.LayoutV1,
    "request": C.GenerationRequestV1,
    "editor": C.EditorDocumentV2,
    "job": C.JobV1,
    "problem": C.ProblemV1,
}


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def resolve_value(value):
    if isinstance(value, dict) and set(value) == {"$number"}:
        key = value["$number"]
        if key not in PLACEHOLDERS:
            raise ValueError(f"unknown number placeholder {key!r}")
        return PLACEHOLDERS[key]
    if isinstance(value, list):
        return [resolve_value(item) for item in value]
    if isinstance(value, dict):
        return {key: resolve_value(item) for key, item in value.items()}
    return value


def apply_patch(payload: dict, patch: list) -> dict:
    target = copy.deepcopy(payload)
    for op in patch:
        node = target
        path = op["path"]
        for step in path[:-1]:
            node = node[step]
        leaf = path[-1]
        action = op["op"]
        if action == "set":
            node[leaf] = resolve_value(copy.deepcopy(op["value"]))
        elif action == "delete":
            del node[leaf]
        elif action == "append":
            node[leaf].append(resolve_value(copy.deepcopy(op["value"])))
        else:
            raise ValueError(f"unknown patch op {action!r}")
    return target


def brief_room(**overrides) -> dict:
    room = {
        "id": "B1",
        "label": "Bedroom 1",
        "type": "bedroom",
        "roomClass": "standard",
        "sourceRequirementId": "bedroom",
        "ordinal": 0,
        "required": True,
        "targetAreaM2": 14,
        "minAreaM2": 11,
        "maxAreaM2": 16.1,
        "minShortSideMm": 3200,
        "minWidthMm": 3200,
        "minHeightMm": 3200,
        "maxAspectRatio": 1.8,
    }
    room.update(overrides)
    return room


def relationship(rel_id: str, a: str, b: str, kind: str = "mustShareWall") -> dict:
    return {
        "id": rel_id,
        "a": a,
        "b": b,
        "kind": kind,
        "minSharedWallMm": 900,
        "minOpeningWidthMm": 820,
    }


def build_case(builder: str, base: dict) -> dict:
    payload = copy.deepcopy(base)
    if builder == "brief-too-many-rooms":
        payload["rooms"] = [
            brief_room(id=f"B{index + 1}", ordinal=index) for index in range(25)
        ]
        payload["relationships"] = []
    elif builder == "brief-fine-type-cap":
        rooms = [brief_room(id=f"B{index + 1}", ordinal=index) for index in range(9)]
        rooms.append(
            brief_room(id="L1", type="living", sourceRequirementId="living", targetAreaM2=22,
                       minAreaM2=16, maxAreaM2=25.3, minShortSideMm=3400, minWidthMm=3400,
                       minHeightMm=3400, maxAspectRatio=2)
        )
        payload["rooms"] = rooms
        payload["relationships"] = []
    elif builder == "brief-too-many-relationships":
        rooms = [
            brief_room(id=f"R{index + 1}", ordinal=index, sourceRequirementId="bedroom")
            for index in range(23)
        ]
        rooms.append(
            brief_room(id="L1", type="living", sourceRequirementId="living", targetAreaM2=22,
                       minAreaM2=16, maxAreaM2=25.3, minShortSideMm=3400, minWidthMm=3400,
                       minHeightMm=3400, maxAspectRatio=2, label="Living Room 1")
        )
        payload["rooms"] = rooms
        ids = [room["id"] for room in rooms]
        relationships = []
        for index, first in enumerate(ids):
            for second in ids[index + 1 :]:
                relationships.append(relationship(f"REL-{first}-{second}", first, second))
                if len(relationships) == 65:
                    break
            if len(relationships) == 65:
                break
        payload["relationships"] = relationships
    elif builder == "brief-relationship-self-edge":
        payload["relationships"] = [relationship("REL-self", "B1", "B1")]
    elif builder == "brief-relationship-unknown-endpoint":
        payload["relationships"] = [relationship("REL-unknown", "B1", "ZZ9")]
    elif builder == "brief-duplicate-relationship-pair":
        payload["relationships"] = [
            relationship("REL-one", "B1", "B2"),
            relationship("REL-two", "B2", "B1"),
        ]
    elif builder == "brief-target-gfa-above-max":
        payload["building"] = {"targetGfaM2": 200, "maxGfaM2": 150}
    elif builder == "brief-topn-above-topk":
        payload["settings"] = {**payload["settings"], "topK": 2, "topN": 3}
    elif builder == "brief-min-area-above-target":
        payload["rooms"][0]["minAreaM2"] = 20
    elif builder == "brief-axis-minimum-below-short-side":
        payload["rooms"][0]["minWidthMm"] = 2000
    elif builder == "brief-no-living-or-dining":
        for room in payload["rooms"]:
            if room["type"] in ("living", "dining"):
                room["type"] = "store"
    elif builder == "brief-no-required-room":
        for room in payload["rooms"]:
            room["required"] = False
    elif builder == "brief-min-site-axis-ok":
        payload["site"] = {**payload["site"], "widthMm": 3000, "heightMm": 3000}
    elif builder == "brief-three-decimals-ok":
        payload["rooms"][0]["targetAreaM2"] = 14.001
    elif builder == "editor-document-over-64k":
        payload = editor_document(base, pad=True)
    elif builder == "layout-below-authored-axis-minimum":
        room = payload["rooms"][0]
        room["rect"] = {"xMm": room["rect"]["xMm"], "yMm": room["rect"]["yMm"],
                        "widthMm": 3100, "heightMm": 4000}
        room["areaM2"] = 3100 * 4000 / 1_000_000
    elif builder == "layout-omitted-room-also-present":
        payload["omittedRoomIds"] = [payload["rooms"][0]["id"]]
    elif builder == "layout-zero-width-wall":
        payload["walls"][0]["rect"]["widthMm"] = 0
    else:
        raise ValueError(f"unknown builder {builder!r}")
    return payload


def editor_document(brief: dict, pad: bool = False) -> dict:
    groups = []
    seen: dict[str, int] = {}
    for room in brief["rooms"]:
        key = room["sourceRequirementId"]
        seen[key] = seen.get(key, 0) + 1
        groups.append(
            {
                "requirementId": key,
                "label": room["label"],
                "type": room["type"],
                "roomClass": room["roomClass"],
                "quantity": 1,
                "required": room["required"],
                "instanceIds": [room["id"]],
                "retiredInstanceIds": [],
            }
        )
    if pad:
        for group in groups:
            group["retiredInstanceIds"] = [
                f"Retired{index:032d}" for index in range(64)
            ]
    return {
        "schemaVersion": "planlab.editor/2",
        "name": brief.get("name", "Fixture project"),
        "roomGroups": groups,
        "legacyImport": None,
    }


def prepare(case: dict) -> tuple[str, dict]:
    base_fixture = load(case["base"])
    base = base_fixture["payload"]
    target = case["target"]
    if target == "request":
        payload = {
            "schemaVersion": C.CONTRACT_VERSION,
            "projectId": base["projectId"],
            "briefVersionId": base["briefVersionId"],
            "idempotencyKey": "idem-fixture-key",
        }
    elif target == "editor":
        payload = editor_document(base)
    else:
        payload = copy.deepcopy(base)

    if case.get("builder"):
        payload = build_case(case["builder"], payload if target != "editor" else base)
    if case.get("patch"):
        payload = apply_patch(payload, case["patch"])
    return target, payload


class FixtureTests(unittest.TestCase):
    def test_golden_briefs_and_layout_validate(self) -> None:
        for name, model in (
            ("brief-B.json", C.BriefV1),
            ("brief-D.json", C.BriefV1),
            ("layout-B.json", C.LayoutV1),
        ):
            with self.subTest(fixture=name):
                payload = load(name)["payload"]
                model.model_validate(payload)

    def test_layout_fixture_carries_real_engine_evidence(self) -> None:
        fixture = load("layout-B.json")
        layout = C.LayoutV1.model_validate(fixture["payload"])
        self.assertEqual(layout.provenance.topologySource, "topology_model_v1")
        self.assertEqual(len(layout.validation.checks), 20)
        self.assertTrue(all(check.passed for check in layout.validation.checks))
        self.assertEqual(
            layout.versions.checkpointSha256,
            "3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8",
        )
        self.assertIn("Real validated engine layout", fixture["origin"]["conversion"])
        self.assertEqual(fixture["origin"]["engineTransportSource"], "brief_provided")

    def test_hash_vectors_match_stored_preimages(self) -> None:
        vectors = load("hash-vectors.json")["vectors"]
        self.assertEqual({vector["name"] for vector in vectors}, {"brief-B", "brief-D"})
        for vector in vectors:
            with self.subTest(vector=vector["name"]):
                brief = C.BriefV1.model_validate(load(vector["fixture"])["payload"])
                preimage = C.canonical_json(C.canonical_brief_payload(brief))
                self.assertEqual(preimage, vector["canonicalPreimage"])
                self.assertEqual(C.brief_sha256(brief), vector["sha256"])

    def test_hash_changes_when_a_setting_changes(self) -> None:
        brief = C.BriefV1.model_validate(load("brief-B.json")["payload"])
        changed = brief.model_copy(deep=True)
        changed.settings.seed = brief.settings.seed + 1
        self.assertNotEqual(C.brief_sha256(brief), C.brief_sha256(changed))

    def test_case_corpus_parity(self) -> None:
        corpus = load("invalid-cases.json")
        names = set()
        for case in corpus["cases"]:
            with self.subTest(case=case["name"]):
                self.assertNotIn(case["name"], names, "case names must be unique")
                names.add(case["name"])
                target, payload = prepare(case)
                model = MODELS[target]
                if case["expect"] == "reject":
                    with self.assertRaises(
                        Exception, msg=f"{case['name']} should be rejected: {case['reason']}"
                    ):
                        model.model_validate(payload)
                else:
                    model.model_validate(payload)

    def test_every_corpus_case_is_runnable(self) -> None:
        corpus = load("invalid-cases.json")
        for case in corpus["cases"]:
            prepare(case)


class ErrorShapeTests(unittest.TestCase):
    def test_problem_shape_follows_the_code(self) -> None:
        problem = E.problem(
            "NO_VALID_LAYOUT",
            "No valid layout found for this brief within this engine's current search.",
            "corr-1",
            remediations=E.default_remediation("NO_VALID_LAYOUT"),
        )
        self.assertEqual(problem.category, "architectural")
        self.assertFalse(problem.retryable)
        self.assertEqual(problem.proof, "limited_search")
        self.assertEqual(problem.remediation[0].code, "REDUCE_PROGRAMME")

    def test_technical_failures_are_not_architectural(self) -> None:
        problem = E.problem("SOLVER_TIMEOUT", "deadline reached", "corr-2")
        self.assertEqual(problem.category, "technical")
        self.assertTrue(problem.retryable)
        self.assertIsNone(problem.proof)

    def test_programme_too_large_is_a_necessary_condition(self) -> None:
        problem = E.problem("PROGRAMME_TOO_LARGE", "programme exceeds the envelope", "corr-3")
        self.assertEqual(problem.proof, "necessary_condition")
        self.assertFalse(problem.retryable)

    def test_mismatched_category_is_rejected(self) -> None:
        with self.assertRaises(Exception):
            C.ProblemV1(
                code="NO_VALID_LAYOUT",
                category="technical",
                message="wrong category",
                retryable=False,
                proof="limited_search",
                correlationId="corr-4",
            )

    def test_field_errors_map_from_pydantic(self) -> None:
        try:
            C.GenerationRequestV1.model_validate({"schemaVersion": C.CONTRACT_VERSION})
        except Exception as exc:  # noqa: BLE001
            field_errors = E.field_errors_from_validation_error(exc)
        else:  # pragma: no cover
            self.fail("validation should have failed")
        self.assertTrue(field_errors)
        self.assertTrue(all(item.path for item in field_errors))

    def test_structural_preflight_is_not_a_schema_error(self) -> None:
        brief = C.BriefV1.model_validate(load("brief-D.json")["payload"])
        self.assertIsNone(C.structural_footprint_check(brief))
        cramped = brief.model_copy(deep=True)
        cramped.setbacks.westMm = 6000
        cramped.setbacks.eastMm = 6000
        self.assertIsNotNone(C.structural_footprint_check(cramped))


if __name__ == "__main__":
    unittest.main()

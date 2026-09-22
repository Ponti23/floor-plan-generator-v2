#!/usr/bin/env python
"""S00 runtime and asset check for the PlanLab generation service.

Verifies, without loading any training data or dataset arrays:

  * the engine interpreter, the protected engine environment and the
    service-only overlay under `.runtime/generation/site-packages`,
  * that the overlay provides FastAPI/Uvicorn/Pydantic/httpx and does NOT
    shadow torch, numpy or OR-Tools,
  * the pinned topology checkpoint hash and both vocabulary manifests,
  * that every engine module the service imports resolves through the flat
    `geometry_engine_v1` module names,
  * SQLite version plus WAL support for the durable job store,
  * optionally, a CPU topology smoke: warm-load the model once and generate
    candidates for demo B.

Run:
    <engine python> scripts/check-generation-runtime.py
    <engine python> scripts/check-generation-runtime.py --skip-smoke --json out.json

Exits 0 only when every required check passed. Never prints secret values.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_ENGINE_ROOT = Path("E:/Projects/floor-plan-model")
DEFAULT_CHECKPOINT_SHA256 = (
    "3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8"
)

OVERLAY_REQUIRED = ("fastapi", "uvicorn", "pydantic", "httpx")
PROTECTED_REQUIRED = ("torch", "numpy", "ortools", "sqlite3")
ENGINE_MODULES = (
    "ge_core",
    "ge_engine",
    "ge_layout_model",
    "ge_validator",
    "ge_circulation",
    "ge_relations",
    "ge_walls",
    "ge_scoring",
    "site_sizing",
    "ge_topology_adapter",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class Report:
    def __init__(self) -> None:
        self.checks: list[dict] = []

    def add(self, name: str, ok: bool, detail: str, required: bool = True) -> bool:
        self.checks.append(
            {
                "name": name,
                "passed": bool(ok),
                "required": bool(required),
                "detail": detail,
            }
        )
        marker = "ok  " if ok else ("FAIL" if required else "warn")
        print(f"[{marker}] {name}: {detail}", flush=True)
        return ok

    @property
    def failed(self) -> list[dict]:
        return [c for c in self.checks if c["required"] and not c["passed"]]


def import_and_locate(name: str):
    module = __import__(name)
    return module, Path(getattr(module, "__file__", "") or ".")


def resolve_roots(args) -> tuple[Path, Path, Path]:
    engine_root = Path(args.engine_root or os.environ.get("PLANLAB_ENGINE_ROOT") or DEFAULT_ENGINE_ROOT)
    service_root = Path(args.service_root or REPO_ROOT)
    overlay = Path(
        args.overlay
        or os.environ.get(
            "PLANLAB_SERVICE_SITE_PACKAGES",
            service_root / ".runtime" / "generation" / "site-packages",
        )
    )
    return engine_root.resolve(), service_root.resolve(), overlay.resolve()


def python_executable_ok(report: Report, engine_root: Path) -> bool:
    expected = engine_root / ".python" / "python.exe"
    if not expected.exists():
        return report.add(
            "engine-interpreter", False, f"missing {expected} (engine root {engine_root})"
        )
    actual = Path(sys.executable).resolve()
    same = actual == expected.resolve()
    return report.add(
        "engine-interpreter",
        same,
        f"running {actual}; expected {expected.resolve()}",
    )


def check_overlay(report: Report, overlay: Path) -> None:
    report.add("overlay-directory", overlay.is_dir(), str(overlay))
    if not overlay.is_dir():
        return

    for name in OVERLAY_REQUIRED:
        try:
            module, path = import_and_locate(name)
        except Exception as exc:  # noqa: BLE001
            report.add(f"overlay-import:{name}", False, f"{type(exc).__name__}: {exc}")
            continue
        inside = str(path).lower().startswith(str(overlay).lower())
        version = getattr(module, "__version__", "unknown")
        report.add(
            f"overlay-import:{name}",
            inside,
            f"{version} from {path}" + ("" if inside else " (outside overlay)"),
        )

    for name in PROTECTED_REQUIRED:
        try:
            module, path = import_and_locate(name)
        except Exception as exc:  # noqa: BLE001
            report.add(f"protected-import:{name}", False, f"{type(exc).__name__}: {exc}")
            continue
        inside_overlay = str(path).lower().startswith(str(overlay).lower())
        version = getattr(module, "__version__", getattr(module, "sqlite_version", "unknown"))
        report.add(
            f"protected-import:{name}",
            not inside_overlay,
            f"{version} from {path}"
            + (" (SHADOWED BY OVERLAY)" if inside_overlay else ""),
        )


def check_assets(report: Report, engine_root: Path, checkpoint: Path, expected_sha: str) -> None:
    if checkpoint.exists():
        actual = sha256_file(checkpoint)
        report.add(
            "checkpoint-hash",
            actual == expected_sha,
            f"{checkpoint} sha256={actual}",
        )
        report.add("checkpoint-bytes", True, f"{checkpoint.stat().st_size} bytes")
    else:
        report.add("checkpoint-hash", False, f"missing checkpoint {checkpoint}")

    manifests = {
        "store_manifest": engine_root / "topology_v1" / "data" / "store" / "store_manifest.json",
        "data_manifest": engine_root / "overnight_topology_v0" / "data" / "data_manifest.json",
    }
    for label, path in manifests.items():
        if path.exists():
            report.add(f"manifest:{label}", True, f"{path} sha256={sha256_file(path)}")
        else:
            report.add(f"manifest:{label}", False, f"missing {path}")


def check_engine_imports(report: Report, engine_root: Path) -> None:
    package_dir = engine_root / "geometry_engine_v1"
    report.add("engine-package", package_dir.is_dir(), str(package_dir))
    if not package_dir.is_dir():
        return
    for name in ENGINE_MODULES:
        try:
            module, path = import_and_locate(name)
        except Exception as exc:  # noqa: BLE001
            report.add(f"engine-import:{name}", False, f"{type(exc).__name__}: {exc}")
            continue
        report.add(f"engine-import:{name}", path.exists(), str(path))


def check_sqlite(report: Report) -> None:
    with tempfile.TemporaryDirectory(prefix="planlab-s00-") as tmp:
        db_path = Path(tmp) / "probe.sqlite3"
        try:
            connection = sqlite3.connect(str(db_path))
            mode = connection.execute("PRAGMA journal_mode=WAL").fetchone()[0]
            connection.execute("CREATE TABLE probe(id INTEGER PRIMARY KEY, blob TEXT)")
            connection.execute("INSERT INTO probe(blob) VALUES (json('{\"ok\": true}'))")
            count = connection.execute("SELECT count(*) FROM probe").fetchone()[0]
            connection.commit()
            connection.close()
        except Exception as exc:  # noqa: BLE001
            report.add("sqlite-wal", False, f"{type(exc).__name__}: {exc}")
            return
        report.add(
            "sqlite-wal",
            mode.lower() == "wal" and count == 1,
            f"sqlite {sqlite3.sqlite_version}, journal_mode={mode}, json() round-trip rows={count}",
        )


def run_topology_smoke(report: Report, engine_root: Path, checkpoint: Path) -> None:
    try:
        import torch  # noqa: F401
        import ge_core
        import ge_topology_adapter as TA
    except Exception as exc:  # noqa: BLE001
        report.add("topology-smoke", False, f"import failed: {type(exc).__name__}: {exc}")
        return

    demo_b = engine_root / "geometry_engine_v1" / "demos" / "demo_B_brief.json"
    if not demo_b.exists():
        report.add("topology-smoke", False, f"missing demo brief {demo_b}")
        return

    started = time.perf_counter()
    try:
        raw_brief = json.loads(demo_b.read_text(encoding="utf-8-sig"))
        brief = ge_core.resolve_brief(raw_brief)
        adapter = TA.TopologyAdapter(checkpoint=str(checkpoint), device="cpu")
        cold = time.perf_counter()
        first = adapter.candidates_from_brief(brief, top_k=5)
        warm = time.perf_counter()
        second = adapter.candidates_from_brief(brief, top_k=5)
        done = time.perf_counter()
    except Exception as exc:  # noqa: BLE001
        report.add("topology-smoke", False, f"{type(exc).__name__}: {exc}")
        return

    n_first = len(first.get("candidates", []))
    n_second = len(second.get("candidates", []))
    report.add(
        "topology-smoke",
        n_first > 0 and n_second > 0,
        (
            f"demo B candidates={n_first}, first call (includes model load) "
            f"{warm - cold:.2f}s, second call on the same adapter "
            f"{done - warm:.2f}s with {n_second} candidate(s); "
            f"device={adapter.last_provenance.get('device')}; "
            f"setup {cold - started:.2f}s"
        ),
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine-root", default=None)
    parser.add_argument("--service-root", default=None)
    parser.add_argument("--overlay", default=None)
    parser.add_argument("--checkpoint", default=None)
    parser.add_argument("--expected-checkpoint-sha256", default=None)
    parser.add_argument("--skip-smoke", action="store_true")
    parser.add_argument("--json", dest="json_path", default=None)
    args = parser.parse_args(argv)

    engine_root, service_root, overlay = resolve_roots(args)

    # Overlay first (service dependencies), then the flat engine modules.
    engine_package = engine_root / "geometry_engine_v1"
    for entry in (engine_package, engine_root):
        if str(entry) not in sys.path:
            sys.path.append(str(entry))
    if overlay.is_dir() and str(overlay) not in sys.path:
        sys.path.insert(0, str(overlay))

    report = Report()
    print(f"engine root : {engine_root}")
    print(f"service root: {service_root}")
    print(f"overlay     : {overlay}")
    print(f"python      : {sys.version.split()[0]} ({sys.executable})")

    checkpoint = Path(
        args.checkpoint
        or os.environ.get("PLANLAB_CHECKPOINT")
        or engine_root / "topology_v1" / "checkpoints" / "full_v1a" / "best.pt"
    )
    expected_sha = (
        args.expected_checkpoint_sha256
        or os.environ.get("PLANLAB_CHECKPOINT_SHA256")
        or DEFAULT_CHECKPOINT_SHA256
    )

    python_executable_ok(report, engine_root)
    check_overlay(report, overlay)
    check_assets(report, engine_root, checkpoint, expected_sha)
    check_engine_imports(report, engine_root)
    check_sqlite(report)
    if not args.skip_smoke:
        run_topology_smoke(report, engine_root, checkpoint)

    failed = report.failed
    summary = {
        "check": "planlab-generation-runtime",
        "recordedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "engineRoot": str(engine_root),
        "serviceRoot": str(service_root),
        "overlay": str(overlay),
        "pythonVersion": sys.version.split()[0],
        "passed": not failed,
        "checks": report.checks,
    }
    if args.json_path:
        Path(args.json_path).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {args.json_path}")

    if failed:
        print(f"\n{len(failed)} required check(s) failed")
        return 1
    print(f"\nall {len(report.checks)} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

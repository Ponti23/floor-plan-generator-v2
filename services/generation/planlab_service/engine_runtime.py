"""Warm engine runtime: one CPU topology adapter, reused across jobs (S03)."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from .contracts import EngineVersionsV1
from .provenance import (
    build_versions,
    combined_sha256,
    engine_source_sha256,
    file_sha256,
    vocabulary_sha256,
)

SERVICE_VERSION = "0.1.0"
CHECKPOINT_ID = "full_v1a/best"
DEFAULT_ENGINE_ROOT = Path("E:/Projects/floor-plan-model")
DEFAULT_CHECKPOINT_SHA256 = (
    "3ea6225e6c582e167cb9a2450eae5b068cc2189cae182cb015503e3d47e220d8"
)
MAX_SOLVER_WORKERS = 8
MAX_ATTEMPTS_PER_CANDIDATE = 2


class EngineError(RuntimeError):
    """Base class for engine-side failures the service must classify honestly."""


class EngineUnavailable(EngineError):
    """Assets or modules are missing, so no generation can run at all."""


class ModelLoadFailure(EngineError):
    """The checkpoint or its vocabulary could not be loaded, or a hash mismatched."""


class EngineDeadline(EngineError):
    """The wall deadline for the active job expired."""


def resolve_paths(engine_root=None, overlay=None) -> dict:
    root = Path(engine_root or os.environ.get("PLANLAB_ENGINE_ROOT") or DEFAULT_ENGINE_ROOT).resolve()
    overlay_path = Path(
        overlay
        or os.environ.get("PLANLAB_SERVICE_SITE_PACKAGES")
        or Path(__file__).resolve().parents[3] / ".runtime" / "generation" / "site-packages"
    ).resolve()
    return {
        "engineRoot": root,
        "enginePackage": root / "geometry_engine_v1",
        "overlay": overlay_path,
        "checkpoint": Path(
            os.environ.get("PLANLAB_CHECKPOINT")
            or root / "topology_v1" / "checkpoints" / "full_v1a" / "best.pt"
        ),
        "storeManifest": root / "topology_v1" / "data" / "store" / "store_manifest.json",
        "dataManifest": root / "overnight_topology_v0" / "data" / "data_manifest.json",
        "interpreter": root / ".python" / "python.exe",
    }


def install_paths(paths: dict) -> None:
    """Overlay first (service deps), then the flat engine module directory."""
    for entry in (paths["enginePackage"], paths["engineRoot"], paths["overlay"]):
        text = str(entry)
        if entry.is_dir() and text not in sys.path:
            sys.path.insert(0, text)


class EngineRuntime:
    """Owns the warm model and all CP-SAT computation for this process."""

    def __init__(
        self,
        engine_root=None,
        checkpoint=None,
        expected_checkpoint_sha256=None,
        overlay=None,
        device="cpu",
        solver_workers=MAX_SOLVER_WORKERS,
        warmup_deadline_s=45.0,
    ) -> None:
        self.paths = resolve_paths(engine_root, overlay)
        if checkpoint:
            self.paths["checkpoint"] = Path(checkpoint)
        self.expected_checkpoint_sha256 = (
            expected_checkpoint_sha256
            or os.environ.get("PLANLAB_CHECKPOINT_SHA256")
            or DEFAULT_CHECKPOINT_SHA256
        )
        if not 1 <= int(solver_workers) <= MAX_SOLVER_WORKERS:
            raise ValueError(f"solver workers must be 1..{MAX_SOLVER_WORKERS}")
        self.solver_workers = int(solver_workers)
        self.device = device
        self.warmup_deadline_s = float(warmup_deadline_s)
        self.adapter = None
        self._versions: EngineVersionsV1 | None = None
        self._modules: dict = {}
        self.warm_jobs = 0
        self.loaded_at: str | None = None

    # ------------------------------------------------------------------ load
    def check_assets(self) -> dict:
        checkpoint = self.paths["checkpoint"]
        if not checkpoint.exists():
            raise EngineUnavailable(f"checkpoint not found: {checkpoint}")
        digest = file_sha256(checkpoint)
        if self.expected_checkpoint_sha256 and digest != self.expected_checkpoint_sha256:
            raise ModelLoadFailure(
                f"checkpoint hash mismatch: {digest} != {self.expected_checkpoint_sha256}"
            )
        for key in ("storeManifest", "dataManifest"):
            if not self.paths[key].exists():
                raise EngineUnavailable(f"vocabulary manifest not found: {self.paths[key]}")
        if not self.paths["enginePackage"].is_dir():
            raise EngineUnavailable(f"engine package not found: {self.paths['enginePackage']}")
        return {
            "checkpointSha256": digest,
            "vocabularySha256": vocabulary_sha256(
                self.paths["storeManifest"], self.paths["dataManifest"]
            ),
            "engineSourceSha256": engine_source_sha256(self.paths["engineRoot"]),
        }

    def load(self) -> EngineVersionsV1:
        assets = self.check_assets()
        install_paths(self.paths)
        try:
            import torch

            torch.set_num_threads(1)
            torch.set_num_interop_threads(1)
        except Exception:  # already configured, or torch missing (checked below)
            pass
        try:
            import ge_core
            import ge_engine
            import ge_relations
            import ge_layout_model
            import ge_topology_adapter as TA
        except Exception as exc:  # noqa: BLE001
            raise EngineUnavailable(f"engine import failed: {type(exc).__name__}: {exc}") from exc
        self._modules = {
            "ge_core": ge_core,
            "ge_engine": ge_engine,
            "ge_relations": ge_relations,
            "ge_layout_model": ge_layout_model,
            "topology": TA,
        }
        started = time.time()
        try:
            self.adapter = TA.TopologyAdapter(
                checkpoint=str(self.paths["checkpoint"]), device=self.device
            )
            self.adapter._ensure_loaded()
        except Exception as exc:  # noqa: BLE001
            raise ModelLoadFailure(f"{type(exc).__name__}: {exc}") from exc
        if time.time() - started > self.warmup_deadline_s:
            raise ModelLoadFailure(
                f"model warmup exceeded {self.warmup_deadline_s}s ({time.time() - started:.1f}s)"
            )
        self.loaded_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        import ortools

        self._versions = build_versions(
            engine_root=self.paths["engineRoot"],
            checkpoint_path=self.paths["checkpoint"],
            checkpoint_sha256=assets["checkpointSha256"],
            store_manifest=self.paths["storeManifest"],
            data_manifest=self.paths["dataManifest"],
            service_version=SERVICE_VERSION,
            python_version=".".join(str(part) for part in sys.version_info[:3]),
            torch_version=getattr(torch, "__version__", "unknown"),
            ortools_version=getattr(ortools, "__version__", "unknown"),
        )
        return self._versions

    @property
    def ready(self) -> bool:
        return self.adapter is not None and self._versions is not None

    @property
    def versions(self) -> EngineVersionsV1:
        if self._versions is None:
            raise EngineUnavailable("model not loaded")
        return self._versions

    def modules(self) -> dict:
        if not self._modules:
            raise EngineUnavailable("model not loaded")
        return self._modules

    # ------------------------------------------------------------- inference
    def warm_candidates(self, engine_brief: dict, top_k: int) -> list[dict]:
        """Model-generated candidates from the warm adapter for this job's seed."""
        if self.adapter is None:
            raise EngineUnavailable("model not loaded")
        self.adapter.seed = int(engine_brief["settings"]["solver"]["random_seed"])
        generated = self.adapter.candidates_from_brief(engine_brief, top_k=int(top_k))
        self.warm_jobs += 1
        return list(generated.get("candidates") or [])

    def generate(
        self,
        engine_brief: dict,
        *,
        top_k: int = 5,
        top_n: int = 3,
        time_limit_s: int = 30,
        max_attempts: int = MAX_ATTEMPTS_PER_CANDIDATE,
    ) -> dict:
        ge_engine = self.modules()["ge_engine"]
        brief = dict(engine_brief)
        solver = dict(brief["settings"]["solver"])
        solver.update(
            {
                "time_limit_s": float(time_limit_s),
                "num_search_workers": self.solver_workers,
                "max_attempts_per_candidate": int(max_attempts),
            }
        )
        brief["settings"] = {**brief["settings"], "solver": solver}
        return ge_engine.generate_floorplans(
            brief,
            top_k=int(top_k),
            top_n=int(top_n),
            time_limit_s=int(time_limit_s),
            verbose=False,
            save_dir=None,
            render=False,
        )


def default_manifest_digest(runtime: EngineRuntime) -> str:
    return combined_sha256([runtime.paths["storeManifest"], runtime.paths["dataManifest"]])

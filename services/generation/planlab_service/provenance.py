"""Engine/model provenance: file hashes and the public EngineVersionsV1 block (S03)."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from .contracts import EngineVersionsV1, canonical_json

ENGINE_VERSION = "geometry_engine_v1"
CHECKPOINT_ID = "full_v1a/best"


def file_sha256(path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def combined_sha256(paths) -> str:
    """sha256 over the canonical JSON of {file name: sha256} for the given files."""
    entries = {Path(path).name: file_sha256(path) for path in paths}
    return hashlib.sha256(canonical_json(entries).encode("utf-8")).hexdigest()


def engine_source_sha256(engine_root) -> str:
    """sha256 over every geometry_engine_v1 module the service can import."""
    package = Path(engine_root) / "geometry_engine_v1"
    sources = sorted(
        path for path in package.glob("*.py") if "__pycache__" not in path.parts
    )
    return combined_sha256(sources)


def vocabulary_sha256(store_manifest, data_manifest) -> str:
    return combined_sha256([store_manifest, data_manifest])


def build_versions(
    *,
    engine_root,
    checkpoint_path,
    checkpoint_sha256,
    store_manifest,
    data_manifest,
    service_version="0.1.0",
    python_version=None,
    torch_version,
    ortools_version,
) -> EngineVersionsV1:
    return EngineVersionsV1(
        engineVersion=ENGINE_VERSION,
        engineSourceSha256=engine_source_sha256(engine_root),
        modelVersion="topology_v1",
        checkpointId=CHECKPOINT_ID,
        checkpointSha256=checkpoint_sha256 or file_sha256(checkpoint_path),
        vocabularySha256=vocabulary_sha256(store_manifest, data_manifest),
        serviceVersion=service_version,
        contractVersion="planlab.generation/1",
        pythonVersion=python_version or ".".join(str(part) for part in sys.version_info[:3]),
        torchVersion=torch_version,
        ortoolsVersion=ortools_version,
    )

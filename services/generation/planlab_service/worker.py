"""Spawned engine worker: owns the warm model and all CP-SAT work, never SQLite (S04)."""
from __future__ import annotations

import time
import traceback


def worker_main(connection, *, engine_root=None, overlay=None, solver_workers=8) -> None:
    """Child-process entry point (spawn start method; no inherited DB connection)."""
    from .contracts import BriefV1
    from .engine_adapter import EngineAdapter
    from .engine_runtime import EngineRuntime, ModelLoadFailure, EngineUnavailable

    runtime = EngineRuntime(
        engine_root=engine_root, overlay=overlay, solver_workers=solver_workers
    )
    try:
        versions = runtime.load()
    except (EngineUnavailable, ModelLoadFailure) as exc:
        connection.send({"type": "load_failed", "detail": f"{type(exc).__name__}: {exc}"})
        connection.close()
        return
    connection.send({"type": "ready", "versions": versions.model_dump(mode="json")})
    adapter = EngineAdapter(runtime)
    last_seen_run_token = None

    while True:
        try:
            message = connection.recv()
        except EOFError:
            break
        if message is None or message.get("type") == "shutdown":
            break
        if message.get("type") != "generate":
            continue
        run_token = message.get("runToken")
        last_seen_run_token = run_token
        started = time.time()

        def emit(stage: str, _token=run_token) -> None:
            connection.send({
                "type": "stage",
                "runToken": _token,
                "generationId": message.get("generationId"),
                "stage": stage,
            })

        try:
            brief = BriefV1.model_validate(message["brief"])
            result = adapter.generate(
                brief,
                generation_id=message["generationId"],
                project_id=message["projectId"],
                brief_version_id=message["briefVersionId"],
                correlation_id=message.get("correlationId", ""),
                on_stage=emit,
            )
            connection.send({
                "type": "result",
                "runToken": run_token,
                "generationId": message["generationId"],
                "status": result.status,
                "layouts": [layout.model_dump(mode="json") for layout in result.layouts],
                "error": result.error.model_dump(mode="json") if result.error else None,
                "warnings": list(result.warnings),
                "diagnostics": result.diagnostics,
                "versions": result.versions.model_dump(mode="json") if result.versions else None,
                "elapsedMs": int((time.time() - started) * 1000),
            })
        except Exception as exc:  # noqa: BLE001
            connection.send({
                "type": "crashed",
                "runToken": run_token,
                "generationId": message.get("generationId"),
                "detail": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc()[-2000:],
            })
    connection.close()

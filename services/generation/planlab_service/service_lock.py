"""OS-held exclusive service lock: one generation service per data directory (S04)."""
from __future__ import annotations

import os
from pathlib import Path


class ServiceLockError(RuntimeError):
    """Another service instance already owns this data directory."""


class ServiceLock:
    """Exclusive lock on DATA_DIR/service.lock, released on exit or crash."""

    def __init__(self, data_dir, name: str = "service.lock") -> None:
        self.path = Path(data_dir) / name
        self._handle = None

    def acquire(self) -> None:
        if self._handle is not None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(self.path, "a+b")
        try:
            if os.name == "nt":  # pragma: no cover - Windows path
                import msvcrt

                handle.seek(0)
                handle.write(b"planlab\n")
                handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:  # pragma: no cover - portability path
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            handle.close()
            raise ServiceLockError(
                f"another generation service already owns {self.path.parent}"
            ) from exc
        self._handle = handle

    def release(self) -> None:
        if self._handle is None:
            return
        try:
            if os.name == "nt":  # pragma: no cover - Windows path
                import msvcrt

                self._handle.seek(0)
                msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            self._handle.close()
            self._handle = None

    def __enter__(self) -> "ServiceLock":
        self.acquire()
        return self

    def __exit__(self, *exc_info) -> None:
        self.release()

    @property
    def held(self) -> bool:
        return self._handle is not None

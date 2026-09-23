"""Run the generation service (dev and release) with the engine interpreter."""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
for candidate in (
    REPO_ROOT / "services" / "generation",
    REPO_ROOT / ".runtime" / "generation" / "site-packages",
):
    if candidate.is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from planlab_service.app import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())

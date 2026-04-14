from __future__ import annotations

import os
from pathlib import Path
import shutil
import sys


ROOT_DIR = Path(__file__).resolve().parents[1]
API_DIR = ROOT_DIR / "apps" / "api"
E2E_DIR = API_DIR / ".e2e"
DB_PATH = E2E_DIR / "gigastudy_e2e.db"
STORAGE_ROOT = API_DIR / ".e2e-storage"


def _ignore_missing_tree_entry(function, path, error) -> None:
    if isinstance(error, FileNotFoundError):
        return
    raise error


def _remove_tree_best_effort(path: Path) -> None:
    if not path.exists():
        return
    shutil.rmtree(path, onexc=_ignore_missing_tree_entry)


def prepare_environment() -> None:
    E2E_DIR.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()
    if STORAGE_ROOT.exists():
        _remove_tree_best_effort(STORAGE_ROOT)
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("GIGASTUDY_API_ENV", "e2e")
    os.environ.setdefault("GIGASTUDY_API_DATABASE_URL", f"sqlite:///{DB_PATH.as_posix()}")
    os.environ.setdefault("GIGASTUDY_API_STORAGE_ROOT", STORAGE_ROOT.as_posix())
    os.environ.setdefault("GIGASTUDY_API_PUBLIC_APP_URL", "http://127.0.0.1:5173")
    os.environ.setdefault(
        "GIGASTUDY_API_CORS_ORIGINS",
        '["http://127.0.0.1:5173","http://localhost:5173"]',
    )


def run_migrations() -> None:
    from alembic import command  # noqa: PLC0415
    from alembic.config import Config  # noqa: PLC0415

    config = Config(str(API_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(API_DIR / "alembic"))
    command.upgrade(config, "head")


def main() -> None:
    prepare_environment()
    run_migrations()

    sys.path.insert(0, str(API_DIR / "src"))
    import uvicorn  # noqa: PLC0415

    from gigastudy_api.main import create_app  # noqa: PLC0415

    uvicorn.run(
        create_app(),
        host="127.0.0.1",
        port=8000,
        log_level="warning",
    )


if __name__ == "__main__":
    main()

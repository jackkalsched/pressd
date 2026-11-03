"""Test setup: the repo root on sys.path and .env loaded, as backend/database.py
expects. No test connects to Postgres; the one that needs a real session uses an
in-memory SQLite database."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

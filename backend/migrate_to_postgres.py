"""
Migrate data from local pressd.db (SQLite) → Supabase PostgreSQL.

Usage:
    1. Fill in DATABASE_URL in .env with your Supabase connection string.
    2. cd Press'd
    3. python backend/migrate_to_postgres.py

Safe to re-run: checks row counts before inserting and skips tables that
already have data, so you won't end up with duplicates.
"""

import os
import sys
from pathlib import Path

# Allow running as a plain script from anywhere inside the project
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

load_dotenv(ROOT / ".env")

SQLITE_PATH = ROOT / "pressd.db"

# Tables in foreign-key dependency order
TABLES = ["album", "artistmeta", "song", "songaudiofeatures"]


def _build_pg_engine():
    pg_host = os.getenv("PG_HOST")
    if not pg_host:
        print("ERROR: PG_HOST is not set in .env")
        sys.exit(1)
    url = URL.create(
        "postgresql",
        username=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD"),
        host=pg_host,
        port=int(os.getenv("PG_PORT", "5432")),
        database=os.getenv("PG_DB", "postgres"),
    )
    return create_engine(url, pool_pre_ping=True)


def migrate():
    if not SQLITE_PATH.exists():
        print(f"ERROR: SQLite DB not found at {SQLITE_PATH}")
        sys.exit(1)

    sqlite_engine = create_engine(f"sqlite:///{SQLITE_PATH}")
    pg_engine = _build_pg_engine()

    # Create tables in Postgres from the SQLModel metadata
    print("Creating tables in PostgreSQL (if not already present)...")
    from sqlmodel import SQLModel
    from backend.models import Album, Song, SongAudioFeatures, ArtistMeta  # noqa: F401 — registers metadata
    SQLModel.metadata.create_all(pg_engine)

    from sqlalchemy import inspect as sa_inspect
    pg_inspector = sa_inspect(pg_engine)

    with pg_engine.connect() as pg_conn:
        for table in TABLES:
            # Check if destination already has data
            existing = pg_conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
            if existing > 0:
                print(f"  {table}: already has {existing:,} rows — skipping")
                continue

            if table == "song":
                df = pd.read_sql(
                    "SELECT s.* FROM song s WHERE s.album_id IN (SELECT id FROM album)",
                    sqlite_engine,
                )
            elif table == "songaudiofeatures":
                df = pd.read_sql(
                    "SELECT af.* FROM songaudiofeatures af WHERE af.song_id IN (SELECT id FROM song WHERE album_id IN (SELECT id FROM album))",
                    sqlite_engine,
                )
            else:
                df = pd.read_sql(f"SELECT * FROM {table}", sqlite_engine)
            if df.empty:
                print(f"  {table}: empty in SQLite — skipping")
                continue

            # Drop columns that exist in SQLite but not in the PostgreSQL schema
            pg_col_info = pg_inspector.get_columns(table)
            pg_cols = {c["name"] for c in pg_col_info}
            extra = set(df.columns) - pg_cols
            if extra:
                print(f"  {table}: dropping SQLite-only columns {sorted(extra)}")
                df = df.drop(columns=list(extra))

            # Cast SQLite integer booleans (0/1) to Python bool for PostgreSQL
            bool_cols = [c["name"] for c in pg_col_info if "BOOL" in str(c["type"]).upper()]
            for col in bool_cols:
                if col in df.columns:
                    df[col] = df[col].astype(bool)

            df.to_sql(table, pg_conn, if_exists="append", index=False, method="multi", chunksize=500)
            pg_conn.commit()
            print(f"  {table}: migrated {len(df):,} rows")

        # Reset PostgreSQL sequences so future inserts don't collide with migrated IDs
        print("\nResetting sequences...")
        for table, pk in [("album", "id"), ("song", "id"), ("songaudiofeatures", "id"), ("artistmeta", "id")]:
            try:
                seq = f"{table}_{pk}_seq"
                pg_conn.execute(text(
                    f"SELECT setval('{seq}', COALESCE((SELECT MAX({pk}) FROM {table}), 1))"
                ))
                pg_conn.commit()
                print(f"  {table}.{pk} sequence reset")
            except Exception as e:
                print(f"  {table}.{pk} sequence reset failed (may not exist): {e}")

    print("\nMigration complete. Verify by checking row counts in Supabase.")


if __name__ == "__main__":
    migrate()

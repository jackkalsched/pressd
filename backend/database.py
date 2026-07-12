import os
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlmodel import create_engine, Session, SQLModel

load_dotenv()


def _build_engine():
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        # Render / production: single connection string
        url = database_url
    else:
        # Local dev: individual PG_* vars from .env
        pg_host = os.getenv("PG_HOST")
        if not pg_host:
            raise RuntimeError("Set DATABASE_URL or PG_HOST in .env")
        url = URL.create(
            "postgresql",
            username=os.getenv("PG_USER", "postgres"),
            password=os.getenv("PG_PASSWORD"),
            host=pg_host,
            port=int(os.getenv("PG_PORT", "5432")),
            database=os.getenv("PG_DB", "postgres"),
        )
    return create_engine(url, pool_size=5, max_overflow=10, pool_pre_ping=True, echo=False)


engine = _build_engine()


def _exec_migration(conn, stmt: str):
    """Run one idempotent migration statement. Expected idempotency errors
    (column/index already exists) stay quiet; anything else is logged so
    schema drift is never silently swallowed."""
    try:
        conn.execute(text(stmt))
        conn.commit()
    except Exception as e:
        conn.rollback()
        msg = str(e).lower()
        if "already exists" not in msg and "duplicate column" not in msg:
            print(f"[init_db] migration failed: {stmt[:80]}... -> {e}")


def init_db():
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        # Seed default user (Jack = 1) — must exist before album FK is added
        try:
            conn.execute(text("INSERT INTO pressuser (id, name) VALUES (1, 'Jack') ON CONFLICT (id) DO NOTHING"))
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"[init_db] seed user failed: {e}")

        # Disable statement timeout for DDL (Supabase pooler sets a short default)
        try:
            conn.execute(text("SET statement_timeout = 0"))
        except Exception:
            conn.rollback()  # not Postgres (e.g. sqlite in tests) — fine

        for stmt in [
            "ALTER TABLE pressuser ADD COLUMN avatar_url VARCHAR",
            "ALTER TABLE pressuser ADD COLUMN apple_sub VARCHAR",
            "ALTER TABLE pressuser ADD COLUMN email VARCHAR",
            "ALTER TABLE pressuser ADD COLUMN google_sub VARCHAR",
            "ALTER TABLE album ADD COLUMN predicted_song_mean REAL",
            "ALTER TABLE album ADD COLUMN recommended_by INTEGER",
            "ALTER TABLE album ADD COLUMN recommended_by_name VARCHAR",
            "ALTER TABLE album ADD COLUMN extra_artists TEXT",
            "ALTER TABLE album ADD COLUMN predicted_theme REAL",
            "ALTER TABLE album ADD COLUMN predicted_theme_reasoning TEXT",
            "ALTER TABLE album ADD COLUMN predicted_distinctness REAL",
            "ALTER TABLE album ADD COLUMN predicted_replay REAL",
            "ALTER TABLE album ADD COLUMN predicted_score REAL",
            "ALTER TABLE album ADD COLUMN sub_genre3 VARCHAR",
            "ALTER TABLE album ADD COLUMN user_id INTEGER",
            "ALTER TABLE invite ADD COLUMN IF NOT EXISTS permanent BOOLEAN DEFAULT FALSE",
            "ALTER TABLE invite ALTER COLUMN email SET DEFAULT ''",
            "UPDATE invite SET permanent = FALSE WHERE permanent IS NULL",
            "UPDATE album SET user_id = 1 WHERE user_id IS NULL",
            # ── Data integrity: dedupe legacy rows, then enforce uniqueness ──
            # (create_all only adds the model constraints on fresh DBs; existing
            # tables get equivalent unique indexes here)
            "DELETE FROM friendship WHERE id NOT IN (SELECT MIN(id) FROM friendship GROUP BY user_id_a, user_id_b)",
            'DELETE FROM "like" WHERE id NOT IN (SELECT MIN(id) FROM "like" GROUP BY user_id, album_id)',
            # Remove likes orphaned by album deletes that predate cascade cleanup
            'DELETE FROM "like" WHERE album_id NOT IN (SELECT id FROM album)',
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_friendship_pair ON friendship (user_id_a, user_id_b)",
            'CREATE UNIQUE INDEX IF NOT EXISTS uq_like_user_album ON "like" (user_id, album_id)',
            # ── Friend requests: pre-existing friendships stay accepted ──
            "ALTER TABLE friendship ADD COLUMN status VARCHAR DEFAULT 'accepted'",
            "ALTER TABLE friendship ADD COLUMN requested_by INTEGER",
            "UPDATE friendship SET status = 'accepted' WHERE status IS NULL",
            # ── ML worker split: shared global track store ──
            "ALTER TABLE song ADD COLUMN track_id INTEGER",
            "CREATE INDEX IF NOT EXISTS ix_song_track_id ON song (track_id)",
            # ── Profile bio ──
            "ALTER TABLE pressuser ADD COLUMN bio TEXT",
            # ── Social: recommendations as feed events ──
            "ALTER TABLE album ADD COLUMN recommended_at TIMESTAMP",
            # ── Reviews: long-form prose attached to an album rating ──
            "ALTER TABLE album ADD COLUMN review TEXT",
            "ALTER TABLE album ADD COLUMN review_at TIMESTAMP",
            # ── Per-user external-factor weights (60-point budget) ──
            "ALTER TABLE pressuser ADD COLUMN theme_pts INTEGER DEFAULT 25",
            "ALTER TABLE pressuser ADD COLUMN replay_pts INTEGER DEFAULT 15",
            "ALTER TABLE pressuser ADD COLUMN production_pts INTEGER DEFAULT 15",
            "ALTER TABLE pressuser ADD COLUMN distinctness_pts INTEGER DEFAULT 5",
            "UPDATE pressuser SET theme_pts = 25 WHERE theme_pts IS NULL",
            "UPDATE pressuser SET replay_pts = 15 WHERE replay_pts IS NULL",
            "UPDATE pressuser SET production_pts = 15 WHERE production_pts IS NULL",
            "UPDATE pressuser SET distinctness_pts = 5 WHERE distinctness_pts IS NULL",
        ]:
            _exec_migration(conn, stmt)


def get_session():
    with Session(engine) as session:
        yield session

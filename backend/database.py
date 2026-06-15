import os
from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import URL
from sqlmodel import create_engine, Session, SQLModel

load_dotenv()


def _build_engine():
    pg_host = os.getenv("PG_HOST")
    if not pg_host:
        raise RuntimeError("PG_HOST is not set — set Supabase credentials in .env")
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


def init_db():
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        # Seed default user (Jack = 1) — must exist before album FK is added
        try:
            conn.execute(text("INSERT INTO pressuser (id, name) VALUES (1, 'Jack') ON CONFLICT (id) DO NOTHING"))
            conn.commit()
        except Exception:
            pass

        # Disable statement timeout for DDL (Supabase pooler sets a short default)
        try:
            conn.execute(text("SET statement_timeout = 0"))
        except Exception:
            pass

        for stmt in [
            "ALTER TABLE album ADD COLUMN extra_artists TEXT",
            "ALTER TABLE album ADD COLUMN predicted_theme REAL",
            "ALTER TABLE album ADD COLUMN predicted_theme_reasoning TEXT",
            "ALTER TABLE album ADD COLUMN predicted_distinctness REAL",
            "ALTER TABLE album ADD COLUMN predicted_replay REAL",
            "ALTER TABLE album ADD COLUMN predicted_score REAL",
            "ALTER TABLE album ADD COLUMN sub_genre3 VARCHAR",
            "ALTER TABLE album ADD COLUMN user_id INTEGER",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists

        # Backfill any nulls in a separate transaction (Supabase pooler has statement timeout)
        try:
            conn.execute(text("UPDATE album SET user_id = 1 WHERE user_id IS NULL"))
            conn.commit()
        except Exception:
            pass


def get_session():
    with Session(engine) as session:
        yield session

"""SQLite storage for songs. One short-lived connection per call keeps it thread-safe."""

import json
import sqlite3
import time
from contextlib import contextmanager

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    status TEXT NOT NULL,          -- queued | processing | done | error
    error TEXT,
    duration REAL,
    stems TEXT NOT NULL DEFAULT '[]',
    created_at REAL NOT NULL,
    started_at REAL,
    finished_at REAL,
    notes TEXT                     -- non-fatal problems, e.g. guitar split failed
);
"""


@contextmanager
def connect():
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init():
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(songs)")}
        if "notes" not in columns:
            conn.execute("ALTER TABLE songs ADD COLUMN notes TEXT")
        # A job interrupted by a restart is simply run again.
        conn.execute("UPDATE songs SET status = 'queued', started_at = NULL WHERE status = 'processing'")


def _row(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    song = dict(row)
    song["stems"] = json.loads(song["stems"])
    return song


def create_song(song_id: str, title: str, filename: str, duration: float) -> dict:
    with connect() as conn:
        conn.execute(
            "INSERT INTO songs (id, title, filename, duration, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)",
            (song_id, title, filename, duration, time.time()),
        )
    return get_song(song_id)


def get_song(song_id: str) -> dict | None:
    with connect() as conn:
        return _row(conn.execute("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone())


def list_songs() -> list[dict]:
    with connect() as conn:
        return [_row(r) for r in conn.execute("SELECT * FROM songs ORDER BY created_at DESC")]


def next_queued() -> dict | None:
    with connect() as conn:
        return _row(
            conn.execute("SELECT * FROM songs WHERE status = 'queued' ORDER BY created_at LIMIT 1").fetchone()
        )


def update_song(song_id: str, **fields):
    if "stems" in fields:
        fields["stems"] = json.dumps(fields["stems"])
    assignments = ", ".join(f"{key} = ?" for key in fields)
    with connect() as conn:
        conn.execute(f"UPDATE songs SET {assignments} WHERE id = ?", (*fields.values(), song_id))


def delete_song(song_id: str):
    with connect() as conn:
        conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))

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
    notes TEXT,                    -- progress message while processing
    mvsep_job TEXT,                -- running MVSEP job, so a restart resumes instead of resubmitting
    origin TEXT,                   -- path in the music library, for songs added from there
    settings TEXT,                 -- player settings (mixer, loop, transpose, speed) as JSON
    bpm REAL                       -- detected tempo; 0 if detection failed, NULL if not tried yet
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
        for column, kind in (("notes", "TEXT"), ("mvsep_job", "TEXT"), ("origin", "TEXT"), ("settings", "TEXT"), ("bpm", "REAL")):
            if column not in columns:
                conn.execute(f"ALTER TABLE songs ADD COLUMN {column} {kind}")
        # A job interrupted by a restart is simply run again.
        conn.execute("UPDATE songs SET status = 'queued', started_at = NULL WHERE status = 'processing'")


def _row(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    song = dict(row)
    song["stems"] = json.loads(song["stems"])
    song["settings"] = json.loads(song["settings"]) if song["settings"] else None
    return song


def create_song(song_id: str, title: str, filename: str, duration: float, origin: str | None = None) -> dict:
    with connect() as conn:
        conn.execute(
            "INSERT INTO songs (id, title, filename, duration, origin, status, created_at)"
            " VALUES (?, ?, ?, ?, ?, 'queued', ?)",
            (song_id, title, filename, duration, origin, time.time()),
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
    for key in ("stems", "settings"):
        if key in fields:
            fields[key] = json.dumps(fields[key])
    assignments = ", ".join(f"{key} = ?" for key in fields)
    with connect() as conn:
        conn.execute(f"UPDATE songs SET {assignments} WHERE id = ?", (*fields.values(), song_id))


def delete_song(song_id: str):
    with connect() as conn:
        conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))


def next_without_bpm() -> dict | None:
    with connect() as conn:
        return _row(conn.execute("SELECT * FROM songs WHERE status = 'done' AND bpm IS NULL LIMIT 1").fetchone())

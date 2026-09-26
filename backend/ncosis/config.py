"""Settings, read from environment variables so the systemd unit can override them."""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

DATA_DIR = Path(os.environ.get("NCOSIS_DATA_DIR", BACKEND_DIR / "data"))
SONGS_DIR = DATA_DIR / "songs"
MODEL_DIR = Path(os.environ.get("NCOSIS_MODEL_DIR", DATA_DIR / "models"))
DB_PATH = DATA_DIR / "ncosis.db"

# Built PWA (web/dist). Served by the backend so production is a single service.
WEB_DIST = Path(os.environ.get("NCOSIS_WEB_DIST", BACKEND_DIR.parent / "web" / "dist"))

# htdemucs_6s: vocals, drums, bass, guitar, piano, other.
MODEL = os.environ.get("NCOSIS_MODEL", "htdemucs_6s.yaml")

# Stems are delivered to the phone as Opus to keep downloads small.
STEM_BITRATE = os.environ.get("NCOSIS_STEM_BITRATE", "160k")

MAX_UPLOAD_BYTES = int(os.environ.get("NCOSIS_MAX_UPLOAD_MB", "200")) * 1024 * 1024

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

# Demucs passes per song, averaged. audio-separator defaults to 2; 1 is ~2.4x faster
# with only a marginal quality difference.
DEMUCS_SHIFTS = int(os.environ.get("NCOSIS_DEMUCS_SHIFTS", "1"))

# Stems are delivered to the phone as Opus to keep downloads small.
STEM_BITRATE = os.environ.get("NCOSIS_STEM_BITRATE", "160k")

# Public certificate of a private CA (deploy/make-certs.sh), offered at /ca.crt so phones can
# install it. Only the certificate is served, never a key.
CA_CERT = Path(os.environ.get("NCOSIS_CA_CERT", DATA_DIR / "tls" / "ca.crt"))

MAX_UPLOAD_BYTES = int(os.environ.get("NCOSIS_MAX_UPLOAD_MB", "200")) * 1024 * 1024


def _secret(env: str, filename: str) -> str | None:
    """Read a secret from an environment variable, or from a file in the data dir."""
    if value := os.environ.get(env):
        return value.strip()
    path = DATA_DIR / filename
    return path.read_text().strip() or None if path.is_file() else None



def mvsep_token() -> str | None:
    """MVSEP (mvsep.com) API token for lead/rhythm guitar splitting. Optional; read on each
    use so adding the token file takes effect without a restart."""
    return _secret("NCOSIS_MVSEP_TOKEN", "mvsep_token")

# ncosis

Split songs into stems (vocals, drums, bass, guitar, piano, other) and play along with any of them muted.
Separation runs on a server with [Demucs](https://github.com/adefossez/demucs) `htdemucs_6s` via
[audio-separator](https://github.com/nomadkaraoke/python-audio-separator); the phone app is a PWA.

```
backend/   FastAPI + SQLite + one worker thread that separates queued songs
web/       Svelte + Vite PWA: library, stem mixer, waveform
deploy/    Debian LXC install script and systemd unit
```

## Development

```sh
# Backend (CPU-only torch)
cd backend
python3 -m venv .venv
.venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -e .
.venv/bin/uvicorn ncosis.main:app --reload --port 8000

# Frontend (proxies /api to :8000)
cd web && npm install && npm run dev
```

The first separation downloads the model (~80 MB) into `backend/data/models`.
A 4-minute song takes a few minutes on a CPU.

## Deployment (Debian 13 LXC)

Suggested container: 4+ cores, 8 GB RAM, 20 GB disk (stems are ~5 MB per stem per song as Opus).

```sh
git clone <repo> /opt/ncosis
/opt/ncosis/deploy/install.sh     # re-run after git pull to update
```

Data lives in `/var/lib/ncosis`. The app serves on port 8000.

Installing the PWA on Android (and the screen wake lock) needs HTTPS. Put a reverse proxy such as Caddy in front,
with a certificate the phone trusts (DNS challenge for a real domain, or a local CA installed on the phone).
Plain HTTP over WireGuard still works in the browser for testing.

## Configuration

Environment variables (see `backend/ncosis/config.py`):
`NCOSIS_DATA_DIR`, `NCOSIS_MODEL_DIR`, `NCOSIS_WEB_DIST`, `NCOSIS_MODEL` (default `htdemucs_6s.yaml`),
`NCOSIS_STEM_BITRATE` (default `160k`), `NCOSIS_MAX_UPLOAD_MB` (default `200`).

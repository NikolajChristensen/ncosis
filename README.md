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

### HTTPS without a domain

`deploy/make-certs.sh <dir> <server-ip>` creates a private CA and a server certificate. The CA is
name-constrained to private IPs and `localhost`, so it can't vouch for real websites. Serve with
`uvicorn ... --ssl-keyfile <dir>/server.key --ssl-certfile <dir>/server.crt`; the app offers the CA at
`/ca.crt` for installing on the phone (Android: Settings → Security → Install a certificate → CA certificate).
In development, `backend/data/tls` is used and the Vite proxy talks HTTPS to the backend.

Installing the PWA on Android (and the screen wake lock) needs HTTPS. Put a reverse proxy such as Caddy in front,
with a certificate the phone trusts (DNS challenge for a real domain, or a local CA installed on the phone).
Plain HTTP over WireGuard still works in the browser for testing.

## Lead/rhythm guitar split (optional)

Demucs only produces one guitar stem. With an [MVSEP](https://mvsep.com) API token, the server also uploads each
song to MVSEP's "Lead/Rhythm Guitar" model and replaces the guitar stem with separate lead and rhythm stems.
Songs are sent to MVSEP's servers; everything else stays local.

- Development: put the token in `backend/data/mvsep_token`.
- LXC: add `NCOSIS_MVSEP_TOKEN=...` to `/etc/ncosis.env` (root-owned, mode 600) and restart the service.

Existing songs get a "Split guitars" button in the library.

## Configuration

Environment variables (see `backend/ncosis/config.py`):
`NCOSIS_DATA_DIR`, `NCOSIS_MODEL_DIR`, `NCOSIS_WEB_DIST`, `NCOSIS_MODEL` (default `htdemucs_6s.yaml`),
`NCOSIS_DEMUCS_SHIFTS` (default `1`; `2` is slightly better and ~2.4x slower), `NCOSIS_STEM_BITRATE` (default `160k`), `NCOSIS_MAX_UPLOAD_MB` (default `200`).

## Ideas for later

- Use MVSEP's own outputs (no guitar, rhythm guitar, lead guitar) instead of Demucs. No local CPU work or
  PyTorch at all, at the cost of per-instrument control of the backing track (vocals/drums/bass become one
  stem, unless those are requested from MVSEP as well).

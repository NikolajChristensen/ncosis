# AGENTS.md

Guidance for coding agents (and humans) working on ncosis. Read README.md for setup; this file covers how the
project is built, deployed and tested, and the decisions you should not undo.

## What it is

A Moises-like practice app for playing guitar along to rock songs. The owner uses it on an Android phone as an
installed PWA. A song is separated by MVSEP into three stems — **lead guitar, rhythm guitar, backing** — and the
player lets you mute/solo/mix them, loop A-B sections, transpose, slow down without changing pitch, and see the
tempo.

## Layout

```
backend/ncosis/   FastAPI app (Python 3.11+), SQLite, one worker thread
  main.py         HTTP API; also serves the built PWA (web/dist)
  worker.py       queue: upload to MVSEP → wait → download → Opus stems → tempo detection
  mvsep.py        MVSEP API client (model "Lead/Rhythm Guitar", sep_type 101)
  audio.py        ffmpeg/ffprobe/aubio helpers
  library.py      read-only music folder for "Add from library"
  db.py           SQLite schema; new columns are added by the migration loop in init()
  config.py       settings from NCOSIS_* environment variables
web/src/          Svelte 5 + TypeScript + Vite PWA
  lib/engine.ts   Web Audio engine: sample-synced stems, loops, speed, pitch shifter
  lib/Player.svelte, Library.svelte, LibraryBrowser.svelte, Waveform.svelte
  lib/api.ts      API client and types; lib/stemCache.ts keeps stems on the device
deploy/           bootstrap.sh (one-time LXC setup), update.sh (runs on every deploy),
                  ncosis.service (systemd), make-certs.sh (local CA + server cert)
```

## Decisions — do not reverse without asking the owner

- **No local ML separation.** Demucs/PyTorch were removed on purpose: the server is a 1 GB LXC on an Intel N100
  host that is already short on RAM (Demucs peaks at ~3 GB per song). All separation goes through the MVSEP API.
  Future vocals/drums/bass stems should also come from MVSEP.
- **No Docker.** The server is a plain Debian 13 LXC with a venv and a systemd unit.
- **Keep the server tiny.** Backend deps: fastapi, uvicorn, python-multipart, requests. System packages: python3,
  ffmpeg, aubio-tools, nodejs/npm. Adding a system package means adding it to `bootstrap.sh` *and* to the
  `missing=` list in `update.sh` so existing containers get it.
- **HTTPS with a private CA, no domain.** Phones trust a name-constrained CA (private IPs + localhost only).
  Re-running `make-certs.sh` keeps the CA so phones stay trusted. Never commit keys.
- **Per-song player settings live on the server** (`songs.settings`, PUT `/api/songs/{id}/settings`) so all devices
  share them. The app owns the JSON format; the server just stores it.
- **Stem URLs carry `?v=<finished_at>`** and are served as immutable; the device cache relies on that to pick up
  reprocessed stems. Keep the version in the URL if you change how stems are served.

## Environments

| | Where | Notes |
|---|---|---|
| Production | Debian 13 LXC `ncosis`, CT 107 on Proxmox, **https://10.0.0.50** (port 443) | IP via DHCP reservation on 10.0.0.103; root SSH with key |
| Dev | the owner's laptop, `~/claude/ncosis` | 2-core i5, 8 GB — fine for builds, slow for audio decoding |
| Data (prod) | `/var/lib/ncosis` (songs, `ncosis.db`, `mvsep_token`, `tls/`) | owned by the `ncosis` service user |
| Music library (prod) | `/mnt/music`, read-only bind mount of a Synology NFS folder | `NCOSIS_LIBRARY_DIR` |
| Data (dev) | `backend/data/` | git-ignored; holds the MVSEP token and the CA — never commit |

## Deploying

```sh
git push lxc master      # deploys: post-receive hook → deploy/update.sh → rebuild, restart, health check (✅/❌)
git push origin master   # backup to GitHub (private repo)
```

- **Check the queue first.** A deploy restarts the service. Running MVSEP jobs resume after a restart (the job id is
  stored in `songs.mvsep_job`), but avoid deploying mid-separation when you can:
  `curl -s --cacert backend/data/tls/ca.crt https://10.0.0.50/api/songs` and look for `queued`/`processing`.
- `update.sh` reinstalls npm packages only when `package-lock.json` changed and issues a new TLS cert if the
  container's IP changed. A normal deploy takes ~10 s.
- Roll back with `git push -f lxc <commit>:master`.
- Phones pick up new versions automatically (the service worker reloads the app once).

## Developing

```sh
cd web && npm run check && npm run build            # always run both before committing
cd web && NCOSIS_API=https://10.0.0.50 npx vite      # dev UI against the production backend
```

- Dev builds expose the audio engine as `window.player` for debugging; production builds don't.
- Python backend locally: see README. Use a throwaway `NCOSIS_DATA_DIR` for experiments so the real library isn't
  touched, and leave out the MVSEP token unless you mean to spend a real separation job (free tier: 50/day).
- Node binds `localhost` to IPv6; point the Vite proxy at `127.0.0.1` when the backend listens on IPv4 only.

## Testing audio features

Unit tests don't exist; features are verified end to end in **headless Chromium** driven over the DevTools protocol
(`chromium --headless=new --remote-debugging-port=9333 --ignore-certificate-errors --mute-audio`, then
`Runtime.evaluate`). Techniques that worked:

- **Is playback really where the UI says?** Replace one stem's buffer with a ramp whose sample value encodes its own
  time (`value = t / 1000`), mute the others, tap the mix bus with an `AnalyserNode`, and compare the decoded audio
  position with `player.position`. Used to verify loops, seeking past B, speed changes.
- **Is the pitch right?** Feed a 440 Hz sine (as a stem buffer or an `OscillatorNode` into the bus), read the peak of
  an `AnalyserNode` (fftSize 32768), compare with `440 · 2^(semitones/12)`.
- **Two devices:** two headless instances with different `--user-data-dir` (separate storage) to test shared settings.
- Navigate to `about:blank` before each test: changing only the `#hash` doesn't reload the page, and scripts from
  the previous test keep running.
- `requestAnimationFrame` is throttled in unfocused windows, so on-screen time readouts can lag; read the engine.
- Tests that touch real songs change their server settings — reset them afterwards
  (`UPDATE songs SET settings = NULL WHERE id = ...` on the container) and say so.

## Known limitations

- Tempo detection (aubio) is sometimes off by ×2 or ×½; the player has tap tempo to correct it per song.
- The laptop's desktop file dialog (GTK portal) can't read files from SMB/CIFS shares; that's why "Add from library"
  reads the music folder on the server instead.
- The app needs the server for the song list and settings; only stems are cached on the device (30 most recent songs).
- Parked ideas the owner deferred: section detection (verse/chorus), a metronome that follows the beats, lossless
  stems for the zip download, a dev container on the N100 (host RAM is the constraint).

## Conventions

- Match the existing style: small modules, comments that explain *why*, Svelte 5 runes, no new dependencies without
  a good reason.
- Commit messages: imperative subject, a short body explaining the change.
- Keep README.md accurate when setup or deployment changes.

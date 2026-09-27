# ncosis

Split songs into **lead guitar**, **rhythm guitar** and **backing** (everything else) and play along with any of
them muted. Separation is done by [MVSEP](https://mvsep.com)'s "Lead/Rhythm Guitar" model through its API; the
server only uploads songs, stores the stems and serves the app. The phone app is a PWA with a stem mixer, A-B
loops and transpose.

```
backend/   FastAPI + SQLite + a worker thread that sends queued songs to MVSEP
web/       Svelte + Vite PWA: library, mixer, loops, transpose
deploy/    LXC bootstrap, push-to-deploy update script, systemd unit, certificate script
```

Songs are uploaded to MVSEP's servers for separation. A free MVSEP account allows 50 separations a day.

## Development

```sh
deploy/make-certs.sh backend/data/tls <laptop-ip>         # once
echo '<your MVSEP API token>' > backend/data/mvsep_token  # never commit this; data/ is git-ignored

cd backend
python3 -m venv .venv && .venv/bin/pip install -e .
.venv/bin/uvicorn ncosis.main:app --host 0.0.0.0 --port 8000 \
    --ssl-keyfile data/tls/server.key --ssl-certfile data/tls/server.crt

cd web && npm install && npm run dev    # proxies /api to the HTTPS backend on :8000
```

## Deployment (Debian 13 LXC)

A container with 2 cores, 1 GB RAM and 16 GB disk is plenty; separation doesn't run locally.

**Once:**

```sh
# 1. Packages, service user and push target with its deploy hook
ssh root@<lxc-ip> 'bash -s' < deploy/bootstrap.sh

# 2. Data, CA (so phones that trust it keep working) and the MVSEP token
rsync -a backend/data/songs backend/data/ncosis.db root@<lxc-ip>:/var/lib/ncosis/
ssh root@<lxc-ip> mkdir -p /var/lib/ncosis/tls
scp backend/data/tls/ca.crt backend/data/tls/ca.key root@<lxc-ip>:/var/lib/ncosis/tls/
scp backend/data/mvsep_token root@<lxc-ip>:/var/lib/ncosis/

# 3. Deploy
git remote add lxc root@<lxc-ip>:/srv/ncosis.git
git push lxc master
```

**Every update:** `git push lxc master`. The hook checks out the new version, reinstalls dependencies only when
they changed, rebuilds the app, restarts the service and prints ✅ or ❌. Phones pick up the new version on their
next load. Roll back with `git push -f lxc <commit>:master`.

The app runs at `https://<lxc-ip>/`. Logs: `journalctl -u ncosis -f`.

## Music library (optional)

With `NCOSIS_LIBRARY_DIR` pointing at a folder of music, the app gets an "Add from library" screen to search
it and add songs without uploading them. On the LXC the service uses `/mnt/music`: mount the share read-only on
the Proxmox host and pass it in with `pct set <ctid> -mp0 <host-path>,mp=/mnt/music,ro=1`.

## HTTPS without a domain

Transpose, installing the app, keeping the screen on and auto-updates need HTTPS. `deploy/make-certs.sh <dir> <ip>`
creates a private CA and a server certificate. The CA is name-constrained to private IPs and `localhost`, so it
can't vouch for real websites. Re-running keeps the CA and issues a new server certificate.

The app offers the CA at `/ca.crt`. Install it on Android once: Settings → Security → Encryption & credentials →
Install a certificate → CA certificate.

## Configuration

Environment variables (see `backend/ncosis/config.py`; on the LXC put them in `/etc/ncosis.env`):
`NCOSIS_DATA_DIR`, `NCOSIS_WEB_DIST`, `NCOSIS_MVSEP_TOKEN` (instead of the `mvsep_token` file),
`NCOSIS_LIBRARY_DIR`, `NCOSIS_STEM_BITRATE` (default `160k`), `NCOSIS_MAX_UPLOAD_MB` (default `200`), `NCOSIS_CA_CERT`.

## Ideas for later

- Separate vocals/drums/bass for the backing track, via another MVSEP model.
- Keep lossless stems for the "download all stems" zip (currently converted from the Opus stems).

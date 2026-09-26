"""HTTP API plus static hosting of the built PWA."""

import logging
import shutil
import subprocess
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, mvsep, separation, worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    config.SONGS_DIR.mkdir(parents=True, exist_ok=True)
    worker.start()
    yield


app = FastAPI(title="ncosis", lifespan=lifespan)


def _song_or_404(song_id: str) -> dict:
    song = db.get_song(song_id)
    if song is None:
        raise HTTPException(404, "Song not found")
    return song


@app.get("/api/config")
def get_config():
    return {"guitarSplit": mvsep.enabled()}


@app.get("/api/songs")
def list_songs():
    return db.list_songs()


@app.get("/api/songs/{song_id}")
def get_song(song_id: str):
    return _song_or_404(song_id)


@app.post("/api/songs", status_code=201)
def upload_song(file: UploadFile):
    song_id = uuid.uuid4().hex[:12]
    song_dir = config.SONGS_DIR / song_id
    song_dir.mkdir(parents=True)
    name = Path(file.filename or "upload").name
    filename = "source" + Path(name).suffix.lower()
    try:
        with open(song_dir / filename, "wb") as out:
            size = 0
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > config.MAX_UPLOAD_BYTES:
                    raise HTTPException(413, f"File is larger than {config.MAX_UPLOAD_BYTES // 2**20} MB")
                out.write(chunk)
        try:
            info = separation.probe(song_dir / filename)
        except (subprocess.CalledProcessError, KeyError, ValueError):
            raise HTTPException(400, "Not a readable audio file")
    except BaseException:
        shutil.rmtree(song_dir, ignore_errors=True)
        raise

    if info["artist"] and info["title"]:
        title = f"{info['artist']} – {info['title']}"
    else:
        title = info["title"] or Path(name).stem
    song = db.create_song(song_id, title, filename, info["duration"])
    worker.notify()
    return song


@app.post("/api/songs/{song_id}/retry")
def retry_song(song_id: str):
    """Re-run whatever a song is missing: a failed separation, or the lead/rhythm guitar split."""
    song = _song_or_404(song_id)
    missing_split = mvsep.enabled() and "lead" not in song["stems"]
    if not (song["status"] == "error" or (song["status"] == "done" and missing_split)):
        raise HTTPException(409, "Nothing to retry for this song")
    db.update_song(song_id, status="queued", error=None, started_at=None, finished_at=None)
    worker.notify()
    return db.get_song(song_id)


@app.delete("/api/songs/{song_id}", status_code=204)
def delete_song(song_id: str):
    _song_or_404(song_id)
    db.delete_song(song_id)
    shutil.rmtree(config.SONGS_DIR / song_id, ignore_errors=True)


@app.get("/api/songs/{song_id}/stems/{stem}.opus")
def get_stem(song_id: str, stem: str):
    song = _song_or_404(song_id)
    if stem not in song["stems"]:
        raise HTTPException(404, "Stem not found")
    # Stems never change once written, so the phone may cache them forever.
    return FileResponse(
        config.SONGS_DIR / song_id / "stems" / f"{stem}.opus",
        media_type="audio/ogg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/ca.crt")
def get_ca_cert():
    if not config.CA_CERT.is_file():
        raise HTTPException(404, "No local CA configured")
    return FileResponse(config.CA_CERT, media_type="application/x-x509-ca-cert", filename="ncosis-ca.crt")


if config.WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.WEB_DIST, html=True), name="web")

"""HTTP API plus static hosting of the built PWA."""

import logging
import shutil
import re
import subprocess
import tempfile
import uuid
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from starlette.background import BackgroundTask
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import audio, config, db, mvsep, worker

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
    return {"version": config.version(), "mvsepConfigured": config.mvsep_token() is not None}


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
            info = audio.probe(song_dir / filename)
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
    """Separate a song again: after a failure, or to get the current set of stems."""
    song = _song_or_404(song_id)
    if song["status"] not in ("error", "done"):
        raise HTTPException(409, "Song is already being processed")
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


STEM_TITLES = {"lead": "Lead guitar", "rhythm": "Rhythm guitar", "backing": "Backing (no guitar)"}


@app.get("/api/songs/{song_id}/stems.zip")
def download_stems(song_id: str):
    """All stems as 16-bit FLAC in a zip, for importing into a DAW (few DAWs read Opus)."""
    song = _song_or_404(song_id)
    if song["status"] != "done":
        raise HTTPException(409, "Song is not separated yet")
    name = re.sub(r'[\\/:*?"<>|]', "_", song["title"]).strip() or song_id
    work = Path(tempfile.mkdtemp(dir=config.DATA_DIR / "work"))
    try:
        archive = work / "stems.zip"
        # FLAC is already compressed, so the zip just stores it.
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as z:
            for stem in song["stems"]:
                flac = work / f"{stem}.flac"
                audio.to_flac(config.SONGS_DIR / song_id / "stems" / f"{stem}.opus", flac)
                z.write(flac, f"{name} - {STEM_TITLES.get(stem, stem.capitalize())}.flac")
                flac.unlink()
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    return FileResponse(
        archive,
        media_type="application/zip",
        filename=f"{name} - stems.zip",
        background=BackgroundTask(shutil.rmtree, work, ignore_errors=True),
    )


@app.get("/ca.crt")
def get_ca_cert():
    if not config.CA_CERT.is_file():
        raise HTTPException(404, "No local CA configured")
    return FileResponse(config.CA_CERT, media_type="application/x-x509-ca-cert", filename="ncosis-ca.crt")


if config.WEB_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.WEB_DIST, html=True), name="web")

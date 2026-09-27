"""Background thread that sends queued songs to MVSEP one at a time (free accounts get one concurrent job)."""

import logging
import shutil
import threading
import time

from . import audio, config, db, mvsep

log = logging.getLogger(__name__)

_wake = threading.Event()


def notify():
    """Tell the worker a new song is queued."""
    _wake.set()


def start():
    threading.Thread(target=_run, name="separation-worker", daemon=True).start()


def _run():
    while True:
        song = db.next_queued()
        if song is not None:
            _process(song)
        elif (song := db.next_without_bpm()) is not None:
            # Songs from before tempo detection existed get it while nothing else is queued.
            _detect_bpm(song)
        else:
            _wake.wait(timeout=60)
            _wake.clear()


def _process(song: dict):
    song_id = song["id"]
    stems_dir = config.SONGS_DIR / song_id / "stems"
    db.update_song(song_id, status="processing", started_at=time.time(), error=None, notes=None)
    log.info("Processing %s (%s)", song_id, song["title"])
    work = config.DATA_DIR / "work" / song_id
    try:
        work.mkdir(parents=True, exist_ok=True)
        stems_dir.mkdir(exist_ok=True)
        # After a restart, pick up the job already running at MVSEP instead of sending the song again.
        job = song["mvsep_job"]
        if job:
            log.info("Resuming MVSEP job %s", job)
        else:
            job = mvsep.submit(config.SONGS_DIR / song_id / song["filename"])
            db.update_song(song_id, mvsep_job=job)
        results = mvsep.fetch(job, work, on_wait=lambda msg: db.update_song(song_id, notes=msg))
        for stem, path in results.items():
            audio.to_opus(path, stems_dir / f"{stem}.opus")
        # Remove stems from an earlier run that this one didn't produce.
        for old in stems_dir.glob("*.opus"):
            if old.stem not in results:
                old.unlink()
        db.update_song(song_id, status="done", stems=sorted(results), notes=None, mvsep_job=None, finished_at=time.time())
        _detect_bpm(db.get_song(song_id))
        log.info("Finished %s in %.0fs", song_id, time.time() - db.get_song(song_id)["started_at"])
    except Exception as e:
        log.exception("Separation failed for %s", song_id)
        db.update_song(
            song_id, status="error", error=str(e) or type(e).__name__, notes=None, mvsep_job=None, finished_at=time.time()
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _detect_bpm(song: dict):
    try:
        bpm = audio.detect_bpm(config.SONGS_DIR / song["id"] / song["filename"])
    except Exception:
        log.exception("Tempo detection failed for %s", song["id"])
        bpm = None
    db.update_song(song["id"], bpm=bpm or 0)
    log.info("Tempo of %s: %s bpm", song["title"], bpm)

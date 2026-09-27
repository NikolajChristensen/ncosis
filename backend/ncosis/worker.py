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
        if song is None:
            _wake.wait(timeout=60)
            _wake.clear()
            continue
        _process(song)


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
        log.info("Finished %s in %.0fs", song_id, time.time() - db.get_song(song_id)["started_at"])
    except Exception as e:
        log.exception("Separation failed for %s", song_id)
        db.update_song(
            song_id, status="error", error=str(e) or type(e).__name__, notes=None, mvsep_job=None, finished_at=time.time()
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)

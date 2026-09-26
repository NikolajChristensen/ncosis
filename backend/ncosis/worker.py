"""Background thread that separates queued songs one at a time (separation is CPU-heavy)."""

import logging
import shutil
import threading
import time

from . import config, db, mvsep, separation

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


# Stems that only Demucs produces; if they exist, the local separation already ran.
DEMUCS_STEMS = {"vocals", "drums", "bass", "other"}


def _process(song: dict):
    """Run whatever separation steps a song is still missing. Safe to re-run."""
    song_id = song["id"]
    song_dir = config.SONGS_DIR / song_id
    stems_dir = song_dir / "stems"
    source = song_dir / song["filename"]
    stems = set(song["stems"])
    notes = None
    db.update_song(song_id, status="processing", started_at=time.time(), error=None, notes=None)
    log.info("Processing %s (%s)", song_id, song["title"])

    # Start the MVSEP upload first so their server works while Demucs runs here.
    job = None
    if mvsep.enabled() and not {"lead", "rhythm"} <= stems:
        try:
            job = mvsep.submit(source)
        except Exception as e:
            log.exception("MVSEP upload failed for %s", song_id)
            notes = f"Guitar split failed: {e}"

    work = config.DATA_DIR / "work" / song_id
    try:
        work.mkdir(parents=True, exist_ok=True)
        stems_dir.mkdir(exist_ok=True)
        if not DEMUCS_STEMS <= stems:
            wav = work / "input.wav"
            separation.to_wav(source, wav)
            for stem, path in separation.separate(wav, song_id).items():
                separation.to_opus(path, stems_dir / f"{stem}.opus")
                path.unlink()
                stems.add(stem)

        if job:
            try:
                for stem, path in mvsep.fetch(job, work).items():
                    separation.to_opus(path, stems_dir / f"{stem}.opus")
                    stems.add(stem)
                # Lead + rhythm replace the combined guitar stem (its file is kept as a fallback).
                stems.discard("guitar")
            except Exception as e:
                log.exception("MVSEP separation failed for %s", song_id)
                notes = f"Guitar split failed: {e}"

        db.update_song(song_id, status="done", stems=sorted(stems), notes=notes, finished_at=time.time())
        log.info("Finished %s in %.0fs", song_id, time.time() - db.get_song(song_id)["started_at"])
    except Exception as e:
        log.exception("Separation failed for %s", song_id)
        db.update_song(song_id, status="error", error=str(e) or type(e).__name__, finished_at=time.time())
    finally:
        shutil.rmtree(work, ignore_errors=True)

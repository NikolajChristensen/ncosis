"""Background thread that separates queued songs one at a time (separation is CPU-heavy)."""

import logging
import threading
import time

from . import config, db, separation

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
    song_dir = config.SONGS_DIR / song_id
    db.update_song(song_id, status="processing", started_at=time.time(), error=None)
    log.info("Separating %s (%s)", song_id, song["title"])
    wav = config.DATA_DIR / "work" / f"{song_id}-input.wav"
    stem_wavs = {}
    try:
        wav.parent.mkdir(parents=True, exist_ok=True)
        separation.to_wav(song_dir / song["filename"], wav)
        stem_wavs = separation.separate(wav, song_id)
        stems_dir = song_dir / "stems"
        stems_dir.mkdir(exist_ok=True)
        for stem, path in stem_wavs.items():
            separation.to_opus(path, stems_dir / f"{stem}.opus")
        db.update_song(song_id, status="done", stems=sorted(stem_wavs), finished_at=time.time())
        log.info("Finished %s in %.0fs", song_id, time.time() - db.get_song(song_id)["started_at"])
    except Exception as e:
        log.exception("Separation failed for %s", song_id)
        db.update_song(song_id, status="error", error=str(e) or type(e).__name__, finished_at=time.time())
    finally:
        wav.unlink(missing_ok=True)
        for path in stem_wavs.values():
            path.unlink(missing_ok=True)

"""Audio conversion (ffmpeg) and stem separation (audio-separator + Demucs)."""

import json
import logging
import subprocess
import threading
from pathlib import Path

from . import config

log = logging.getLogger(__name__)

STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"]

_separator = None
_separator_lock = threading.Lock()


def probe(path: Path) -> dict:
    """Return duration and tags of an audio file, or raise if ffmpeg can't read it."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    fmt = json.loads(out.stdout).get("format", {})
    tags = {k.lower(): v for k, v in fmt.get("tags", {}).items()}
    return {"duration": float(fmt["duration"]), "artist": tags.get("artist"), "title": tags.get("title")}


def to_wav(src: Path, dst: Path):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "2", "-ar", "44100", str(dst)],
        check=True, capture_output=True,
    )


def to_opus(src: Path, dst: Path):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c:a", "libopus", "-b:a", config.STEM_BITRATE, str(dst)],
        check=True, capture_output=True,
    )


def to_flac(src: Path, dst: Path):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c:a", "flac", "-sample_fmt", "s16", "-ar", "44100", str(dst)],
        check=True, capture_output=True,
    )


def _get_separator():
    """Load the model once; it takes a while and is reused for every song."""
    global _separator
    if _separator is None:
        from audio_separator.separator import Separator

        work = config.DATA_DIR / "work"
        work.mkdir(parents=True, exist_ok=True)
        config.MODEL_DIR.mkdir(parents=True, exist_ok=True)
        sep = Separator(
            output_dir=str(work),
            model_file_dir=str(config.MODEL_DIR),
            output_format="WAV",
            demucs_params={"segment_size": "Default", "shifts": config.DEMUCS_SHIFTS, "overlap": 0.25, "segments_enabled": True},
        )
        sep.load_model(model_filename=config.MODEL)
        _separator = sep
    return _separator


def separate(wav: Path, song_id: str) -> dict[str, Path]:
    """Split `wav` into stems. Returns {stem name: wav path} inside the work dir."""
    with _separator_lock:
        sep = _get_separator()
        names = {stem: f"{song_id}-{stem}" for stem in STEM_NAMES}
        outputs = sep.separate(str(wav), custom_output_names=names)

    work = Path(sep.output_dir)
    stems = {}
    for out in outputs:
        path = Path(out) if Path(out).is_absolute() else work / out
        stem = path.stem.removeprefix(f"{song_id}-")
        stems[stem] = path
    return stems

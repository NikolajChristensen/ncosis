"""Audio probing and conversion with ffmpeg."""

import json
import re
import subprocess
from pathlib import Path

from . import config


def probe(path: Path) -> dict:
    """Return duration and tags of an audio file, or raise if ffmpeg can't read it."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags", "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    fmt = json.loads(out.stdout).get("format", {})
    tags = {k.lower(): v for k, v in fmt.get("tags", {}).items()}
    return {"duration": float(fmt["duration"]), "artist": tags.get("artist"), "title": tags.get("title")}


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


def detect_bpm(path: Path) -> float | None:
    """Estimate the tempo with aubio. Can be off by a factor of two, which the app lets
    the user correct with tap tempo."""
    out = subprocess.run(["aubio", "tempo", "-i", str(path)], capture_output=True, text=True, timeout=120)
    found = re.findall(r"([\d.]+)\s*bpm", out.stdout)
    bpm = float(found[-1]) if found else 0
    return round(bpm, 1) if 30 <= bpm <= 300 else None

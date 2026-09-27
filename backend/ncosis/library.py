"""The user's own music folder (read-only), browsable from the app."""

import os
import time
from pathlib import Path

from . import config

AUDIO_SUFFIXES = {".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".aif", ".aiff"}
CACHE_SECONDS = 60

_cache: tuple[float, list[str]] | None = None


def enabled() -> bool:
    return config.LIBRARY_DIR is not None and config.LIBRARY_DIR.is_dir()


def files() -> list[str]:
    """Audio files in the library as paths relative to it, sorted. Cached briefly; scanning a
    network share is slow."""
    global _cache
    if _cache and time.time() - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    root = config.LIBRARY_DIR
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if not name.startswith(".") and Path(name).suffix.lower() in AUDIO_SUFFIXES:
                found.append(str((Path(dirpath) / name).relative_to(root)))
    found.sort(key=str.lower)
    _cache = (time.time(), found)
    return found


def resolve(rel: str) -> Path:
    """The file for a library-relative path; refuses anything outside the library."""
    root = config.LIBRARY_DIR.resolve()
    path = (root / rel).resolve()
    if not path.is_relative_to(root) or path.suffix.lower() not in AUDIO_SUFFIXES or not path.is_file():
        raise ValueError(f"not a song in the library: {rel}")
    return path

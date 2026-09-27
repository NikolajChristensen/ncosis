"""Stem separation through the MVSEP API (https://mvsep.com/en/full_api)."""

import logging
import re
import time
from collections.abc import Callable
from pathlib import Path

import requests

from . import config

log = logging.getLogger(__name__)

API = "https://mvsep.com/api"
LEAD_RHYTHM_GUITAR = 101  # "MVSep Lead/Rhythm Guitar"
TWO_STAGE_MODEL = "0"  # the better of its two model types
FLAC = 2
POLL_SECONDS = 5
TIMEOUT_SECONDS = 60 * 60

# MVSEP output type → our stem name. Its "all guitar" output isn't needed.
OUTPUTS = [
    (re.compile(r"\blead\b"), "lead"),
    (re.compile(r"\brhythm\b"), "rhythm"),
    (re.compile(r"\bno[\s_-]?guitar\b"), "backing"),
]
STEMS = {stem for _, stem in OUTPUTS}


class MvsepError(Exception):
    pass


def submit(audio: Path) -> str:
    """Upload a song for separation. Returns the job hash."""
    token = config.mvsep_token()
    if not token:
        raise MvsepError("no MVSEP API token configured")
    with open(audio, "rb") as f:
        res = requests.post(
            f"{API}/separation/create",
            data={
                "api_token": token,
                "sep_type": LEAD_RHYTHM_GUITAR,
                "add_opt1": TWO_STAGE_MODEL,
                "output_format": FLAC,
            },
            files={"audiofile": (audio.name, f)},
            timeout=600,
        )
    body = _json(res)
    if not body.get("success"):
        raise MvsepError(body.get("data", {}).get("message") or f"upload failed ({res.status_code})")
    return body["data"]["hash"]


def fetch(job: str, dest: Path, on_wait: Callable[[str], None] = lambda _: None) -> dict[str, Path]:
    """Wait for a job, reporting progress through `on_wait`, then download its stems.
    Returns {stem name: path}."""
    deadline = time.time() + TIMEOUT_SECONDS
    while True:
        body = _json(requests.get(f"{API}/separation/get", params={"hash": job}, timeout=60))
        status, data = body.get("status"), body.get("data", {})
        if status == "done":
            break
        if status == "failed" or not body.get("success"):
            raise MvsepError(data.get("message") or "separation failed")
        if time.time() > deadline:
            raise MvsepError("timed out waiting for MVSEP")
        if status == "waiting" and data.get("current_order"):
            on_wait(f"In MVSEP queue: position {data['current_order']}")
        elif status == "processing":
            on_wait("MVSEP is separating")
        time.sleep(POLL_SECONDS)

    stems = {}
    for file in data["files"]:
        kind = (file.get("type") or file.get("name") or "").lower()
        stem = next((stem for pattern, stem in OUTPUTS if pattern.search(kind)), None)
        if stem is None:
            continue
        path = dest / f"{stem}.flac"
        with requests.get(file["url"], stream=True, timeout=300) as res:
            res.raise_for_status()
            with open(path, "wb") as out:
                for chunk in res.iter_content(1 << 20):
                    out.write(chunk)
        stems[stem] = path
    if set(stems) != STEMS:
        raise MvsepError(f"unexpected outputs: {[f.get('type') for f in data['files']]}")
    return stems


def _json(res: requests.Response) -> dict:
    try:
        return res.json()
    except ValueError:
        raise MvsepError(f"unexpected response ({res.status_code})")

"""Lead/rhythm guitar separation through the MVSEP API (https://mvsep.com/en/full_api)."""

import logging
import time
from pathlib import Path

import requests

from . import config

log = logging.getLogger(__name__)

API = "https://mvsep.com/api"
LEAD_RHYTHM_GUITAR = 101  # "MVSep Lead/Rhythm Guitar"
TWO_STAGE_MODEL = "0"  # the better of its two model types
FLAC = 2
POLL_SECONDS = 5
TIMEOUT_SECONDS = 45 * 60


class MvsepError(Exception):
    pass


def enabled() -> bool:
    return config.mvsep_token() is not None


def submit(audio: Path) -> str:
    """Upload a song for lead/rhythm separation. Returns the job hash."""
    with open(audio, "rb") as f:
        res = requests.post(
            f"{API}/separation/create",
            data={
                "api_token": config.mvsep_token(),
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


def fetch(job: str, dest: Path) -> dict[str, Path]:
    """Wait for a job to finish and download its stems. Returns {"lead"|"rhythm": path}."""
    deadline = time.time() + TIMEOUT_SECONDS
    while True:
        body = _json(requests.get(f"{API}/separation/get", params={"hash": job}, timeout=60))
        status = body.get("status")
        if status == "done":
            break
        if status == "failed" or not body.get("success"):
            raise MvsepError(body.get("data", {}).get("message") or "separation failed")
        if time.time() > deadline:
            raise MvsepError("timed out waiting for MVSEP")
        time.sleep(POLL_SECONDS)

    stems = {}
    for file in body["data"]["files"]:
        label = f"{file.get('type', '')} {file.get('name', '')}".lower()
        # Outputs are lead guitar, rhythm guitar, all guitar and no guitar; we want the first two.
        stem = "lead" if "lead" in label else "rhythm" if "rhythm" in label else None
        if stem is None:
            continue
        path = dest / f"{stem}.flac"
        with requests.get(file["url"], stream=True, timeout=300) as res:
            res.raise_for_status()
            with open(path, "wb") as out:
                for chunk in res.iter_content(1 << 20):
                    out.write(chunk)
        stems[stem] = path
    if set(stems) != {"lead", "rhythm"}:
        raise MvsepError(f"unexpected outputs: {[f.get('type') for f in body['data']['files']]}")
    return stems


def _json(res: requests.Response) -> dict:
    try:
        return res.json()
    except ValueError:
        raise MvsepError(f"unexpected response ({res.status_code})")

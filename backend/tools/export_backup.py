#!/usr/bin/env python3
"""Export all finished songs (metadata, settings, source files, stems) into a portable backup
archive for the Capacitor app's "Import backup" flow.

Read-only against NCOSIS_DATA_DIR — run it against a copy of the data, not the live LXC:

    rsync -a root@10.0.0.50:/var/lib/ncosis/ncosis.db  /tmp/ncosis-export/ncosis.db
    rsync -a root@10.0.0.50:/var/lib/ncosis/songs/     /tmp/ncosis-export/songs/
    NCOSIS_DATA_DIR=/tmp/ncosis-export python3 backend/tools/export_backup.py ncosis-backup.zip
"""

import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ncosis import config, db  # noqa: E402


def main(out_path: str):
    songs = [s for s in db.list_songs() if s["status"] == "done"]
    manifest = {
        "schemaVersion": 1,
        "songs": [
            {
                "id": s["id"],
                "title": s["title"],
                "filename": s["filename"],
                "duration": s["duration"],
                "stems": s["stems"],
                "stemFormat": "opus",
                "createdAt": s["created_at"],
                "finishedAt": s["finished_at"],
                "bpm": s["bpm"],
                "settings": s["settings"],
            }
            for s in songs
        ],
    }
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_STORED) as z:
        z.writestr("manifest.json", json.dumps(manifest))
        for s in manifest["songs"]:
            song_dir = config.SONGS_DIR / s["id"]
            z.write(song_dir / s["filename"], f"songs/{s['id']}/{s['filename']}")
            for stem in s["stems"]:
                z.write(song_dir / "stems" / f"{stem}.opus", f"songs/{s['id']}/stems/{stem}.opus")
    print(f"Exported {len(manifest['songs'])} song(s) to {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(f"Usage: {sys.argv[0]} <output.zip>")
    main(sys.argv[1])

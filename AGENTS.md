# AGENTS.md

Guidance for coding agents (and humans) working on ncosis. Read README.md for setup; this file covers how the
project is built, tested and distributed, and the decisions you should not undo.

## What it is

A Moises-like practice app for playing guitar along to rock songs. The owner uses it on an Android phone as a
sideloaded APK; a friend has their own sideloaded install too. A song is separated by MVSEP into three stems —
**lead guitar, rhythm guitar, backing** — and the player lets you mute/solo/mix them, loop A-B sections, transpose,
slow down without changing pitch, and see the tempo.

There is **no server**. The app is a Svelte web UI wrapped in Capacitor as a native Android app; it talks to
MVSEP's API directly over native HTTP, and all data (song list, settings, stems) lives on the device.

## Layout

```
web/src/          Svelte 5 + TypeScript + Vite app
  lib/engine.ts        Web Audio engine: sample-synced stems, loops, speed, pitch shifter
  lib/songStore.ts      song index + settings, via @capacitor/preferences (replaces a SQLite table)
  lib/stemStorage.ts    source/stem files on disk, via @capacitor/filesystem (replaces SONGS_DIR)
  lib/mvsep.ts          MVSEP API client (model "Lead/Rhythm Guitar", sep_type 101), fetch()-based
  lib/separation.ts     one-song-at-a-time queue loop, runs in-page while the app is open
  lib/audioAnalysis.ts  tempo detection (web-audio-beat-detector), replaces an aubio shell-out
  lib/settings.ts       this device's own MVSEP token, via @capacitor/preferences
  lib/importBackup.ts   one-time import of a backup zip exported from the old server (see below)
  lib/api.ts            thin facade over the above, keeping the same shape the UI always used
  lib/Player.svelte, Library.svelte, Settings.svelte, Waveform.svelte
web/android/       Capacitor's native Android project (Gradle). Keep this in source control; only
                   local.properties, release.jks and keystore.properties are git-ignored.
web/capacitor.config.ts   CapacitorHttp.enabled: true — routes MVSEP calls through native Android
                          networking instead of the WebView's fetch, since mvsep.com sends no CORS
                          headers at all and a plain fetch would be blocked.
tools/setup-signing.sh    one-time: generates the release keystore and pushes it to GitHub secrets
```

## Decisions — do not reverse without asking the owner

- **No backend, no server, no LXC.** The previous architecture (FastAPI + SQLite + a worker thread on a Debian
  LXC) was deliberately removed so there is nothing to host, patch or pay for. Don't reintroduce a server-side
  component (including a relay/proxy) without asking — that was explicitly rejected because it would mean
  sharing the owner's MVSEP token/quota with anyone else using the app, and owning infra for someone else.
- **Each install has its own MVSEP token**, entered via Settings and stored locally
  (`@capacitor/preferences`). Never hardcode a token into the app or commit one.
- **CapacitorHttp bypasses CORS, not a relay.** MVSEP calls go through native Android networking
  (`capacitor.config.ts`'s `CapacitorHttp.enabled`), confirmed via source to route same-origin/local requests
  straight through and external ones via a native proxy — no server-side component needed.
- **All data is on-device only, with no automatic eviction.** Songs/settings/stems are the only copy (unlike the
  old 30-song LRU cache, which could safely evict because the server could re-supply them) — don't add silent
  deletion; a storage-management UI would need to be explicit.
- **Local file reads go through `Capacitor.convertFileSrc()` + `fetch()`, not `Filesystem.readFile()`.** Confirmed
  on-device that `Filesystem.readFile()` (even chunked) moves data as base64 across the JS↔native plugin bridge,
  which is both slow and was the direct cause of an `OutOfMemoryError` crash when done in one call. `convertFileSrc`
  lets the WebView's own native file loader stream the file directly, bypassing the bridge entirely for local
  reads. Writes still need `Filesystem.writeFile`/`appendFile` (chunked, see `stemStorage.ts`) since there's no
  equivalent native write path.
- **Stem downloads from MVSEP go through `@capacitor/file-transfer`'s `downloadFile()`**, straight from the
  network to disk, never through JS memory — this is what made large FLAC stems safe to download at all.
- **`android:largeHeap="true"` is required** (`AndroidManifest.xml`). Capacitor's WebView runs inside the
  Android app's own heap (much smaller than a normal mobile browser tab gets), and a few minutes of decoded
  stem audio across 3 stems can exceed the default ~256MB limit.
- **Stems load one at a time, not in parallel** (`StemPlayer.loadStem`, called in a loop from `Player.svelte`),
  to keep peak memory to roughly one stem's decoded buffer instead of three.
- **Builds are signed with a fixed key** (`tools/setup-signing.sh`, secrets `KEYSTORE_BASE64`/`KEYSTORE_PASSWORD`).
  Without this, every CI run's debug key differs and Android refuses to install an update over the last one.
- **"Add from library" is gone.** A sandboxed Android app has no access to an arbitrary NFS/SMB folder the way
  the old server did; don't try to re-add it without a real plan for file access.
- **Stems stay in whatever format they came in** — FLAC for anything separated on-device (what MVSEP returns),
  Opus for songs migrated from the old server. Both decode identically via `decodeAudioData`; don't add a
  transcode step "to be consistent" unless storage actually becomes a problem.

## Environments

| | Where | Notes |
|---|---|---|
| Dev | the owner's laptop, `~/claude/ncosis` | Android SDK cmdline-tools under `~/android-sdk`; JDK 21 required (not whatever `java` defaults to — Gradle 8.14 doesn't support newer JDKs) |
| Distribution | GitHub Releases, tag `latest` | `.github/workflows/build.yml` builds + signs on every push to `master`, uploads `ncosis.apk`; sideload from the repo's Releases page (public repo, no login needed) |
| Signing key | `web/android/release.jks` + `keystore.properties` (git-ignored, local) and the `KEYSTORE_BASE64`/`KEYSTORE_PASSWORD` GitHub secrets | regenerate with `tools/setup-signing.sh`; losing both copies means future updates can never again install over an existing one |
| MVSEP token (dev/testing) | entered in-app via Settings, per device | not an env var or file anymore — there's no server process to read one |

## Testing on a device

There's no emulator set up here (none needed for day-to-day work); test on a real phone over USB:

```sh
export ANDROID_HOME=~/android-sdk
export PATH="$ANDROID_HOME/platform-tools:$PATH"
adb devices          # phone must have USB debugging enabled and the RSA prompt accepted
adb logcat -c && adb logcat -v time | grep -iE "ncosis|FATAL|OutOfMemory"   # live crash/OOM watch
```

Building: `cd web && npm run build && npx cap sync android`, then `cd android && ./gradlew assembleDebug`
(no signing needed) or `assembleRelease` (needs `KEYSTORE_FILE`/`KEYSTORE_PASSWORD` env vars or
`keystore.properties`) with `JAVA_HOME` pointed at JDK 21. Install with `adb install -r <apk>`, or push to a
GitHub prerelease and download on-phone if USB isn't convenient.

A desktop/headless-Chromium testing technique doesn't apply anymore — the app depends on native Capacitor
plugins (Preferences, Filesystem, FileTransfer, CapacitorHttp) that don't exist outside a real Android WebView,
so audio-engine logic that's pure Web Audio can still be poked in a browser, but anything touching storage or
MVSEP needs a real device.

## Developing

```sh
cd web && npm run check && npm run build && npx cap sync android    # always run before committing
```

- `npm run dev` (plain `vite`) still works for UI-only iteration in a desktop browser, but MVSEP calls will
  CORS-fail there (expected — that's exactly why CapacitorHttp exists) and Capacitor plugins will silently no-op
  or use their web fallback, so storage/separation can't be exercised outside the app.
- `web/android/` is a real part of the project, not pure build output — `npx cap sync android` updates it from
  `web/dist` and the plugin list, but manual edits (signing config in `app/build.gradle`,
  `android:largeHeap` in `AndroidManifest.xml`) survive a sync and should stay that way.

## Migrating data from the old server

The old FastAPI/SQLite backend is gone, but `backend/tools/export_backup.py` (recoverable from git history —
`git log --all --diffstat -- backend/tools/export_backup.py`, from before the backend directory was deleted)
built a portable zip from a copy of the old `/var/lib/ncosis` data, and `web/src/lib/importBackup.ts` reads one
back in via Settings → "Import backup". This was a one-time migration, already run for the owner's existing
songs; it's dead code now unless a similar migration is ever needed again (e.g. restoring a specific device's
data onto a new phone some other way).

## Known limitations

- Tempo detection (`web-audio-beat-detector`) is sometimes off by ×2 or ×½, same caveat as the old aubio-based
  detector; the player has tap tempo to correct it per song.
- MVSEP's free tier queue can take anywhere from under a minute to several minutes per song, independent of
  anything in this app.
- Separation only progresses while the app is open — MVSEP keeps processing server-side regardless, and
  reopening the app resumes polling via a persisted job hash rather than resubmitting, but there's no Android
  foreground service to keep it going while fully backgrounded.
- No cross-device sync. Settings, songs and stems are local to each phone; the old "share state across devices"
  behavior was an explicit, deliberate trade for not needing a server.
- An uninstall wipes everything (token, songs, settings, stems) — there's no backend to fall back on. The backup
  export/import flow covers a deliberate device switch, not an accidental uninstall.
- Parked ideas the owner deferred: section detection (verse/chorus), a metronome that follows the beats, an
  Android foreground service for background separation.

## Conventions

- Match the existing style: small modules, comments that explain *why*, Svelte 5 runes, no new dependencies
  without a good reason.
- Commit messages: imperative subject, a short body explaining the change.
- Keep README.md accurate when setup or distribution changes.

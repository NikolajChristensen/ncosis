# ncosis

Split songs into **lead guitar**, **rhythm guitar** and **backing** (everything else) and play along with any of
them muted. Separation is done by [MVSEP](https://mvsep.com)'s "Lead/Rhythm Guitar" model, called directly from
the app. There's no server — ncosis is a Svelte web app wrapped as a native Android app with
[Capacitor](https://capacitorjs.com), with a stem mixer, A-B loops, transpose and tap tempo.

```
web/src/     Svelte + TypeScript app: library, mixer, loops, transpose; storage via Capacitor plugins
web/android/ Capacitor's native Android project (Gradle) — part of the repo, not just build output
tools/       tools/setup-signing.sh: one-time release-signing key setup
```

Songs are uploaded to MVSEP's servers for separation. A free MVSEP account allows 50 separations a day; each
person who installs the app needs their own MVSEP account/token (entered in-app, under Settings).

## Installing

Download `ncosis.apk` from the repo's [latest release](../../releases/tag/latest) and sideload it (Android will
ask you to allow installs from whatever app you downloaded it with — allow that once). Open the app, go to
**Settings**, and paste in your own MVSEP API token (get one at mvsep.com).

## Development

```sh
cd web && npm install
npm run check && npm run build && npx cap sync android
```

- `npm run dev` runs the UI in a desktop browser for quick iteration, but MVSEP calls will fail there (CORS —
  the whole reason the app talks to MVSEP through Capacitor's native HTTP instead) and storage won't persist
  between runs, so anything beyond pure UI work needs a real device.
- A phone connected over USB with Developer options → USB debugging enabled: `adb devices` should list it
  (`authorized`, not `unauthorized` — accept the prompt on the phone first).
- Debug build (unsigned, fine for testing): `cd web/android && ./gradlew assembleDebug`, then
  `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
- Release build (signed, needed so repeat installs update in place instead of requiring an uninstall first — see
  "Signing" below): `./gradlew assembleRelease` with `KEYSTORE_FILE`/`KEYSTORE_PASSWORD` env vars set, or a
  `keystore.properties` file present.
- `JAVA_HOME` needs to point at a JDK Gradle actually supports (JDK 21 here) — not necessarily whatever `java`
  resolves to by default.

## Signing

Builds need a stable signing key so an update installs over the previous version instead of forcing an
uninstall. Run once:

```sh
./tools/setup-signing.sh
```

This generates `web/android/release.jks` (git-ignored — back it up somewhere; losing it means no future build
can ever again install as an update over an existing one) and pushes `KEYSTORE_BASE64`/`KEYSTORE_PASSWORD` to
this repo's GitHub secrets, which `.github/workflows/build.yml` uses to sign every build automatically.

## Distribution

```sh
git push origin master   # triggers .github/workflows/build.yml
```

On every push to `master`, GitHub Actions builds a signed release APK and publishes it to the `latest` release,
replacing the previous asset — so there's always one stable link to re-download from (the repo is public, so no
GitHub login is needed to download it). Re-run the workflow manually (`workflow_dispatch`) if you need a rebuild
without a code change.

## Migrating from the old server-based version

Earlier versions of ncosis ran a FastAPI backend on an LXC; that's gone. If you're restoring songs from that era
onto a device for the first time, you'd need `backend/tools/export_backup.py` from git history (see AGENTS.md)
to build a backup zip from a copy of the old server's data, then import it in-app via Settings → "Import
backup". This was a one-time migration and isn't part of the normal workflow.

## Ideas for later

- Separate vocals/drums/bass for the backing track, via another MVSEP model.
- An Android foreground service so separation can continue while the app is fully backgrounded.
- A "manage storage" screen to delete old songs' stems explicitly (there's no automatic eviction — on-device
  stems are the only copy of a song, so nothing is deleted silently).

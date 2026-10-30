// Imports a backup archive produced by backend/tools/export_backup.py (see Phase 9 of
// /home/musicmad/.claude/plans/validated-dreaming-sutherland.md) — the one-time path for
// porting songs + settings off the old server. Fully offline, no network involved.

import { unzipSync } from 'fflate'
import * as songStore from './songStore'
import * as stemStorage from './stemStorage'
import type { Song } from './types'

interface Manifest {
  schemaVersion: number
  songs: {
    id: string
    title: string
    filename: string
    duration: number | null
    stems: string[]
    stemFormat: 'opus' | 'flac'
    createdAt: number
    finishedAt: number | null
    bpm: number | null
    settings: Song['settings']
  }[]
}

export async function importBackup(file: File): Promise<{ imported: number; skipped: number }> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const manifestBytes = zip['manifest.json']
  if (!manifestBytes) throw new Error('Not a ncosis backup (no manifest.json)')
  const manifest: Manifest = JSON.parse(new TextDecoder().decode(manifestBytes))
  if (manifest.schemaVersion !== 1) throw new Error(`Unrecognized backup schema version ${manifest.schemaVersion}`)

  let imported = 0
  let skipped = 0
  for (const s of manifest.songs) {
    if (await songStore.getSong(s.id)) {
      skipped++
      continue
    }
    const sourceBytes = zip[`songs/${s.id}/${s.filename}`]
    if (sourceBytes) await stemStorage.writeSource(s.id, s.filename, sourceBytes.buffer)
    for (const stem of s.stems) {
      const stemBytes = zip[`songs/${s.id}/stems/${stem}.${s.stemFormat}`]
      if (stemBytes) await stemStorage.writeStem(s.id, stem, s.stemFormat, stemBytes.buffer)
    }
    const added = await songStore.createFromImport({
      id: s.id,
      title: s.title,
      filename: s.filename,
      status: 'done',
      error: null,
      duration: s.duration,
      stems: s.stems,
      created_at: s.createdAt,
      started_at: null,
      finished_at: s.finishedAt,
      notes: null,
      settings: s.settings,
      bpm: s.bpm,
      stemFormat: s.stemFormat,
      stemVersion: 1,
    })
    if (added) imported++
    else skipped++
  }
  return { imported, skipped }
}

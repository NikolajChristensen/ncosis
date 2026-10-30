// Zips a song's stems for export, replacing the server's on-the-fly FLAC transcode+zip. Stems
// are already FLAC/Opus on disk, so this is just a zip — no transcoding needed either way.

import { zipSync } from 'fflate'
import * as stemStorage from './stemStorage'
import type { Song } from './types'

const STEM_LABELS: Record<string, string> = { lead: 'Lead guitar', rhythm: 'Rhythm guitar', backing: 'Backing (no guitar)' }

export async function buildStemsZip(song: Song): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  for (const stem of song.stems) {
    const bytes = await stemStorage.readStem(song.id, stem, song.stemFormat)
    const label = STEM_LABELS[stem] ?? stem.replace(/^./, (c) => c.toUpperCase())
    entries[`${song.title} - ${label}.${song.stemFormat}`] = new Uint8Array(bytes)
  }
  // Stored, not deflated — the audio is already compressed, mirroring the server's ZIP_STORED.
  const zipped = zipSync(entries, { level: 0 })
  return new Blob([zipped], { type: 'application/zip' })
}

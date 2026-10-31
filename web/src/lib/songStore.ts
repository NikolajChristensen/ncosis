// The song index: replaces the server's SQLite `songs` table. Metadata and settings live in
// Capacitor Preferences (one key per song, plus an id list); stem/source bytes live in
// stemStorage.ts instead. No automatic eviction — on-device stems are the only copy, so a song
// stays until the user deletes it.

import { Preferences } from '@capacitor/preferences'
import type { Song } from './types'
import * as stemStorage from './stemStorage'

const IDS_KEY = 'ncosis:songIds'
const ACTIVE_JOB_KEY = 'ncosis:activeJob'
const songKey = (id: string) => `ncosis:song:${id}`

interface ActiveJob {
  songId: string
  jobHash: string
}

async function getIds(): Promise<string[]> {
  const { value } = await Preferences.get({ key: IDS_KEY })
  return value ? JSON.parse(value) : []
}

async function putSong(song: Song): Promise<void> {
  await Preferences.set({ key: songKey(song.id), value: JSON.stringify(song) })
}

export async function getSong(id: string): Promise<Song | null> {
  const { value } = await Preferences.get({ key: songKey(id) })
  return value ? JSON.parse(value) : null
}

export async function listSongs(): Promise<Song[]> {
  const ids = await getIds()
  const songs = (await Promise.all(ids.map(getSong))).filter((s): s is Song => s !== null)
  songs.sort((a, b) => b.created_at - a.created_at)
  return songs
}

/** Create a queued song from a freshly picked file: writes the source and probes its duration. */
export async function createSong(file: File): Promise<Song> {
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const ext = file.name.match(/\.[^./]+$/)?.[0]?.toLowerCase() ?? ''
  const filename = `source${ext}`
  const bytes = await file.arrayBuffer()
  await stemStorage.writeSource(id, filename, bytes)

  let duration: number | null = null
  try {
    const ctx = new AudioContext()
    duration = (await ctx.decodeAudioData(bytes.slice(0))).duration
    await ctx.close()
  } catch {
    // Not decodable up front; leave duration null, same as the backend's ffprobe fallback.
  }

  const song: Song = {
    id,
    title: file.name.replace(/\.[^./]+$/, ''),
    filename,
    status: 'queued',
    error: null,
    duration,
    stems: [],
    created_at: Date.now() / 1000,
    started_at: null,
    finished_at: null,
    notes: null,
    settings: null,
    bpm: null,
    stemFormat: 'flac',
    stemVersion: 0,
  }
  await putSong(song)
  await Preferences.set({ key: IDS_KEY, value: JSON.stringify([...(await getIds()), id]) })
  return song
}

/** Add a song that was reconstructed from a backup import, skipping any id already present. */
export async function createFromImport(song: Song): Promise<boolean> {
  if (await getSong(song.id)) return false
  await putSong(song)
  await Preferences.set({ key: IDS_KEY, value: JSON.stringify([...(await getIds()), song.id]) })
  return true
}

export async function updateSong(id: string, patch: Partial<Song>): Promise<Song> {
  const song = await getSong(id)
  if (!song) throw new Error(`Unknown song ${id}`)
  const updated = { ...song, ...patch }
  await putSong(updated)
  return updated
}

export async function deleteSong(id: string): Promise<void> {
  await Preferences.remove({ key: songKey(id) })
  await Preferences.set({ key: IDS_KEY, value: JSON.stringify((await getIds()).filter((x) => x !== id)) })
}

/** The oldest still-queued song (FIFO), or null if nothing is waiting. */
export async function nextQueued(): Promise<Song | null> {
  const queued = (await listSongs()).filter((s) => s.status === 'queued')
  queued.sort((a, b) => a.created_at - b.created_at)
  return queued[0] ?? null
}

/** The in-flight MVSEP job, if any, so a killed/relaunched app resumes polling instead of resubmitting. */
export async function getActiveJob(): Promise<ActiveJob | null> {
  const { value } = await Preferences.get({ key: ACTIVE_JOB_KEY })
  return value ? JSON.parse(value) : null
}

export async function setActiveJob(job: ActiveJob | null): Promise<void> {
  if (job) await Preferences.set({ key: ACTIVE_JOB_KEY, value: JSON.stringify(job) })
  else await Preferences.remove({ key: ACTIVE_JOB_KEY })
}

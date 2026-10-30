// Local facade with the same shape the UI always used, now backed by on-device storage instead
// of the server. Keeps Player.svelte/Library.svelte's call sites (mostly) unchanged.

export type { Song, SongSettings, SongStatus } from './types'
import type { Song, SongSettings } from './types'
import * as songStore from './songStore'
import * as stemStorage from './stemStorage'
import * as separation from './separation'
import { buildStemsZip } from './zipExport'

export const listSongs = songStore.listSongs
export const getSong = (id: string) => songStore.getSong(id) as Promise<Song>

export async function uploadSong(file: File): Promise<Song> {
  const song = await songStore.createSong(file)
  separation.notify()
  return song
}

export async function retrySong(id: string): Promise<Song> {
  const song = await songStore.updateSong(id, { status: 'queued', error: null, started_at: null, finished_at: null })
  separation.notify()
  return song
}

export async function deleteSong(id: string): Promise<void> {
  await stemStorage.deleteSong(id)
  await songStore.deleteSong(id)
}

export async function saveSettings(id: string, settings: SongSettings): Promise<void> {
  await songStore.updateSong(id, { settings })
}

export async function readStemBytes(song: Song, stem: string): Promise<ArrayBuffer> {
  return stemStorage.readStem(song.id, stem, song.stemFormat)
}

export async function exportStemsZip(song: Song): Promise<Blob> {
  return buildStemsZip(song)
}

export type SongStatus = 'queued' | 'processing' | 'done' | 'error'

export interface Song {
  id: string
  title: string
  filename: string
  status: SongStatus
  error: string | null
  duration: number | null
  stems: string[]
  created_at: number
  started_at: number | null
  finished_at: number | null
  notes: string | null
  settings: SongSettings | null
  bpm: number | null // detected tempo; 0 if detection failed
}

/** Player settings for a song, stored on the server so every device shares them. */
export interface SongSettings {
  mix?: Record<string, { volume: number; muted: boolean; solo: boolean }>
  loop?: { a: number | null; b: number | null; enabled: boolean }
  semitones?: number
  practiceSemitones?: number | null
  speed?: number
  practiceSpeed?: number | null
  bpm?: number | null // tempo tapped in by the user, overriding the detected one
  masterVolume?: number
}

export interface ServerConfig {
  version: string
  mvsepConfigured: boolean
  library: boolean
}

export interface LibraryEntry {
  path: string // relative to the server's music folder
  song: string | null // id of the song already added from it
}

/** fetch, with a readable error when the server can't be reached at all. */
async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new Error(`Couldn't talk to the ncosis server at ${location.host}. Is it running, and is this the right address?`)
  }
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {}
    throw new Error(detail)
  }
  return res
}

export async function getConfig(): Promise<ServerConfig> {
  return (await check(await request('/api/config'))).json()
}

export async function listSongs(): Promise<Song[]> {
  return (await check(await request('/api/songs'))).json()
}

export async function getSong(id: string): Promise<Song> {
  return (await check(await request(`/api/songs/${id}`))).json()
}

export async function uploadSong(file: File): Promise<Song> {
  // Read the file up front instead of letting the browser stream it during the upload:
  // on network shares (SMB) Chromium often thinks the file changed and aborts mid-request.
  let data: ArrayBuffer
  try {
    data = await file.arrayBuffer()
  } catch (e) {
    throw new Error(`Couldn't read the file (${(e as Error).message})`)
  }
  const body = new FormData()
  body.append('file', new Blob([data], { type: file.type }), file.name)
  return (await check(await request('/api/songs', { method: 'POST', body }))).json()
}

export async function retrySong(id: string): Promise<Song> {
  return (await check(await request(`/api/songs/${id}/retry`, { method: 'POST' }))).json()
}

export async function deleteSong(id: string): Promise<void> {
  await check(await request(`/api/songs/${id}`, { method: 'DELETE' }))
}

/** The version (`v`) changes when a song is reprocessed, so cached stems are never stale. */
export function stemUrl(song: Song, stem: string): string {
  return `/api/songs/${song.id}/stems/${stem}.opus?v=${Math.round(song.finished_at ?? 0)}`
}

export function stemsZipUrl(id: string): string {
  return `/api/songs/${id}/stems.zip`
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  return (await check(await request('/api/library'))).json()
}

export async function addFromLibrary(path: string): Promise<Song> {
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }
  return (await check(await request('/api/library', init))).json()
}

/** `keepalive` lets the request finish even while the page is being left. */
export async function saveSettings(id: string, settings: SongSettings, keepalive = false): Promise<void> {
  const init = {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
    keepalive,
  }
  await check(await request(`/api/songs/${id}/settings`, init))
}

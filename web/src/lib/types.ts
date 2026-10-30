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
  stemFormat: 'flac' | 'opus' // flac for songs separated on-device; opus for migrated ones
  stemVersion: number // bumped whenever stems are (re)written, so stale cached buffers can be told apart
}

/** Player settings for a song, stored locally on this device. */
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

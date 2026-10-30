// Replaces worker.py: a single in-page loop that sends queued songs to MVSEP one at a time
// (free accounts get one concurrent job). Only progresses while the app is open; MVSEP keeps
// processing server-side regardless, and relaunching the app resumes polling via the persisted
// job hash instead of resubmitting, the same guarantee worker.py gave across a server restart.

import * as songStore from './songStore'
import * as stemStorage from './stemStorage'
import * as mvsep from './mvsep'
import { getMvsepToken } from './settings'
import { detectTempo } from './audioAnalysis'
import type { Song } from './types'

const IDLE_POLL_MS = 60_000

let started = false
let wake: (() => void) | null = null

/** Wake the loop if it's idle waiting for work. */
export function notify() {
  wake?.()
  wake = null
}

export function start() {
  if (started) return
  started = true
  loop()
}

async function loop() {
  while (true) {
    const job = await songStore.getActiveJob()
    const song = job ? await songStore.getSong(job.songId) : await songStore.nextQueued()
    if (!song) {
      await new Promise<void>((resolve) => {
        wake = resolve
        setTimeout(resolve, IDLE_POLL_MS)
      })
      continue
    }
    await process(song, job?.jobHash)
  }
}

async function process(song: Song, resumeJobHash?: string) {
  try {
    await songStore.updateSong(song.id, { status: 'processing', started_at: Date.now() / 1000, error: null, notes: null })

    let hash = resumeJobHash
    if (!hash) {
      const token = await getMvsepToken()
      if (!token) throw new Error('No MVSEP API token set — add one in Settings')
      const sourceBytes = await stemStorage.readSource(song.id, song.filename)
      const file = new File([sourceBytes], song.filename)
      hash = await mvsep.submit(file, token)
      await songStore.setActiveJob({ songId: song.id, jobHash: hash })
    }

    const downloadUrls = await mvsep.poll(hash, (msg) => songStore.updateSong(song.id, { notes: msg }))
    const stems: string[] = []
    for (const [stem, url] of Object.entries(downloadUrls)) {
      await stemStorage.downloadStem(song.id, stem, 'flac', url)
      stems.push(stem)
    }

    await songStore.setActiveJob(null)
    await songStore.updateSong(song.id, {
      status: 'done',
      stems,
      notes: null,
      finished_at: Date.now() / 1000,
      stemFormat: 'flac',
      stemVersion: song.stemVersion + 1,
    })
    await detectBpm(song.id)
  } catch (e) {
    await songStore.setActiveJob(null)
    await songStore.updateSong(song.id, {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      notes: null,
      finished_at: Date.now() / 1000,
    })
  }
}

async function detectBpm(songId: string) {
  let bpm = 0
  try {
    const song = await songStore.getSong(songId)
    if (song) {
      const bytes = await stemStorage.readSource(songId, song.filename)
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(bytes)
      await ctx.close()
      bpm = (await detectTempo(buffer)) ?? 0
    }
  } catch {
    bpm = 0
  }
  await songStore.updateSong(songId, { bpm })
}

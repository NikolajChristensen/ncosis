// Tempo detection, replacing backend/ncosis/audio.py's `aubio tempo` shell-out. Can be off by
// 2x/0.5x just like aubio was — the player's tap-tempo UI already exists to correct that.

import { analyze } from 'web-audio-beat-detector'

export async function detectTempo(buffer: AudioBuffer): Promise<number | null> {
  try {
    const bpm = await analyze(buffer, { minTempo: 30, maxTempo: 300 })
    return Math.round(bpm * 10) / 10
  } catch {
    return null
  }
}

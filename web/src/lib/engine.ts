// Plays all stems of a song in sample-accurate sync, each through its own gain node.

export interface Stem {
  name: string
  buffer: AudioBuffer
  gain: GainNode
  volume: number
  muted: boolean
  solo: boolean
  // Max absolute amplitude per waveform bin, used to draw the overview.
  peaks: Float32Array
}

export const PEAK_BINS = 1200

function computePeaks(buffer: AudioBuffer): Float32Array {
  const peaks = new Float32Array(PEAK_BINS)
  const binSize = Math.ceil(buffer.length / PEAK_BINS)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let bin = 0; bin < PEAK_BINS; bin++) {
      const end = Math.min((bin + 1) * binSize, data.length)
      let max = peaks[bin]
      for (let i = bin * binSize; i < end; i++) {
        const v = Math.abs(data[i])
        if (v > max) max = v
      }
      peaks[bin] = max
    }
  }
  return peaks
}

export class StemPlayer {
  readonly ctx = new AudioContext({ latencyHint: 'playback' })
  readonly stems: Stem[] = []
  duration = 0
  playing = false
  onEnded: (() => void) | null = null

  private sources: AudioBufferSourceNode[] = []
  private offset = 0 // song position when playback (re)started or paused
  private startedAt = 0 // ctx.currentTime matching `offset`

  async load(urls: { name: string; url: string }[], onProgress: (done: number) => void) {
    let done = 0
    const stems = await Promise.all(
      urls.map(async ({ name, url }) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Could not load ${name} stem (${res.status})`)
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer())
        onProgress(++done)
        const gain = this.ctx.createGain()
        gain.connect(this.ctx.destination)
        return { name, buffer, gain, volume: 1, muted: false, solo: false, peaks: computePeaks(buffer) }
      }),
    )
    this.stems.push(...stems)
    this.duration = Math.max(...stems.map((s) => s.buffer.duration))
  }

  get position(): number {
    if (!this.playing) return this.offset
    return Math.min(this.offset + this.ctx.currentTime - this.startedAt, this.duration)
  }

  async play() {
    if (this.playing) return
    await this.ctx.resume()
    if (this.offset >= this.duration) this.offset = 0
    // Small lead time so every source starts on exactly the same sample.
    const when = this.ctx.currentTime + 0.05
    this.sources = this.stems.map((stem) => {
      const src = this.ctx.createBufferSource()
      src.buffer = stem.buffer
      src.connect(stem.gain)
      src.start(when, this.offset)
      return src
    })
    const first = this.sources[0]
    first.onended = () => {
      // `onended` also fires after stop(); only react to the song actually finishing.
      if (this.sources[0] !== first) return
      this.stopSources()
      this.playing = false
      this.offset = this.duration
      this.onEnded?.()
    }
    this.startedAt = when
    this.playing = true
  }

  pause() {
    if (!this.playing) return
    this.offset = this.position
    this.stopSources()
    this.playing = false
  }

  seek(time: number) {
    const wasPlaying = this.playing
    this.pause()
    this.offset = Math.max(0, Math.min(time, this.duration))
    if (wasPlaying) this.play()
  }

  /** Re-apply volume/mute/solo to all gain nodes. Call after changing a stem's settings. */
  updateGains() {
    const anySolo = this.stems.some((s) => s.solo)
    for (const stem of this.stems) {
      const audible = !stem.muted && (!anySolo || stem.solo)
      // Short ramp avoids clicks when toggling.
      stem.gain.gain.setTargetAtTime(audible ? stem.volume : 0, this.ctx.currentTime, 0.015)
    }
  }

  isAudible(stem: Stem): boolean {
    const anySolo = this.stems.some((s) => s.solo)
    return !stem.muted && (!anySolo || stem.solo)
  }

  async close() {
    this.stopSources()
    await this.ctx.close()
  }

  private stopSources() {
    const sources = this.sources
    this.sources = []
    for (const src of sources) {
      src.onended = null
      src.stop()
      src.disconnect()
    }
  }
}

// Plays all stems of a song in sample-accurate sync, each through its own gain node.
// The mix goes through a pitch shifter (Signalsmith Stretch) only while transposed.

import SignalsmithStretch from 'signalsmith-stretch'

export interface Stem {
  name: string
  buffer: AudioBuffer
  gain: GainNode
  volume: number
  muted: boolean
  solo: boolean
  // Max absolute amplitude per 1/PEAK_RATE seconds, used to draw waveforms.
  peaks: Float32Array
}

/** Waveform resolution in bins per second; fine enough for the zoomed loop editor. */
export const PEAK_RATE = 50

export interface Loop {
  start: number
  end: number
}

/** A visible time range of a waveform, in seconds. */
export interface View {
  start: number
  end: number
}

/** Shortest loop allowed, in seconds. */
export const MIN_LOOP = 0.2

function computePeaks(buffer: AudioBuffer): Float32Array {
  const binSize = Math.round(buffer.sampleRate / PEAK_RATE)
  const bins = Math.ceil(buffer.length / binSize)
  const peaks = new Float32Array(bins)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let bin = 0; bin < bins; bin++) {
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

  private loop: Loop | null = null
  // All stem gains feed this bus, which goes either straight out or through `stretch`.
  private bus = this.ctx.createGain()
  private stretch: (AudioNode & { schedule(o: object): void; stop(): void }) | null = null
  private stretchReady: Promise<void> | null = null
  private routedThroughStretch = false
  private semitones = 0
  private stretchLatency = 0
  private sources: AudioBufferSourceNode[] = []
  private offset = 0 // song position when playback (re)started or paused
  private startedAt = 0 // ctx.currentTime matching `offset`

  constructor() {
    this.bus.connect(this.ctx.destination)
  }

  async load(urls: { name: string; url: string }[], onProgress: (done: number) => void) {
    let done = 0
    const stems = await Promise.all(
      urls.map(async ({ name, url }) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Could not load ${name} stem (${res.status})`)
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer())
        onProgress(++done)
        const gain = this.ctx.createGain()
        gain.connect(this.bus)
        return { name, buffer, gain, volume: 1, muted: false, solo: false, peaks: computePeaks(buffer) }
      }),
    )
    this.stems.push(...stems)
    this.duration = Math.max(...stems.map((s) => s.buffer.duration))
  }

  get position(): number {
    if (!this.playing) return this.offset
    const raw = this.offset + Math.max(0, this.ctx.currentTime - this.startedAt)
    const loop = this.loop
    // Playback started at or before the loop start (see play/seek), so once it
    // reaches the loop end it cycles between start and end.
    if (loop && raw >= loop.end) return loop.start + ((raw - loop.start) % (loop.end - loop.start))
    return Math.min(raw, this.duration)
  }

  /** The position you currently hear: the pitch shifter delays audio slightly while active. */
  get heardPosition(): number {
    const pos = this.position
    if (!this.playing || !this.routedThroughStretch) return pos
    const heard = pos - this.stretchLatency
    // Just after a loop wrap, what you hear is still the end of the loop.
    if (this.loop && pos - this.loop.start < this.stretchLatency && heard < this.loop.start) {
      return this.loop.end - (this.loop.start - heard)
    }
    return Math.max(0, heard)
  }

  /** Loop all stems between two points, gaplessly. `null` turns looping off. */
  setLoop(loop: Loop | null) {
    const pos = this.position
    this.loop = loop
    if (this.playing) {
      // Past the loop end, the sources would wrap somewhere we can't track; restart at A.
      if (loop && pos >= loop.end) {
        this.seek(loop.start)
        return
      }
      // Re-base the position clock so `position` stays correct under the new loop.
      this.offset = pos
      this.startedAt = Math.max(this.ctx.currentTime, this.startedAt)
      for (const src of this.sources) this.applyLoop(src)
    } else if (loop && pos >= loop.end) {
      this.offset = loop.start
    }
  }

  async play() {
    if (this.playing) return
    await this.ctx.resume()
    if (this.offset >= this.duration) this.offset = 0
    if (this.loop && this.offset >= this.loop.end) this.offset = this.loop.start
    // Small lead time so every source starts on exactly the same sample.
    const when = this.ctx.currentTime + 0.05
    this.sources = this.stems.map((stem) => {
      const src = this.ctx.createBufferSource()
      src.buffer = stem.buffer
      this.applyLoop(src)
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

  /** Jump to `time`. With a loop active, a time after the loop end jumps to the loop start. */
  seek(time: number) {
    const wasPlaying = this.playing
    this.pause()
    this.offset = Math.max(0, Math.min(time, this.duration))
    if (this.loop && this.offset >= this.loop.end) this.offset = this.loop.start
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

  /** Transpose the whole mix by `semitones` without changing tempo. 0 bypasses the shifter. */
  async setSemitones(semitones: number) {
    this.semitones = semitones
    if (semitones !== 0 && !this.stretch) {
      // AudioWorklet (which the shifter runs on) only exists on HTTPS or localhost.
      if (!this.ctx.audioWorklet) throw new Error('needs the app to be opened over HTTPS')
      this.stretchReady ??= (async () => {
        const node = await SignalsmithStretch(this.ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
        node.connect(this.ctx.destination)
        this.stretchLatency = await node.latency()
        this.stretch = node
      })()
      await this.stretchReady
    }
    // Re-read: another call may have changed it while the shifter was loading.
    const st = this.semitones
    const stretch = this.stretch
    if (!stretch) return
    if (st === 0) {
      if (this.routedThroughStretch) {
        this.bus.disconnect()
        this.bus.connect(this.ctx.destination)
        stretch.stop()
        this.routedThroughStretch = false
      }
      return
    }
    stretch.schedule({ active: true, semitones: st })
    if (!this.routedThroughStretch) {
      this.bus.disconnect()
      this.bus.connect(stretch)
      this.routedThroughStretch = true
    }
  }

  async close() {
    this.stopSources()
    await this.ctx.close()
  }

  private applyLoop(src: AudioBufferSourceNode) {
    src.loop = this.loop !== null
    if (this.loop) {
      src.loopStart = this.loop.start
      src.loopEnd = this.loop.end
    }
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

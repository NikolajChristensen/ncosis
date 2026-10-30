// Plays all stems of a song in sample-accurate sync, each through its own gain node.
// Tempo changes play the stems faster/slower (which also shifts their pitch); the mix then
// goes through a pitch shifter (Signalsmith Stretch) that undoes that shift and applies any
// transpose. At normal speed and pitch the shifter is bypassed.

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

/** Waveform resolution in bins per second. */
export const PEAK_RATE = 50

export interface Loop {
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
  // Whether the running sources loop. False while playing past the loop end (after a seek
  // there), so the song simply plays on; the loop applies again once playback is before B.
  private looping = false
  // All stem gains feed this bus, which goes either straight out or through `stretch`.
  private bus = this.ctx.createGain()
  // Master volume control sits between bus and output.
  private masterGain = this.ctx.createGain()
  private stretch: (AudioNode & { schedule(o: object): void; stop(): void }) | null = null
  private stretchReady: Promise<void> | null = null
  private routedThroughStretch = false
  private semitones = 0
  private rate = 1 // playback speed; 0.5 = half speed
  private stretchLatency = 0
  private sources: AudioBufferSourceNode[] = []
  private offset = 0 // song position when playback (re)started or paused
  private startedAt = 0 // ctx.currentTime matching `offset`

  constructor() {
    this.bus.connect(this.masterGain)
    this.masterGain.connect(this.ctx.destination)
  }

  /**
   * Decode and add one stem. Loaded one at a time (not in parallel) by the caller so only one
   * stem's raw bytes are ever in memory at once — Capacitor's WebView runs in the app's own
   * Android heap, much smaller than a normal mobile browser tab gets, and holding all stems'
   * bytes/decoded buffers at once risks an OOM on longer songs.
   */
  async loadStem(name: string, bytes: ArrayBuffer): Promise<void> {
    let buffer: AudioBuffer
    try {
      buffer = await this.ctx.decodeAudioData(bytes)
    } catch (e) {
      throw new Error(`Could not decode ${name} stem (${(e as Error).message})`)
    }
    const gain = this.ctx.createGain()
    gain.connect(this.bus)
    this.stems.push({ name, buffer, gain, volume: 1, muted: false, solo: false, peaks: computePeaks(buffer) })
    this.duration = Math.max(this.duration, buffer.duration)
  }

  get position(): number {
    if (!this.playing) return this.offset
    const raw = this.offset + Math.max(0, this.ctx.currentTime - this.startedAt) * this.rate
    const loop = this.loop
    // While looping, playback started before the loop end, so once it reaches
    // the loop end it cycles between start and end.
    if (this.looping && loop && raw >= loop.end) {
      return loop.start + ((raw - loop.start) % (loop.end - loop.start))
    }
    return Math.min(raw, this.duration)
  }

  /** The position you currently hear: the pitch shifter delays audio slightly while active. */
  get heardPosition(): number {
    const pos = this.position
    if (!this.playing || !this.routedThroughStretch) return pos
    const lag = this.stretchLatency * this.rate // in song time
    const heard = pos - lag
    // Just after a loop wrap, what you hear is still the end of the loop.
    if (this.looping && this.loop && pos - this.loop.start < lag && heard < this.loop.start) {
      return this.loop.end - (this.loop.start - heard)
    }
    return Math.max(0, heard)
  }

  /**
   * Loop all stems between two points, gaplessly. `null` turns looping off.
   * Playback continues from where it is; past the loop end it plays on without looping.
   */
  setLoop(loop: Loop | null) {
    const pos = this.position
    this.loop = loop
    if (!this.playing) return
    this.rebase(pos)
    this.looping = loop !== null && pos < loop.end
    for (const src of this.sources) this.applyLoop(src)
  }

  async play() {
    if (this.playing) return
    await this.ctx.resume()
    if (this.offset >= this.duration) this.offset = 0
    this.looping = this.loop !== null && this.offset < this.loop.end
    // Small lead time so every source starts on exactly the same sample.
    const when = this.ctx.currentTime + 0.05
    this.sources = this.stems.map((stem) => {
      const src = this.ctx.createBufferSource()
      src.buffer = stem.buffer
      src.playbackRate.value = this.rate
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

  /** Jump to `time`. After the loop end, playback continues without looping. */
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

  /** Set the master volume (0–1.5) for all stems. */
  setMasterVolume(volume: number) {
    this.masterGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.015)
  }

  /** Transpose the whole mix by `semitones` without changing tempo. */
  setSemitones(semitones: number): Promise<void> {
    this.semitones = semitones
    return this.updateShifter()
  }

  /** Change the tempo (1 = original, 0.5 = half speed) without changing pitch. */
  setRate(rate: number): Promise<void> {
    if (this.playing) {
      // Re-base the clock at the current position before the speed changes.
      this.rebase(this.position)
      for (const src of this.sources) src.playbackRate.setValueAtTime(rate, this.ctx.currentTime)
    }
    this.rate = rate
    return this.updateShifter()
  }

  /** Route the mix through the shifter with whatever pitch shift speed and transpose need. */
  private async updateShifter() {
    const needed = () => this.semitones - 12 * Math.log2(this.rate)
    if (Math.abs(needed()) > 1e-6 && !this.stretch) {
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
    // Re-read: another call may have changed things while the shifter was loading.
    const st = needed()
    const stretch = this.stretch
    if (!stretch) return
    if (Math.abs(st) <= 1e-6) {
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

  /** Restart the position clock at `pos` from now, e.g. before changing loop or speed. */
  private rebase(pos: number) {
    this.offset = pos
    this.startedAt = Math.max(this.ctx.currentTime, this.startedAt)
  }

  private applyLoop(src: AudioBufferSourceNode) {
    src.loop = this.looping
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

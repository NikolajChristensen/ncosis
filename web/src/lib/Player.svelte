<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Filesystem, Directory } from '@capacitor/filesystem'
  import { Share } from '@capacitor/share'
  import { exportStemsZip, getSong, readStemBytes, saveSettings, type Song, type SongSettings } from './api'
  import { MIN_LOOP, StemPlayer, type Loop, type Stem } from './engine'
  import { uint8ToBase64 } from './stemStorage'
  import Waveform from './Waveform.svelte'

  let { id }: { id: string } = $props()

  const STEM_ORDER = ['lead', 'rhythm', 'backing', 'vocals', 'guitar', 'bass', 'drums', 'piano', 'other']
  const STEM_LABELS: Record<string, string> = { lead: 'Lead gtr', rhythm: 'Rhythm gtr' }

  let song = $state<Song | null>(null)
  let error = $state('')
  let loaded = $state(0)
  let ready = $state(false)
  let playing = $state(false)
  let position = $state(0)

  // Per-stem mixer settings. The engine gets a copy on every change.
  type Mix = Pick<Stem, 'volume' | 'muted' | 'solo'>
  let mix = $state<Record<string, Mix>>({})
  const anySolo = $derived(Object.values(mix).some((m) => m.solo))

  // A-B loop. A can be set on its own; the loop exists once both points are set.
  let loopA = $state<number | null>(null)
  let loopB = $state<number | null>(null)
  let loopEnabled = $state(false)
  const loop = $derived<Loop | null>(loopA !== null && loopB !== null ? { start: loopA, end: loopB } : null)

  // Transpose in semitones, remembered per song (e.g. -1 for songs in Eb tuning).
  const MAX_SEMITONES = 12
  let semitones = $state(0)
  // The last transpose other than 0, so the middle button can toggle back to it.
  let practiceSemitones = $state<number | null>(null)
  let pitchError = $state('')

  // Playback speed in percent, remembered per song. Pitch stays the same.
  const MIN_SPEED = 50
  const MAX_SPEED = 125
  let speed = $state(100)
  // The last speed other than 100%, so the middle button can toggle back to it.
  let practiceSpeed = $state<number | null>(null)

  // Master volume for the whole mix, remembered per song.
  let masterVolume = $state(1)

  // Tempo: detected on the server, or tapped in by the user (saved with the settings).
  let bpmOverride = $state<number | null>(null)
  const baseBpm = $derived(bpmOverride ?? (song?.bpm || null))
  const effectiveBpm = $derived(baseBpm ? Math.round((baseBpm * speed) / 100) : null)
  const TAP_TIMEOUT_MS = 2000
  const MIN_TAPS = 4
  let taps: number[] = []
  let tapCount = $state(0)
  let tapBpm = $state<number | null>(null)
  let tapTimer: ReturnType<typeof setTimeout> | undefined

  const player = new StemPlayer()
  // Handy for poking at playback from the devtools console.
  if (import.meta.env.DEV) Object.assign(window, { player })
  let wakeLock: WakeLockSentinel | null = null
  let raf = 0

  player.onEnded = () => {
    playing = false
    releaseWakeLock()
  }

  async function init() {
    try {
      song = await getSong(id)
      const stemNames = [...song.stems].sort((a, b) => STEM_ORDER.indexOf(a) - STEM_ORDER.indexOf(b))
      // One stem at a time, not in parallel — keeps peak memory to roughly one stem's worth.
      for (const name of stemNames) {
        const bytes = await readStemBytes(song, name)
        await player.loadStem(name, bytes)
        loaded++
      }
      mix = Object.fromEntries(player.stems.map((s) => [s.name, { volume: s.volume, muted: s.muted, solo: s.solo }]))
      const legacy = song.settings ? null : legacySettings()
      applySettings(song.settings ?? legacy ?? {})
      // Start at the loop's A marker, where practice usually resumes.
      if (loopA !== null) player.seek(loopA)
      // Settings from the server are already saved; ones carried over from this device are not.
      savedJson = legacy ? '' : JSON.stringify(currentSettings())
      migratingLegacy = !!legacy
      ready = true
      // Autostart playback 2 seconds after the song opens.
      setTimeout(() => {
        player.play().then(() => {
          playing = true
          holdWakeLock()
        })
      }, 2000)
    } catch (e) {
      error = (e as Error).message
    }
  }
  init()

  function tick() {
    position = player.heardPosition
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  onDestroy(() => {
    cancelAnimationFrame(raf)
    releaseWakeLock()
    player.close()
  })

  // Keep the screen on while playing along.
  async function holdWakeLock() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen')
    } catch {}
  }
  function releaseWakeLock() {
    wakeLock?.release()
    wakeLock = null
  }

  async function toggle() {
    if (player.playing) {
      player.pause()
      releaseWakeLock()
    } else {
      await player.play()
      holdWakeLock()
    }
    playing = player.playing
  }

  // Keep the engine and the saved copy in sync with the loop state.
  $effect(() => {
    if (!ready) return
    player.setLoop(loopEnabled ? loop : null)
    position = player.heardPosition
  })

  $effect(() => {
    if (!ready) return
    const st = semitones
    player.setSemitones(st).then(
      // Falling back to 0 after a failure succeeds too; keep the message in that case.
      () => st !== 0 && (pitchError = ''),
      (e) => {
        pitchError = `Transpose ${e.message}`
        semitones = 0
      },
    )
  })

  $effect(() => {
    if (!ready) return
    const sp = speed
    player.setRate(sp / 100).then(
      () => sp !== 100 && (pitchError = ''),
      // Without the shifter the speed change still works, but the pitch moves with it.
      (e) => (pitchError = `Keeping the pitch while changing speed ${e.message}`),
    )
  })

  $effect(() => {
    if (!ready) return
    player.setMasterVolume(masterVolume)
  })

  function changeSpeed(delta: number) {
    speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, speed + delta))
    if (speed !== 100) practiceSpeed = speed
  }

  /** Toggle between 100% and the last practice speed. */
  function toggleSpeed() {
    if (speed !== 100) {
      practiceSpeed = speed
      speed = 100
    } else if (practiceSpeed !== null) {
      speed = practiceSpeed
    }
  }

  function transpose(delta: number) {
    semitones = Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, semitones + delta))
    if (semitones !== 0) practiceSemitones = semitones
  }

  /** Toggle between no transpose and the last transpose. */
  function toggleTranspose() {
    if (semitones !== 0) {
      practiceSemitones = semitones
      semitones = 0
    } else if (practiceSemitones !== null) {
      semitones = practiceSemitones
    }
  }

  /** Tap along to the beat (at the current speed); after a pause the tempo is taken over. */
  function tap() {
    const now = performance.now()
    if (taps.length && now - taps[taps.length - 1] > TAP_TIMEOUT_MS) taps = []
    taps.push(now)
    tapCount = taps.length
    if (taps.length >= 2) {
      const gaps = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b)
      tapBpm = 60000 / gaps[Math.floor(gaps.length / 2)] // median resists a sloppy tap
    }
    clearTimeout(tapTimer)
    tapTimer = setTimeout(finishTapping, TAP_TIMEOUT_MS)
  }

  function finishTapping() {
    // Taps happen at the current speed; store the song's own tempo.
    if (taps.length >= MIN_TAPS && tapBpm) bpmOverride = Math.round((tapBpm / (speed / 100)) * 10) / 10
    taps = []
    tapCount = 0
    tapBpm = null
  }

  const fmtSemitones = (st: number) => `${st > 0 ? '+' : ''}${st} st`

  // Settings are saved to the server (shared by all devices) shortly after the last change.
  const SAVE_DELAY_MS = 600
  let savedJson = ''
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let migratingLegacy = false

  function currentSettings(): SongSettings {
    return {
      mix: $state.snapshot(mix),
      loop: { a: loopA, b: loopB, enabled: loopEnabled },
      semitones,
      practiceSemitones,
      speed,
      practiceSpeed,
      bpm: bpmOverride,
      masterVolume,
    }
  }

  $effect(() => {
    if (!ready) return
    const json = JSON.stringify(currentSettings())
    if (json === savedJson) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => flushSettings(), SAVE_DELAY_MS)
  })

  function flushSettings() {
    clearTimeout(saveTimer)
    const settings = currentSettings()
    const json = JSON.stringify(settings)
    if (!ready || json === savedJson) return
    saveSettings(id, settings).then(
      () => {
        savedJson = json
        if (migratingLegacy) clearLegacySettings()
      },
      (e) => console.warn('Could not save settings', e),
    )
  }
  onDestroy(() => flushSettings())

  function applySettings(s: SongSettings) {
    for (const stem of player.stems) {
      const saved = s.mix?.[stem.name]
      if (!saved) continue
      const m = mix[stem.name]
      if (typeof saved.volume === 'number') m.volume = saved.volume
      m.muted = !!saved.muted
      m.solo = !!saved.solo && !m.muted
      Object.assign(stem, m)
    }
    player.updateGains()
    if (s.loop) {
      loopA = s.loop.a
      loopB = s.loop.b
      loopEnabled = s.loop.enabled && s.loop.a !== null && s.loop.b !== null
    }
    semitones = s.semitones ?? 0
    practiceSemitones = s.practiceSemitones ?? null
    speed = s.speed ?? 100
    practiceSpeed = s.practiceSpeed ?? null
    bpmOverride = s.bpm ?? null
    masterVolume = s.masterVolume ?? 1
  }

  // Before settings moved to the server, each device kept its own in localStorage.
  const legacyKeys = () =>
    [`mix:${id}`, `loop:${id}`, `pitch:${id}`, `pitch:${id}:practice`, `speed:${id}`, `speed:${id}:practice`].map(
      (k) => `ncosis:${k}`,
    )

  function legacySettings(): SongSettings | null {
    try {
      const get = (k: string) => localStorage.getItem(`ncosis:${k}`)
      if (!legacyKeys().some((k) => localStorage.getItem(k) !== null)) return null
      const loop = JSON.parse(get(`loop:${id}`) ?? 'null')
      return {
        mix: JSON.parse(get(`mix:${id}`) ?? 'null') ?? undefined,
        loop: loop ? { a: loop.a, b: loop.b, enabled: loop.enabled } : undefined,
        semitones: Number(get(`pitch:${id}`)) || 0,
        practiceSemitones: Number(get(`pitch:${id}:practice`)) || null,
        speed: Number(get(`speed:${id}`)) || 100,
        practiceSpeed: Number(get(`speed:${id}:practice`)) || null,
      }
    } catch {
      return null
    }
  }

  function clearLegacySettings() {
    try {
      for (const k of legacyKeys()) localStorage.removeItem(k)
    } catch {}
    migratingLegacy = false
  }

  const clampTime = (t: number) => Math.round(Math.max(0, Math.min(t, player.duration)) * 100) / 100

  function setA() {
    const t = clampTime(player.heardPosition)
    loopA = t
    if (loopB !== null && loopB < t + MIN_LOOP) {
      loopB = null
      loopEnabled = false
    }
  }

  function setB() {
    const t = clampTime(player.heardPosition)
    if (loopA === null || t < loopA + MIN_LOOP) return
    loopB = t
    loopEnabled = true
    // Start looping right away instead of playing on past the new end point.
    player.setLoop({ start: loopA, end: t })
    player.seek(loopA)
  }

  function nudge(point: 'a' | 'b', delta: number) {
    if (point === 'a' && loopA !== null) {
      loopA = clampTime(Math.min(loopA + delta, (loopB ?? Infinity) - MIN_LOOP))
    } else if (point === 'b' && loopB !== null) {
      loopB = clampTime(Math.max(loopB + delta, (loopA ?? 0) + MIN_LOOP))
    }
  }

  function clearLoop() {
    loopA = loopB = null
    loopEnabled = false
  }

  function toStart() {
    player.seek(loopA ?? 0)
  }

  function skip(seconds: number) {
    player.seek(player.position + seconds)
  }

  function change(stem: Stem, patch: Partial<Mix>) {
    const m = mix[stem.name]
    Object.assign(m, patch)
    // Mute and solo are exclusive on a track: turning one on turns the other off.
    if (patch.muted) m.solo = false
    if (patch.solo) m.muted = false
    Object.assign(stem, m)
    player.updateGains()
  }

  const DEFAULT_MIX: Mix = { volume: 1, muted: false, solo: false }
  const isDefault = $derived(
    Object.values(mix).every((m) => m.volume === 1 && !m.muted && !m.solo) && masterVolume === 1,
  )

  function resetMix() {
    for (const stem of player.stems) change(stem, DEFAULT_MIX)
    masterVolume = 1
  }

  function isAudible(name: string): boolean {
    return !mix[name].muted && (!anySolo || mix[name].solo)
  }

  const mixPeaks = $derived.by(() => {
    if (!ready) return new Float32Array(0)
    const peaks = new Float32Array(Math.max(...player.stems.map((s) => s.peaks.length)))
    for (const stem of player.stems) {
      if (!isAudible(stem.name)) continue
      const vol = mix[stem.name].volume
      for (let i = 0; i < stem.peaks.length; i++) peaks[i] += stem.peaks[i] * vol
    }
    return peaks
  })

  function fmtPrecise(t: number | null): string {
    if (t === null) return '–:––.–'
    const m = Math.floor(t / 60)
    const s = (t % 60).toFixed(1).padStart(4, '0')
    return `${m}:${s}`
  }

  function fmt(t: number): string {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  async function downloadZip() {
    if (!song) return
    try {
      const blob = await exportStemsZip(song)
      const data = uint8ToBase64(new Uint8Array(await blob.arrayBuffer()))
      const { uri } = await Filesystem.writeFile({ path: `${song.title}.zip`, directory: Directory.Cache, data })
      await Share.share({ url: uri, title: `${song.title} stems` })
    } catch (e) {
      error = `Could not export stems: ${(e as Error).message}`
    }
  }
</script>

<header>
  <a href="#/" class="back" aria-label="Back to library">←</a>
  <h1>{song?.title ?? ''}</h1>
  {#if song?.status === 'done'}
    <button class="download" onclick={downloadZip} title="Share all stems (zip)" aria-label="Share all stems">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V3zM5 18h14v2H5z" /></svg>
    </button>
  {/if}
</header>

{#if error}
  <p class="error">{error}</p>
{:else if !ready}
  <p class="hint">Loading stems… {loaded}/{song?.stems.length ?? '?'}</p>
{:else}
  <section class="transport">
    <Waveform
      peaks={mixPeaks}
      duration={player.duration}
      {position}
      {loopA}
      {loopB}
      {loopEnabled}
      onseek={(t) => player.seek(t)}
      onloopchange={(a, b) => {
        loopA = clampTime(a)
        loopB = b === null ? null : clampTime(b)
      }}
    />
    <div class="time">
      <span>{fmt(position)}</span>
      <span>{fmt(player.duration)}</span>
    </div>
    <div class="buttons">
      <button class="icon" onclick={toStart} aria-label={loopA !== null ? 'Back to loop start' : 'Back to start'}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="2.5" height="14" rx="1" /><path d="M19 6.2v11.6a1 1 0 0 1-1.54.84L9.3 13.3a1.5 1.5 0 0 1 0-2.6l8.16-5.34A1 1 0 0 1 19 6.2z" /></svg>
      </button>
      <button onclick={() => skip(-10)} aria-label="Back 10 seconds">−10s</button>
      <button class="play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {#if playing}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
        {/if}
      </button>
      <button onclick={() => skip(10)} aria-label="Forward 10 seconds">+10s</button>
    </div>
    <div class="pitch">
      <span class="label">Transpose</span>
      <button onclick={() => transpose(-1)} disabled={semitones <= -MAX_SEMITONES} aria-label="Transpose down">−</button>
      <button
        class="value"
        class:on={semitones !== 0}
        onclick={toggleTranspose}
        title={semitones !== 0 ? 'Tap for 0 st' : practiceSemitones ? `Tap for ${fmtSemitones(practiceSemitones)}` : ''}
      >
        {fmtSemitones(semitones)}
        {#if semitones === 0 && practiceSemitones}<span class="alt">↺ {fmtSemitones(practiceSemitones)}</span>{/if}
      </button>
      <button onclick={() => transpose(1)} disabled={semitones >= MAX_SEMITONES} aria-label="Transpose up">+</button>
    </div>
    <div class="pitch">
      <span class="label">Speed</span>
      <button onclick={() => changeSpeed(-5)} disabled={speed <= MIN_SPEED} aria-label="Slower">−</button>
      <button
        class="value"
        class:on={speed !== 100}
        onclick={toggleSpeed}
        title={speed !== 100 ? 'Tap for 100%' : practiceSpeed ? `Tap for ${practiceSpeed}%` : ''}
      >
        {speed}%
        {#if speed === 100 && practiceSpeed}<span class="alt">↺ {practiceSpeed}%</span>{/if}
      </button>
      <button onclick={() => changeSpeed(5)} disabled={speed >= MAX_SPEED} aria-label="Faster">+</button>
    </div>
    <div class="pitch tempo">
      <span class="label">Tempo</span>
      <span class="bpm" class:tapping={tapBpm !== null}>
        {#if tapBpm !== null}
          {Math.round(tapBpm)} BPM
          <small>{tapCount < MIN_TAPS ? `keep tapping… ${tapCount}/${MIN_TAPS}` : 'pause to save'}</small>
        {:else if effectiveBpm}
          {effectiveBpm} BPM
          {#if speed !== 100}<small>of {Math.round(baseBpm ?? 0)}</small>{/if}
        {:else}
          <small>unknown</small>
        {/if}
      </span>
      <button class="tap" onclick={tap} aria-label="Tap tempo">Tap</button>
      {#if bpmOverride !== null && tapBpm === null && song?.bpm}
        <button class="auto" onclick={() => (bpmOverride = null)} title="Use the detected tempo">auto</button>
      {/if}
    </div>
    {#if pitchError}<p class="error pitch-error">{pitchError}</p>{/if}
  </section>

  <section class="loop">
    <div class="point">
      <button class="set" class:on={loopA !== null} onclick={setA} >Set A</button>
      <span class="t">{fmtPrecise(loopA)}</span>
      <button class="nudge" onclick={() => nudge('a', -0.1)} disabled={loopA === null} aria-label="Loop start earlier">‹</button>
      <button class="nudge" onclick={() => nudge('a', 0.1)} disabled={loopA === null} aria-label="Loop start later">›</button>
    </div>
    <div class="point">
      <button class="set" class:on={loopB !== null} onclick={setB} disabled={loopA === null} >Set B</button>
      <span class="t">{fmtPrecise(loopB)}</span>
      <button class="nudge" onclick={() => nudge('b', -0.1)} disabled={loopB === null} aria-label="Loop end earlier">‹</button>
      <button class="nudge" onclick={() => nudge('b', 0.1)} disabled={loopB === null} aria-label="Loop end later">›</button>
    </div>
    <div class="loop-actions">
      <button class="loop-toggle" class:on={loopEnabled} disabled={!loop} onclick={() => (loopEnabled = !loopEnabled)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5h10V2zM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-1h2v1a5 5 0 0 1-5 5H7v3z" /></svg>
        Loop {loopEnabled ? 'on' : 'off'}
      </button>
      <button class="clear" onclick={clearLoop} disabled={loopA === null}>Clear</button>
    </div>
  </section>

  <section class="mixer">
    <div class="mixer-head">
      <span>Mixer</span>
      <button class="reset" onclick={resetMix} disabled={isDefault}>Reset</button>
    </div>
    <div class="stem master">
      <span class="name">Master</span>
      <div class="spacer"></div>
      <input
        type="range"
        min="0"
        max="1.5"
        step="0.01"
        value={masterVolume}
        oninput={(e) => (masterVolume = +e.currentTarget.value)}
        ondblclick={() => (masterVolume = 1)}
        title="Double-tap to reset"
        aria-label="Master volume"
      />
    </div>
    {#each player.stems as stem (stem.name)}
      {@const m = mix[stem.name]}
      <div class="stem" class:silent={!isAudible(stem.name)}>
        <span class="name">{STEM_LABELS[stem.name] ?? stem.name}</span>
        <button class="toggle" class:on={m.muted} onclick={() => change(stem, { muted: !m.muted })}>M</button>
        <button class="toggle solo" class:on={m.solo} onclick={() => change(stem, { solo: !m.solo })}>S</button>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.01"
          value={m.volume}
          oninput={(e) => change(stem, { volume: +e.currentTarget.value })}
          ondblclick={() => change(stem, { volume: 1 })}
          title="Double-tap to reset"
          aria-label="{stem.name} volume"
        />
      </div>
    {/each}
  </section>
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  h1 {
    font-size: 1.15rem;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .download {
    margin-left: auto;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    color: inherit;
    border: 1px solid var(--muted);
  }
  .download svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }
  .back {
    font-size: 1.5rem;
    text-decoration: none;
    color: inherit;
    padding: 4px 8px;
  }
  .transport {
    background: var(--surface);
    border-radius: 12px;
    padding: 12px;
  }
  .time {
    display: flex;
    justify-content: space-between;
    font-variant-numeric: tabular-nums;
    color: var(--muted-text);
    font-size: 0.85rem;
    margin-top: 4px;
  }
  .buttons {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 16px;
    margin-top: 8px;
  }
  .icon {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    padding: 0;
  }
  .icon svg {
    width: 22px;
    height: 22px;
    fill: currentColor;
  }
  .play {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    padding: 0;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
  }
  .pitch {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .pitch .label {
    color: var(--muted-text);
    font-size: 0.85rem;
    margin-right: 4px;
    min-width: 5.5em;
    text-align: right;
  }
  .pitch button {
    height: 40px;
    min-width: 44px;
    border-radius: 8px;
    font-size: 1.1rem;
  }
  .pitch .value {
    min-width: 72px;
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
  }
  .pitch .value .alt {
    display: block;
    font-size: 0.7rem;
    color: var(--muted-text);
    line-height: 1;
  }
  .pitch .value.on {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 700;
  }
  .tempo .bpm {
    min-width: 72px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    line-height: 1.1;
  }
  .tempo .bpm small {
    display: block;
    font-size: 0.7rem;
    font-weight: 400;
    color: var(--muted-text);
  }
  .tempo .bpm.tapping {
    color: var(--accent);
  }
  .pitch .tap {
    min-width: 64px;
    font-size: 0.95rem;
  }
  .pitch .auto {
    min-width: 0;
    padding: 0 10px;
    font-size: 0.8rem;
  }
  .pitch-error {
    text-align: center;
    font-size: 0.85rem;
    margin: 8px 0 0;
  }
  .pitch button:disabled {
    opacity: 0.35;
  }
  .loop {
    margin-top: 12px;
    background: var(--surface);
    border-radius: 12px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .point {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .point .t {
    font-variant-numeric: tabular-nums;
    font-size: 0.85rem;
    color: var(--muted-text);
    min-width: 3.6em;
    flex: 1;
  }
  .set {
    width: 76px;
    height: 40px;
    border-radius: 8px;
    font-weight: 700;
  }
  .set.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .nudge {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    padding: 0;
  }
  .loop-actions {
    display: flex;
    gap: 8px;
  }
  .loop-toggle {
    flex: 1;
    height: 40px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-weight: 600;
  }
  .loop-toggle svg {
    width: 18px;
    height: 18px;
    fill: currentColor;
  }
  .loop-toggle.on {
    background: var(--accent);
    color: var(--on-accent);
    border-color: transparent;
  }
  .clear {
    height: 40px;
    padding: 0 16px;
    border-radius: 8px;
  }
  .loop button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .mixer-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--muted-text);
    font-size: 0.85rem;
    padding: 0 4px;
  }
  .reset {
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 0.85rem;
  }
  .reset:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .play svg {
    width: 30px;
    height: 30px;
    fill: currentColor;
  }
  .mixer {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stem {
    display: grid;
    grid-template-columns: 6.5em 44px 44px 1fr;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border-radius: 10px;
    padding: 8px 12px;
  }
  .stem.master {
    grid-template-columns: 6.5em 1fr;
  }
  .stem.master .spacer {
    display: none;
  }
  .stem.silent .name,
  .stem.silent input {
    opacity: 0.4;
  }
  .name {
    text-transform: capitalize;
    font-weight: 600;
  }
  .toggle {
    height: 40px;
    border-radius: 8px;
    font-weight: 700;
  }
  .toggle.on {
    background: var(--danger);
    color: white;
    border-color: transparent;
  }
  .toggle.solo.on {
    background: var(--warn);
    color: black;
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
</style>

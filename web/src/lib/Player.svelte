<script lang="ts">
  import { onDestroy } from 'svelte'
  import { getSong, stemUrl, type Song } from './api'
  import { PEAK_BINS, StemPlayer, type Stem } from './engine'
  import Waveform from './Waveform.svelte'

  let { id }: { id: string } = $props()

  const STEM_ORDER = ['vocals', 'guitar', 'bass', 'drums', 'piano', 'other']

  let song = $state<Song | null>(null)
  let error = $state('')
  let loaded = $state(0)
  let ready = $state(false)
  let playing = $state(false)
  let position = $state(0)
  // Bumped whenever stem settings change so derived values re-run.
  let mixVersion = $state(0)

  const player = new StemPlayer()
  let wakeLock: WakeLockSentinel | null = null
  let raf = 0

  player.onEnded = () => {
    playing = false
    releaseWakeLock()
  }

  async function init() {
    try {
      song = await getSong(id)
      const stems = [...song.stems].sort((a, b) => STEM_ORDER.indexOf(a) - STEM_ORDER.indexOf(b))
      await player.load(
        stems.map((name) => ({ name, url: stemUrl(id, name) })),
        (n) => (loaded = n),
      )
      ready = true
    } catch (e) {
      error = (e as Error).message
    }
  }
  init()

  function tick() {
    position = player.position
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

  function skip(seconds: number) {
    player.seek(player.position + seconds)
  }

  function change(stem: Stem, patch: Partial<Pick<Stem, 'volume' | 'muted' | 'solo'>>) {
    Object.assign(stem, patch)
    player.updateGains()
    mixVersion++
  }

  // `version` only makes Svelte re-evaluate this when the mix changes.
  function isAudible(stem: Stem, version: number): boolean {
    return version >= 0 && player.isAudible(stem)
  }

  const mixPeaks = $derived.by(() => {
    mixVersion
    const peaks = new Float32Array(PEAK_BINS)
    if (!ready) return peaks
    for (const stem of player.stems) {
      if (!player.isAudible(stem)) continue
      for (let i = 0; i < PEAK_BINS; i++) peaks[i] += stem.peaks[i] * stem.volume
    }
    return peaks
  })

  function fmt(t: number): string {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }
</script>

<header>
  <a href="#/" class="back" aria-label="Back to library">←</a>
  <h1>{song?.title ?? ''}</h1>
</header>

{#if error}
  <p class="error">{error}</p>
{:else if !ready}
  <p class="hint">Loading stems… {loaded}/{song?.stems.length ?? '?'}</p>
{:else}
  <section class="transport">
    <Waveform peaks={mixPeaks} {position} duration={player.duration} onseek={(t) => player.seek(t)} />
    <div class="time">
      <span>{fmt(position)}</span>
      <span>{fmt(player.duration)}</span>
    </div>
    <div class="buttons">
      <button onclick={() => skip(-10)} aria-label="Back 10 seconds">−10s</button>
      <button class="play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button onclick={() => skip(10)} aria-label="Forward 10 seconds">+10s</button>
    </div>
  </section>

  <section class="mixer">
    {#each player.stems as stem (stem.name)}
      {@const audible = isAudible(stem, mixVersion)}
      <div class="stem" class:silent={!audible}>
        <span class="name">{stem.name}</span>
        <button class="toggle" class:on={stem.muted} onclick={() => change(stem, { muted: !stem.muted })}>M</button>
        <button class="toggle solo" class:on={stem.solo} onclick={() => change(stem, { solo: !stem.solo })}>S</button>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.01"
          value={stem.volume}
          oninput={(e) => change(stem, { volume: +e.currentTarget.value })}
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
    gap: 24px;
    margin-top: 8px;
  }
  .play {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    font-size: 1.4rem;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
  }
  .mixer {
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stem {
    display: grid;
    grid-template-columns: 5.5em 44px 44px 1fr;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border-radius: 10px;
    padding: 8px 12px;
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

<script lang="ts">
  import { MIN_LOOP, PEAK_RATE } from './engine'

  let {
    peaks,
    duration,
    position,
    loopA,
    loopB,
    loopEnabled,
    onseek,
    onloopchange,
  }: {
    peaks: Float32Array
    duration: number
    position: number
    loopA: number | null
    loopB: number | null
    loopEnabled: boolean
    onseek: (time: number) => void
    onloopchange: (a: number, b: number | null) => void
  } = $props()

  const HEIGHT = 110
  const LANE = 26 // strip on top holding the A/B handles
  const TAB_W = 28
  const TOUCH_SLOP = 8 // extra px around a handle that still grabs it

  let canvas: HTMLCanvasElement
  let width = $state(0)
  let drag: 'seek' | 'a' | 'b' | null = null
  // Px from finger to the grabbed line, so a handle grabbed off-centre doesn't jump.
  let grabOffset = 0

  const x = (t: number) => (duration ? (t / duration) * width : 0)

  /** Handle rectangles in px. Tabs point outward (A left of its line, B right) so they never overlap. */
  function tabs(): { a: number | null; b: number | null } {
    const clamp = (v: number) => Math.max(0, Math.min(width - TAB_W, v))
    return {
      a: loopA === null ? null : clamp(x(loopA) - TAB_W + 1),
      b: loopB === null ? null : clamp(x(loopB) - 1),
    }
  }

  $effect(() => {
    if (!canvas || !width) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = HEIGHT * dpr
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)

    const styles = getComputedStyle(canvas)
    const accent = styles.getPropertyValue('--accent')
    const rest = styles.getPropertyValue('--muted')
    const text = styles.getPropertyValue('--text')
    const bg = styles.getPropertyValue('--surface')
    const waveH = HEIGHT - LANE
    const mid = LANE + waveH / 2

    if (loopA !== null && loopB !== null) {
      g.globalAlpha = loopEnabled ? 0.22 : 0.08
      g.fillStyle = accent
      g.fillRect(x(loopA), LANE, x(loopB) - x(loopA), waveH)
      g.globalAlpha = 1
    }

    // One bar per pixel column, using the loudest bin that falls in it.
    let max = 0.01
    for (let i = 0; i < peaks.length; i++) if (peaks[i] > max) max = peaks[i]
    const binsPerPx = (duration * PEAK_RATE) / width
    const playX = x(position)
    for (let px = 0; px < width; px++) {
      const b0 = Math.floor(px * binsPerPx)
      const b1 = Math.max(b0 + 1, Math.floor((px + 1) * binsPerPx))
      let v = 0
      for (let i = b0; i < b1 && i < peaks.length; i++) if (peaks[i] > v) v = peaks[i]
      const h = Math.max(1, (v / max) * (waveH - 4))
      g.fillStyle = px < playX ? accent : rest
      g.fillRect(px, mid - h / 2, 1, h)
    }

    // Loop lines, and their handles in the top strip.
    const tab = tabs()
    g.globalAlpha = loopEnabled || loopB === null ? 1 : 0.5
    for (const [t, tabX, label] of [
      [loopA, tab.a, 'A'],
      [loopB, tab.b, 'B'],
    ] as const) {
      if (t === null || tabX === null) continue
      g.fillStyle = text
      g.fillRect(x(t) - 1, 2, 2, HEIGHT - 2)
      g.beginPath()
      g.roundRect(tabX, 2, TAB_W, LANE - 4, 5)
      g.fill()
      g.fillStyle = bg
      g.font = 'bold 13px system-ui'
      g.textAlign = 'center'
      g.fillText(label, tabX + TAB_W / 2, LANE - 9)
    }
    g.globalAlpha = 1

    g.fillStyle = accent
    g.fillRect(playX - 1, LANE, 2, waveH)
  })

  function pointer(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }

  function timeAt(px: number): number {
    return Math.max(0, Math.min(1, px / width)) * duration
  }

  /** Only a touch on a handle grabs it; anything else moves the playhead. */
  function grab(e: PointerEvent): 'a' | 'b' | 'seek' {
    const { px, py } = pointer(e)
    if (py > LANE + TOUCH_SLOP) return 'seek'
    const tab = tabs()
    const dist = (tabX: number | null) =>
      tabX === null ? Infinity : Math.max(0, tabX - px, px - (tabX + TAB_W))
    const da = dist(tab.a)
    const db = dist(tab.b)
    if (Math.min(da, db) > TOUCH_SLOP) return 'seek'
    return da <= db ? 'a' : 'b'
  }

  function move(e: PointerEvent) {
    const t = timeAt(pointer(e).px + grabOffset)
    if (drag === 'seek') onseek(t)
    else if (drag === 'a' && loopA !== null) onloopchange(loopB === null ? t : Math.min(t, loopB - MIN_LOOP), loopB)
    else if (drag === 'b' && loopA !== null && loopB !== null) onloopchange(loopA, Math.max(t, loopA + MIN_LOOP))
  }
</script>

<div class="wave" bind:clientWidth={width} style:height="{HEIGHT}px">
  <canvas
    bind:this={canvas}
    style:width="{width}px"
    style:height="{HEIGHT}px"
    onpointerdown={(e) => {
      drag = grab(e)
      const line = drag === 'a' ? loopA : drag === 'b' ? loopB : null
      grabOffset = line === null ? 0 : x(line) - pointer(e).px
      canvas.setPointerCapture(e.pointerId)
      if (drag === 'seek') move(e)
    }}
    onpointermove={(e) => drag && move(e)}
    onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)}
  ></canvas>
</div>

<style>
  .wave {
    touch-action: none;
  }
  canvas {
    display: block;
  }
</style>

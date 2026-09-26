<script lang="ts">
  import { MIN_LOOP, PEAK_RATE, type View } from './engine'

  let {
    peaks,
    view,
    position,
    loopA,
    loopB,
    loopEnabled,
    editLoop = false,
    height = 96,
    onseek,
    onloopchange,
  }: {
    peaks: Float32Array
    view: View
    position: number
    loopA: number | null
    loopB: number | null
    loopEnabled: boolean
    /** Show the handle strip on top, where A/B are dragged. Elsewhere, a touch always seeks. */
    editLoop?: boolean
    height?: number
    onseek: (time: number) => void
    onloopchange?: (a: number, b: number | null) => void
  } = $props()

  const LANE = 26 // height of the handle strip
  const TAB_W = 26

  let canvas: HTMLCanvasElement
  let width = $state(0)
  let drag: 'seek' | 'a' | 'b' | null = null
  // The view is frozen while a handle is dragged, so the handle doesn't run away from the finger.
  let frozenView = $state<View | null>(null)
  const activeView = $derived(frozenView ?? view)

  $effect(() => {
    if (!canvas || !width) return
    const { start, end } = activeView
    const span = Math.max(end - start, 0.001)
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)

    const styles = getComputedStyle(canvas)
    const accent = styles.getPropertyValue('--accent')
    const rest = styles.getPropertyValue('--muted')
    const text = styles.getPropertyValue('--text')
    const bg = styles.getPropertyValue('--surface')
    const x = (t: number) => ((t - start) / span) * width

    const top = editLoop ? LANE : 0
    const waveH = height - top
    const mid = top + waveH / 2

    if (loopA !== null && loopB !== null) {
      g.globalAlpha = loopEnabled ? 0.22 : 0.08
      g.fillStyle = accent
      g.fillRect(x(loopA), top, x(loopB) - x(loopA), waveH)
      g.globalAlpha = 1
    }

    // One bar per pixel column, using the loudest bin that falls in it.
    const firstBin = Math.floor(start * PEAK_RATE)
    const lastBin = Math.min(peaks.length, Math.ceil(end * PEAK_RATE))
    let max = 0.01
    for (let i = firstBin; i < lastBin; i++) if (peaks[i] > max) max = peaks[i]
    const playX = x(position)
    const binsPerPx = (span * PEAK_RATE) / width
    for (let px = 0; px < width; px++) {
      const b0 = Math.floor(firstBin + px * binsPerPx)
      const b1 = Math.max(b0 + 1, Math.floor(firstBin + (px + 1) * binsPerPx))
      let v = 0
      for (let i = b0; i < b1 && i < peaks.length; i++) if (peaks[i] > v) v = peaks[i]
      const h = Math.max(1, (v / max) * (waveH - 4))
      g.fillStyle = px < playX ? accent : rest
      g.fillRect(px, mid - h / 2, 1, h)
    }

    // Loop markers, with A/B tabs in the handle strip when editing.
    g.globalAlpha = loopEnabled || loopB === null ? 1 : 0.5
    for (const [t, label] of [[loopA, 'A'], [loopB, 'B']] as const) {
      if (t === null) continue
      const lx = x(t)
      g.fillStyle = text
      g.fillRect(lx - 1, top, 2, waveH)
      if (editLoop) {
        const tabX = label === 'A' ? lx - 1 : lx - TAB_W + 1
        g.beginPath()
        g.roundRect(tabX, 2, TAB_W, LANE - 4, 5)
        g.fill()
        g.fillStyle = bg
        g.font = 'bold 13px system-ui'
        g.textAlign = 'center'
        g.fillText(label, tabX + TAB_W / 2, LANE - 9)
        g.fillStyle = text
      }
    }
    g.globalAlpha = 1

    if (position >= start && position <= end) {
      g.fillStyle = accent
      g.fillRect(playX - 1, top, 2, waveH)
    }
  })

  function timeAt(e: PointerEvent): number {
    const rect = canvas.getBoundingClientRect()
    const { start, end } = activeView
    const t = start + ((e.clientX - rect.left) / rect.width) * (end - start)
    return Math.max(start, Math.min(end, t))
  }

  function grab(e: PointerEvent): 'a' | 'b' | 'seek' {
    const rect = canvas.getBoundingClientRect()
    if (!editLoop || e.clientY - rect.top > LANE || loopA === null) return 'seek'
    if (loopB === null) return 'a'
    // In the strip, the nearer handle wins; the midpoint between them is the boundary.
    return timeAt(e) < (loopA + loopB) / 2 ? 'a' : 'b'
  }

  function move(e: PointerEvent) {
    const t = timeAt(e)
    if (drag === 'seek') onseek(t)
    else if (drag === 'a' && loopA !== null) onloopchange?.(loopB === null ? t : Math.min(t, loopB - MIN_LOOP), loopB)
    else if (drag === 'b' && loopA !== null && loopB !== null) onloopchange?.(loopA, Math.max(t, loopA + MIN_LOOP))
  }

  function release() {
    drag = null
    frozenView = null
  }
</script>

<div class="wave" bind:clientWidth={width} style:height="{height}px">
  <canvas
    bind:this={canvas}
    style:width="{width}px"
    style:height="{height}px"
    onpointerdown={(e) => {
      drag = grab(e)
      if (drag !== 'seek') frozenView = view
      canvas.setPointerCapture(e.pointerId)
      move(e)
    }}
    onpointermove={(e) => drag && move(e)}
    onpointerup={release}
    onpointercancel={release}
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

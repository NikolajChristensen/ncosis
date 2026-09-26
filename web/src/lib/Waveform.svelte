<script lang="ts">
  import { MIN_LOOP, PEAK_BINS, type Loop } from './engine'

  let {
    peaks,
    position,
    duration,
    loop,
    loopEnabled,
    onseek,
    onloopchange,
  }: {
    peaks: Float32Array
    position: number
    duration: number
    loop: Loop | null
    loopEnabled: boolean
    onseek: (time: number) => void
    onloopchange: (loop: Loop) => void
  } = $props()

  // How close (px) a touch must be to a loop handle to grab it.
  const HANDLE_GRAB = 20

  let canvas: HTMLCanvasElement
  let width = $state(0)
  let height = $state(0)
  let drag: 'seek' | 'start' | 'end' | null = null

  $effect(() => {
    if (!canvas || !width || !height) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)

    const styles = getComputedStyle(canvas)
    const played = styles.getPropertyValue('--wave-played')
    const rest = styles.getPropertyValue('--wave-rest')
    const max = Math.max(...peaks, 0.01)
    const mid = height / 2
    const x = (t: number) => (duration ? (t / duration) * width : 0)
    const playX = x(position)
    const barW = width / PEAK_BINS

    if (loop) {
      g.globalAlpha = loopEnabled ? 0.22 : 0.08
      g.fillStyle = played
      g.fillRect(x(loop.start), 0, x(loop.end) - x(loop.start), height)
      g.globalAlpha = 1
    }

    for (let i = 0; i < PEAK_BINS; i++) {
      const bx = i * barW
      const h = Math.max(1, (peaks[i] / max) * (height - 4))
      g.fillStyle = bx < playX ? played : rest
      g.fillRect(bx, mid - h / 2, Math.max(barW, 1), h)
    }

    if (loop) {
      g.globalAlpha = loopEnabled ? 1 : 0.4
      for (const [t, label] of [[loop.start, 'A'], [loop.end, 'B']] as const) {
        const lx = x(t)
        g.fillStyle = styles.getPropertyValue('--text')
        g.fillRect(lx - 1, 0, 2, height)
        // Tab at the top of the handle, pointing into the loop.
        const tabX = label === 'A' ? lx : lx - 14
        g.fillRect(tabX, 0, 14, 14)
        g.fillStyle = styles.getPropertyValue('--bg')
        g.font = 'bold 10px system-ui'
        g.fillText(label, tabX + 3.5, 11)
      }
      g.globalAlpha = 1
    }

    g.fillStyle = played
    g.fillRect(playX - 1, 0, 2, height)
  })

  function timeAt(e: PointerEvent): number {
    const rect = canvas.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration
  }

  function grab(e: PointerEvent): 'start' | 'end' | null {
    if (!loop) return null
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const dStart = Math.abs(px - (loop.start / duration) * rect.width)
    const dEnd = Math.abs(px - (loop.end / duration) * rect.width)
    if (Math.min(dStart, dEnd) > HANDLE_GRAB) return null
    return dStart <= dEnd ? 'start' : 'end'
  }

  function move(e: PointerEvent) {
    const t = timeAt(e)
    if (drag === 'seek') onseek(t)
    else if (drag === 'start' && loop) onloopchange({ start: Math.min(t, loop.end - MIN_LOOP), end: loop.end })
    else if (drag === 'end' && loop) onloopchange({ start: loop.start, end: Math.max(t, loop.start + MIN_LOOP) })
  }
</script>

<div class="wave" bind:clientWidth={width} bind:clientHeight={height}>
  <canvas
    bind:this={canvas}
    style:width="{width}px"
    style:height="{height}px"
    onpointerdown={(e) => {
      drag = grab(e) ?? 'seek'
      canvas.setPointerCapture(e.pointerId)
      move(e)
    }}
    onpointermove={(e) => drag && move(e)}
    onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)}
  ></canvas>
</div>

<style>
  .wave {
    height: 96px;
    touch-action: none;
  }
  canvas {
    display: block;
    --wave-played: var(--accent);
    --wave-rest: var(--muted);
  }
</style>

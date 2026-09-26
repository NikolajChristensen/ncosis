<script lang="ts">
  import { PEAK_BINS } from './engine'

  let {
    peaks,
    position,
    duration,
    onseek,
  }: {
    peaks: Float32Array
    position: number
    duration: number
    onseek: (time: number) => void
  } = $props()

  let canvas: HTMLCanvasElement
  let width = $state(0)
  let height = $state(0)
  let dragging = false

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
    const playX = duration ? (position / duration) * width : 0
    const barW = width / PEAK_BINS

    for (let i = 0; i < PEAK_BINS; i++) {
      const x = i * barW
      const h = Math.max(1, (peaks[i] / max) * (height - 4))
      g.fillStyle = x < playX ? played : rest
      g.fillRect(x, mid - h / 2, Math.max(barW, 1), h)
    }
    g.fillStyle = played
    g.fillRect(playX - 1, 0, 2, height)
  })

  function timeAt(e: PointerEvent): number {
    const rect = canvas.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration
  }
</script>

<div class="wave" bind:clientWidth={width} bind:clientHeight={height}>
  <canvas
    bind:this={canvas}
    style:width="{width}px"
    style:height="{height}px"
    onpointerdown={(e) => {
      dragging = true
      canvas.setPointerCapture(e.pointerId)
      onseek(timeAt(e))
    }}
    onpointermove={(e) => dragging && onseek(timeAt(e))}
    onpointerup={() => (dragging = false)}
    onpointercancel={() => (dragging = false)}
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

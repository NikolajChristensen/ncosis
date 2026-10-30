<script lang="ts">
  // THROWAWAY — Phase 0 de-risking spike for the backend-removal plan. Not meant to survive;
  // delete this file (and its route in App.svelte) once the four checks below have passed on
  // a real device. See /home/musicmad/.claude/plans/validated-dreaming-sutherland.md Phase 0.
  import SignalsmithStretch from 'signalsmith-stretch'

  let token = $state('')
  let log = $state<string[]>([])
  let running = $state(false)

  function line(msg: string) {
    log = [...log, msg]
  }

  // A few seconds of a simple two-tone mix, encoded as 16-bit PCM WAV, so there's a real
  // audio file to upload — MVSEP's API doesn't care that it's synthetic, only that it's
  // real audio bytes sent as a multipart file.
  function makeTestWav(seconds = 6, sampleRate = 44100): Blob {
    const frames = seconds * sampleRate
    const data = new Int16Array(frames * 2) // stereo
    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate
      const s = 0.2 * Math.sin(2 * Math.PI * 220 * t) + 0.15 * Math.sin(2 * Math.PI * 440 * t)
      const v = Math.max(-1, Math.min(1, s)) * 32767
      data[i * 2] = v
      data[i * 2 + 1] = v
    }
    const bytesPerSample = 2
    const blockAlign = bytesPerSample * 2
    const byteRate = sampleRate * blockAlign
    const dataSize = data.length * bytesPerSample
    const buf = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buf)
    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
    }
    writeStr(0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    writeStr(8, 'WAVE')
    writeStr(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 2, true) // stereo
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, 16, true) // bits per sample
    writeStr(36, 'data')
    view.setUint32(40, dataSize, true)
    new Int16Array(buf, 44).set(data)
    return new Blob([buf], { type: 'audio/wav' })
  }

  async function submit(blob: Blob): Promise<string> {
    const form = new FormData()
    form.append('api_token', token)
    form.append('sep_type', '101')
    form.append('add_opt1', '0')
    form.append('output_format', '2')
    form.append('audiofile', blob, 'spike-test.wav')
    const res = await fetch('https://mvsep.com/api/separation/create', { method: 'POST', body: form })
    const body = await res.json()
    if (!body.success) throw new Error(body.data?.message ?? `upload failed (${res.status})`)
    return body.data.hash
  }

  async function poll(hash: string): Promise<{ url: string }[]> {
    const deadline = Date.now() + 10 * 60 * 1000
    while (true) {
      const res = await fetch(`https://mvsep.com/api/separation/get?hash=${hash}`)
      const body = await res.json()
      if (body.status === 'done') return body.data.files
      if (body.status === 'failed' || !body.success) throw new Error(body.data?.message ?? 'separation failed')
      if (Date.now() > deadline) throw new Error('timed out waiting for MVSEP')
      line(`  ...${body.status}${body.data?.current_order ? ` (queue position ${body.data.current_order})` : ''}`)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }

  async function run() {
    log = []
    running = true
    try {
      line('1. Native HTTP: submitting test file to MVSEP...')
      const hash = await submit(makeTestWav())
      line(`   submitted, job hash ${hash}`)
      line('   polling (this takes a few minutes)...')
      const files = await poll(hash)
      line(`   PASS — separation done, ${files.length} output file(s)`)

      line('2. Downloading + decoding a result file...')
      const res = await fetch(files[0].url)
      const bytes = await res.arrayBuffer()
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(bytes)
      line(`   PASS — decoded ${buffer.duration.toFixed(1)}s of audio, ${buffer.numberOfChannels}ch @ ${buffer.sampleRate}Hz`)

      line('3. AudioWorklet (pitch shifter)...')
      const shifter = await SignalsmithStretch(ctx)
      line(`   PASS — worklet loaded, latency ${shifter.latency()}s`)

      line('4. Wake Lock...')
      const wl = await navigator.wakeLock.request('screen')
      await wl.release()
      line('   PASS — wake lock acquired and released')

      line('')
      line('ALL CHECKS PASSED')
    } catch (e) {
      line('')
      line(`FAILED: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      running = false
    }
  }
</script>

<main class="spike">
  <h1>Phase 0 spike</h1>
  <p>Paste your MVSEP token, then run. This takes several minutes (real separation job).</p>
  <input type="password" placeholder="MVSEP API token" bind:value={token} />
  <button onclick={run} disabled={running || !token}>{running ? 'Running…' : 'Run checks'}</button>
  <pre>{log.join('\n')}</pre>
</main>

<style>
  .spike {
    padding: 1rem;
    font-family: monospace;
    color: #eee;
    background: #121215;
    min-height: 100vh;
  }
  input {
    width: 100%;
    margin: 0.5rem 0;
    padding: 0.5rem;
  }
  pre {
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
  }
</style>

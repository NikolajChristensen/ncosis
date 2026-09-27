<script lang="ts">
  import { onDestroy } from 'svelte'
  import { deleteSong, getConfig, listSongs, retrySong, uploadSong, type ServerConfig, type Song } from './api'

  let songs = $state<Song[]>([])
  let error = $state('') // from an action like uploading; stays until the next action
  let loadError = $state('') // from refreshing the list; clears once the server answers again
  let uploading = $state('')
  let now = $state(Date.now() / 1000)
  let timer = 0
  let serverConfig = $state<ServerConfig | null>(null)
  getConfig().then((c) => (serverConfig = c), () => {})

  // Stems the current server produces; older songs without them can be reprocessed.
  const CURRENT_STEMS = ['lead', 'rhythm', 'backing']

  async function refresh() {
    try {
      songs = await listSongs()
      loadError = ''
    } catch (e) {
      loadError = (e as Error).message
    }
    now = Date.now() / 1000
    // Poll while the server is still working on something.
    const busy = songs.some((s) => s.status === 'queued' || s.status === 'processing')
    clearTimeout(timer)
    timer = setTimeout(refresh, busy ? 3000 : 30000)
  }
  refresh()
  onDestroy(() => clearTimeout(timer))

  function pick(e: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(e.currentTarget.files ?? [])]
    e.currentTarget.value = ''
    upload(files)
  }

  const AUDIO_EXT = /\.(mp3|flac|wav|m4a|aac|ogg|opus|aiff?)$/i
  let dragging = $state(false)
  let notice = $state('')

  // Songs can also be dragged in from a file manager, which avoids the file dialog.
  function drop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const files = [...(e.dataTransfer?.files ?? [])]
    if (!files.length) {
      // Some file managers hand over only links to files the browser can't open.
      const types = [...(e.dataTransfer?.types ?? [])].join(', ') || 'nothing'
      const uris = e.dataTransfer?.getData('text/uri-list').split('\n').filter(Boolean).slice(0, 3).join(' ') ?? ''
      error = `The browser received no files from this drop (got: ${types}${uris ? `; ${uris}` : ''}).`
      return
    }
    const audio = files.filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name))
    const skipped = files.length - audio.length
    notice = skipped ? `Skipped ${skipped} file${skipped > 1 ? 's' : ''} that ${skipped > 1 ? "aren't" : "isn't"} audio.` : ''
    if (audio.length) upload(audio)
  }

  async function upload(files: File[]) {
    error = ''
    for (const file of files) {
      uploading = file.name
      try {
        await uploadSong(file)
      } catch (err) {
        error = `${file.name}: ${(err as Error).message}`
      }
    }
    uploading = ''
    refresh()
  }

  async function retry(song: Song) {
    await retrySong(song.id)
    refresh()
  }

  async function remove(song: Song) {
    if (!confirm(`Delete "${song.title}" and its stems?`)) return
    await deleteSong(song.id)
    refresh()
  }

  function statusText(song: Song): string {
    switch (song.status) {
      case 'queued':
        return 'Waiting in queue'
      case 'processing': {
        const secs = Math.round(now - (song.started_at ?? now))
        return `${song.notes ?? 'Uploading to MVSEP'}… ${Math.floor(secs / 60)}m ${secs % 60}s`
      }
      case 'error':
        return `Failed: ${song.error}`
      default:
        return song.duration ? `${Math.floor(song.duration / 60)}:${String(Math.round(song.duration % 60)).padStart(2, '0')}` : ''
    }
  }
</script>

<svelte:window
  ondragover={(e) => {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    dragging = true
  }}
  ondragleave={(e) => {
    // Only when the pointer leaves the window, not when it moves between elements.
    if (!e.relatedTarget) dragging = false
  }}
  ondrop={drop}
/>

{#if dragging}<div class="dropzone">Drop songs to add them</div>{/if}

<header>
  <h1>ncosis</h1>
  <label class="upload" class:busy={uploading}>
    {uploading ? 'Uploading…' : '+ Add song'}
    <input type="file" accept="audio/*,.flac,.mp3,.wav,.m4a,.ogg,.opus" multiple onchange={pick} disabled={!!uploading} />
  </label>
</header>

{#if error}<p class="error">{error}</p>{/if}
{#if loadError}<p class="error">{loadError}</p>{/if}
{#if notice}<p class="hint">{notice}</p>{/if}

{#if songs.length === 0 && !loadError}
  <p class="hint">
    No songs yet. Add an mp3, flac or wav file, or drag songs onto this page. Separation takes a few minutes per song.
  </p>
{/if}

{#if serverConfig && !serverConfig.mvsepConfigured}
  <p class="error">The server has no MVSEP API token, so new songs can't be separated.</p>
{/if}

<ul>
  {#each songs as song (song.id)}
    <li>
      {#if song.status === 'done'}
        <a href="#/song/{song.id}" class="title">{song.title}</a>
      {:else}
        <span class="title pending">{song.title}</span>
      {/if}
      <span class="status" class:err={song.status === 'error'}>
        {statusText(song)}
        {#if song.status === 'error'}<button class="retry" onclick={() => retry(song)}>Retry</button>{/if}
        {#if song.status === 'done' && !CURRENT_STEMS.every((s) => song.stems.includes(s))}
          <button class="retry" onclick={() => retry(song)}>Reprocess</button>
        {/if}
      </span>
      <button class="delete" onclick={() => remove(song)} aria-label="Delete {song.title}">✕</button>
    </li>
  {/each}
</ul>

{#if serverConfig}<footer>ncosis {serverConfig.version}</footer>{/if}

<style>
  .dropzone {
    position: fixed;
    inset: 12px;
    z-index: 10;
    display: grid;
    place-items: center;
    border: 3px dashed var(--accent);
    border-radius: 16px;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    color: var(--accent);
    font-size: 1.3rem;
    font-weight: 700;
    pointer-events: none;
  }
  footer {
    margin-top: 32px;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-text);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .upload {
    background: var(--accent);
    color: var(--on-accent);
    padding: 10px 16px;
    border-radius: 999px;
    font-weight: 600;
    cursor: pointer;
  }
  .upload.busy {
    opacity: 0.6;
  }
  .upload input {
    display: none;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'title delete' 'status delete';
    align-items: center;
    column-gap: 8px;
    background: var(--surface);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .title {
    grid-area: title;
    font-weight: 600;
    color: inherit;
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .title.pending {
    opacity: 0.6;
  }
  .status {
    grid-area: status;
    font-size: 0.85rem;
    color: var(--muted-text);
  }
  .status.err {
    color: var(--danger);
  }
  .retry {
    margin-left: 8px;
    padding: 2px 10px;
    border-radius: 6px;
    font-size: 0.85rem;
  }
  .delete {
    grid-area: delete;
    width: 40px;
    height: 40px;
    border-radius: 8px;
  }
</style>

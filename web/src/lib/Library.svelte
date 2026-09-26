<script lang="ts">
  import { onDestroy } from 'svelte'
  import { deleteSong, listSongs, retrySong, uploadSong, type Song } from './api'

  let songs = $state<Song[]>([])
  let error = $state('')
  let uploading = $state('')
  let now = $state(Date.now() / 1000)
  let timer = 0

  async function refresh() {
    try {
      songs = await listSongs()
      error = ''
    } catch (e) {
      error = (e as Error).message
    }
    now = Date.now() / 1000
    // Poll while the server is still working on something.
    const busy = songs.some((s) => s.status === 'queued' || s.status === 'processing')
    clearTimeout(timer)
    timer = setTimeout(refresh, busy ? 3000 : 30000)
  }
  refresh()
  onDestroy(() => clearTimeout(timer))

  async function upload(e: Event & { currentTarget: HTMLInputElement }) {
    const files = [...(e.currentTarget.files ?? [])]
    e.currentTarget.value = ''
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
        return `Separating… ${Math.floor(secs / 60)}m ${secs % 60}s`
      }
      case 'error':
        return `Failed: ${song.error}`
      default:
        return song.duration ? `${Math.floor(song.duration / 60)}:${String(Math.round(song.duration % 60)).padStart(2, '0')}` : ''
    }
  }
</script>

<header>
  <h1>ncosis</h1>
  <label class="upload" class:busy={uploading}>
    {uploading ? 'Uploading…' : '+ Add song'}
    <input type="file" accept="audio/*,.flac,.mp3,.wav,.m4a,.ogg,.opus" multiple onchange={upload} disabled={!!uploading} />
  </label>
</header>

{#if error}<p class="error">{error}</p>{/if}

{#if songs.length === 0 && !error}
  <p class="hint">No songs yet. Add an mp3, flac or wav file. Separation takes a few minutes per song.</p>
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
      </span>
      <button class="delete" onclick={() => remove(song)} aria-label="Delete {song.title}">✕</button>
    </li>
  {/each}
</ul>

<style>
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

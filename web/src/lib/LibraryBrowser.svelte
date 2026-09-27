<script lang="ts">
  import { addFromLibrary, listLibrary, type LibraryEntry } from './api'

  const MAX_SHOWN = 200

  let entries = $state<LibraryEntry[] | null>(null)
  let error = $state('')
  let query = $state('')
  let adding = $state<Record<string, 'adding' | 'failed'>>({})

  listLibrary().then(
    (list) => (entries = list),
    (e) => (error = (e as Error).message),
  )

  // Every word must appear somewhere in the path, in any order ("priest ruins").
  const matches = $derived.by(() => {
    if (!entries) return []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return entries.filter((e) => words.every((w) => e.path.toLowerCase().includes(w)))
  })

  function split(path: string) {
    const slash = path.lastIndexOf('/')
    const file = path.slice(slash + 1)
    return { name: file.replace(/\.[^.]+$/, ''), folder: slash > 0 ? path.slice(0, slash) : '' }
  }

  async function add(entry: LibraryEntry) {
    adding[entry.path] = 'adding'
    try {
      entry.song = (await addFromLibrary(entry.path)).id
      delete adding[entry.path]
    } catch (e) {
      adding[entry.path] = 'failed'
      error = `${split(entry.path).name}: ${(e as Error).message}`
    }
  }
</script>

<header>
  <a href="#/" class="back" aria-label="Back to your songs">←</a>
  <h1>Add from library</h1>
</header>

<!-- svelte-ignore a11y_autofocus -->
<input class="search" type="search" placeholder="Search artist or song" bind:value={query} autofocus />

{#if error}<p class="error">{error}</p>{/if}

{#if entries === null && !error}
  <p class="hint">Reading your music library…</p>
{:else if entries}
  <p class="hint">
    {matches.length} of {entries.length} songs{matches.length > MAX_SHOWN ? ` · showing the first ${MAX_SHOWN}, search to narrow down` : ''}
  </p>
  <ul>
    {#each matches.slice(0, MAX_SHOWN) as entry (entry.path)}
      {@const { name, folder } = split(entry.path)}
      <li>
        <span class="name">{name}</span>
        {#if folder}<span class="folder">{folder}</span>{/if}
        {#if entry.song}
          <a class="action added" href="#/song/{entry.song}">Added ✓</a>
        {:else}
          <button class="action" onclick={() => add(entry)} disabled={adding[entry.path] === 'adding'}>
            {adding[entry.path] === 'adding' ? 'Adding…' : adding[entry.path] === 'failed' ? 'Retry' : 'Add'}
          </button>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0;
  }
  .back {
    font-size: 1.5rem;
    text-decoration: none;
    color: inherit;
    padding: 4px 8px;
  }
  .search {
    width: 100%;
    font: inherit;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--muted);
    background: var(--surface);
    color: var(--text);
  }
  .hint {
    font-size: 0.85rem;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'name action' 'folder action';
    align-items: center;
    column-gap: 10px;
    background: var(--surface);
    border-radius: 10px;
    padding: 8px 12px;
  }
  .name {
    grid-area: name;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .folder {
    grid-area: folder;
    font-size: 0.8rem;
    color: var(--muted-text);
    overflow-wrap: anywhere;
  }
  .action {
    grid-area: action;
    min-width: 76px;
    padding: 8px 12px;
    border-radius: 999px;
    font-weight: 600;
    text-align: center;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
  }
  .action:disabled {
    opacity: 0.6;
  }
  .action.added {
    background: transparent;
    color: var(--muted-text);
    border: 1px solid var(--muted);
    text-decoration: none;
  }
</style>

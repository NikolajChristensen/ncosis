<script lang="ts">
  import Library from './lib/Library.svelte'
  import LibraryBrowser from './lib/LibraryBrowser.svelte'
  import Player from './lib/Player.svelte'
  import Spike from './lib/Spike.svelte'

  let hash = $state(location.hash)
  const songId = $derived(hash.match(/^#\/song\/([\w-]+)/)?.[1] ?? null)
</script>

<svelte:window onhashchange={() => (hash = location.hash)} />

<main>
  {#if hash.startsWith('#/spike') || hash === ''}
    <Spike />
  {:else if hash.startsWith('#/add')}
    <LibraryBrowser />
  {:else if songId}
    {#key songId}
      <Player id={songId} />
    {/key}
  {:else}
    <Library />
  {/if}
</main>

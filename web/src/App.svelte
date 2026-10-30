<script lang="ts">
  import Library from './lib/Library.svelte'
  import Player from './lib/Player.svelte'
  import Settings from './lib/Settings.svelte'

  let hash = $state(location.hash)
  const songId = $derived(hash.match(/^#\/song\/([\w-]+)/)?.[1] ?? null)
</script>

<svelte:window onhashchange={() => (hash = location.hash)} />

<main>
  {#if hash.startsWith('#/settings')}
    <Settings />
  {:else if songId}
    {#key songId}
      <Player id={songId} />
    {/key}
  {:else}
    <Library />
  {/if}
</main>

<script lang="ts">
  import { App } from '@capacitor/app'
  import { getMvsepToken, setMvsepToken } from './settings'
  import { importBackup } from './importBackup'

  let token = $state('')
  let saved = $state(false)
  let version = $state('')
  let importing = $state(false)
  let importResult = $state('')
  let importError = $state('')

  getMvsepToken().then((t) => (token = t ?? ''))
  App.getInfo().then(
    (info) => (version = info.version),
    () => {},
  )

  async function save() {
    await setMvsepToken(token)
    saved = true
    setTimeout(() => (saved = false), 1500)
  }

  async function pickBackup(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!file) return
    importing = true
    importError = ''
    importResult = ''
    try {
      const { imported, skipped } = await importBackup(file)
      importResult = `Imported ${imported} song${imported === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} already present` : ''}.`
    } catch (e) {
      importError = (e as Error).message
    } finally {
      importing = false
    }
  }
</script>

<header>
  <a href="#/" class="back" aria-label="Back to your songs">←</a>
  <h1>Settings</h1>
</header>

<section>
  <label for="token">MVSEP API token</label>
  <p class="hint">Needed to separate new songs. Get your own at mvsep.com — it's never shared with anyone else.</p>
  <input id="token" type="password" placeholder="Paste your token" bind:value={token} />
  <button onclick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
</section>

<section>
  <label for="backup">Import backup</label>
  <p class="hint">Restore songs and settings from a ncosis-backup.zip exported from the old server.</p>
  <label class="upload" class:busy={importing}>
    {importing ? 'Importing…' : 'Choose backup file'}
    <input id="backup" type="file" accept=".zip" onchange={pickBackup} disabled={importing} />
  </label>
  {#if importResult}<p class="hint">{importResult}</p>{/if}
  {#if importError}<p class="error">{importError}</p>{/if}
</section>

{#if version}<footer>ncosis {version}</footer>{/if}

<style>
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
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
  section {
    background: var(--surface);
    border-radius: 12px;
    padding: 14px;
    margin-bottom: 16px;
  }
  label {
    font-weight: 600;
  }
  .hint {
    font-size: 0.85rem;
    color: var(--muted-text);
    margin: 4px 0 10px;
  }
  input[type='password'] {
    width: 100%;
    font: inherit;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid var(--muted);
    background: var(--bg);
    color: var(--text);
    margin-bottom: 10px;
  }
  button {
    padding: 8px 16px;
    border-radius: 999px;
  }
  .upload {
    display: inline-block;
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
  footer {
    margin-top: 32px;
    text-align: center;
    font-size: 0.75rem;
    color: var(--muted-text);
  }
</style>

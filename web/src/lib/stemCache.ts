// Keeps downloaded stems on the device (Cache Storage), so reopening a song skips the download
// and works offline. Stem URLs carry a version, so reprocessed songs fetch their new stems.

const CACHE = 'ncosis-stems'
const MAX_SONGS = 30
const USAGE_KEY = 'ncosis:stem-cache' // songId -> last opened (ms)

function usage(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(USAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** Fetch a stem, from the device cache when possible. Falls back to the network if caching fails. */
export async function fetchStem(url: string): Promise<Response> {
  if (!('caches' in window)) return fetch(url)
  try {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(url)
    if (hit) return hit
    const res = await fetch(url)
    if (res.ok) await cache.put(url, res.clone())
    return res
  } catch {
    return fetch(url)
  }
}

/** Note that a song was opened, and drop stems of old versions and of the least recently opened songs. */
export async function touchSong(songId: string, currentUrls: string[]) {
  if (!('caches' in window)) return
  try {
    const used = { ...usage(), [songId]: Date.now() }
    const keep = new Set(
      Object.entries(used)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_SONGS)
        .map(([id]) => id),
    )
    const current = new Set(currentUrls.map((u) => new URL(u, location.href).href))
    const cache = await caches.open(CACHE)
    for (const req of await cache.keys()) {
      const id = new URL(req.url).pathname.split('/')[3] // /api/songs/<id>/stems/<stem>.opus
      const outdated = id === songId && !current.has(req.url)
      if (outdated || !keep.has(id)) await cache.delete(req)
    }
    localStorage.setItem(USAGE_KEY, JSON.stringify(Object.fromEntries([...keep].map((id) => [id, used[id]]))))
  } catch {}
}

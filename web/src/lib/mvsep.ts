// MVSEP API client (https://mvsep.com/en/full_api), ported from backend/ncosis/mvsep.py.
// Runs through CapacitorHttp's native networking (see capacitor.config.ts) instead of the
// WebView's fetch, since mvsep.com sends no CORS headers at all.

const API = 'https://mvsep.com/api'
const LEAD_RHYTHM_GUITAR = '101' // "MVSep Lead/Rhythm Guitar"
const TWO_STAGE_MODEL = '0' // the better of its two model types
const FLAC = '2'
const POLL_MS = 5000
const TIMEOUT_MS = 60 * 60 * 1000

// MVSEP output type -> our stem name. Its "all guitar" output isn't needed.
const OUTPUTS: [RegExp, string][] = [
  [/\blead\b/, 'lead'],
  [/\brhythm\b/, 'rhythm'],
  [/\bno[\s_-]?guitar\b/, 'backing'],
]
const STEMS = new Set(OUTPUTS.map(([, stem]) => stem))

class MvsepError extends Error {}

async function asJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    throw new MvsepError(`unexpected response (${res.status})`)
  }
}

/** Upload a song for separation. Returns the job hash. */
export async function submit(file: File, token: string): Promise<string> {
  const form = new FormData()
  form.append('api_token', token)
  form.append('sep_type', LEAD_RHYTHM_GUITAR)
  form.append('add_opt1', TWO_STAGE_MODEL)
  form.append('output_format', FLAC)
  form.append('audiofile', file, file.name) // the filename arg is what makes this a File part, not a bare Blob
  const res = await fetch(`${API}/separation/create`, { method: 'POST', body: form })
  const body = await asJson(res)
  if (!body.success) throw new MvsepError(body.data?.message ?? `upload failed (${res.status})`)
  return body.data.hash
}

/** Wait for a job, reporting progress through `onWait`. Returns {stem name: download url}. */
export async function poll(job: string, onWait: (msg: string) => void): Promise<Record<string, string>> {
  const deadline = Date.now() + TIMEOUT_MS
  while (true) {
    const res = await fetch(`${API}/separation/get?hash=${job}`)
    const body = await asJson(res)
    const data = body.data ?? {}
    if (body.status === 'done') return mapOutputs(data.files ?? [])
    if (body.status === 'failed' || !body.success) throw new MvsepError(data.message ?? 'separation failed')
    if (Date.now() > deadline) throw new MvsepError('timed out waiting for MVSEP')
    if (body.status === 'waiting' && data.current_order) onWait(`In MVSEP queue: position ${data.current_order}`)
    else if (body.status === 'processing') onWait('MVSEP is separating')
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

function mapOutputs(files: { type?: string; name?: string; url: string }[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const file of files) {
    const kind = (file.type ?? file.name ?? '').toLowerCase()
    const stem = OUTPUTS.find(([re]) => re.test(kind))?.[1]
    if (stem) result[stem] = file.url
  }
  if (![...STEMS].every((stem) => stem in result)) {
    throw new MvsepError(`unexpected outputs: ${files.map((f) => f.type ?? f.name).join(', ')}`)
  }
  return result
}

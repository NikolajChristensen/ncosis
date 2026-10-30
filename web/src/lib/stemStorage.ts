// On-device storage for each song's source file and separated stems, via Capacitor Filesystem.
// Replaces the server's SONGS_DIR. Layout: songs/<id>/source.<ext>, songs/<id>/stems/<stem>.<ext>.
//
// Writes go through Filesystem.writeFile/appendFile, which move data as base64 strings in JSON
// messages across the native bridge — for a multi-ten-MB stem, one giant string in a single call
// can exceed the WebView process's heap (confirmed on-device: a ~75MB base64 string blew a
// ~256MB heap in org.json.JSONStringer, crashing the app with OutOfMemoryError), so writes are
// chunked and use the WebView's native base64 codec (Blob/FileReader) instead of JS loops.
// Reads don't need any of that: Capacitor.convertFileSrc() + fetch() lets the WebView's own
// native file loader stream the file directly (confirmed via native-bridge.js: requests to the
// app's own server origin, which these are, bypass the CapacitorHttp JSON-bridge path entirely)
// — no base64, no chunking, no JS-side buffering at all. Stem downloads from MVSEP similarly
// skip JS entirely via @capacitor/file-transfer's native-to-disk downloadFile().

import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { FileTransfer } from '@capacitor/file-transfer'

// android:largeHeap gives real headroom now, so write chunks can be bigger (fewer, cheaper
// bridge round-trips) while staying far below the "whole file in one call" territory that OOM'd.
const FILE_CHUNK = 8 * 1024 * 1024

async function uint8ToBase64(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).slice((reader.result as string).indexOf(',') + 1))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]))
  })
}

const songDir = (id: string) => `songs/${id}`
const stemsDir = (id: string) => `${songDir(id)}/stems`
const sourcePath = (id: string, filename: string) => `${songDir(id)}/${filename}`
const stemPath = (id: string, stem: string, ext: string) => `${stemsDir(id)}/${stem}.${ext}`

async function write(path: string, bytes: ArrayBuffer, directory: Directory = Directory.Data): Promise<void> {
  const data = new Uint8Array(bytes)
  if (data.length === 0) {
    await Filesystem.writeFile({ path, directory, data: '', recursive: true })
    return
  }
  for (let offset = 0; offset < data.length; offset += FILE_CHUNK) {
    const chunk = await uint8ToBase64(data.subarray(offset, offset + FILE_CHUNK))
    if (offset === 0) await Filesystem.writeFile({ path, directory, data: chunk, recursive: true })
    else await Filesystem.appendFile({ path, directory, data: chunk })
  }
}

async function read(path: string): Promise<ArrayBuffer> {
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data })
  const res = await fetch(Capacitor.convertFileSrc(uri))
  if (!res.ok) throw new Error(`Could not read ${path} (${res.status})`)
  return res.arrayBuffer()
}

export async function writeSource(id: string, filename: string, bytes: ArrayBuffer): Promise<void> {
  await write(sourcePath(id, filename), bytes)
}

export async function readSource(id: string, filename: string): Promise<ArrayBuffer> {
  return read(sourcePath(id, filename))
}

/** Download a stem straight from MVSEP to disk, natively — never held in JS memory as bytes. */
export async function downloadStem(id: string, stem: string, ext: string, url: string): Promise<void> {
  await Filesystem.mkdir({ path: stemsDir(id), directory: Directory.Data, recursive: true }).catch(() => {})
  const { uri } = await Filesystem.getUri({ path: stemPath(id, stem, ext), directory: Directory.Data })
  await FileTransfer.downloadFile({ url, path: uri, method: 'GET' })
}

/** Write a stem already in memory (e.g. unzipped from a backup import), chunked like writeSource. */
export async function writeStem(id: string, stem: string, ext: string, bytes: ArrayBuffer): Promise<void> {
  await write(stemPath(id, stem, ext), bytes)
}

export async function readStem(id: string, stem: string, ext: string): Promise<ArrayBuffer> {
  return read(stemPath(id, stem, ext))
}

export async function deleteSong(id: string): Promise<void> {
  await Filesystem.rmdir({ path: songDir(id), directory: Directory.Data, recursive: true }).catch(() => {})
}

/** Write an arbitrary file to the cache dir (e.g. for sharing), chunked like stem writes. Returns its native URI. */
export async function writeCacheFile(filename: string, bytes: ArrayBuffer): Promise<string> {
  await write(filename, bytes, Directory.Cache)
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
  return uri
}

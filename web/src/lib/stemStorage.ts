// On-device storage for each song's source file and separated stems, via Capacitor Filesystem.
// Replaces the server's SONGS_DIR. Layout: songs/<id>/source.<ext>, songs/<id>/stems/<stem>.<ext>.
//
// Filesystem.writeFile/readFile move the whole file as one base64 string in a single JSON
// message across the native bridge. For a multi-ten-MB stem that allocation alone can exceed
// the WebView process's heap limit (confirmed on-device: a ~75MB base64 string blew a ~256MB
// heap in org.json.JSONStringer while writing one stem in a single call, crashing the app with
// OutOfMemoryError). Stem downloads go through @capacitor/file-transfer instead, which streams
// straight from the network to disk with no JS-side buffering at all; everything else is
// chunked so no single bridge call ever carries more than a few MB.

import { Directory, Filesystem } from '@capacitor/filesystem'
import { FileTransfer } from '@capacitor/file-transfer'

const FILE_CHUNK = 2 * 1024 * 1024 // bound per bridge-call payload size
const STRING_CHUNK = 32 * 1024 // avoid a huge arg list to String.fromCharCode at once

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += STRING_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STRING_CHUNK))
  }
  return btoa(binary)
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
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
    const chunk = uint8ToBase64(data.subarray(offset, offset + FILE_CHUNK))
    if (offset === 0) await Filesystem.writeFile({ path, directory, data: chunk, recursive: true })
    else await Filesystem.appendFile({ path, directory, data: chunk })
  }
}

async function read(path: string): Promise<ArrayBuffer> {
  const { size } = await Filesystem.stat({ path, directory: Directory.Data })
  const result = new Uint8Array(size)
  for (let offset = 0; offset < size; offset += FILE_CHUNK) {
    const { data } = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      offset,
      length: Math.min(FILE_CHUNK, size - offset),
    })
    if (typeof data !== 'string') throw new Error(`Unexpected Filesystem.readFile result for ${path}`)
    result.set(base64ToUint8(data), offset)
  }
  return result.buffer
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

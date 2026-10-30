// On-device storage for each song's source file and separated stems, via Capacitor Filesystem.
// Replaces the server's SONGS_DIR. Layout: songs/<id>/source.<ext>, songs/<id>/stems/<stem>.<ext>.

import { Directory, Filesystem } from '@capacitor/filesystem'

const CHUNK = 32 * 1024 // avoid passing a huge arg list to String.fromCharCode/btoa at once

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

const songDir = (id: string) => `songs/${id}`
const sourcePath = (id: string, filename: string) => `${songDir(id)}/${filename}`
const stemPath = (id: string, stem: string, ext: string) => `${songDir(id)}/stems/${stem}.${ext}`

async function write(path: string, bytes: ArrayBuffer): Promise<void> {
  await Filesystem.writeFile({ path, directory: Directory.Data, data: uint8ToBase64(new Uint8Array(bytes)), recursive: true })
}

async function read(path: string): Promise<ArrayBuffer> {
  const { data } = await Filesystem.readFile({ path, directory: Directory.Data })
  if (typeof data !== 'string') throw new Error(`Unexpected Filesystem.readFile result for ${path}`)
  return base64ToArrayBuffer(data)
}

export async function writeSource(id: string, filename: string, bytes: ArrayBuffer): Promise<void> {
  await write(sourcePath(id, filename), bytes)
}

export async function readSource(id: string, filename: string): Promise<ArrayBuffer> {
  return read(sourcePath(id, filename))
}

export async function writeStem(id: string, stem: string, ext: string, bytes: ArrayBuffer): Promise<void> {
  await write(stemPath(id, stem, ext), bytes)
}

export async function readStem(id: string, stem: string, ext: string): Promise<ArrayBuffer> {
  return read(stemPath(id, stem, ext))
}

export async function deleteSong(id: string): Promise<void> {
  await Filesystem.rmdir({ path: songDir(id), directory: Directory.Data, recursive: true }).catch(() => {})
}

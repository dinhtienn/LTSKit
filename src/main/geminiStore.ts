import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { GeminiKeyDescriptor } from '../shared/types'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR } from './deps'

export interface GeminiStoredKey {
  id: string
  value: string
}

interface GeminiKeyPayload {
  version: 1
  keys: GeminiStoredKey[]
}

export interface DecodedKeys {
  keys: GeminiStoredKey[]
  migrated: boolean
}

function keyFile(): string {
  return join(DATA_DIR, 'gk.bin')
}

function normalizeKeys(keys: unknown): GeminiStoredKey[] {
  if (!Array.isArray(keys)) return []
  const seen = new Set<string>()
  const normalized: GeminiStoredKey[] = []
  for (const candidate of keys) {
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as { id?: unknown; value?: unknown }
    if (typeof item.id !== 'string' || !item.id.trim() || typeof item.value !== 'string') return []
    const value = item.value.trim()
    if (!value) return []
    if (seen.has(value)) throw new Error('API key bị trùng.')
    seen.add(value)
    normalized.push({ id: item.id.trim(), value })
  }
  return normalized
}

export function decodeKeyPayload(raw: string, makeId: () => string = randomUUID): DecodedKeys {
  const text = raw.trim()
  if (!text) return { keys: [], migrated: false }

  try {
    const parsed = JSON.parse(text) as { version?: unknown; keys?: unknown }
    if (parsed.version !== 1) return { keys: [], migrated: false }
    return { keys: normalizeKeys(parsed.keys), migrated: false }
  } catch (error) {
    if (error instanceof Error && error.message.includes('trùng')) throw error
    return { keys: [{ id: makeId(), value: text }], migrated: true }
  }
}

export function maskKeyRecords(keys: GeminiStoredKey[]): GeminiKeyDescriptor[] {
  return keys.map(({ id }) => ({ id, masked: '********' }))
}

function encrypt(value: string): Buffer {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value)
    : Buffer.from(value, 'utf-8')
}

function decrypt(data: Buffer): string {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(data)
    : data.toString('utf-8')
}

async function readKeys(): Promise<{ keys: GeminiStoredKey[]; migrate: boolean }> {
  try {
    const decoded = decodeKeyPayload(decrypt(await readFile(keyFile())))
    return { keys: decoded.keys, migrate: decoded.migrated }
  } catch (error) {
    if (error instanceof Error && error.message.includes('trùng')) throw error
    return { keys: [], migrate: false }
  }
}

async function writeKeys(keys: GeminiStoredKey[]): Promise<void> {
  await writeFile(keyFile(), encrypt(JSON.stringify({ version: 1, keys } satisfies GeminiKeyPayload)))
}

async function loadKeys(): Promise<GeminiStoredKey[]> {
  const result = await readKeys()
  if (result.migrate) await writeKeys(result.keys)
  return result.keys
}

export async function listKeys(): Promise<GeminiKeyDescriptor[]> {
  return maskKeyRecords(await loadKeys())
}

export async function getKey(id: string): Promise<string> {
  return (await loadKeys()).find((item) => item.id === id)?.value ?? ''
}

export async function addKey(key: string): Promise<GeminiKeyDescriptor> {
  const value = key.trim()
  if (!value) throw new Error('API key trống.')
  const keys = await loadKeys()
  if (keys.some((item) => item.value === value)) throw new Error('API key bị trùng.')
  const item = { id: randomUUID(), value }
  await writeKeys([...keys, item])
  return { id: item.id, masked: '********' }
}

export async function removeKey(id: string): Promise<void> {
  const keys = await loadKeys()
  const next = keys.filter((item) => item.id !== id)
  if (next.length === keys.length) return
  if (next.length) await writeKeys(next)
  else await rm(keyFile(), { force: true })
}

export async function firstKey(): Promise<string> {
  return (await loadKeys())[0]?.value ?? ''
}

export async function hasKey(): Promise<boolean> {
  return (await loadKeys()).length > 0
}

// Compatibility exports are replaced by the key-list IPC in the next task.
export async function saveKey(key: string): Promise<void> {
  const value = key.trim()
  const keys = await loadKeys()
  if (!value) {
    await rm(keyFile(), { force: true })
    return
  }
  const first = keys[0]
  await writeKeys(first ? [{ ...first, value }, ...keys.slice(1)] : [{ id: randomUUID(), value }])
}

export async function loadKey(): Promise<string> {
  return firstKey()
}

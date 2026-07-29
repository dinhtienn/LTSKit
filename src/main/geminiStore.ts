import { safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATA_DIR } from './deps'

function keyFile(): string {
  return join(DATA_DIR, 'gk.bin')
}

export async function saveKey(key: string): Promise<void> {
  const value = key.trim()
  if (!value) {
    await rm(keyFile(), { force: true })
    return
  }
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value)
    : Buffer.from(value, 'utf-8')
  await writeFile(keyFile(), data)
}

export async function loadKey(): Promise<string> {
  try {
    const data = await readFile(keyFile())
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(data)
      : data.toString('utf-8')
  } catch {
    return ''
  }
}

export async function hasKey(): Promise<boolean> {
  return (await loadKey()).length > 0
}

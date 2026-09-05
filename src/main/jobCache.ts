import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { basename, join } from 'node:path'
import { DATA_DIR } from './deps'

/**
 * Cache ket qua job de khong phai chay lai engine nang khi input va cau hinh
 * khong doi.
 *
 * Nguyen tac: cache HONG thi bo qua, KHONG bao gio lam gay job. Moi loi doc deu
 * tra ve "miss" va engine chay lai binh thuong.
 *
 * Cache luu NOI DUNG file, khong luu duong dan. Nho vay mot ket qua da luu van
 * dung lai duoc khi nguoi dung chon thu muc dau ra khac.
 */
const SCHEMA_VERSION = 1

/** Cache nam trong appdata cua app, khong lam ban thu muc dau ra cua nguoi dung. */
export function jobCacheRoot(): string {
  return join(DATA_DIR, 'job-cache')
}

export type CacheMeta = Record<string, number | string | boolean>

interface CacheManifest {
  schemaVersion: number
  files: string[]
  meta: CacheMeta
}

export interface CacheHit {
  outputs: string[]
  meta: CacheMeta
}

function entryDir(root: string, namespace: string, key: string): string {
  return join(root, namespace, key)
}

function backupDir(root: string, namespace: string, key: string): string {
  return `${entryDir(root, namespace, key)}.backup`
}

/** Ghi manifest kieu atomic: ghi `.tmp` roi doi ten, tranh manifest ghi do dang. */
async function writeManifestAtomically(directory: string, manifest: CacheManifest): Promise<void> {
  const target = join(directory, 'manifest.json')
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8')
  await rename(temporary, target)
}

function isSafeCacheFileName(name: unknown): name is string {
  return typeof name === 'string' && !!name && name === basename(name)
}

async function readCacheManifest(directory: string): Promise<CacheManifest | null> {
  let manifest: CacheManifest
  try {
    manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as CacheManifest
  } catch {
    return null
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION || !Array.isArray(manifest.files) || !manifest.files.length) return null
  if (!manifest.files.every(isSafeCacheFileName)) return null
  for (const name of manifest.files) {
    try {
      if (!(await stat(join(directory, name))).isFile()) return null
    } catch {
      return null
    }
  }
  return { ...manifest, meta: manifest.meta ?? {} }
}

async function recoverEntry(root: string, namespace: string, key: string): Promise<void> {
  const directory = entryDir(root, namespace, key)
  const backup = backupDir(root, namespace, key)
  const parent = join(root, namespace)
  let entries: Dirent[] = []
  try {
    entries = await readdir(parent, { withFileTypes: true })
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${key}.tmp-`))
      .map((entry) => rm(join(parent, entry.name), { recursive: true, force: true }))
  )
  const current = await readCacheManifest(directory)
  const previous = await readCacheManifest(backup)
  if (!current && previous) {
    await rm(directory, { recursive: true, force: true })
    await rename(backup, directory)
  } else if (current || !previous) {
    await rm(backup, { recursive: true, force: true })
  } else {
    await rm(backup, { recursive: true, force: true })
  }
}

export interface CacheWriteOps {
  copyFile: typeof copyFile
  rename: typeof rename
}

export async function writeCachedOutputsWithOps(
  root: string,
  namespace: string,
  key: string,
  outputs: string[],
  meta: CacheMeta,
  ops: CacheWriteOps
): Promise<void> {
  if (!outputs.length) return
  await recoverEntry(root, namespace, key)
  const directory = entryDir(root, namespace, key)
  const backup = backupDir(root, namespace, key)
  const staging = `${directory}.tmp-${randomUUID()}`
  let movedOld = false
  let promoted = false

  try {
    await mkdir(staging, { recursive: true })
    const files: string[] = []
    for (const output of outputs) {
      const name = basename(output)
      await ops.copyFile(output, join(staging, name))
      files.push(name)
    }
    await writeManifestAtomically(staging, { schemaVersion: SCHEMA_VERSION, files, meta })
    if (!(await readCacheManifest(staging))) throw new Error('Cache staging không hợp lệ.')
    if (await readCacheManifest(directory)) {
      await rm(backup, { recursive: true, force: true })
      await ops.rename(directory, backup)
      movedOld = true
    }
    await ops.rename(staging, directory)
    promoted = true
    await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (promoted) await rm(directory, { recursive: true, force: true })
    if (movedOld) {
      try {
        await ops.rename(backup, directory)
      } catch {
        // Keep the backup for the next recovery pass.
      }
    }
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function writeCachedOutputs(
  root: string,
  namespace: string,
  key: string,
  outputs: string[],
  meta: CacheMeta
): Promise<void> {
  return writeCachedOutputsWithOps(root, namespace, key, outputs, meta, { copyFile, rename })
}

export async function readCachedOutputs(
  root: string,
  namespace: string,
  key: string,
  outputDir: string
): Promise<CacheHit | null> {
  await recoverEntry(root, namespace, key)
  const directory = entryDir(root, namespace, key)
  const manifest = await readCacheManifest(directory)
  if (!manifest) return null

  try {
    await mkdir(outputDir, { recursive: true })
    const outputs: string[] = []
    for (const name of manifest.files) {
      const target = join(outputDir, name)
      await copyFile(join(directory, name), target)
      outputs.push(target)
    }
    return { outputs, meta: manifest.meta ?? {} }
  } catch {
    return null
  }
}

async function directoryBytes(path: string): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(child)
    else {
      try {
        total += (await stat(child)).size
      } catch {
        // Tep vua bi xoa: bo qua.
      }
    }
  }
  return total
}

export async function cacheUsageBytes(root: string, namespace?: string): Promise<number> {
  return directoryBytes(namespace ? join(root, namespace) : root)
}

export async function clearJobCache(root: string, namespace?: string): Promise<void> {
  await rm(namespace ? join(root, namespace) : root, { recursive: true, force: true })
}

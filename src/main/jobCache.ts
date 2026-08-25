import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
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

/** Ghi manifest kieu atomic: ghi `.tmp` roi doi ten, tranh manifest ghi do dang. */
async function writeManifestAtomically(directory: string, manifest: CacheManifest): Promise<void> {
  const target = join(directory, 'manifest.json')
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8')
  await rename(temporary, target)
}

export async function writeCachedOutputs(
  root: string,
  namespace: string,
  key: string,
  outputs: string[],
  meta: CacheMeta
): Promise<void> {
  if (!outputs.length) return
  const directory = entryDir(root, namespace, key)
  // Xoa entry cu truoc khi ghi lai, tranh con sot file cua lan chay truoc.
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })

  const files: string[] = []
  for (const output of outputs) {
    const name = basename(output)
    await copyFile(output, join(directory, name))
    files.push(name)
  }
  await writeManifestAtomically(directory, { schemaVersion: SCHEMA_VERSION, files, meta })
}

export async function readCachedOutputs(
  root: string,
  namespace: string,
  key: string,
  outputDir: string
): Promise<CacheHit | null> {
  const directory = entryDir(root, namespace, key)
  let manifest: CacheManifest
  try {
    manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as CacheManifest
  } catch {
    return null // Chua co cache, hoac manifest khong doc duoc.
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION || !Array.isArray(manifest.files)) return null
  if (!manifest.files.length) return null

  // Kiem tra du file TRUOC khi ghi ra, de khong de lai ket qua mot nua.
  for (const name of manifest.files) {
    try {
      if (!(await stat(join(directory, name))).isFile()) return null
    } catch {
      return null
    }
  }

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

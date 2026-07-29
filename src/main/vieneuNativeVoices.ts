import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import type { VieneuAddVoiceResult, VieneuVoice } from '../shared/types'
import { vieneuPaths } from './vieneuNativeAssets'

interface StoredClone {
  id: string
  label: string
  refAudio: string
  migratedFrom?: string
}

interface VoiceRegistry {
  version: 1
  cloned: StoredClone[]
}

interface PresetRecord {
  description?: unknown
  gender?: unknown
  style?: unknown
}

const STYLES = new Set(['tu_nhien', 'tin_tuc', 'doc_truyen'])
let registryMutation: Promise<void> = Promise.resolve()

function serializeRegistryMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = registryMutation.then(operation, operation)
  registryMutation = result.then(() => undefined, () => undefined)
  return result
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    const value = await stat(path)
    return value.isFile() && value.size > 0
  } catch {
    return false
  }
}

function emptyRegistry(): VoiceRegistry {
  return { version: 1, cloned: [] }
}

async function readRegistry(dataDir: string): Promise<VoiceRegistry> {
  const path = vieneuPaths(dataDir).registry
  const backup = `${path}.bak`
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as VoiceRegistry
    return parsed.version === 1 && Array.isArray(parsed.cloned) ? parsed : emptyRegistry()
  } catch {
    try {
      const parsed = JSON.parse(await readFile(backup, 'utf8')) as VoiceRegistry
      if (parsed.version !== 1 || !Array.isArray(parsed.cloned)) return emptyRegistry()
      await rename(backup, path)
      return parsed
    } catch {
      return emptyRegistry()
    }
  }
}

async function writeRegistry(dataDir: string, registry: VoiceRegistry): Promise<void> {
  const path = vieneuPaths(dataDir).registry
  const temp = `${path}.tmp`
  const backup = `${path}.bak`
  await mkdir(vieneuPaths(dataDir).root, { recursive: true })
  await writeFile(temp, JSON.stringify(registry, null, 2), 'utf8')
  await rm(backup, { force: true })
  let hadOriginal = false
  try {
    await rename(path, backup)
    hadOriginal = true
  } catch {
    // A new registry has no original file.
  }
  try {
    await rename(temp, path)
    await rm(backup, { force: true })
  } catch (error) {
    if (hadOriginal) await rename(backup, path)
    throw error
  }
}

export function parseVieneuPresets(raw: string): VieneuVoice[] {
  const parsed = JSON.parse(raw) as { default_voice?: unknown; presets?: unknown }
  if (!parsed.presets || typeof parsed.presets !== 'object' || Array.isArray(parsed.presets)) return []
  const entries = Object.entries(parsed.presets as Record<string, PresetRecord>)
  const voices = entries.map(([id, preset]): VieneuVoice => {
    const gender = preset.gender === 'male' || preset.gender === 'female' ? preset.gender : 'unknown'
    const style = typeof preset.style === 'string' && STYLES.has(preset.style)
      ? (preset.style as VieneuVoice['style'])
      : undefined
    const description = typeof preset.description === 'string' ? preset.description.trim() : ''
    return {
      id,
      label: description ? `${id} — ${description}` : id,
      kind: 'preset',
      gender,
      ...(style ? { style } : {})
    }
  })
  if (typeof parsed.default_voice === 'string') {
    const index = voices.findIndex((voice) => voice.id === parsed.default_voice)
    if (index > 0) voices.unshift(...voices.splice(index, 1))
  }
  return voices
}

export async function migrateValtecVoices(dataDir: string): Promise<void> {
  return serializeRegistryMutation(() => migrateValtecVoicesUnlocked(dataDir))
}

async function migrateValtecVoicesUnlocked(dataDir: string): Promise<void> {
  if (!(await isNonEmptyFile(vieneuPaths(dataDir).voicesJson))) return
  let legacy: { cloned?: unknown }
  try {
    legacy = JSON.parse(await readFile(resolve(dataDir, 'valtec-voices.json'), 'utf8')) as {
      cloned?: unknown
    }
  } catch {
    return
  }
  if (!Array.isArray(legacy.cloned)) return
  const registry = await readRegistry(dataDir)
  const presetIds = new Set(
    parseVieneuPresets(await readFile(vieneuPaths(dataDir).voicesJson, 'utf8')).map((voice) => voice.id)
  )
  let changed = false
  for (const item of legacy.cloned) {
    if (!item || typeof item !== 'object') continue
    const clone = item as { id?: unknown; label?: unknown; refAudio?: unknown }
    if (typeof clone.id !== 'string' || typeof clone.refAudio !== 'string') continue
    if (!(await isNonEmptyFile(clone.refAudio))) continue
    const absolute = resolve(clone.refAudio).toLowerCase()
    if (
      registry.cloned.some(
        (stored) => stored.migratedFrom === clone.id || resolve(stored.refAudio).toLowerCase() === absolute
      )
    ) continue
    let id = clone.id
    let suffix = 1
    while (presetIds.has(id) || registry.cloned.some((stored) => stored.id === id)) {
      id = `${clone.id}_legacy_${suffix++}`
    }
    registry.cloned.push({
      id,
      label: typeof clone.label === 'string' && clone.label.trim() ? clone.label.trim() : clone.id,
      refAudio: clone.refAudio,
      migratedFrom: clone.id
    })
    changed = true
  }
  if (changed) await writeRegistry(dataDir, registry)
}

export async function loadVieneuVoices(dataDir: string): Promise<VieneuVoice[]> {
  await migrateValtecVoices(dataDir)
  const paths = vieneuPaths(dataDir)
  let presets: VieneuVoice[] = []
  try {
    presets = parseVieneuPresets(await readFile(paths.voicesJson, 'utf8'))
  } catch {
    // The renderer asks for voices before the optional engine is installed.
  }
  const registry = await readRegistry(dataDir)
  const clones: VieneuVoice[] = []
  for (const clone of registry.cloned) {
    if (!(await isNonEmptyFile(clone.refAudio))) continue
    clones.push({
      id: clone.id,
      label: `${clone.label} (clone)`,
      kind: 'clone',
      gender: 'unknown',
      refAudio: clone.refAudio
    })
  }
  return [...presets, ...clones]
}

export async function addVieneuVoice(
  dataDir: string,
  label: string,
  source: string
): Promise<VieneuAddVoiceResult> {
  return serializeRegistryMutation(() => addVieneuVoiceUnlocked(dataDir, label, source))
}

async function addVieneuVoiceUnlocked(
  dataDir: string,
  label: string,
  source: string
): Promise<VieneuAddVoiceResult> {
  const name = label.trim()
  if (!name) return { ok: false, error: 'Nhập tên giọng.' }
  if (!(await isNonEmptyFile(source))) return { ok: false, error: 'Không thấy file mẫu.' }
  const paths = vieneuPaths(dataDir)
  await mkdir(paths.refsDir, { recursive: true })
  const id = `clone_${Date.now().toString(36)}`
  const target = resolve(paths.refsDir, `${id}${extname(source) || '.wav'}`)
  await copyFile(source, target)
  const registry = await readRegistry(dataDir)
  registry.cloned.push({ id, label: name, refAudio: target })
  await writeRegistry(dataDir, registry)
  return {
    ok: true,
    voice: { id, label: `${name} (clone)`, kind: 'clone', gender: 'unknown', refAudio: target }
  }
}

export async function removeVieneuVoice(
  dataDir: string,
  id: string
): Promise<{ ok: boolean; error?: string }> {
  return serializeRegistryMutation(() => removeVieneuVoiceUnlocked(dataDir, id))
}

async function removeVieneuVoiceUnlocked(
  dataDir: string,
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const registry = await readRegistry(dataDir)
  const found = registry.cloned.find((clone) => clone.id === id)
  if (!found) return { ok: false, error: 'Không tìm thấy giọng clone.' }
  registry.cloned = registry.cloned.filter((clone) => clone.id !== id)
  await writeRegistry(dataDir, registry)
  const rel = relative(vieneuPaths(dataDir).refsDir, found.refAudio)
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) await rm(found.refAudio, { force: true })
  return { ok: true }
}

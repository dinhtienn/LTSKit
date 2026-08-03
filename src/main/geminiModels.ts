import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GeminiModelDiscovery, GeminiReadiness } from '../shared/types'
import { DATA_DIR } from './deps'
import { firstKey, hasKey } from './geminiStore'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const EXCLUDED = /image|imagen|tts|audio|speech|embedding|robotics|computer-use|omni/i
const MODEL_NAME = /^gemini-[a-z0-9._-]+$/i

interface GeminiApiModel {
  name?: string
  supportedGenerationMethods?: string[]
}

function poolFile(): string {
  return join(DATA_DIR, 'gemini-models.json')
}

export function filterDiscoveredModels(items: GeminiApiModel[]): string[] {
  return items
    .filter((item) => item.name?.includes('gemini-'))
    .filter((item) => item.supportedGenerationMethods?.includes('generateContent'))
    .map((item) => item.name!.replace(/^models\//, ''))
    .filter((name) => !EXCLUDED.test(name))
}

export function validateModelPool(models: string[]): string[] {
  const seen = new Set<string>()
  return models.map((raw) => {
    const model = raw.trim()
    if (!model) throw new Error('Tên model trống.')
    if (!MODEL_NAME.test(model)) throw new Error('Tên model Gemini không hợp lệ.')
    if (seen.has(model)) throw new Error('Tên model bị trùng.')
    seen.add(model)
    return model
  })
}

export function createModelRotation(initial: string[]): {
  order: () => string[]
  succeeded: (model: string) => void
  replace: (models: string[]) => void
} {
  let models = [...initial]
  let nextModel: string | null = models[0] ?? null
  return {
    order: (): string[] => {
      if (!models.length) return []
      const index = Math.max(0, models.indexOf(nextModel ?? ''))
      return [...models.slice(index), ...models.slice(0, index)]
    },
    succeeded: (model: string): void => {
      const index = models.indexOf(model)
      if (index >= 0) nextModel = models[(index + 1) % models.length]
    },
    replace: (next: string[]): void => {
      models = [...next]
      if (!models.includes(nextModel ?? '')) nextModel = models[0] ?? null
    }
  }
}

const rotation = createModelRotation([])

export async function loadModelPool(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(poolFile(), 'utf-8')) as { models?: unknown }
    return Array.isArray(parsed.models) && parsed.models.every((item) => typeof item === 'string')
      ? validateModelPool(parsed.models)
      : []
  } catch {
    return []
  }
}

export async function saveModelPool(models: string[]): Promise<void> {
  const valid = validateModelPool(models)
  await writeFile(poolFile(), JSON.stringify({ models: valid }), 'utf-8')
  rotation.replace(valid)
}

export async function orderedPool(): Promise<string[]> {
  const models = await loadModelPool()
  rotation.replace(models)
  return rotation.order()
}

export async function advanceModelCursor(model: string): Promise<void> {
  rotation.replace(await loadModelPool())
  rotation.succeeded(model)
}

export async function geminiReadiness(): Promise<GeminiReadiness> {
  const models = await loadModelPool()
  return { hasKey: await hasKey(), hasModels: models.length > 0 }
}

export async function discoverModels(): Promise<GeminiModelDiscovery> {
  const key = await firstKey()
  if (!key) return { ok: false, error: 'Chưa có API key.' }
  try {
    const response = await fetch(`${BASE}/models?key=${key}`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return { ok: false, error: 'Không lấy được danh sách model từ Gemini.' }
    const data = (await response.json()) as { models?: GeminiApiModel[] }
    const models = filterDiscoveredModels(data.models ?? [])
    return models.length ? { ok: true, models } : { ok: false, error: 'Không tìm thấy model Gemini phù hợp.' }
  } catch {
    return { ok: false, error: 'Không kết nối được Gemini để lấy model.' }
  }
}

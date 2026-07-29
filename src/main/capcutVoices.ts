import { readFile } from 'node:fs/promises'
import type { VieneuVoice } from '../shared/types'

interface CapcutCatalogRow {
  voice_type?: string
  display_name?: string
  lang?: string
  lan?: string
}

export function parseCapcutVoiceCatalog(raw: string, lang = 'vi-VN'): VieneuVoice[] {
  let data: CapcutCatalogRow[]
  try {
    data = JSON.parse(raw) as CapcutCatalogRow[]
    if (!Array.isArray(data)) return []
  } catch {
    return []
  }
  const want = lang.toLowerCase()
  return data
    .filter((row) => {
      if (!lang) return true
      const l = (row.lang || '').toLowerCase()
      const a = (row.lan || '').toLowerCase()
      return l === want || a === want
    })
    .filter((row) => row.voice_type && row.display_name)
    .map((row) => ({
      id: String(row.voice_type),
      label: String(row.display_name),
      kind: 'preset' as const,
      gender: 'unknown' as const
    }))
}

export async function loadCapcutVoices(
  catalogPath: string,
  lang = 'vi-VN'
): Promise<VieneuVoice[]> {
  try {
    return parseCapcutVoiceCatalog(await readFile(catalogPath, 'utf8'), lang)
  } catch {
    return []
  }
}

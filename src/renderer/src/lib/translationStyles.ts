import type { TranslationStyle, TranslationStyleSnapshot } from '../../../shared/types'

export const BUILT_IN_TRANSLATION_STYLES: readonly TranslationStyle[] = [
  { id: 'natural', name: 'Tự nhiên', instruction: 'Dùng cách diễn đạt tự nhiên, mượt và dễ hiểu trong ngôn ngữ đích.', builtIn: true },
  { id: 'literal', name: 'Sát nghĩa', instruction: 'Bám sát cấu trúc và sắc thái câu nguồn, hạn chế diễn giải.', builtIn: true },
  { id: 'short', name: 'Ngắn gọn', instruction: 'Ưu tiên câu ngắn, dễ đọc; lược filler hoặc lặp từ nhưng giữ dữ kiện chính.', builtIn: true },
  { id: 'news', name: 'Tin tức', instruction: 'Dùng giọng trung tính, rõ ràng và khách quan.', builtIn: true },
  { id: 'storytelling', name: 'Kể chuyện', instruction: 'Dùng nhịp kể tự nhiên và cảm xúc vừa phải, không thêm thông tin.', builtIn: true }
]

const PRESET_IDS = new Set(BUILT_IN_TRANSLATION_STYLES.map((style) => style.id))

export function sanitizeCustomTranslationStyles(value: unknown): TranslationStyle[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Partial<TranslationStyle>
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.instruction !== 'string') return []
    const id = candidate.id.trim()
    const name = candidate.name.trim()
    const instruction = candidate.instruction.trim()
    if (!id || PRESET_IDS.has(id) || seen.has(id) || !name || name.length > 60 || !instruction || instruction.length > 2000) return []
    seen.add(id)
    return [{ id, name, instruction, builtIn: false }]
  })
}

export function resolveTranslationStyle(styleId: string, customStyles: TranslationStyle[]): TranslationStyleSnapshot {
  const style = [...customStyles, ...BUILT_IN_TRANSLATION_STYLES].find((candidate) => candidate.id === styleId)
    ?? BUILT_IN_TRANSLATION_STYLES[0]
  return { id: style.id, name: style.name, instruction: style.instruction }
}

export function createCustomTranslationStyle(name: string, instruction: string, id?: string): TranslationStyle {
  const trimmedName = name.trim()
  const trimmedInstruction = instruction.trim()
  if (!trimmedName || trimmedName.length > 60) throw new Error('Tên style phải từ 1 đến 60 ký tự.')
  if (!trimmedInstruction || trimmedInstruction.length > 2000) throw new Error('Hướng dẫn style phải từ 1 đến 2000 ký tự.')
  return { id: id ?? crypto.randomUUID(), name: trimmedName, instruction: trimmedInstruction, builtIn: false }
}

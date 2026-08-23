import type { GenKQ } from './gemini'

export interface DubbingRewriteOptions {
  enabled: boolean
  maxAttempts: number
  overrunRatio: number
}

export interface DubbingRewriteRequest {
  text: string
  slotSeconds: number
  targetWords: number
}

export interface DubbingRewriteResult {
  ok: boolean
  text?: string
  error?: string
}

export const DEFAULT_DUBBING_REWRITE_OPTIONS: DubbingRewriteOptions = {
  enabled: false,
  maxAttempts: 2,
  overrunRatio: 1
}

export type DubbingRewriteGenerate = (
  system: string,
  user: string,
  schema?: object
) => Promise<GenKQ>

export async function generateDubbingRewriteWithGemini(
  jobId: string,
  system: string,
  user: string,
  schema?: object
): Promise<GenKQ> {
  const { generateDubbingRewrite } = await import('./gemini')
  return generateDubbingRewrite(jobId, system, user, schema ?? {})
}

export function shouldRewriteCue({
  duration,
  slotSeconds,
  options
}: {
  duration: number
  slotSeconds: number
  options: DubbingRewriteOptions
}): boolean {
  return options.enabled && Number.isFinite(duration) && duration > slotSeconds * options.overrunRatio
}

export function targetWordsForSlot(slotSeconds: number, originalWords = 0): number {
  const naturalTarget = Math.floor(Math.max(0, slotSeconds) * 2.8)
  const preservationTarget = Math.ceil(Math.max(0, originalWords) * 0.75)
  return Math.max(1, naturalTarget, preservationTarget)
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function parseDubbingRewrite(text: string, originalText: string): string | null {
  let value = text.trim()
  if (value.includes('\n') || value.includes('\r')) return null
  try {
    const parsed = JSON.parse(value) as { text?: unknown }
    if (parsed && typeof parsed.text === 'string') value = parsed.text
  } catch {
    // Gemini may return plain text when a compatible model ignores the schema.
  }
  value = normalizeText(value).replace(/^(?:"|“)(.*)(?:"|”)$/u, '$1').trim()
  const original = normalizeText(originalText)
  if (!value || value.length >= original.length) return null
  return value
}

function buildSystemInstruction({ targetWords }: DubbingRewriteRequest): string {
  return [
    'You are a careful dubbing editor for spoken Vietnamese dialogue.',
    'Rewrite the line to be shorter only as much as needed to fit the reading time.',
    'Preserve names, numbers, brands, products, speaker intent, event order, and essential claims exactly.',
    'Keep the same meaning and natural spoken tone. Remove filler or repetition first; do not invent, summarize away, or change facts.',
    'Return only the rewritten line, without markdown, numbering, quotes, timestamps, or explanation.'
  ].join('\n')
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: { text: { type: 'STRING' } },
  required: ['text']
}

export async function rewriteForDubbing(
  request: DubbingRewriteRequest,
  generate: DubbingRewriteGenerate
): Promise<DubbingRewriteResult> {
  if (!request.text.trim() || request.slotSeconds <= 0 || request.targetWords <= 0) {
    return { ok: false, error: 'Dữ liệu rewrite không hợp lệ.' }
  }
  const result = await generate(
    buildSystemInstruction(request),
    request.text,
    RESPONSE_SCHEMA
  )
  if (!result.ok || !result.text) return { ok: false, error: result.err || 'Gemini rewrite thất bại.' }
  const text = parseDubbingRewrite(result.text, request.text)
  return text ? { ok: true, text } : { ok: false, error: 'Gemini trả về câu rewrite không hợp lệ.' }
}

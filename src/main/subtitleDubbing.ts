import { access, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { docSrt, srtTimeToSeconds } from './burn'
import { buildVoiceCuePlan, cueCps, writeVoiceoverSrt, type CpsOptions, type VoiceCue } from './voiceCuePlan'
import { generateDubbingRewriteWithGemini, rewriteForDubbing, targetWordsForSlot, type DubbingRewriteGenerate } from './dubbingRewrite'
import type { OptimizeSrtRequest, OptimizeSrtResult } from '../shared/types'
import { parseEditableSrt, serializeEditableSrt, validateEditableCues, type EditableSubtitleCue } from '../renderer/src/lib/subtitleEditor'

export interface SubtitleOptimizeWarning {
  cueIndex: number
  message: string
}

export interface OptimizedSubtitleCues {
  cues: VoiceCue[]
  rewrittenCues: number
  retimedCues: number
  remainingOverCps: number
  averageCps: number
  warnings: SubtitleOptimizeWarning[]
}

const optionsFor = (targetCps: number): CpsOptions => ({
  enabled: true,
  targetCps,
  maxExpandSeconds: 0.5,
  minGapSeconds: 0.1,
  maxBoundaryShiftSeconds: 0.5,
  minDurationSeconds: 0.8,
  balancePasses: 5
})

export async function optimizeSubtitleCues(
  cues: VoiceCue[],
  targetCps: number,
  generate: DubbingRewriteGenerate,
  onProgress?: (done: number, total: number) => void
): Promise<OptimizedSubtitleCues> {
  const original = cues.map((cue) => ({ ...cue }))
  const firstPlan = buildVoiceCuePlan(cues, optionsFor(targetCps))
  const candidates = firstPlan.filter((cue) => cueCps(cue) > targetCps)
  const warnings: SubtitleOptimizeWarning[] = []
  let rewrittenCues = 0

  for (let index = 0; index < candidates.length; index++) {
    const cue = candidates[index]
    const slotSeconds = cue.end - cue.start
    const result = await rewriteForDubbing(
      {
        text: cue.voiceText,
        slotSeconds,
        targetWords: targetWordsForSlot(slotSeconds)
      },
      generate
    )
    if (result.ok && result.text) {
      cue.voiceText = result.text
      rewrittenCues += 1
    } else {
      warnings.push({ cueIndex: cue.cueIndex, message: result.error ?? 'Gemini rewrite thất bại.' })
    }
    onProgress?.(index + 1, candidates.length)
  }

  const finalCues = buildVoiceCuePlan(firstPlan, optionsFor(targetCps))
  const retimedCues = finalCues.filter((cue, index) => {
    const source = original[index]
    return Math.abs(cue.start - source.start) > 0.0005 || Math.abs(cue.end - source.end) > 0.0005
  }).length
  const overCps = finalCues.filter((cue) => cueCps(cue) > targetCps)
  const finiteCps = finalCues.map(cueCps).filter(Number.isFinite)

  return {
    cues: finalCues,
    rewrittenCues,
    retimedCues,
    remainingOverCps: overCps.length,
    averageCps: finiteCps.length ? finiteCps.reduce((sum, value) => sum + value, 0) / finiteCps.length : 0,
    warnings
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function nextSubtitleOutputPath(
  inputPath: string,
  outputDir: string,
  suffix: 'voice' | 'edited'
): Promise<string> {
  const stem = basename(inputPath).replace(/\.srt$/i, '')
  const first = join(outputDir, `${stem}.${suffix}.srt`)
  if (!(await pathExists(first))) return first
  for (let index = 2; ; index++) {
    const candidate = join(outputDir, `${stem}.${suffix}-${index}.srt`)
    if (!(await pathExists(candidate))) return candidate
  }
}

export async function optimizeSrtForDubbing(
  jobId: string,
  request: OptimizeSrtRequest,
  onProgress: (done: number, total: number) => void,
  generate: DubbingRewriteGenerate = (system, user, schema) =>
    generateDubbingRewriteWithGemini(jobId, system, user, schema)
): Promise<OptimizeSrtResult> {
  if (!request.inputPath.toLowerCase().endsWith('.srt')) return { ok: false, error: 'File đầu vào phải là SRT.' }
  if (!Number.isFinite(request.targetCps) || request.targetCps < 1 || request.targetCps > 60) {
    return { ok: false, error: 'CPS mục tiêu phải nằm trong khoảng 1 đến 60.' }
  }
  try {
    const raw = await readFile(request.inputPath, 'utf8')
    const parsed = docSrt(raw)
    if (!parsed.length) return { ok: false, error: 'File phụ đề trống hoặc không hợp lệ.' }
    const cues: VoiceCue[] = parsed.map((cue, cueIndex) => ({
      cueIndex,
      start: srtTimeToSeconds(cue.a),
      end: srtTimeToSeconds(cue.b),
      sourceText: cue.chu.replace(/\\N/g, '\n'),
      voiceText: cue.chu.replace(/\\N/g, '\n')
    }))
    const optimized = await optimizeSubtitleCues(cues, request.targetCps, generate, onProgress)
    const output = await nextSubtitleOutputPath(request.inputPath, request.outputDir, 'voice')
    const content = writeVoiceoverSrt(optimized.cues)
    const temporary = `${output}.tmp`
    await writeFile(temporary, content, 'utf8')
    try {
      await rename(temporary, output)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
    return {
      ok: true,
      output,
      totalCues: optimized.cues.length,
      rewrittenCues: optimized.rewrittenCues,
      retimedCues: optimized.retimedCues,
      remainingOverCps: optimized.remainingOverCps,
      averageCps: optimized.averageCps,
      warnings: optimized.warnings
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Không tối ưu được file phụ đề.' }
  }
}

export async function readEditableSubtitle(path: string): Promise<{
  ok: boolean
  cues?: EditableSubtitleCue[]
  error?: string
}> {
  if (!path.toLowerCase().endsWith('.srt')) return { ok: false, error: 'File phải có định dạng SRT.' }
  try {
    const cues = parseEditableSrt(await readFile(path, 'utf8'))
    if (!cues.length) return { ok: false, error: 'File phụ đề trống hoặc không hợp lệ.' }
    return { ok: true, cues }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Không đọc được file phụ đề.' }
  }
}

export async function saveEditedSubtitle(path: string, cues: EditableSubtitleCue[]): Promise<{
  ok: boolean
  output?: string
  error?: string
}> {
  const validation = validateEditableCues(cues, Number.POSITIVE_INFINITY)
  if (!validation.canSave) return { ok: false, error: validation.issues.find((issue) => issue.severity === 'error')?.message ?? 'Phụ đề không hợp lệ.' }
  try {
    const output = await nextSubtitleOutputPath(path, dirname(path), 'edited')
    const temporary = `${output}.tmp`
    await writeFile(temporary, serializeEditableSrt(cues), 'utf8')
    try {
      await rename(temporary, output)
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
    return { ok: true, output }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Không lưu được file phụ đề.' }
  }
}

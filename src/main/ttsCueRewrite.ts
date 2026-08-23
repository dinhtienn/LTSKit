import {
  rewriteForDubbing,
  shouldRewriteCue,
  targetWordsForSlot,
  type DubbingRewriteGenerate,
  type DubbingRewriteOptions
} from './dubbingRewrite'

export interface SynthesizedCueAudio {
  path: string
  duration: number
}

export interface CueRewriteResult extends SynthesizedCueAudio {
  voiceText: string
  rewritten: boolean
  warning?: string
  reason?: 'gemini_failed' | 'synthesis_failed' | 'still_overlong'
  reasonDetail?: string
}

export async function synthesizeWithOptionalRewrite({
  originalText,
  slotSeconds,
  options,
  isCancelled,
  synthesize,
  rewrite,
  rewriteBeforeSynthesis
}: {
  originalText: string
  slotSeconds: number
  options: DubbingRewriteOptions
  isCancelled: () => boolean
  synthesize: (text: string) => Promise<SynthesizedCueAudio>
  rewrite: DubbingRewriteGenerate
  rewriteBeforeSynthesis?: () => Promise<string | null>
}): Promise<CueRewriteResult> {
  let initialText = originalText
  if (rewriteBeforeSynthesis) {
    if (isCancelled()) throw new Error('Đã hủy.')
    try {
      const rewritten = await rewriteBeforeSynthesis()
      if (rewritten?.trim()) initialText = rewritten.trim()
    } catch {
      initialText = originalText
    }
  }
  const original = await synthesize(initialText)
  if (isCancelled()) throw new Error('Đã hủy.')
  if (!shouldRewriteCue({ duration: original.duration, slotSeconds, options })) {
    return { ...original, voiceText: initialText, rewritten: initialText !== originalText }
  }

  let current = original
  let sawGeminiFailure = false
  let lastGeminiError = ''
  let sawSynthesisFailure = false
  for (let attempt = 0; attempt < Math.max(1, Math.min(2, options.maxAttempts)); attempt++) {
    if (isCancelled()) throw new Error('Đã hủy.')
    const rewritten = await rewriteForDubbing(
      {
        text: initialText,
        slotSeconds,
        targetWords: targetWordsForSlot(slotSeconds)
      },
      rewrite
    )
    if (!rewritten.ok || !rewritten.text) {
      sawGeminiFailure = true
      lastGeminiError = rewritten.error ?? 'Gemini rewrite trả kết quả không hợp lệ.'
      continue
    }
    if (isCancelled()) throw new Error('Đã hủy.')
    try {
      current = await synthesize(rewritten.text)
    } catch (error) {
      if (isCancelled()) throw new Error('Đã hủy.')
      sawSynthesisFailure = true
      continue
    }
    if (current.duration <= slotSeconds * options.overrunRatio) {
      return { ...current, voiceText: rewritten.text, rewritten: true }
    }
  }
  return {
    ...current,
    path: original.path,
    duration: original.duration,
    voiceText: initialText,
    rewritten: false,
    warning: 'Gemini rewrite không tạo được audio vừa thời lượng; đã dùng bản gốc.',
    reason: sawSynthesisFailure ? 'synthesis_failed' : sawGeminiFailure ? 'gemini_failed' : 'still_overlong',
    reasonDetail: sawSynthesisFailure ? 'TTS/FFmpeg retry thất bại.' : sawGeminiFailure ? lastGeminiError : `Audio vẫn dài ${current.duration.toFixed(3)}s.`
  }
}

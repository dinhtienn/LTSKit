export interface VoiceCue {
  cueIndex: number
  start: number
  end: number
  sourceText: string
  voiceText: string
}

export interface CpsOptions {
  enabled: boolean
  targetCps: number
  maxExpandSeconds: number
  minGapSeconds: number
  maxBoundaryShiftSeconds: number
  minDurationSeconds: number
  balancePasses: number
}

export const DEFAULT_CPS_OPTIONS: CpsOptions = {
  enabled: false,
  targetCps: 20,
  maxExpandSeconds: 0.5,
  minGapSeconds: 0.1,
  maxBoundaryShiftSeconds: 0.5,
  minDurationSeconds: 0.8,
  balancePasses: 5
}

function stripSubtitleTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')
}

export function visibleCharacterCount(text: string): number {
  return [...stripSubtitleTags(text)].filter((char) => !/\s/u.test(char)).length
}

export function cueCps(cue: VoiceCue): number {
  const duration = cue.end - cue.start
  return duration > 0 ? visibleCharacterCount(cue.voiceText) / duration : Number.POSITIVE_INFINITY
}

function requiredDuration(cue: VoiceCue, targetCps: number): number {
  return visibleCharacterCount(cue.voiceText) / targetCps
}

function cloneCues(cues: VoiceCue[]): VoiceCue[] {
  return cues.map((cue) => ({ ...cue }))
}

function expandIntoGaps(cues: VoiceCue[], options: CpsOptions): void {
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index]
    const need = requiredDuration(cue, options.targetCps) - (cue.end - cue.start)
    if (need <= 0) continue
    const previousEnd = index > 0 ? cues[index - 1].end : 0
    const nextStart = index + 1 < cues.length ? cues[index + 1].start : Number.POSITIVE_INFINITY
    const before = Math.max(0, Math.min(options.maxExpandSeconds, cue.start - previousEnd - options.minGapSeconds))
    const after = Number.isFinite(nextStart)
      ? Math.max(0, Math.min(options.maxExpandSeconds, nextStart - cue.end - options.minGapSeconds))
      : options.maxExpandSeconds
    const beforeTake = Math.min(before, need / 2)
    const afterTake = Math.min(after, need - beforeTake)
    const extraBefore = Math.min(Math.max(0, before - beforeTake), need - beforeTake - afterTake)
    const extraAfter = Math.min(Math.max(0, after - afterTake), need - beforeTake - afterTake - extraBefore)
    cue.start -= beforeTake + extraBefore
    cue.end += afterTake + extraAfter
  }
}

function balanceAdjacentBoundaries(cues: VoiceCue[], options: CpsOptions): void {
  for (let pass = 0; pass < Math.max(1, options.balancePasses); pass++) {
    let changed = false
    for (let index = 0; index < cues.length - 1; index++) {
      const left = cues[index]
      const right = cues[index + 1]
      const gap = right.start - left.end
      if (gap < 0 || gap > options.minGapSeconds) continue
      const leftHigh = cueCps(left) > options.targetCps
      const rightHigh = cueCps(right) > options.targetCps
      const leftRequired = Math.max(options.minDurationSeconds, requiredDuration(left, options.targetCps))
      const rightRequired = Math.max(options.minDurationSeconds, requiredDuration(right, options.targetCps))
      const leftSlack = Math.max(0, left.end - left.start - leftRequired)
      const rightSlack = Math.max(0, right.end - right.start - rightRequired)
      let shift = 0
      if (leftHigh && !rightHigh) {
        shift = Math.min(options.maxBoundaryShiftSeconds, Math.max(0, leftRequired - (left.end - left.start)), rightSlack)
      } else if (rightHigh && !leftHigh) {
        shift = -Math.min(options.maxBoundaryShiftSeconds, Math.max(0, rightRequired - (right.end - right.start)), leftSlack)
      }
      if (shift === 0) continue
      const newBoundary = left.end + shift
      if (newBoundary - left.start < options.minDurationSeconds) continue
      if (right.end - (right.start + shift) < options.minDurationSeconds) continue
      left.end = newBoundary
      right.start = newBoundary
      changed = true
    }
    if (!changed) break
  }
}

export function buildVoiceCuePlan(cues: VoiceCue[], options: CpsOptions): VoiceCue[] {
  const plan = cloneCues(cues)
  if (!options.enabled || !plan.length || options.targetCps <= 0) return plan
  expandIntoGaps(plan, options)
  balanceAdjacentBoundaries(plan, options)
  for (let index = 0; index < plan.length; index++) {
    const cue = plan[index]
    const previous = plan[index - 1]
    const minimumStart = previous ? previous.end + options.minGapSeconds : 0
    cue.start = Math.max(cue.start, minimumStart)
    cue.end = Math.max(cue.end, cue.start + options.minDurationSeconds)
    if (index + 1 < plan.length) {
      const next = plan[index + 1]
      if (next.start < cue.end + options.minGapSeconds) next.start = cue.end + options.minGapSeconds
    }
  }
  return plan
}

function formatTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const secs = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function writeVoiceoverSrt(cues: VoiceCue[]): string {
  return `${cues.map((cue, index) => `${index + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.voiceText}\n`).join('\n')}\n`
}

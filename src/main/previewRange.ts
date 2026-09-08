export interface RenderRange {
  startSec: number
  durationSec: number
}

export function previewRange(startSec: number, videoDuration: number, maxDuration = 5): RenderRange | null {
  const start = Math.min(Math.max(0, Number.isFinite(startSec) ? startSec : 0), Math.max(0, videoDuration))
  const remaining = Math.max(0, videoDuration - start)
  const duration = Math.min(Math.max(0, maxDuration), remaining)
  return duration > 0 ? { startSec: start, durationSec: duration } : null
}

export function renderRangeArgs(range?: RenderRange): string[] {
  return range ? ['-ss', String(range.startSec), '-t', String(range.durationSec)] : []
}

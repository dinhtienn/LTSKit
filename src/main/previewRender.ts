import { app } from 'electron'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import type { BurnProgress, BurnReq, VideoPreviewResult } from '../shared/types'
import { burnSubtitle, cancelBurn } from './burn'
import { previewRange } from './previewRange'
import { probeMedia } from './videoComposer'
import { formatProcessingMetric } from './processingMetrics'
import { logError, logInfo } from './logger'

let currentOutput: string | null = null

function previewRoot(): string {
  return join(app.getPath('temp'), 'ltskit-video-preview')
}

export async function cleanupVideoPreview(): Promise<void> {
  if (!currentOutput) return
  await rm(currentOutput, { force: true }).catch(() => undefined)
  currentOutput = null
}

export function cancelVideoPreview(): void {
  cancelBurn()
}

export async function renderVideoPreview(
  req: BurnReq,
  startSec: number,
  onProgress: (progress: BurnProgress) => void
): Promise<VideoPreviewResult> {
  const startedAt = performance.now()
  const meta = await probeMedia(req.video)
  const range = previewRange(startSec, meta.duration)
  if (!range) return { ok: false, error: 'Playhead đang ở cuối video.' }
  await mkdir(previewRoot(), { recursive: true })
  await cleanupVideoPreview()
  const output = join(previewRoot(), `preview-${Date.now()}.mp4`)
  const result = await burnSubtitle(req, onProgress, { range, outputPath: output, promote: false })
  if (!result.ok) {
    logPreviewMetric(startedAt, 'lỗi')
    return result
  }
  currentOutput = output
  logPreviewMetric(startedAt, 'xong')
  return { ...result, output, startSec: range.startSec, durationSec: range.durationSec }
}

function logPreviewMetric(startedAt: number, outcome: 'xong' | 'lỗi'): void {
  const line = formatProcessingMetric({ job: 'Preview video', elapsedMs: performance.now() - startedAt, outcome })
  if (outcome === 'xong') logInfo(line)
  else logError(line)
}

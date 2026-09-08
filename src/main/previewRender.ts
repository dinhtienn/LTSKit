import { app } from 'electron'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import type { BurnProgress, BurnReq, VideoPreviewResult } from '../shared/types'
import { burnSubtitle, cancelBurn } from './burn'
import { previewRange } from './previewRange'
import { probeMedia } from './videoComposer'

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
  const meta = await probeMedia(req.video)
  const range = previewRange(startSec, meta.duration)
  if (!range) return { ok: false, error: 'Playhead đang ở cuối video.' }
  await mkdir(previewRoot(), { recursive: true })
  await cleanupVideoPreview()
  const output = join(previewRoot(), `preview-${Date.now()}.mp4`)
  const result = await burnSubtitle(req, onProgress, { range, outputPath: output, promote: false })
  if (!result.ok) return result
  currentOutput = output
  return { ...result, output, startSec: range.startSec, durationSec: range.durationSec }
}

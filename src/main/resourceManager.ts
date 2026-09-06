import type { CapcutEngineStatus, DepStatus, OcrEngineStatus, ResourceDescriptor, ResourceId, ResourceProgress, ResourceState, VieneuEngineStatus, WhisperCudaStatus, WhisperEngineStatus } from '../shared/types'
import { checkDependencies, runSetup } from './deps'
import { installOcrEngine, ocrEngineStatus } from './ocr'
import { installWhisperEngine, whisperEngineStatus, installCudaPack, whisperCudaStatus } from './whisper'
import { installVieneuEngine, vieneuEngineStatus } from './vieneuNative'
import { capcutEngineStatus, installCapcutEngine } from './capcutTts'

export interface ResourceStatusInputs {
  platform: Pick<DepStatus, 'ytdlp' | 'ffmpeg'>
  whisper: Pick<WhisperEngineStatus, 'has'>
  whisperCuda: Pick<WhisperCudaStatus, 'has'>
  ocr: Pick<OcrEngineStatus, 'has'>
  vieneu: Pick<VieneuEngineStatus, 'has' | 'missing'>
  capcut: Pick<CapcutEngineStatus, 'has' | 'needsPython' | 'message'>
}

export type ResourceInstallOps = {
  setup: (onProgress: (progress: { message: string; percent: number }) => void) => Promise<void>
  whisper: (onProgress: (percent: number) => void) => Promise<void>
  whisperCuda: (onProgress: (percent: number) => void) => Promise<void>
  ocr: (onProgress: (percent: number) => void) => Promise<void>
  vieneu: (onProgress: (progress: unknown) => void) => Promise<void>
  capcut: (onProgress: (progress: unknown) => void) => Promise<void>
}

export function mapResourceStatuses(input: ResourceStatusInputs): ResourceDescriptor[] {
  return [
    {
      id: 'platform', group: 'platform', label: 'FFmpeg & yt-dlp', optional: false,
      state: input.platform.ffmpeg && input.platform.ytdlp ? 'ready' : 'missing',
      message: input.platform.ffmpeg && input.platform.ytdlp ? 'Sẵn sàng' : 'Thiếu FFmpeg hoặc yt-dlp.',
      action: 'setup'
    },
    {
      id: 'whisper', group: 'subtitle', label: 'Whisper Audio → Text', optional: false,
      state: input.whisper.has ? 'ready' : 'missing',
      message: input.whisper.has ? 'Sẵn sàng' : 'Chưa cài engine Whisper.',
      action: 'install'
    },
    {
      id: 'whisper-cuda', group: 'subtitle', label: 'Whisper CUDA', optional: true,
      state: input.whisperCuda.has ? 'ready' : 'optional-missing',
      message: input.whisperCuda.has ? 'Sẵn sàng tăng tốc' : 'Optional · chưa cài',
      action: 'install'
    },
    {
      id: 'ocr', group: 'subtitle', label: 'OCR Dịch màn hình', optional: false,
      state: input.ocr.has ? 'ready' : 'missing',
      message: input.ocr.has ? 'Sẵn sàng' : 'Chưa cài engine OCR.',
      action: 'install'
    },
    {
      id: 'vieneu', group: 'voice', label: 'VieNeu TTS', optional: false,
      state: input.vieneu.has ? 'ready' : input.vieneu.missing.length ? 'broken' : 'missing',
      message: input.vieneu.has ? 'Sẵn sàng' : input.vieneu.missing.length ? `Thiếu: ${input.vieneu.missing.join(', ')}` : 'Chưa cài engine VieNeu.',
      action: 'install'
    },
    {
      id: 'capcut', group: 'voice', label: 'CapCut TTS', optional: true,
      state: input.capcut.has ? 'ready' : input.capcut.needsPython ? 'optional-missing' : 'broken',
      message: input.capcut.has ? 'Sẵn sàng' : input.capcut.needsPython ? 'Optional · chưa cài' : input.capcut.message,
      action: 'install'
    }
  ]
}

export async function getResourceStatus(): Promise<ResourceDescriptor[]> {
  const [platform, whisper, whisperCuda, ocr, vieneu, capcut] = await Promise.all([
    checkDependencies(), whisperEngineStatus(), whisperCudaStatus(), ocrEngineStatus(), vieneuEngineStatus(), capcutEngineStatus()
  ])
  return mapResourceStatuses({ platform, whisper, whisperCuda, ocr, vieneu, capcut })
}

export async function installResourceWithOps(
  id: ResourceId,
  ops: ResourceInstallOps,
  onProgress: (progress: ResourceProgress) => void
): Promise<void> {
  if (id === 'platform') return ops.setup((progress) => onProgress({ id, ...progress }))
  const reportPercent = (percent: number): void => onProgress({ id, message: 'Đang cài…', percent })
  if (id === 'whisper') return ops.whisper(reportPercent)
  if (id === 'whisper-cuda') return ops.whisperCuda(reportPercent)
  if (id === 'ocr') return ops.ocr(reportPercent)
  if (id === 'vieneu') return ops.vieneu((progress) => onProgress({ id, message: String(progress), percent: -1 }))
  if (id === 'capcut') return ops.capcut((progress) => onProgress({ id, message: String(progress), percent: -1 }))
  throw new Error('Resource không hợp lệ.')
}

export async function installResource(id: ResourceId, onProgress: (progress: ResourceProgress) => void): Promise<void> {
  return installResourceWithOps(id, {
    setup: async (callback) => runSetup((progress) => callback({ message: progress.message, percent: progress.percent })),
    whisper: (callback) => installWhisperEngine(callback),
    whisperCuda: (callback) => installCudaPack(callback),
    ocr: (callback) => installOcrEngine(callback),
    vieneu: (callback) => installVieneuEngine(callback),
    capcut: (callback) => installCapcutEngine(callback)
  }, onProgress)
}

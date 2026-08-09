import { spawn } from 'node:child_process'
import { dirname, extname, join } from 'node:path'
import { resolveFfmpeg } from './deps'
import type { BlurRegion, BurnReq, LogoDimensions, MediaProbe, VideoRect } from '../shared/types'
import { displayDimensions } from '../shared/videoOrientation'

export interface ComposerPlan {
  inputs: string[]
  filterComplex: string
  maps: string[]
  changesPixels: boolean
  changesAudio: boolean
  softSubtitleInput: number | null
}

export interface AssetProbe {
  hasAudio: boolean
  audioDuration: number | null
  visual: { width: number; height: number } | null
}

export function ffprobePath(ffmpeg: string): string {
  if (ffmpeg === 'ffmpeg') return 'ffprobe'
  return join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
}

function spawnText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => (stdout += data.toString()))
    child.stderr.on('data', (data: Buffer) => (stderr += data.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `ffprobe thoát với mã ${code ?? -1}`))
    })
  })
}

export async function probeMedia(path: string): Promise<MediaProbe> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu ffmpeg. Hãy chạy lại bước cài đặt.')
  return probeMediaWithFfmpeg(ffmpeg, path)
}

export async function probeMediaWithFfmpeg(ffmpeg: string, path: string): Promise<MediaProbe> {
  const raw = await spawnText(ffprobePath(ffmpeg), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path])
  return parseMediaProbe(raw)
}

export async function probeAsset(ffmpeg: string, path: string): Promise<AssetProbe> {
  const raw = await spawnText(ffprobePath(ffmpeg), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path])
  return parseAssetProbe(raw)
}

export async function probeLogoDimensions(path: string): Promise<LogoDimensions> {
  if (!isSupportedLogoPath(path)) {
    throw new Error('File logo phải là ảnh PNG, JPG, JPEG, WEBP hoặc BMP.')
  }
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu ffmpeg. Hãy chạy lại bước cài đặt.')
  return logoDimensionsFromAsset(await probeAsset(ffmpeg, path))
}

export type AuxiliaryAssetKind = 'voice' | 'logo'
export type AuxiliaryDecoder = (kind: AuxiliaryAssetKind, path: string) => Promise<boolean>

export function isSupportedLogoPath(path: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(extname(path).toLowerCase())
}

function decodeWithFfmpeg(ffmpeg: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}

export function decodeAuxiliaryAsset(ffmpeg: string, kind: AuxiliaryAssetKind, path: string): Promise<boolean> {
  const selection = kind === 'voice' ? ['-map', '0:a:0', '-t', '1'] : ['-map', '0:v:0', '-frames:v', '1']
  return decodeWithFfmpeg(ffmpeg, ['-v', 'error', '-i', path, ...selection, '-f', 'null', '-'])
}

export function parseAssetProbe(raw: string): AssetProbe {
  let data: {
    streams?: Array<{
      codec_type?: string
      width?: number
      height?: number
      duration?: string
    }>
    format?: { duration?: string }
  }
  try {
    data = JSON.parse(raw) as typeof data
  } catch {
    throw new Error('Dữ liệu ffprobe không hợp lệ.')
  }
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio')
  const visual = data.streams?.find(
    (stream) =>
      stream.codec_type === 'video' && Number.isFinite(stream.width) && (stream.width ?? 0) > 0 && Number.isFinite(stream.height) && (stream.height ?? 0) > 0
  )
  const formatDuration = Number(data.format?.duration)
  const streamDuration = Number(audio?.duration)
  const audioDuration =
    Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : null
  return {
    hasAudio: !!audio,
    audioDuration,
    visual: visual ? { width: visual.width as number, height: visual.height as number } : null
  }
}

export function logoDimensionsFromAsset(asset: AssetProbe): LogoDimensions {
  if (!asset.visual) throw new Error('Không đọc được kích thước ảnh logo.')
  return asset.visual
}

export function validateComposerAssets(req: BurnReq, assets: { voice: AssetProbe | null; logo: AssetProbe | null }): string | null {
  if (req.voice && (!assets.voice?.hasAudio || assets.voice.audioDuration == null)) {
    return 'File voice không tồn tại, không đọc được hoặc không có âm thanh hợp lệ.'
  }
  if (req.logo) {
    const visual = assets.logo?.visual
    if (!visual) return 'File logo không tồn tại hoặc không đọc được hình ảnh hợp lệ.'
    const rectWidth = req.logo.rect.x1 - req.logo.rect.x0
    const rectHeight = req.logo.rect.y1 - req.logo.rect.y0
    const sourceAspect = visual.width / visual.height
    const requestedAspect = rectWidth / rectHeight
    const roundingTolerance = Math.max(0.02, 2 / Math.max(1, rectHeight))
    if (!Number.isFinite(requestedAspect) || Math.abs(requestedAspect / sourceAspect - 1) > roundingTolerance) {
      return 'Tỷ lệ khung logo không khớp với tỷ lệ ảnh logo gốc.'
    }
  }
  return null
}

export async function validateAndDecodeComposerAssets(
  req: BurnReq,
  assets: { voice: AssetProbe | null; logo: AssetProbe | null },
  decode: AuxiliaryDecoder
): Promise<string | null> {
  const metadataError = validateComposerAssets(req, assets)
  if (metadataError) return metadataError
  if (req.logo && !isSupportedLogoPath(req.logo.path)) {
    return 'File logo phải là ảnh PNG, JPG, JPEG, WEBP hoặc BMP.'
  }
  if (req.voice && !(await decode('voice', req.voice))) {
    return 'File voice không tồn tại, không đọc được hoặc không có âm thanh hợp lệ.'
  }
  if (req.logo && !(await decode('logo', req.logo.path))) {
    return 'File logo không tồn tại hoặc không giải mã được hình ảnh hợp lệ.'
  }
  return null
}

export function parseMediaProbe(raw: string): MediaProbe {
  let data: {
    streams?: Array<{
      codec_type?: string
      width?: number
      height?: number
      duration?: string
      disposition?: { attached_pic?: number }
      side_data_list?: Array<{ rotation?: number }>
    }>
    format?: { duration?: string }
  }
  try {
    data = JSON.parse(raw) as typeof data
  } catch {
    throw new Error('Không đọc được thông tin video hợp lệ. Hãy chọn một tệp video khác.')
  }

  const video = data.streams?.find((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1)
  const formatDuration = Number(data.format?.duration)
  const streamDuration = Number(video?.duration)
  const duration = Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : streamDuration
  if (
    !video ||
    !Number.isFinite(video.width) ||
    (video.width ?? 0) <= 0 ||
    !Number.isFinite(video.height) ||
    (video.height ?? 0) <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    throw new Error('Không đọc được thông tin video hợp lệ. Hãy chọn một tệp video khác.')
  }

  const dimensions = displayDimensions(
    video.width as number,
    video.height as number,
    video.side_data_list?.find((sideData) => Number.isFinite(sideData.rotation))?.rotation
  )
  return {
    width: dimensions.width,
    height: dimensions.height,
    duration,
    hasAudio: !!data.streams?.some((stream) => stream.codec_type === 'audio')
  }
}

function validRect(rect: VideoRect | null | undefined, meta: MediaProbe): boolean {
  if (!rect) return false
  const values = [rect.x0, rect.x1, rect.y0, rect.y1]
  return (
    values.every(Number.isFinite) && rect.x0 >= 0 && rect.y0 >= 0 && rect.x1 > rect.x0 && rect.y1 > rect.y0 && rect.x1 <= meta.width && rect.y1 <= meta.height
  )
}

function effectiveBlurRegions(req: BurnReq): BlurRegion[] {
  if (req.blurRegions !== undefined) return req.blurRegions
  if (req.region) return [{ id: 'legacy', ...req.region }]
  return []
}

const COLOR = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i

function validPercent(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100
}

function validateTextOverlays(req: BurnReq, meta: MediaProbe): string | null {
  const overlays = req.textOverlays ?? []
  if (overlays.length > 20) return 'Chỉ được thêm tối đa 20 text.'
  for (const [index, item] of overlays.entries()) {
    const label = `Text ${index + 1}`
    if (!item.text.trim()) return `${label}: nội dung không được để trống.`
    if (!validRect(item.rect, meta)) return `${label}: vùng hiển thị không hợp lệ.`
    if (!Number.isFinite(item.fontSize) || item.fontSize <= 0) return `${label}: cỡ chữ không hợp lệ.`
    if (![item.textColor, item.outlineColor, item.bgColor].every((color) => COLOR.test(color))) {
      return `${label}: màu không hợp lệ.`
    }
    if (!validPercent(item.textOpacity) || !validPercent(item.bgOpacity)) {
      return `${label}: độ mờ không hợp lệ.`
    }
    if (!Number.isFinite(item.outlinePx) || item.outlinePx < 0 || item.outlinePx > 8) {
      return `${label}: độ dày viền không hợp lệ.`
    }
    if (
      !Number.isFinite(item.startSec) ||
      item.startSec < 0 ||
      (item.endSec != null && (!Number.isFinite(item.endSec) || item.endSec <= item.startSec || item.endSec > meta.duration))
    ) {
      return `${label}: thời gian hiển thị không hợp lệ.`
    }
  }
  return null
}

function validateSubtitleStyle(req: BurnReq): string | null {
  const style = req.subtitleStyle
  if (!style) return null
  if (
    ![style.textColor, style.outlineColor, style.bgColor].every((color) => COLOR.test(color)) ||
    !validPercent(style.textOpacity) ||
    !validPercent(style.bgOpacity) ||
    !Number.isFinite(style.outlinePx) ||
    style.outlinePx < 0 ||
    style.outlinePx > 8
  ) {
    return 'Style phụ đề không hợp lệ.'
  }
  return null
}

export function validateBurnRequest(req: BurnReq, meta: MediaProbe): string | null {
  if (![req.videoVolume, req.voiceVolume].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) return 'Âm lượng phải từ 0 đến 100.'
  if (req.srt && req.mode !== 'burn' && req.mode !== 'soft') return 'Hãy chọn cách gắn phụ đề.'
  if (req.mode === 'burn' && !req.srt) return 'Cần chọn phụ đề SRT để đốt chữ.'
  if (req.srt && req.mode === 'burn' && !validRect(req.subRegion ?? req.region, meta)) {
    return 'Vùng đặt phụ đề không hợp lệ hoặc nằm ngoài video.'
  }
  const subtitleStyleError = validateSubtitleStyle(req)
  if (subtitleStyleError) return subtitleStyleError
  const textError = validateTextOverlays(req, meta)
  if (textError) return textError
  const blurRegions = effectiveBlurRegions(req)
  if (req.lamMo && (blurRegions.length === 0 || blurRegions.some((rect) => !validRect(rect, meta)))) {
    return 'vùng làm mờ không hợp lệ hoặc nằm ngoài video.'
  }
  if (req.logo && (!req.logo.path || !validRect(req.logo.rect, meta))) {
    return 'Vùng logo không hợp lệ hoặc nằm ngoài video.'
  }
  const hasOperation = !!req.srt || !!req.lamMo || !!req.voice || !!req.logo || (req.textOverlays?.length ?? 0) > 0 || req.videoVolume !== 100
  if (!hasOperation) return 'Hãy chọn ít nhất một thay đổi để xuất video.'
  return null
}

const evenCoordinate = (value: number): number => Math.max(0, Math.floor(value / 2) * 2)
const evenDimension = (value: number): number => Math.max(2, Math.floor(value / 2) * 2)
const volume = (percent: number): string => Number((percent / 100).toFixed(2)).toString()

export function buildComposerPlan(req: BurnReq, meta: MediaProbe, assName?: string): ComposerPlan {
  const inputs: string[] = []
  const addInput = (path: string): number => {
    inputs.push(path)
    return inputs.length
  }

  const logoInput = req.logo ? addInput(req.logo.path) : null
  const voiceInput = req.voice ? addInput(req.voice) : null
  const softSubtitleInput = req.srt && req.mode === 'soft' ? addInput(req.srt) : null
  const filters: string[] = []
  let videoLabel = '0:v'
  let videoStep = 0

  const blurRegions = req.lamMo ? effectiveBlurRegions(req) : []
  if (blurRegions.length > 0) {
    const branches = blurRegions.map((_, index) => `[vblur${index}]`).join('')
    filters.push(`[${videoLabel}]split=${blurRegions.length + 1}[vbase]${branches}`)
    videoLabel = 'vbase'
    for (const [index, rect] of blurRegions.entries()) {
      const x = evenCoordinate(rect.x0)
      const y = evenCoordinate(rect.y0)
      const width = evenDimension(rect.x1 - rect.x0)
      const height = evenDimension(rect.y1 - rect.y0)
      filters.push(`[vblur${index}]crop=${width}:${height}:${x}:${y},gblur=sigma=20[blur${index}]`)
    }
    for (const [index, rect] of blurRegions.entries()) {
      const x = evenCoordinate(rect.x0)
      const y = evenCoordinate(rect.y0)
      const out = `[v${++videoStep}]`
      filters.push(`[${videoLabel}][blur${index}]overlay=${x}:${y}${out}`)
      videoLabel = `v${videoStep}`
    }
  }

  if (req.logo && logoInput !== null) {
    const rect = req.logo.rect
    const width = evenDimension(rect.x1 - rect.x0)
    const height = evenDimension(rect.y1 - rect.y0)
    const x = evenCoordinate(rect.x0)
    const y = evenCoordinate(rect.y0)
    filters.push(`[${logoInput}:v]scale=${width}:${height}[logo]`, `[${videoLabel}][logo]overlay=${x}:${y}[v${++videoStep}]`)
    videoLabel = `v${videoStep}`
  }

  const hasBurnAss = (req.srt != null && req.mode === 'burn') || (req.textOverlays?.length ?? 0) > 0
  if (hasBurnAss) {
    if (!assName || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.ass$/i.test(assName)) {
      throw new Error('Cần tên tệp ASS tạm hợp lệ để đốt phụ đề.')
    }
    filters.push(`[${videoLabel}]ass=${assName}[vout]`)
    videoLabel = 'vout'
  }

  const changesPixels = videoStep > 0 || hasBurnAss
  if (changesPixels && videoLabel !== 'vout') filters.push(`[${videoLabel}]null[vout]`)

  const changesAudio = voiceInput !== null || req.videoVolume !== 100
  let audioMap = '0:a?'
  if (voiceInput !== null) {
    if (meta.hasAudio) {
      filters.push(
        `[0:a]volume=${volume(req.videoVolume)}[a0]`,
        `[${voiceInput}:a]volume=${volume(req.voiceVolume)}[a1]`,
        '[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]'
      )
      audioMap = '[aout]'
    } else {
      filters.push(`[${voiceInput}:a]volume=${volume(req.voiceVolume)}[aout]`, '[aout]apad[aoutp]')
      audioMap = '[aoutp]'
    }
  } else if (changesAudio && meta.hasAudio) {
    filters.push(`[0:a]volume=${volume(req.videoVolume)}[aout]`)
    audioMap = '[aout]'
  }

  const maps = [changesPixels ? '[vout]' : '0:v:0', audioMap]
  if (softSubtitleInput !== null) maps.push(`${softSubtitleInput}:0`)

  return {
    inputs,
    filterComplex: filters.join(';'),
    maps,
    changesPixels,
    changesAudio,
    softSubtitleInput
  }
}

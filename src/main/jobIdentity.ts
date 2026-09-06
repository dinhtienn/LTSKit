import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { TranslationStyleSnapshot, WhisperRequest } from '../shared/types'

/**
 * Khoa nhan dang mot job da chay. Doi khoa = phai chay lai; giu khoa = dung lai
 * ket qua da luu.
 *
 * Tang so nay khi thay doi cach sinh khoa hoac cach luu ket qua, de cache cu
 * khong bi doc nham.
 */
export const JOB_IDENTITY_VERSION = 1
export const WHISPER_PIPELINE_VERSION = 1
export const OCR_PIPELINE_VERSION = 1
export const TRANSLATION_PIPELINE_VERSION = 1

/**
 * Tang so nay moi khi sua prompt dich: prompt khac thi ban dich khac, nen ket
 * qua da luu bang prompt cu khong con dung de dung lai.
 */
export const TRANSLATION_PROMPT_VERSION = 1

/** Dau van tay cua file input: doi ten, doi kich thuoc hay sua noi dung deu doi khoa. */
async function inputFingerprint(path: string): Promise<{
  path: string
  size: number
  modifiedMs: number
}> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`Không phải tệp: ${path}`)
  return {
    // Windows khong phan biet hoa/thuong -> chuan hoa de khong tao 2 cache trung.
    path: path.replace(/\\/g, '/').toLowerCase(),
    size: info.size,
    modifiedMs: Math.floor(info.mtimeMs)
  }
}

function jobKey(namespace: string, parts: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ namespace, version: JOB_IDENTITY_VERSION, parts }))
    .digest('hex')
}

/**
 * `outputDir` KHONG tham gia vao khoa: cung mot file va cung cau hinh thi ket
 * qua giong nhau, chi la duoc ghi ra cho khac. Neu dua vao khoa thi doi thu muc
 * luu se mat cache mot cach vo ly.
 */
export async function whisperJobKey(req: WhisperRequest): Promise<string> {
  const input = await inputFingerprint(req.input)
  return jobKey('whisper', {
    pipelineVersion: WHISPER_PIPELINE_VERSION,
    input,
    model: req.model,
    language: req.language || 'auto',
    task: req.task,
    // Thu tu nguoi dung tick format khong doi noi dung tung file.
    formats: [...new Set(req.formats?.length ? req.formats : ['srt'])].sort(),
    device: req.device,
    diarize: req.diarize,
    speakers: req.diarize ? req.speakers : 0
  })
}

/**
 * OCR doc chu trong MOT vung cua khung hinh, nen vung doc la phan cua khoa.
 * Chuan hoa canh giong `buildOcrArgs` de cung mot vung khong sinh hai cache.
 */
export async function ocrJobKey(
  input: string,
  region: { x0: number; x1: number; y0: number; y1: number }
): Promise<string> {
  const edges = (a: number, b: number): [number, number] => {
    const first = Math.max(0, Math.round(a))
    const second = Math.max(0, Math.round(b))
    return first <= second ? [first, second] : [second, first]
  }
  const [x0, x1] = edges(region.x0, region.x1)
  const [y0, y1] = edges(region.y0, region.y1)
  return jobKey('ocr', { pipelineVersion: OCR_PIPELINE_VERSION, input: await inputFingerprint(input), x0, x1, y0, y1 })
}

/**
 * Ban dich phu thuoc vao file nguon, ngon ngu dich, tap model va prompt. Thu tu
 * quay vong model KHONG tinh vao khoa: cung tap model thi ket qua tuong duong.
 */
export async function translationJobKey(
  srtPath: string,
  targetLanguage: string,
  models: string[],
  style: TranslationStyleSnapshot
): Promise<string> {
  return jobKey('translation', {
    pipelineVersion: TRANSLATION_PIPELINE_VERSION,
    input: await inputFingerprint(srtPath),
    targetLanguage,
    models: [...new Set(models)].sort(),
    promptVersion: TRANSLATION_PROMPT_VERSION,
    style: { id: style.id, name: style.name, instruction: style.instruction }
  })
}

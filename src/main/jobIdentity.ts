import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { WhisperRequest } from '../shared/types'

/**
 * Khoa nhan dang mot job da chay. Doi khoa = phai chay lai; giu khoa = dung lai
 * ket qua da luu.
 *
 * Tang so nay khi thay doi cach sinh khoa hoac cach luu ket qua, de cache cu
 * khong bi doc nham.
 */
export const JOB_IDENTITY_VERSION = 1

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

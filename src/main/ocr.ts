import { spawn, ChildProcess } from 'node:child_process'
import { access, chmod, mkdtemp, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { replaceEngineDirectory } from './ocrInstall'
import { ASSET_BASE, binDir, downloadFile, ensureDataDirs, extractZip, resolveFfmpeg } from './deps'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import { jobCacheRoot, readCachedOutputs, writeCachedOutputs } from './jobCache'
import { formatProcessingMetric } from './processingMetrics'
import { ocrJobKey } from './jobIdentity'
import type { OcrEngineStatus, OcrProgress, OcrResult } from '../shared/types'
import { buildOcrArgs } from './ocrArgs'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const BASE = ASSET_BASE

// Engine RIENG (~232MB) — chi tab Dich man hinh tai.
// Vi sao khong gop vao whisper-engine: opencv 118MB la MA, bi dong bang thang
// vao .exe, khong tach thanh goi du lieu tai rieng duoc. Gop vao la bat nguoi
// chi lam phu de ganh them 150MB. (Theo dung nep dy-engine cua tab Douyin.)
function asset(): string {
  return isWin ? 'ocr-engine-win.zip' : isMac ? 'ocr-engine-macos.zip' : 'ocr-engine-linux.zip'
}
function engineDir(): string {
  return join(binDir(), 'ocr-engine')
}
function enginePath(): string {
  return join(engineDir(), isWin ? 'ocr-engine.exe' : 'ocr-engine')
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function ocrEngineStatus(): Promise<OcrEngineStatus> {
  return { has: await exists(enginePath()) }
}

export async function installOcrEngine(onProgress: (p: number) => void): Promise<void> {
  await ensureDataDirs()
  const stagingRoot = await mkdtemp(join(binDir(), 'ocr-install-'))
  const zip = join(stagingRoot, 'ocr-engine.zip')
  const extracted = join(stagingRoot, 'extracted')
  const executable = isWin ? 'ocr-engine.exe' : 'ocr-engine'
  try {
    logInfo('Dịch màn hình: đang tải công cụ (~230MB)…')
    await downloadFile(`${BASE}/${asset()}`, zip, onProgress)
    logInfo('Dịch màn hình: đang giải nén…')
    await extractZip(zip, extracted)
    const candidate = await findEngineDir(extracted, executable)
    if (!candidate) throw new Error('Gói tải về không có file thực thi OCR.')
    await replaceEngineDirectory(candidate, engineDir(), executable)
    if (!isWin) await chmod(enginePath(), 0o755)
    logInfo('Dịch màn hình: đã cài xong công cụ.')
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

async function findEngineDir(root: string, executable: string): Promise<string | null> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) return root
    if (entry.isDirectory()) {
      const found = await findEngineDir(path, executable)
      if (found) return found
    }
  }
  return null
}

let child: ChildProcess | null = null

/** Huy giua chung: dong tien trinh, video dai co the chay vai phut. */
export function cancelOcr(): void {
  if (!child) return
  try {
    child.kill()
  } catch {
    /* bo qua */
  }
  child = null
}

/**
 * Doc chu chay tren video -> .srt.
 * y0/y1 la PIXEL CUA VIDEO GOC (giao dien da quy doi san).
 */
export async function ocrVideo(
  input: string,
  outputDir: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  onProgress: (p: OcrProgress) => void
): Promise<OcrResult> {
  const startedAt = performance.now()
  if (child) return { ok: false, error: 'Đang xử lý một video khác.' }
  if (!(await exists(enginePath()))) {
    return { ok: false, error: 'Chưa có công cụ. Vui lòng tải công cụ trước.' }
  }
  const ff = await resolveFfmpeg()
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

  const out = join(outputDir, basename(input).replace(/\.[^.]+$/, '') + '.srt')
  const args = buildOcrArgs(input, out, x0, x1, y0, y1, ff)

  // Cache tra TRUOC khi spawn: doc chu tren video dai ton rat nhieu thoi gian,
  // chay lai nguyen ven khi video va vung doc khong doi la vo ich. Moi loi lien
  // quan cache deu bo qua de job van chay binh thuong.
  const cacheKey = await ocrJobKey(input, { x0, x1, y0, y1 }).catch(() => null)
  if (cacheKey) {
    const cached = await readCachedOutputs(jobCacheRoot(), 'ocr', cacheKey, outputDir).catch(
      () => null
    )
    if (cached?.outputs.length) {
      logInfo(`Dịch màn hình: dùng lại kết quả đã lưu cho ${basename(input)}`)
      logInfo(formatProcessingMetric({ job: 'OCR', elapsedMs: performance.now() - startedAt, outcome: 'xong', cache: 'hit' }))
      onProgress({ percent: 100, text: '' })
      return {
        ok: true,
        output: cached.outputs[0],
        count: Number(cached.meta.count) || 0,
        bandTop: typeof cached.meta.bandTop === 'number' ? cached.meta.bandTop : null,
        bandBot: typeof cached.meta.bandBot === 'number' ? cached.meta.bandBot : null
      }
    }
  }

  logInfo(`Dịch màn hình: bắt đầu đọc ${basename(input)}…`)

  return new Promise<OcrResult>((resolve) => {
    const p = spawn(enginePath(), args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    })
    child = p

    let buf = ''
    let errTail = ''
    let doneOut: string | null = null
    let count = 0
    let bandTop: number | null = null
    let bandBot: number | null = null
    let errMsg: string | null = null

    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      for (const line of parts) {
        const t = line.trim()
        if (!t || t[0] !== '{') continue
        try {
          const o = JSON.parse(t) as {
            type?: string
            percent?: number
            text?: string
            message?: string
            output?: string
            count?: number
            band_top?: number | null
            band_bot?: number | null
          }
          if (o.type === 'progress') {
            onProgress({ percent: o.percent ?? 0, text: o.text ?? '' })
          } else if (o.type === 'status') {
            onProgress({ percent: -1, text: o.message ?? '' })
          } else if (o.type === 'done') {
            doneOut = o.output ?? out
            count = o.count ?? 0
            bandTop = o.band_top ?? null
            bandBot = o.band_bot ?? null
          } else if (o.type === 'error') {
            errMsg = o.message ?? null
          }
        } catch {
          /* bo qua dong hong */
        }
      }
    })

    p.stderr.on('data', (d: Buffer) => {
      const last = d.toString().trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })

    p.on('error', (err) => {
      debugRaw('ocr spawn', err)
      child = null
      logError(formatProcessingMetric({ job: 'OCR', elapsedMs: performance.now() - startedAt, outcome: 'lỗi', cache: cacheKey ? 'miss' : undefined }))
      resolve({ ok: false, error: errLabel(err) })
    })

    p.on('close', (code) => {
      child = null
      if (doneOut) {
        logInfo(`Dịch màn hình: xong ${count} câu.`)
        logInfo(formatProcessingMetric({ job: 'OCR', elapsedMs: performance.now() - startedAt, outcome: 'xong', cache: 'miss' }))
        if (cacheKey) {
          void writeCachedOutputs(jobCacheRoot(), 'ocr', cacheKey, [doneOut], {
            count,
            ...(bandTop === null ? {} : { bandTop }),
            ...(bandBot === null ? {} : { bandBot })
          }).catch((err) => {
            // Khong luu duoc cache thi lan sau doc lai, khong anh huong ket qua.
            debugRaw('ocr cache write', err)
          })
        }
        resolve({ ok: true, output: doneOut, count, bandTop, bandBot })
        return
      }
      // Bi huy giua chung -> khong phai loi
      if (code === null) {
        logError(formatProcessingMetric({ job: 'OCR', elapsedMs: performance.now() - startedAt, outcome: 'lỗi', cache: cacheKey ? 'miss' : undefined }))
        resolve({ ok: false, error: 'Đã huỷ.' })
        return
      }
      const raw = errMsg || errTail || `code ${code}`
      debugRaw('ocr close', raw)
      resolve({ ok: false, error: errLabel(raw) })
      logError(formatProcessingMetric({ job: 'OCR', elapsedMs: performance.now() - startedAt, outcome: 'lỗi', cache: cacheKey ? 'miss' : undefined }))
    })
  })
}

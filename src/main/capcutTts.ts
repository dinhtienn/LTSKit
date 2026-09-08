import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import { DATA_DIR, resolveFfmpeg } from './deps'
import { docSrt, srtTimeToSeconds } from './burn'
import { debugRaw, errLabel, logError, logInfo, logWarn } from './logger'
import { formatProcessingMetric } from './processingMetrics'
import { capcutPaths, ensureCapcutProfile, rotateCapcutProfile } from './capcutDevice'
import { buildCapcutAudioPlan } from './capcutAudioPlan'
import { trimAudioEdges } from './audioFit'
import {
  capcutCheckpointDir,
  capcutCueFingerprint,
  createCapcutJobMetrics,
  formatCapcutJobSummary,
  readReusableCheckpoint,
  recordCapcutRetry,
  runCapcutPool,
  sanitizeCapcutText,
  validateProfileCount,
  type CapcutCue,
  type CapcutTerminalStatus
} from './capcutJob'
import { buildCapcutMixPlan, type CapcutMixClip } from './capcutMix'
import { CapcutWorkerPool, type CapcutWorkerResponse } from './capcutWorkerPool'
import { CapcutManifestWriter } from './capcutManifestWriter'
import { loadCapcutVoices } from './capcutVoices'
import { safeVieneuJobId } from './vieneuNativeCli'
import type {
  CapcutEngineStatus,
  CapcutInstallProgress,
  CapcutSrtRequest,
  VieneuPreviewResult,
  VieneuProgress,
  VieneuResult,
  VieneuVoice
} from '../shared/types'

const MIN_SLOT = 0.15
const MIX_BATCH_CONCURRENCY = 4
const CAPTURE_LIMIT = 64 * 1024
const CAPCUT_PIP_GIT = 'git+https://github.com/K07VN/capcut-tts-api.git'
const CAPCUT_PIP_ZIP = 'https://github.com/K07VN/capcut-tts-api/archive/refs/heads/main.zip'
const jobs = new Map<string, { procs: ChildProcess[]; cancelled: boolean; workDir?: string }>()
let cachedPython: string | null | undefined

type CapcutAttemptCode = 'shark' | 'busy' | 'network' | 'api'

class CapcutAttemptError extends Error {
  constructor(readonly code: CapcutAttemptCode, message: string) {
    super(message)
  }
}

export function capcutResourceRoot(): string {
  if (app?.isPackaged) {
    return join(process.resourcesPath, 'capcut-tts')
  }
  return join(app.getAppPath(), 'resources', 'capcut-tts')
}

async function isNonEmptyFile(path: string, minSize = 0): Promise<boolean> {
  try {
    const value = await stat(path)
    return value.isFile() && value.size > minSize
  } catch {
    return false
  }
}

async function startJob(id: string, workDir?: string): Promise<void> {
  if (jobs.get(id)) throw new Error('Tác vụ này đang chạy.')
  jobs.set(id, { procs: [], cancelled: false, workDir })
}

function trackProcess(id: string, process: ChildProcess): void {
  const job = jobs.get(id)
  if (job) job.procs.push(process)
}

function isCancelled(id: string): boolean {
  return jobs.get(id)?.cancelled === true
}

function clearJob(id: string): void {
  jobs.delete(id)
}

export function cancelCapcut(id: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.cancelled = true
  for (const process of job.procs) {
    try {
      process.kill()
    } catch {
      // already exited
    }
  }
  if (job.workDir) {
    void rm(job.workDir, { recursive: true, force: true }).catch((error) => {
      debugRaw('capcut cancel cleanup', error)
    })
  }
}

function runCapture(
  command: string,
  args: string[],
  id?: string
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    // Only the tail is ever read for error messages; ffmpeg on a two-hour
    // timeline would otherwise accumulate an unbounded string.
    const append = (chunk: string): void => {
      out += chunk
      if (out.length > CAPTURE_LIMIT) out = out.slice(out.length - CAPTURE_LIMIT)
    }
    try {
      const child = spawn(command, args, { windowsHide: true, shell: false })
      if (id) trackProcess(id, child)
      child.stdout?.on('data', (data) => append(data.toString()))
      child.stderr?.on('data', (data) => append(data.toString()))
      child.on('error', () => resolve({ code: -1, out }))
      child.on('close', (code) => resolve({ code: code ?? -1, out }))
    } catch {
      resolve({ code: -1, out })
    }
  })
}

async function tryPythonExecutable(command: string, prefixArgs: string[]): Promise<string | null> {
  const result = await runCapture(command, [
    ...prefixArgs,
    '-c',
    'import sys; print(sys.executable); print(sys.version_info[0], sys.version_info[1])'
  ])
  if (result.code !== 0) return null
  const lines = result.out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const executable = lines[0]
  const versionLine = lines[1] || ''
  const match = /^(\d+)\s+(\d+)/.exec(versionLine)
  if (!executable || !match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  if (major < 3 || (major === 3 && minor < 9)) return null
  return executable
}

export function clearCapcutPythonCache(): void {
  cachedPython = undefined
}

export async function resolveSystemPython(): Promise<string | null> {
  const candidates: { command: string; prefix: string[] }[] =
    process.platform === 'win32'
      ? [
          { command: 'py', prefix: ['-3'] },
          { command: 'python', prefix: [] },
          { command: 'python3', prefix: [] }
        ]
      : [
          { command: 'python3', prefix: [] },
          { command: 'python', prefix: [] }
        ]
  for (const candidate of candidates) {
    const found = await tryPythonExecutable(candidate.command, candidate.prefix)
    if (found) return found
  }
  return null
}

export async function resolvePython(): Promise<string | null> {
  if (cachedPython !== undefined) return cachedPython
  const venvPython = capcutPaths(DATA_DIR).venvPython
  if (await isNonEmptyFile(venvPython)) {
    const ok = await tryPythonExecutable(venvPython, [])
    if (ok) {
      cachedPython = ok
      return ok
    }
  }
  const system = await resolveSystemPython()
  cachedPython = system
  return system
}

function parseWorkerJson(stdout: string): Record<string, unknown> {
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .pop()
  if (!line) throw new Error('Worker không trả JSON.')
  return JSON.parse(line) as Record<string, unknown>
}

async function invokeWorker(
  command: 'status' | 'synth',
  payload?: Record<string, unknown>,
  jobId?: string
): Promise<Record<string, unknown>> {
  const python = await resolvePython()
  if (!python) throw new Error('Không tìm thấy Python 3.9+ (py -3 / python).')
  const worker = join(capcutResourceRoot(), 'worker.py')
  if (!(await isNonEmptyFile(worker))) {
    throw new Error(`Không thấy worker CapCut: ${worker}`)
  }
  const args =
    command === 'status' ? [worker, 'status'] : [worker, 'synth', JSON.stringify(payload ?? {})]
  const result = await runCapture(python, args, jobId)
  try {
    return parseWorkerJson(result.out)
  } catch {
    throw new Error(result.out.slice(0, 300) || `Worker exit ${result.code}`)
  }
}

export async function capcutEngineStatus(): Promise<CapcutEngineStatus> {
  try {
    const system = await resolveSystemPython()
    const python = await resolvePython()
    if (!python) {
      return {
        has: false,
        python: null,
        needsPython: true,
        message: 'Cần cài Python 3.9+ rồi bấm Tải công cụ CapCut.'
      }
    }
    const status = await invokeWorker('status')
    const version = typeof status.python === 'string' ? status.python : null
    if (status.ok === true) {
      return {
        has: true,
        python: version,
        message: `Sẵn sàng (Python ${version ?? '?'}, capcut_tts_api).`
      }
    }
    return {
      has: false,
      python: version,
      needsPython: !system,
      message: system
        ? 'Chưa có package CapCut trong app. Bấm Tải công cụ CapCut (cài vào appdata).'
        : 'Cần cài Python 3.9+ rồi bấm Tải công cụ CapCut.'
    }
  } catch (error) {
    return {
      has: false,
      python: null,
      message: errLabel(error)
    }
  }
}

export async function installCapcutEngine(
  onProgress: (progress: CapcutInstallProgress) => void
): Promise<void> {
  clearCapcutPythonCache()
  const system = await resolveSystemPython()
  if (!system) {
    throw new Error(
      'Cần cài Python 3.9+ trên máy (thêm vào PATH), rồi bấm Tải lại. https://www.python.org/downloads/'
    )
  }
  const paths = capcutPaths(DATA_DIR)
  await mkdir(paths.root, { recursive: true })

  onProgress({ percent: 5, phase: 'venv', line: 'Đang tạo môi trường Python…' })
  if (!(await isNonEmptyFile(paths.venvPython))) {
    const venv = await runCapture(system, ['-m', 'venv', paths.venvDir])
    if (venv.code !== 0) {
      throw new Error(`Không tạo được venv CapCut: ${venv.out.slice(0, 400)}`)
    }
  }
  if (!(await isNonEmptyFile(paths.venvPython))) {
    throw new Error('Venv đã tạo nhưng không thấy python.exe.')
  }
  const py = paths.venvPython

  onProgress({ percent: 25, phase: 'pip', line: 'Đang cập nhật pip…' })
  await runCapture(py, ['-m', 'pip', 'install', '--upgrade', 'pip'])

  onProgress({ percent: 40, phase: 'pip', line: 'Đang cài requests…' })
  const req = await runCapture(py, ['-m', 'pip', 'install', 'requests'])
  if (req.code !== 0) throw new Error(`Cài requests thất bại: ${req.out.slice(-500)}`)

  onProgress({ percent: 55, phase: 'pip', line: 'Đang cài capcut-tts-api…' })
  let pkg = await runCapture(py, ['-m', 'pip', 'install', CAPCUT_PIP_GIT])
  if (pkg.code !== 0) {
    onProgress({ percent: 65, phase: 'pip', line: 'Thử cài từ zip GitHub…' })
    pkg = await runCapture(py, ['-m', 'pip', 'install', CAPCUT_PIP_ZIP])
  }
  if (pkg.code !== 0) {
    throw new Error(`Cài capcut-tts-api thất bại: ${pkg.out.slice(-800)}`)
  }

  onProgress({ percent: 90, phase: 'verify', line: 'Đang kiểm tra…' })
  clearCapcutPythonCache()
  cachedPython = py
  const status = await invokeWorker('status')
  if (status.ok !== true) {
    throw new Error(
      typeof status.error === 'string'
        ? status.error
        : 'Cài xong nhưng import capcut_tts_api thất bại.'
    )
  }
  onProgress({ percent: 100, phase: 'verify', line: 'Xong' })
  logInfo('CapCut TTS: đã cài venv appdata.')
}

export async function listCapcutVoices(): Promise<VieneuVoice[]> {
  return loadCapcutVoices(join(capcutResourceRoot(), 'Voice.json'), 'vi-VN')
}

async function probeDurationSec(ffmpeg: string, audio: string, id?: string): Promise<number> {
  const ffprobe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  if (await isNonEmptyFile(ffprobe)) {
    const result = await runCapture(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audio],
      id
    )
    const duration = Number(result.out.trim())
    if (Number.isFinite(duration) && duration > 0) return duration
  }
  const result = await runCapture(ffmpeg, ['-i', audio], id)
  const match = /Duration:\s*(\d+):(\d+):(\d+)[.,](\d+)/.exec(result.out)
  if (!match) return 0
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4].padEnd(3, '0').slice(0, 3)) / 1000
  )
}

async function replaceOutputFile(source: string, destination: string): Promise<void> {
  const token = randomUUID()
  const part = `${destination}.ltskit-${token}.part`
  const backup = `${destination}.ltskit-backup`
  try {
    await stat(destination)
  } catch {
    try {
      await rename(backup, destination)
    } catch {
      // no interrupted output
    }
  }
  await copyFile(source, part)
  let hadOriginal = false
  try {
    await rename(destination, backup)
    hadOriginal = true
  } catch {
    // new output
  }
  try {
    await rename(part, destination)
    await rm(backup, { force: true })
  } catch (error) {
    await rm(part, { force: true })
    if (hadOriginal) {
      try {
        await rename(backup, destination)
      } catch {
        // keep backup
      }
    }
    throw error
  }
}

async function synthCapcutMp3(
  id: string,
  text: string,
  voiceId: string,
  devicePath: string,
  outputWav: string,
  pool: CapcutWorkerPool | null = null,
  profileIndex = 1
): Promise<string> {
  if (isCancelled(id)) throw new Error('Đã hủy.')
  await mkdir(dirname(outputWav), { recursive: true })
  const rawMp3 = `${outputWav}.capcut.mp3`
  await rm(rawMp3, { force: true })
  await rm(outputWav, { force: true })
  const payload = {
    text,
    voice: voiceId,
    devicePath,
    outPath: rawMp3,
    catalogPath: join(capcutResourceRoot(), 'Voice.json')
  }
  const response: CapcutWorkerResponse = pool
    ? await pool.send(profileIndex, payload)
    : ((await invokeWorker('synth', payload, id)) as unknown as CapcutWorkerResponse)
  if (response.ok !== true) {
    const code = typeof response.code === 'string' ? response.code : 'api'
    const detail = typeof response.error === 'string' ? response.error : 'Synth CapCut thất bại.'
    throw new CapcutAttemptError(
      code === 'shark' || code === 'busy' || code === 'network' ? code : 'api',
      detail
    )
  }
  if (!(await isNonEmptyFile(rawMp3, 64))) {
    throw new Error('CapCut không tạo được file audio.')
  }
  return rawMp3
}

async function convertCapcutMp3ToWav(
  id: string,
  ffmpeg: string,
  sourceMp3: string,
  outputWav: string,
  speed: number,
  slot: number | null
): Promise<number> {
  const trimmedWav = `${outputWav}.trim.wav`
  const trimInput = await trimAudioEdges(
    sourceMp3,
    trimmedWav,
    async (args) => {
      const result = await runCapture(ffmpeg, args, id)
      return result.code === 0 && (await isNonEmptyFile(trimmedWav, 44))
    },
    () => isCancelled(id)
  )
  try {
    const sourceDuration = await probeDurationSec(ffmpeg, trimInput, id)
    const plan = buildCapcutAudioPlan(trimInput, outputWav, sourceDuration, speed, slot, MIN_SLOT)
    const result = await runCapture(ffmpeg, plan.args, id)
    if (result.code !== 0 || !(await isNonEmptyFile(outputWav, 44))) {
      throw new Error('Không chuyển được audio CapCut sang WAV.')
    }
    if (plan.outputLimit != null) return plan.outputLimit
    // No slot limit means the atempo chain multiplies out to exactly plan.tempo
    // and no -t was applied, so the output length is exact without a probe.
    const fittedDuration = sourceDuration / plan.tempo
    if (!(fittedDuration > 0)) throw new Error('Không đo được thời lượng audio CapCut.')
    return fittedDuration
  } finally {
    await rm(trimmedWav, { force: true })
  }
}

export async function previewCapcutVoice(
  voiceId: string,
  speed = 1
): Promise<VieneuPreviewResult> {
  const id = `capcut-preview-${randomUUID()}`
  try {
    if (!(await capcutEngineStatus()).has) {
      return { ok: false, path: null, error: 'Chưa sẵn sàng CapCut TTS (Python + package).' }
    }
    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) return { ok: false, path: null, error: 'Không tìm thấy ffmpeg.' }
    const dir = join(capcutPaths(DATA_DIR).workDir, id)
    await startJob(id, dir)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const output = join(dir, 'preview.wav')
    const devicePath = await ensureCapcutProfile(DATA_DIR, 1)
    const sourceMp3 = await synthCapcutMp3(
      id,
      'Xin chào, đây là bản nghe thử giọng CapCut.',
      voiceId,
      devicePath,
      output
    )
    try {
      await convertCapcutMp3ToWav(id, ffmpeg, sourceMp3, output, speed, null)
    } finally {
      await rm(sourceMp3, { force: true })
    }
    clearJob(id)
    return { ok: true, path: output, error: null }
  } catch (error) {
    clearJob(id)
    debugRaw(`capcut ${id}`, error)
    const message = error instanceof Error ? error.message : errLabel(error)
    logError(`CapCut preview: ${message}`)
    return { ok: false, path: null, error: message }
  }
}

export async function capcutSrtToMp3(
  id: string,
  req: CapcutSrtRequest,
  onProgress: (progress: VieneuProgress) => void
): Promise<VieneuResult> {
  const startedAt = performance.now()
  const send = (partial: Partial<VieneuProgress> & Pick<VieneuProgress, 'status'>): void => {
    onProgress({
      id,
      status: partial.status,
      percent: partial.percent ?? -1,
      current: partial.current ?? 0,
      total: partial.total ?? 0,
      line: partial.line ?? null
    })
  }
  let safeId: string
  try {
    safeId = safeVieneuJobId(id)
  } catch (error) {
    return { id, ok: false, output: null, error: errLabel(error) }
  }
  void safeId
  let started = false
  let jobDir = ''
  let terminalStatus: CapcutTerminalStatus = 'failed'
  let metrics: ReturnType<typeof createCapcutJobMetrics> | null = null
  let totalCues = 0
  let pool: CapcutWorkerPool | null = null
  let manifestWriter: CapcutManifestWriter | null = null
  try {
    if (!(await capcutEngineStatus()).has) {
      return { id, ok: false, output: null, error: 'Chưa sẵn sàng CapCut TTS (Python + package).' }
    }
    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) return { id, ok: false, output: null, error: 'Không tìm thấy ffmpeg.' }
    const python = await resolvePython()
    if (!python) return { id, ok: false, output: null, error: 'Không tìm thấy Python 3.9+.' }
    pool = new CapcutWorkerPool(python, join(capcutResourceRoot(), 'worker.py'), (child) =>
      trackProcess(id, child)
    )
    const workerPool = pool
    send({ status: 'preparing', percent: 0, line: 'Đang đọc phụ đề…' })
    const cues = docSrt(await readFile(req.srt, 'utf8'))
      .map((cue, cueIndex): CapcutCue => ({
        cueIndex,
        start: srtTimeToSeconds(cue.a),
        end: srtTimeToSeconds(cue.b),
        text: sanitizeCapcutText(cue.chu.replace(/\\N/g, ' '))
      }))
      .filter((cue) => cue.text.length > 0)
    if (!cues.length) return { id, ok: false, output: null, error: 'File phụ đề trống hoặc không hợp lệ.' }
    const plannedCues = cues
    totalCues = cues.length
    const profileCount = validateProfileCount(req.profileCount)
    metrics = createCapcutJobMetrics(profileCount)
    const jobMetrics = metrics
    jobDir = capcutCheckpointDir(capcutPaths(DATA_DIR).workDir, req.srt, req.voiceId, req.speed)
    await startJob(id, jobDir)
    started = true
    await mkdir(jobDir, { recursive: true })
    const manifestPath = join(jobDir, 'manifest.json')
    const fingerprints = new Map(plannedCues.map((cue) => [cue.cueIndex, capcutCueFingerprint(cue, req.voiceId, req.speed)]))
    const entriesByCue = await readReusableCheckpoint(manifestPath, fingerprints)
    jobMetrics.completed = entriesByCue.size
    const missing = plannedCues.filter((cue) => !entriesByCue.has(cue.cueIndex))
    let stopped = false
    manifestWriter = new CapcutManifestWriter(manifestPath)
    const writer = manifestWriter
    for (const entry of entriesByCue.values()) {
      writer.record(entry)
    }
    await runCapcutPool(
      missing,
      profileCount,
      async (cue, _itemIndex, profileIndex) => {
        let devicePath = await ensureCapcutProfile(DATA_DIR, profileIndex)
        let lastError: Error | null = null
        for (let attempt = 0; attempt < 5; attempt++) {
          if (isCancelled(id) || stopped) throw new Error('Đã hủy.')
          try {
                const fitted = join(jobDir, `fit_${cue.cueIndex}.wav`)
                const sourceMp3 = await synthCapcutMp3(
                  id, cue.text, req.voiceId, devicePath, fitted, workerPool, profileIndex
                )
                const duration = await convertCapcutMp3ToWav(
                  id,
                  ffmpeg,
                  sourceMp3,
                  fitted,
                  req.speed,
                  Math.max(cue.end - cue.start, MIN_SLOT)
                )
                await rm(sourceMp3, { force: true })
            writer.record({
              cueIndex: cue.cueIndex,
              fingerprint: fingerprints.get(cue.cueIndex)!,
              path: fitted,
              start: cue.start,
              dur: duration,
              voiceText: cue.text
            })
            jobMetrics.completed += 1
            send({
              status: 'synthesizing',
              percent: Math.round((jobMetrics.completed / cues.length) * 85),
              current: jobMetrics.completed,
              total: cues.length,
              line: cue.text.slice(0, 80)
            })
            return
          } catch (error) {
            if (!(error instanceof CapcutAttemptError)) throw error
            lastError = error
            if (error.code === 'api' || attempt === 4) break
            if (error.code === 'shark') {
              recordCapcutRetry(jobMetrics, profileIndex, 'shark')
              logWarn(
                `CapCut SHARK: profile=${String(profileIndex).padStart(2, '0')} cue=${cue.cueIndex + 1} ` +
                  `profileSharks=${jobMetrics.sharksByProfile[profileIndex - 1]} totalSharks=${jobMetrics.sharks}; rotating device`
              )
              await rotateCapcutProfile(DATA_DIR, profileIndex)
              devicePath = await ensureCapcutProfile(DATA_DIR, profileIndex)
              workerPool.recycle(profileIndex)
            } else {
              recordCapcutRetry(jobMetrics, profileIndex, error.code)
              if (error.code === 'network') workerPool.recycle(profileIndex)
            }
            await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 750 * 2 ** attempt)))
          }
        }
        stopped = true
        throw new Error(`CapCut thất bại ở câu ${cue.cueIndex + 1}: ${cue.text.slice(0, 80)} (${lastError?.message ?? 'unknown'})`)
      },
      () => stopped || isCancelled(id)
    )
    if (isCancelled(id)) throw new Error('Đã hủy.')
    await writer.flush()
    const clips: CapcutMixClip[] = [...writer.entries.values()].map((entry) => ({
      path: entry.path,
      cueIndex: entry.cueIndex,
      start: entry.start,
      dur: entry.dur
    }))
    send({
      status: 'mixing',
      percent: 90,
      current: cues.length,
      total: cues.length,
      line: 'Đang ghép MP3…'
    })
    const totalSec = Math.max(0.5, ...plannedCues.map((cue) => cue.end), ...clips.map((clip) => clip.start + clip.dur))
    await mkdir(req.outputDir, { recursive: true })
    const output = join(req.outputDir, `${basename(req.srt).replace(/\.srt$/i, '')}.mp3`)
    const mixPlan = buildCapcutMixPlan(clips, totalSec, jobDir)
    // Batches read disjoint clips and write distinct outputs; amix is
    // addition and the final pass uses duration=longest, so completion
    // order cannot change the mixed result.
    await runCapcutPool(
      mixPlan.batches,
      Math.min(MIX_BATCH_CONCURRENCY, Math.max(1, mixPlan.batches.length)),
      async (batch) => {
        if (isCancelled(id)) throw new Error('Đã hủy.')
        const result = await runCapture(ffmpeg, batch.args, id)
        if (result.code !== 0) throw new Error('Không ghép được batch audio CapCut.')
      },
      () => isCancelled(id)
    )
    if (isCancelled(id)) throw new Error('Đã hủy.')
    const final = await runCapture(ffmpeg, mixPlan.finalArgs, id)
    if (final.code !== 0 || !(await isNonEmptyFile(mixPlan.finalOutput, 64))) {
      throw new Error('Xuất MP3 CapCut thất bại.')
    }
    await replaceOutputFile(mixPlan.finalOutput, output)
    await rm(jobDir, { recursive: true, force: true })
    clearJob(id)
    terminalStatus = 'finished'
    send({ status: 'finished', percent: 100, current: cues.length, total: cues.length, line: output })
    logInfo(`CapCut Text→Giọng: xong ${basename(output)}`)
    logInfo(formatProcessingMetric({ job: 'Text→Giọng', elapsedMs: performance.now() - startedAt, outcome: 'xong', provider: 'CapCut' }))
    return { id, ok: true, output, error: null }
  } catch (error) {
    await manifestWriter?.flush().catch(() => undefined)
    const cancelled = started && isCancelled(id)
    terminalStatus = cancelled ? 'cancelled' : 'failed'
    if (cancelled) await rm(jobDir, { recursive: true, force: true })
    else if (started) logError(`CapCut Text→Giọng: giữ thư mục lỗi ${jobDir}`)
    if (started) clearJob(id)
    const message = cancelled ? 'Đã hủy.' : error instanceof Error ? error.message : errLabel(error)
    debugRaw('capcut srtToMp3', error)
    send({ status: 'error', line: message })
    return { id, ok: false, output: null, error: message }
  } finally {
    pool?.disposeAll()
    if (metrics) {
      for (const line of formatCapcutJobSummary(terminalStatus, metrics, totalCues)) logInfo(line)
    }
  }
}

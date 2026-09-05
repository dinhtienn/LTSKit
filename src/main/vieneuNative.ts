import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { DATA_DIR, resolveFfmpeg } from './deps'
import { docSrt, srtTimeToSeconds } from './burn'
import { debugRaw, errLabel, logError, logInfo, logWarn } from './logger'
import { buildAtempoFilter, planAudioFitIfDurationKnown, trimAudioEdges } from './audioFit'
import { findMissingVieneuAssets, installVieneuAssets, VIENEU_READY, vieneuPaths } from './vieneuNativeAssets'
import { buildVieneuCliArgs, resolveVieneuSelection, safeVieneuJobId, usefulVieneuError } from './vieneuNativeCli'
import {
  addVieneuVoice,
  loadVieneuVoices,
  parseVieneuPresets,
  removeVieneuVoice
} from './vieneuNativeVoices'
import type {
  VieneuAddVoiceResult,
  VieneuEngineStatus,
  VieneuInstallProgress,
  VieneuPreviewResult,
  VieneuProgress,
  VieneuResult,
  VieneuSrtRequest,
  VieneuVoice
} from '../shared/types'

const MIN_SLOT = 0.15
const jobs = new Map<string, { procs: ChildProcess[]; cancelled: boolean; workDir?: string }>()

async function isNonEmptyFile(path: string, minSize = 0): Promise<boolean> {
  try {
    const value = await stat(path)
    return value.isFile() && value.size > minSize
  } catch {
    return false
  }
}

async function startJob(id: string, workDir?: string): Promise<void> {
  const previous = jobs.get(id)
  if (previous) {
    throw new Error('Tác vụ này đang chạy.')
  }
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

export function cancelVieneu(id: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.cancelled = true
  for (const process of job.procs) {
    try {
      process.kill()
    } catch {
      // Process may already have exited.
    }
  }
  if (job.workDir) {
    void rm(job.workDir, { recursive: true, force: true }).catch((error) => {
      debugRaw('vieneu cancel cleanup', error)
    })
  }
}

function runCapture(command: string, args: string[], id?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    try {
      const child = spawn(command, args, { windowsHide: true, shell: false })
      if (id) trackProcess(id, child)
      child.stdout?.on('data', (data) => (out += data.toString()))
      child.stderr?.on('data', (data) => (out += data.toString()))
      child.on('error', () => resolve({ code: -1, out }))
      child.on('close', (code) => resolve({ code: code ?? -1, out }))
    } catch {
      resolve({ code: -1, out })
    }
  })
}

async function runSynth(
  id: string,
  text: string,
  selection: { voiceId?: string; refAudio?: string },
  output: string
): Promise<void> {
  if (isCancelled(id)) throw new Error('Đã hủy.')
  const paths = vieneuPaths(DATA_DIR)
  await mkdir(dirname(output), { recursive: true })
  await rm(output, { force: true })
  let normalizedSelection = selection
  if (selection.refAudio && !/\.wav$/i.test(selection.refAudio)) {
    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) throw new Error('Cần ffmpeg để đổi file mẫu sang WAV.')
    const normalizedReference = `${output}.reference.wav`
    const conversion = await runCapture(
      ffmpeg,
      ['-y', '-i', selection.refAudio, '-ac', '1', '-ar', '48000', normalizedReference],
      id
    )
    if (conversion.code !== 0 || !(await isNonEmptyFile(normalizedReference, 44))) {
      throw new Error('Không chuyển được file mẫu sang WAV.')
    }
    normalizedSelection = { refAudio: normalizedReference }
  }
  const args = buildVieneuCliArgs({
    modelDir: paths.modelDir,
    codecDir: paths.codecDir,
    voicesJson: paths.voicesJson,
    text,
    output,
    ...normalizedSelection
  })
  await new Promise<void>((resolve, reject) => {
    let raw = ''
    try {
      const child = spawn(paths.cli, args, {
        cwd: paths.runtimeDir,
        windowsHide: true,
        shell: false,
        env: { ...process.env }
      })
      trackProcess(id, child)
      child.stdout?.on('data', (data) => (raw += data.toString()))
      child.stderr?.on('data', (data) => (raw += data.toString()))
      child.on('error', reject)
      child.on('close', (code) => {
        if (isCancelled(id)) reject(new Error('Đã hủy.'))
        else if (code === 0) resolve()
        else {
          debugRaw('vieneu native cli', raw)
          reject(new Error(usefulVieneuError(raw, code ?? -1)))
        }
      })
    } catch (error) {
      reject(error)
    }
  })
  if (!(await isNonEmptyFile(output, 44))) throw new Error('VieNeu không tạo được file WAV hợp lệ.')
}

async function defaultPresetSelection(): Promise<{ voiceId: string }> {
  const raw = await readFile(vieneuPaths(DATA_DIR).voicesJson, 'utf8')
  const presets = parseVieneuPresets(raw)
  if (!presets.length) throw new Error('Không tìm thấy giọng preset VieNeu.')
  return { voiceId: presets[0].id }
}

async function smokeTest(): Promise<void> {
  const paths = vieneuPaths(DATA_DIR)
  const smokeDir = join(paths.workDir, 'smoke-test')
  const output = join(smokeDir, 'smoke-test.wav')
  const id = 'install-smoke-test'
  await startJob(id, smokeDir)
  try {
    await runSynth(
      id,
      'Xin chào, đây là VieNeu-TTS v3 native.',
      await defaultPresetSelection(),
      output
    )
  } finally {
    clearJob(id)
  }
}

export async function vieneuEngineStatus(): Promise<VieneuEngineStatus> {
  const missing = await findMissingVieneuAssets(DATA_DIR)
  try {
    const ready = JSON.parse(await readFile(vieneuPaths(DATA_DIR).ready, 'utf8'))
    if (ready.runtime !== VIENEU_READY.runtime || ready.model !== VIENEU_READY.model) missing.push('ready.json')
  } catch {
    missing.push('ready.json')
  }
  return { has: missing.length === 0, missing }
}

export async function installVieneuEngine(
  onProgress: (progress: VieneuInstallProgress) => void
): Promise<void> {
  await installVieneuAssets(DATA_DIR, onProgress, smokeTest)
  logInfo('Text→Giọng: đã cài VieNeu-TTS v3 native CPU.')
}

export async function listVieneuVoices(): Promise<VieneuVoice[]> {
  return loadVieneuVoices(DATA_DIR)
}

export async function addVieneuClonedVoice(
  label: string,
  source: string
): Promise<VieneuAddVoiceResult> {
  return addVieneuVoice(DATA_DIR, label, source)
}

export async function removeVieneuClonedVoice(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  return removeVieneuVoice(DATA_DIR, id)
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
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) +
    Number(match[4].padEnd(3, '0').slice(0, 3)) / 1000
}

async function trimTtsAudio(
  ffmpeg: string,
  input: string,
  output: string,
  id: string
): Promise<string> {
  return trimAudioEdges(
    input,
    output,
    async (args) => {
      const result = await runCapture(ffmpeg, args, id)
      return result.code === 0 && (await isNonEmptyFile(output, 44))
    },
    () => isCancelled(id)
  )
}

async function applyUserSpeed(
  ffmpeg: string,
  input: string,
  output: string,
  speed: number,
  id: string
): Promise<void> {
  const value = speed > 0 ? speed : 1
  if (Math.abs(value - 1) < 0.001) {
    const result = await runCapture(ffmpeg, ['-y', '-i', input, '-c', 'copy', output], id)
    if (result.code !== 0) throw new Error('Không chép được audio VieNeu.')
    return
  }
  const result = await runCapture(
    ffmpeg,
    ['-y', '-i', input, '-filter:a', buildAtempoFilter(1 / value), output],
    id
  )
  if (result.code !== 0) throw new Error('Không chỉnh được tốc độ audio VieNeu.')
}

async function fitWavToSlot(
  ffmpeg: string,
  input: string,
  output: string,
  slot: number,
  id: string
): Promise<number> {
  const duration = await probeDurationSec(ffmpeg, input, id)
  const plan = planAudioFitIfDurationKnown(duration, 1, slot, MIN_SLOT)
  if (plan?.outputLimit == null) {
    const result = await runCapture(ffmpeg, ['-y', '-i', input, '-c', 'copy', output], id)
    if (result.code !== 0) throw new Error('Không chép được clip TTS.')
    return duration > 0 ? duration : Math.min(slot, 0.1)
  }
  const result = await runCapture(
    ffmpeg,
    [
      '-y', '-i', input,
      '-filter:a', buildAtempoFilter(plan.tempo),
      '-t', String(plan.outputLimit),
      output
    ],
    id
  )
  if (result.code !== 0) throw new Error('Không chỉnh audio cho vừa phụ đề.')
  const fitted = await probeDurationSec(ffmpeg, output, id)
  return fitted > 0 ? Math.min(fitted, slot) : slot
}

async function mixClipsToMp3(
  ffmpeg: string,
  clips: { path: string; start: number; dur: number }[],
  totalSec: number,
  output: string,
  id: string
): Promise<void> {
  if (!clips.length) throw new Error('Không có câu nào để ghép.')
  let master = join(dirname(clips[0].path), 'master_0.wav')
  let result = await runCapture(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(totalSec), master],
    id
  )
  if (result.code !== 0) throw new Error('Không tạo được nền im lặng.')
  for (let index = 0; index < clips.length; index++) {
    if (isCancelled(id)) throw new Error('Đã hủy.')
    const clip = clips[index]
    const next = join(dirname(clip.path), `master_${index + 1}.wav`)
    const delay = Math.max(0, Math.round(clip.start * 1000))
    result = await runCapture(
      ffmpeg,
      [
        '-y', '-i', master, '-i', clip.path,
        '-filter_complex',
        `[1:a]adelay=${delay}|${delay}[c];[0:a][c]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
        '-map', '[a]', next
      ],
      id
    )
    if (result.code !== 0) throw new Error(`Ghép câu ${index + 1} thất bại.`)
    if (index > 0) await rm(master, { force: true })
    master = next
  }
  result = await runCapture(
    ffmpeg,
    ['-y', '-i', master, '-codec:a', 'libmp3lame', '-qscale:a', '2', output],
    id
  )
  await rm(master, { force: true })
  if (result.code !== 0) throw new Error('Xuất MP3 thất bại.')
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
      // No interrupted output replacement to recover.
    }
  }
  await copyFile(source, part)
  let hadOriginal = false
  try {
    await rename(destination, backup)
    hadOriginal = true
  } catch {
    // A new output has no file to back up.
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
        // Keep the backup for recovery on the next attempt.
      }
    }
    throw error
  }
}

async function previewSelection(
  kind: string,
  text: string,
  selection: { voiceId?: string; refAudio?: string },
  fileName: string,
  speed: number
): Promise<VieneuPreviewResult> {
  const id = `${kind}-${randomUUID()}`
  try {
    if (!(await vieneuEngineStatus()).has) {
      return { ok: false, path: null, error: 'Chưa có công cụ VieNeu-TTS v3 native.' }
    }
    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) return { ok: false, path: null, error: 'Không tìm thấy ffmpeg.' }
    const dir = join(vieneuPaths(DATA_DIR).workDir, id)
    await startJob(id, dir)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const raw = join(dir, 'raw.wav')
    const trimmed = join(dir, 'trimmed.wav')
    const output = join(dir, fileName)
    await runSynth(id, text, selection, raw)
    const trimInput = await trimTtsAudio(ffmpeg, raw, trimmed, id)
    await applyUserSpeed(ffmpeg, trimInput, output, speed, id)
    clearJob(id)
    return { ok: true, path: output, error: null }
  } catch (error) {
    clearJob(id)
    debugRaw(`vieneu ${id}`, error)
    const message = error instanceof Error ? error.message : errLabel(error)
    logError(`Text→Giọng preview: ${message}`)
    return { ok: false, path: null, error: message }
  }
}

export async function previewVieneuVoice(
  voiceId: string,
  speed = 1
): Promise<VieneuPreviewResult> {
  try {
    const selection = resolveVieneuSelection(await listVieneuVoices(), voiceId)
    return previewSelection('preview', 'Xin chào, đây là bản nghe thử giọng VieNeu.', selection, 'preview.wav', speed)
  } catch (error) {
    return { ok: false, path: null, error: errLabel(error) }
  }
}

export async function previewVieneuCloneDraft(
  refAudio: string,
  speed = 1
): Promise<VieneuPreviewResult> {
  if (!(await isNonEmptyFile(refAudio))) {
    return { ok: false, path: null, error: 'Không thấy file mẫu.' }
  }
  return previewSelection(
    'preview-draft',
    'Xin chào, đây là bản nghe thử giọng clone trước khi lưu.',
    { refAudio },
    'preview_draft.wav',
    speed
  )
}

export async function vieneuSrtToMp3(
  id: string,
  req: VieneuSrtRequest,
  onProgress: (progress: VieneuProgress) => void
): Promise<VieneuResult> {
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
  const jobDir = join(vieneuPaths(DATA_DIR).workDir, safeId)
  let started = false
  try {
    if (!(await vieneuEngineStatus()).has) {
      return { id, ok: false, output: null, error: 'Chưa có công cụ VieNeu-TTS v3 native.' }
    }
    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) return { id, ok: false, output: null, error: 'Không tìm thấy ffmpeg.' }
    const selection = resolveVieneuSelection(await listVieneuVoices(), req.voiceId)
    send({ status: 'preparing', percent: 0, line: 'Đang đọc phụ đề…' })
    const cues = docSrt(await readFile(req.srt, 'utf8'))
      .map((cue) => ({
        start: srtTimeToSeconds(cue.a),
        end: srtTimeToSeconds(cue.b),
        text: cue.chu.replace(/\\N/g, ' ').replace(/\s+/g, ' ').trim()
      }))
      .filter((cue) => cue.text.length > 0)
    if (!cues.length) return { id, ok: false, output: null, error: 'File phụ đề trống hoặc không hợp lệ.' }
    await startJob(id, jobDir)
    started = true
    await rm(jobDir, { recursive: true, force: true })
    await mkdir(jobDir, { recursive: true })
    const clips: { path: string; start: number; dur: number }[] = []
    for (let index = 0; index < cues.length; index++) {
      if (isCancelled(id)) throw new Error('Đã hủy.')
      const cue = cues[index]
      send({
        status: 'synthesizing',
        percent: Math.round((index / cues.length) * 85),
        current: index + 1,
        total: cues.length,
        line: cue.text.slice(0, 80)
      })
      const fitted = join(jobDir, `fit_${index}.wav`)
      const source = join(jobDir, `raw_${index}.wav`)
      const trim = join(jobDir, `trimmed_${index}.wav`)
      const pacedPath = join(jobDir, `paced_${index}.wav`)
      await runSynth(id, cue.text, selection, source)
      const trimInput = await trimTtsAudio(ffmpeg, source, trim, id)
      await applyUserSpeed(ffmpeg, trimInput, pacedPath, req.speed, id)
      const duration = await fitWavToSlot(
        ffmpeg,
        pacedPath,
        fitted,
        Math.max(cue.end - cue.start, MIN_SLOT),
        id
      )
      clips.push({ path: fitted, start: cue.start, dur: duration })
    }
    send({ status: 'mixing', percent: 90, current: cues.length, total: cues.length, line: 'Đang ghép MP3…' })
    let totalSec = 0.5
    for (const cue of cues) totalSec = Math.max(totalSec, cue.end)
    for (const clip of clips) totalSec = Math.max(totalSec, clip.start + clip.dur)
    await mkdir(req.outputDir, { recursive: true })
    const output = join(req.outputDir, `${basename(req.srt).replace(/\.srt$/i, '')}.mp3`)
    const temporaryOutput = join(jobDir, 'output.mp3')
    await mixClipsToMp3(ffmpeg, clips, totalSec, temporaryOutput, id)
    await replaceOutputFile(temporaryOutput, output)
    await rm(jobDir, { recursive: true, force: true })
    clearJob(id)
    send({ status: 'finished', percent: 100, current: cues.length, total: cues.length, line: output })
    logInfo(`Text→Giọng: xong ${basename(output)}`)
    return { id, ok: true, output, error: null }
  } catch (error) {
    const cancelled = started && isCancelled(id)
    if (cancelled) await rm(jobDir, { recursive: true, force: true })
    else if (started) logError(`Text→Giọng: giữ thư mục lỗi ${jobDir}`)
    if (started) clearJob(id)
    const message = cancelled ? 'Đã hủy.' : errLabel(error)
    debugRaw('vieneu srtToMp3', error)
    send({ status: 'error', line: message })
    return { id, ok: false, output: null, error: message }
  }
}

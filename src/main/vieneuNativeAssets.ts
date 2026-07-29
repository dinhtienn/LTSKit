import { access, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import type { VieneuInstallProgress } from '../shared/types'

export const VIENEU_RUNTIME_URL =
  'https://github.com/dduongtrandai/VieNeu-TTS.cpp/releases/download/v0.1.3/vieneu-tts-win-cpu.zip'
export const VIENEU_MODEL_BASE =
  'https://huggingface.co/lastudio-community/VieNeu-TTS-v3-Turbo-CPP/resolve/main'
export const VIENEU_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'backbone.gguf',
  'vieneu_v3_heads.npz',
  'acoustic/vieneu_acoustic_weights.npz',
  'speaker_encoder.onnx',
  'denoiser.onnx',
  'codec/moss_audio_tokenizer_decode_full.onnx',
  'codec/moss_audio_tokenizer_decode_shared.data',
  'codec/moss_audio_tokenizer_encode.onnx',
  'codec/moss_audio_tokenizer_encode.data',
  'voices_v3_turbo.json'
] as const
export const VIENEU_RUNTIME_FILES = [
  'backend-manifest.json',
  'ggml-base.dll',
  'ggml-cpu.dll',
  'ggml.dll',
  'llama.dll',
  'onnxruntime_providers_shared.dll',
  'onnxruntime.dll',
  'sea_g2p_rs.dll',
  'sea_g2p.bin',
  'vieneu-tts-cli.exe',
  'vieneu-tts.dll'
] as const
export const VIENEU_READY = {
  runtime: 'v0.1.3',
  model: 'a7b4f40050d4ff6d5225d8fd4fe6d571913844a2'
} as const

export function vieneuPaths(dataDir: string) {
  const root = join(dataDir, 'vieneu-native')
  const runtimeDir = join(root, 'runtime')
  const modelDir = join(root, 'model')
  return {
    root,
    runtimeDir,
    modelDir,
    cli: join(runtimeDir, 'vieneu-tts-cli.exe'),
    voicesJson: join(modelDir, 'voices_v3_turbo.json'),
    codecDir: join(modelDir, 'codec'),
    refsDir: join(root, 'refs'),
    workDir: join(root, 'work'),
    registry: join(root, 'voices.json'),
    ready: join(root, 'ready.json')
  }
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    const value = await stat(path)
    return value.isFile() && value.size > 0
  } catch {
    return false
  }
}

type DownloadFile = (url: string, dest: string, onProgress: (percent: number) => void) => Promise<void>
type ExtractZip = (zip: string, dest: string) => Promise<void>

export interface InstallerDeps {
  download: DownloadFile
  extract: ExtractZip
}

async function defaultDownload(
  url: string,
  dest: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const { downloadFile } = await import('./deps')
  await downloadFile(url, dest, onProgress)
}

async function defaultExtract(zip: string, dest: string): Promise<void> {
  const { extractZip } = await import('./deps')
  await extractZip(zip, dest)
}

async function findFile(root: string, name: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      const found = await findFile(path, name)
      if (found) return found
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return path
    }
  }
  return null
}

function modelUrl(relative: string): string {
  const encoded = relative.split('/').map(encodeURIComponent).join('/')
  return `${VIENEU_MODEL_BASE}/${encoded}`
}

export async function findMissingVieneuAssets(dataDir: string): Promise<string[]> {
  const paths = vieneuPaths(dataDir)
  const expected: [string, string][] = [
    ...VIENEU_RUNTIME_FILES.map(
      (relative): [string, string] => [`runtime/${relative}`, join(paths.runtimeDir, relative)]
    ),
    ...VIENEU_MODEL_FILES.map(
      (relative): [string, string] => [`model/${relative}`, join(paths.modelDir, relative)]
    )
  ]
  const missing: string[] = []
  for (const [relative, absolute] of expected) {
    if (!(await isNonEmptyFile(absolute))) missing.push(relative)
  }
  return missing
}

export async function installVieneuAssets(
  dataDir: string,
  onProgress: (progress: VieneuInstallProgress) => void,
  runSmokeTest: () => Promise<void>,
  deps: InstallerDeps = { download: defaultDownload, extract: defaultExtract }
): Promise<void> {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('VieNeu native hiện chỉ hỗ trợ Windows x64 trong app này.')
  }

  const paths = vieneuPaths(dataDir)
  const runtimePart = join(paths.root, 'runtime.zip.part')
  const runtimeZip = join(paths.root, 'runtime.zip')
  const runtimeTemp = join(paths.root, 'runtime.tmp')
  const previousRuntime = join(paths.root, 'runtime.previous')
  let runtimeWasReplaced = false
  const itemCount = 1 + VIENEU_MODEL_FILES.length
  await mkdir(paths.root, { recursive: true })
  if (!(await isNonEmptyFile(paths.cli))) {
    try {
      await rename(previousRuntime, paths.runtimeDir)
    } catch {
      // No interrupted runtime swap to recover.
    }
  }
  await rm(paths.ready, { force: true })
  await rm(runtimePart, { force: true })
  await rm(runtimeTemp, { recursive: true, force: true })

  const runtimeMissing = await Promise.all(
    VIENEU_RUNTIME_FILES.map(async (relative) => !(await isNonEmptyFile(join(paths.runtimeDir, relative))))
  )
  if (runtimeMissing.some(Boolean)) {
    onProgress({ percent: 0, asset: 'VieNeu runtime', phase: 'downloading' })
    await deps.download(VIENEU_RUNTIME_URL, runtimePart, (percent) => {
      onProgress({
        percent: Math.round(percent / itemCount),
        asset: 'VieNeu runtime',
        phase: 'downloading'
      })
    })
    await rm(runtimeZip, { force: true })
    await rename(runtimePart, runtimeZip)
    onProgress({ percent: Math.round(100 / itemCount), asset: 'VieNeu runtime', phase: 'extracting' })
    await mkdir(runtimeTemp, { recursive: true })
    await deps.extract(runtimeZip, runtimeTemp)
    const cli = await findFile(runtimeTemp, 'vieneu-tts-cli.exe')
    if (!cli) throw new Error('Gói runtime không có vieneu-tts-cli.exe.')
    const extractedRuntime = dirname(cli)
    for (const relative of VIENEU_RUNTIME_FILES) {
      if (!(await isNonEmptyFile(join(extractedRuntime, relative)))) {
        throw new Error(`Gói runtime thiếu ${relative}.`)
      }
    }
    if (await isNonEmptyFile(paths.cli)) {
      await rm(previousRuntime, { recursive: true, force: true })
    }
    try {
      await rename(paths.runtimeDir, previousRuntime)
    } catch {
      // A fresh install has no previous runtime.
    }
    try {
      if (extractedRuntime === runtimeTemp) await rename(runtimeTemp, paths.runtimeDir)
      else await rename(extractedRuntime, paths.runtimeDir)
      runtimeWasReplaced = true
    } catch (error) {
      try {
        await rename(previousRuntime, paths.runtimeDir)
      } catch {
        // Preserve the original error when no prior runtime exists.
      }
      throw error
    }
    await rm(runtimeTemp, { recursive: true, force: true })
    await rm(runtimeZip, { force: true })
  }

  for (let index = 0; index < VIENEU_MODEL_FILES.length; index++) {
    const relative = VIENEU_MODEL_FILES[index]
    const target = join(paths.modelDir, relative)
    const part = `${target}.part`
    const completedItems = index + 1
    if (await isNonEmptyFile(target)) continue
    await mkdir(dirname(target), { recursive: true })
    await rm(part, { force: true })
    await deps.download(modelUrl(relative), part, (percent) => {
      onProgress({
        percent: Math.round(((completedItems + percent / 100) / itemCount) * 100),
        asset: relative,
        phase: 'downloading'
      })
    })
    await rename(part, target)
  }

  onProgress({ percent: 96, asset: 'Kiểm tra tệp', phase: 'validating' })
  const missing = await findMissingVieneuAssets(dataDir)
  if (missing.length) throw new Error(`Thiếu tệp VieNeu: ${missing.join(', ')}`)

  onProgress({ percent: 98, asset: 'Kiểm tra giọng mẫu', phase: 'smoke-test' })
  try {
    await runSmokeTest()
  } catch (error) {
    if (runtimeWasReplaced) {
      await rm(paths.runtimeDir, { recursive: true, force: true })
      try {
        await rename(previousRuntime, paths.runtimeDir)
      } catch {
        // Fresh installs have no runtime to restore.
      }
    }
    throw error
  }
  await rm(previousRuntime, { recursive: true, force: true })
  await writeFile(
    paths.ready,
    JSON.stringify(VIENEU_READY),
    'utf8'
  )
  onProgress({ percent: 100, asset: 'Hoàn tất', phase: 'validating' })
}

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  installVieneuAssets,
  vieneuPaths,
  type InstallerDeps
} from '../src/main/vieneuNativeAssets'
import { buildVieneuCliArgs } from '../src/main/vieneuNativeCli'

async function download(
  url: string,
  destination: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${url}`)
  await mkdir(dirname(destination), { recursive: true })
  const total = Number(response.headers.get('content-length') || 0)
  let received = 0
  const stream = Readable.fromWeb(response.body as unknown as import('stream/web').ReadableStream)
  stream.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)))
  })
  await pipeline(stream, createWriteStream(destination))
}

function extract(zip: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$zip=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(zip).toString('base64')}'));` +
          `$dest=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${Buffer.from(destination).toString('base64')}'));` +
          'Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force'
      ],
      { windowsHide: true }
    )
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Giải nén thất bại, exit ${code}`))
    )
  })
}

function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false })
    child.stdout?.on('data', (data) => (output += data.toString()))
    child.stderr?.on('data', (data) => (output += data.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${output}\nexit ${code}`))
    )
  })
}

async function main(): Promise<void> {
  const dataDir = join(process.cwd(), 'appdata')
  const paths = vieneuPaths(dataDir)
  const dependencies: InstallerDeps = { download, extract }
  await installVieneuAssets(
    dataDir,
    (progress) => {
      console.log(`${progress.percent}% [${progress.phase}] ${progress.asset}`)
    },
    async () => {
      await mkdir(paths.workDir, { recursive: true })
      const output = join(paths.workDir, 'smoke-direct.wav')
      const args = buildVieneuCliArgs({
        modelDir: paths.modelDir,
        codecDir: paths.codecDir,
        voicesJson: paths.voicesJson,
        text: 'Xin chào, đây là VieNeu-TTS v3 native.',
        output,
        voiceId: 'Phạm Tuyên'
      })
      console.log(await run(paths.cli, args, paths.runtimeDir))
      const cloneOutput = join(paths.workDir, 'smoke-clone.wav')
      const cloneArgs = buildVieneuCliArgs({
        modelDir: paths.modelDir,
        codecDir: paths.codecDir,
        voicesJson: paths.voicesJson,
        text: 'Đây là câu kiểm tra clone giọng bằng runtime native.',
        output: cloneOutput,
        refAudio: output
      })
      console.log(await run(paths.cli, cloneArgs, paths.runtimeDir))
    },
    dependencies
  )
  console.log('VIENEU_INSTALL_SMOKE_OK')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

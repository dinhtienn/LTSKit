import { join } from 'node:path'

export interface CapcutMixClip {
  path: string
  cueIndex: number
  start: number
  dur: number
}

export interface CapcutMixBatch {
  inputs: string[]
  output: string
  duration: number
  filter: string
  args: string[]
}

export interface CapcutMixPlan {
  batches: CapcutMixBatch[]
  finalInputs: string[]
  finalOutput: string
  finalFilter: string
  finalArgs: string[]
}

function inputArgs(inputs: string[]): string[] {
  return inputs.flatMap((input) => ['-i', input])
}

export function buildCapcutMixPlan(
  clips: readonly CapcutMixClip[],
  totalSec: number,
  workDir: string,
  batchSize = 100
): CapcutMixPlan {
  if (!clips.length) throw new Error('Không có clip TTS để ghép.')
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('Kích thước batch không hợp lệ.')
  if (!Number.isFinite(totalSec) || totalSec <= 0) throw new Error('Thời lượng mix không hợp lệ.')

  const sorted = [...clips].sort((left, right) => left.cueIndex - right.cueIndex)
  const batches: CapcutMixBatch[] = []
  for (let offset = 0; offset < sorted.length; offset += batchSize) {
    const batchClips = sorted.slice(offset, offset + batchSize)
    const output = join(workDir, `mix-batch-${String(batches.length).padStart(3, '0')}.wav`)
    const delayed = batchClips.map((clip, index) => {
      const delay = Math.max(0, Math.round(clip.start * 1000))
      return `[${index}:a]adelay=${delay}|${delay}[c${index}]`
    })
    const silenceIndex = batchClips.length
    const labels = batchClips.map((_, index) => `[c${index}]`).join('')
    const filter = [
      ...delayed,
      `[${silenceIndex}:a]${labels}amix=inputs=${batchClips.length + 1}:duration=first:dropout_transition=0:normalize=0[out]`
    ].join(';')
    batches.push({
      inputs: batchClips.map((clip) => clip.path),
      output,
      duration: totalSec,
      filter,
      args: [
        '-y',
        ...inputArgs(batchClips.map((clip) => clip.path)),
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=48000:cl=mono:d=${totalSec}`,
        '-filter_complex',
        filter,
        '-map',
        '[out]',
        '-t',
        String(totalSec),
        output
      ]
    })
  }

  const finalInputs = batches.map((batch) => batch.output)
  const finalOutput = join(workDir, 'mixed.mp3')
  const finalFilter = `${finalInputs.map((_, index) => `[${index}:a]`).join('')}amix=inputs=${finalInputs.length}:duration=longest:dropout_transition=0:normalize=0[out]`
  return {
    batches,
    finalInputs,
    finalOutput,
    finalFilter,
    finalArgs: [
      '-y',
      ...inputArgs(finalInputs),
      '-filter_complex',
      finalFilter,
      '-map',
      '[out]',
      '-t',
      String(totalSec),
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '128k',
      finalOutput
    ]
  }
}

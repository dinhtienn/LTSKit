import { buildAtempoFilter, planAudioFit } from './audioFit'

export interface CapcutAudioPlan {
  tempo: number
  outputLimit: number | null
  args: string[]
}

export { buildAtempoFilter } from './audioFit'

export function buildCapcutAudioPlan(
  sourcePath: string,
  outputPath: string,
  sourceDuration: number,
  userSpeed: number,
  slot: number | null,
  minSlot: number
): CapcutAudioPlan {
  const { tempo, outputLimit } = planAudioFit(sourceDuration, userSpeed, slot, minSlot)
  const args = [
    '-y',
    '-i',
    sourcePath,
    '-ac',
    '1',
    '-ar',
    '48000',
    '-filter:a',
    buildAtempoFilter(tempo)
  ]
  if (outputLimit != null) args.push('-t', String(outputLimit))
  args.push(outputPath)
  return { tempo, outputLimit, args }
}

export interface AudioFitPlan {
  tempo: number
  outputLimit: number | null
}

export function buildAtempoFilter(rate: number): string {
  let remaining = rate
  const filters: string[] = []
  while (remaining > 2 + 1e-6) {
    filters.push('atempo=2.0')
    remaining /= 2
  }
  while (remaining < 0.5 - 1e-6) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }
  filters.push(`atempo=${Math.max(0.5, Math.min(2, remaining)).toFixed(4)}`)
  return filters.join(',')
}

export function planAudioFit(
  sourceDuration: number,
  userTempo: number,
  slot: number | null,
  minSlot: number
): AudioFitPlan {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new Error('Không đo được thời lượng audio.')
  }
  const tempo = Number.isFinite(userTempo) && userTempo > 0 ? userTempo : 1
  const usableSlot = slot == null ? null : Math.max(slot, minSlot)
  const afterUserTempo = sourceDuration / tempo
  const outputLimit = usableSlot != null && afterUserTempo > usableSlot + 0.02 ? usableSlot : null
  return {
    tempo: outputLimit == null ? tempo : sourceDuration / outputLimit,
    outputLimit
  }
}

export function planAudioFitIfDurationKnown(
  sourceDuration: number,
  userTempo: number,
  slot: number | null,
  minSlot: number
): AudioFitPlan | null {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return null
  return planAudioFit(sourceDuration, userTempo, slot, minSlot)
}

export function buildTrimSilenceArgs(inputPath: string, outputPath: string): string[] {
  const filter = [
    'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.02',
    'areverse',
    'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.02',
    'areverse',
    'apad=pad_dur=0.05'
  ].join(',')
  return ['-y', '-i', inputPath, '-filter:a', filter, '-ar', '48000', '-ac', '1', outputPath]
}

export async function trimAudioEdges(
  inputPath: string,
  outputPath: string,
  runTrim: (args: string[]) => Promise<boolean>,
  isCancelled: () => boolean = () => false
): Promise<string> {
  try {
    const ready = await runTrim(buildTrimSilenceArgs(inputPath, outputPath))
    if (isCancelled()) throw new Error('Đã hủy.')
    return ready ? outputPath : inputPath
  } catch (error) {
    if (isCancelled()) throw new Error('Đã hủy.')
    return inputPath
  }
}

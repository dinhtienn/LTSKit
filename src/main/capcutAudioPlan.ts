export interface CapcutAudioPlan {
  tempo: number
  outputLimit: number | null
  args: string[]
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

export function buildCapcutAudioPlan(
  sourcePath: string,
  outputPath: string,
  sourceDuration: number,
  userSpeed: number,
  slot: number | null,
  minSlot: number
): CapcutAudioPlan {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    throw new Error('Không đo được thời lượng audio CapCut.')
  }
  const speed = Number.isFinite(userSpeed) && userSpeed > 0 ? userSpeed : 1
  const usableSlot = slot == null ? null : Math.max(slot, minSlot)
  const afterUserSpeed = sourceDuration / speed
  const outputLimit = usableSlot != null && afterUserSpeed > usableSlot + 0.02 ? usableSlot : null
  const tempo = outputLimit == null ? speed : sourceDuration / outputLimit
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

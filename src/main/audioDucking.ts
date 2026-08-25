import { mergeDuckWindows, type DuckWindow } from '../shared/duckingEnvelope'

export type DuckingWindow = DuckWindow
export { mergeDuckWindows as mergeDuckingWindows }

function parseTimestamp(value: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000
}

export function parseSrtDuckingWindows(srt: string): DuckingWindow[] {
  return srt
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const line = block.split('\n').find((value) => value.includes('-->'))
      if (!line) return null
      const [start, end] = line.split('-->').map((value) => parseTimestamp(value.trim().split(/\s+/)[0]))
      if (start === null || end === null) return null
      return end > start ? { start, end } : null
    })
    .filter((window): window is DuckingWindow => window !== null)
}

const round = (value: number): string => String(Number(value.toFixed(6)))

/**
 * Sinh bieu thuc gain cho MOT cua so, voi `fallback` la gia tri dung khi thoi
 * diem `t` nam ngoai cua so nay. Cac cua so duoc long vao nhau qua `fallback`
 * nen FFmpeg khong bao gio nhan min() qua hai tham so.
 */
function gainExpression(
  window: DuckingWindow,
  base: number,
  duck: number,
  attackMs: number,
  releaseMs: number,
  fallback: string
): string {
  const attack = Math.min(Math.max(0, attackMs) / 1000, (window.end - window.start) / 2)
  const release = Math.min(Math.max(0, releaseMs) / 1000, (window.end - window.start) / 2)
  const attackEnd = window.start + attack
  const releaseStart = window.end - release
  const held = `if(between(t,${round(window.start)},${round(window.end)}),${round(duck)},${fallback})`
  const withRelease =
    release > 0
      ? `if(between(t,${round(releaseStart)},${round(window.end)}),${round(duck)}+(${round(base)}-${round(duck)})*(t-${round(releaseStart)})/${round(release)},${held})`
      : held
  return attack > 0
    ? `if(between(t,${round(window.start)},${round(attackEnd)}),${round(base)}+(${round(duck)}-${round(base)})*(t-${round(window.start)})/${round(attack)},${withRelease})`
    : withRelease
}

export function buildDuckingVolumeExpression({
  baseVolume,
  duckPercent,
  attackMs,
  releaseMs,
  windows
}: {
  baseVolume: number
  duckPercent: number
  attackMs: number
  releaseMs: number
  windows: DuckingWindow[]
}): string {
  const base = Math.max(0, Math.min(1, baseVolume))
  const duck = Number(((base * Math.max(0, Math.min(100, duckPercent))) / 100).toFixed(6))
  const expression = windows.reduceRight(
    (fallback, window) => gainExpression(window, base, duck, attackMs, releaseMs, fallback),
    round(base)
  )
  return expression.replaceAll(',', '\\,')
}

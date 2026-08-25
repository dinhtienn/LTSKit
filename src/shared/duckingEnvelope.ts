/**
 * Duong bao am luong cho ducking, dung chung giua preview va ban xuat.
 *
 * `audioDucking.ts` dich cac cua so nay thanh bieu thuc `volume` cua FFmpeg;
 * preview goi truc tiep `duckGainAt` tren tung khung hinh. Ca hai phai cho ra
 * cung mot gain, neu khong nguoi dung se nghe mot dang va xuat ra mot dang.
 */
export interface DuckWindow {
  start: number
  end: number
}

export interface DuckEnvelopeOptions {
  baseVolume: number
  duckPercent: number
  attackMs: number
  releaseMs: number
}

/**
 * No rong moi cua so theo attack/release roi gop cac cua so cham nhau. Nho vay
 * hai cau thoai sat nhau khong lam nhac nen bat len roi tat ngay giua chung.
 */
export function mergeDuckWindows(
  windows: DuckWindow[],
  attackMs: number,
  releaseMs: number
): DuckWindow[] {
  const attack = Math.max(0, attackMs) / 1000
  const release = Math.max(0, releaseMs) / 1000
  const expanded = windows
    .filter((window) => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
    .map((window) => ({ start: Math.max(0, window.start - attack), end: window.end + release }))
    .sort((left, right) => left.start - right.start)
  const merged: DuckWindow[] = []
  for (const window of expanded) {
    const previous = merged.at(-1)
    if (previous && window.start <= previous.end) previous.end = Math.max(previous.end, window.end)
    else merged.push({ ...window })
  }
  return merged
}

export function duckGainAt(
  windows: DuckWindow[],
  time: number,
  { baseVolume, duckPercent, attackMs, releaseMs }: DuckEnvelopeOptions
): number {
  const base = Math.max(0, Math.min(1, baseVolume))
  const duck = (base * Math.max(0, Math.min(100, duckPercent))) / 100
  const window = windows.find((item) => time >= item.start && time <= item.end)
  if (!window) return base

  const span = window.end - window.start
  const attack = Math.min(Math.max(0, attackMs) / 1000, span / 2)
  const release = Math.min(Math.max(0, releaseMs) / 1000, span / 2)

  if (attack > 0 && time <= window.start + attack) {
    return base + (duck - base) * ((time - window.start) / attack)
  }
  if (release > 0 && time >= window.end - release) {
    return duck + (base - duck) * ((time - (window.end - release)) / release)
  }
  return duck
}

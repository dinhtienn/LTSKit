import type { CoChu, VideoRect } from './types'

/**
 * Cach tinh co chu phu de, dung chung giua preview va ban xuat.
 *
 * `burn.ts` dung ket qua nay khi dung file ASS; `VideoEditor` dung no de ve
 * chu trong khung xem truoc. Hai ben phai cho ra cung mot so pixel, neu khong
 * nguoi dung se can chinh theo mot thu roi nhan ve mot thu khac.
 */
export interface SubtitleScale {
  /** `true` = do theo chieu cao khung hinh, `false` = do theo chieu rong. */
  theoCao: boolean
  tuDong: number
  thang: Record<Exclude<CoChu, 'auto'>, number>
  min: number
  max: number
}

// Ngang: moc theo chieu cao.
export const LANDSCAPE_SCALE: SubtitleScale = {
  theoCao: true,
  tuDong: 0.042,
  thang: { nho: 0.025, vua: 0.035, lon: 0.045, ratlon: 0.055 },
  min: 0.02,
  max: 0.055
}

// Doc: moc theo be rong, chu to hon cho kieu TikTok/Reels. Video vuong tinh la doc.
export const PORTRAIT_SCALE: SubtitleScale = {
  theoCao: false,
  tuDong: 0.045,
  thang: { nho: 0.035, vua: 0.045, lon: 0.055, ratlon: 0.065 },
  min: 0.035,
  max: 0.065
}

export function subtitleScaleFor(width: number, height: number): SubtitleScale {
  return width < height ? PORTRAIT_SCALE : LANDSCAPE_SCALE
}

export function subtitleFontSize({
  w,
  h,
  coChu,
  region
}: {
  w: number
  h: number
  coChu?: CoChu | null
  region?: VideoRect | null
}): number {
  const height = h > 0 ? h : 720
  const width = w > 0 ? w : 1280
  const scale = subtitleScaleFor(width, height)
  const anchor = scale.theoCao ? height : width
  const min = Math.round(anchor * scale.min)
  const max = Math.max(min, Math.round(anchor * scale.max))
  const clamp = (value: number): number => Math.max(min, Math.min(max, Math.round(value)))

  const manual = coChu && coChu !== 'auto' ? scale.thang[coChu] : null
  if (manual) return clamp(anchor * manual)

  const hasRegion = region != null && region.x1 > region.x0 && region.y1 > region.y0
  if (!hasRegion) return clamp(anchor * scale.tuDong)

  // Tu dong khi co khung: mot dong chu vua chieu cao khung nguoi dung keo.
  const boxHeight = Math.min(height - Math.max(0, region.y0), region.y1 - region.y0)
  return clamp(boxHeight * 0.5)
}

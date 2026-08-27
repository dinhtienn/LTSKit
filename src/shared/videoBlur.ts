/**
 * Do mo cua vung lam mo, tinh theo Gaussian sigma. Preview dung truc tiep so
 * nay; ban xuat quy doi sang ban kinh boxblur tuong duong.
 */
export const EXPORT_BLUR_SIGMA = 20

/**
 * Filter lam mo dung khi xuat video.
 *
 * Dung `boxblur` thay `gblur` vi nhanh hon dang ke tren video dai, trong khi
 * do mo nhin bang mat la tuong duong. Do thuc te 1080p/100s, 3 vung mo:
 *   gblur=sigma=20     -> 49.6 s
 *   boxblur=20:3:10:3  -> 44.2 s
 * Ban kinh chroma bang mot nua luma vi mat phang mau da duoc lay mau thua.
 */
export function exportBlurFilter(): string {
  const luma = EXPORT_BLUR_SIGMA
  const chroma = Math.max(1, Math.round(luma / 2))
  return `boxblur=${luma}:3:${chroma}:3`
}

/** Quy doi blur tu pixel video goc sang CSS pixel cua khung preview. */
export function previewBlurRadius(
  videoWidth: number,
  videoHeight: number,
  previewWidth: number,
  previewHeight: number
): number {
  if (
    ![videoWidth, videoHeight, previewWidth, previewHeight].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) {
    return 0
  }
  const scale = Math.min(previewWidth / videoWidth, previewHeight / videoHeight)
  return Number((EXPORT_BLUR_SIGMA * scale).toFixed(3))
}

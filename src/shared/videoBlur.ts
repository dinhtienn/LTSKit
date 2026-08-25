/** Gaussian sigma dung khi xuat vung lam mo bang FFmpeg. */
export const EXPORT_BLUR_SIGMA = 20

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

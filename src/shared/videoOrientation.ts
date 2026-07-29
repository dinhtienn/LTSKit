export function displayDimensions(
  width: number,
  height: number,
  rotation: number | undefined
): { width: number; height: number } {
  const normalized = ((Math.round(rotation ?? 0) % 360) + 360) % 360
  return normalized === 90 || normalized === 270
    ? { width: height, height: width }
    : { width, height }
}

export function containDimensions(
  videoWidth: number,
  videoHeight: number,
  containerWidth: number,
  containerHeight: number
): { width: number; height: number } {
  if (videoWidth <= 0 || videoHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { width: 0, height: 0 }
  }
  if (containerWidth / videoWidth <= containerHeight / videoHeight) {
    return { width: containerWidth, height: containerWidth * videoHeight / videoWidth }
  }
  return { width: containerHeight * videoWidth / videoHeight, height: containerHeight }
}

import type { VideoRect } from '../../../shared/types'

export function defaultOcrRegion(videoW: number, videoH: number): VideoRect {
  const width = Math.max(1, Math.round(videoW * 0.7))
  const x0 = Math.max(0, Math.round((videoW - width) / 2))
  const y0 = Math.max(0, Math.round(videoH * 0.75))
  return {
    x0,
    x1: Math.min(videoW, x0 + width),
    y0,
    y1: videoH
  }
}

export function formatOcrRegionForNotebook(region: VideoRect): string {
  return [
    `X0 = ${Math.round(region.x0)}`,
    `X1 = ${Math.round(region.x1)}`,
    `Y0 = ${Math.round(region.y0)}`,
    `Y1 = ${Math.round(region.y1)}`
  ].join('\n')
}

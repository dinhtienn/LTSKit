import type { VideoRect } from '../../../shared/types'

export type RectEdge = 'left' | 'right' | 'top' | 'bottom'
export type RectCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type LogoCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export function arrowDelta(
  key: string,
  stepX: number,
  stepY: number,
  largeStep: boolean
): { dx: number; dy: number } | null {
  const multiplier = largeStep ? 10 : 1
  if (key === 'ArrowLeft') return { dx: -stepX * multiplier, dy: 0 }
  if (key === 'ArrowRight') return { dx: stepX * multiplier, dy: 0 }
  if (key === 'ArrowUp') return { dx: 0, dy: -stepY * multiplier }
  if (key === 'ArrowDown') return { dx: 0, dy: stepY * multiplier }
  return null
}

export function logoCornerArrowDelta(
  key: string,
  corner: LogoCorner,
  stepX: number,
  stepY: number,
  largeStep: boolean
): { dx: number; dy: number } | null {
  if (!key.startsWith('Arrow')) return null
  const multiplier = largeStep ? 10 : 1
  const direction = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1
  const signX = corner.endsWith('left') ? -1 : 1
  const signY = corner.startsWith('top') ? -1 : 1
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    return {
      dx: direction * stepX * multiplier,
      dy: direction * signX * signY * stepY * multiplier
    }
  }
  return {
    dx: direction * signX * signY * stepX * multiplier,
    dy: direction * stepY * multiplier
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const rounded = (rect: VideoRect): VideoRect => ({
  x0: Math.round(rect.x0), x1: Math.round(rect.x1),
  y0: Math.round(rect.y0), y1: Math.round(rect.y1)
})

export function moveRect(
  rect: VideoRect, dx: number, dy: number, videoW: number, videoH: number
): VideoRect {
  const width = rect.x1 - rect.x0
  const height = rect.y1 - rect.y0
  const x0 = clamp(rect.x0 + dx, 0, videoW - width)
  const y0 = clamp(rect.y0 + dy, 0, videoH - height)
  return rounded({ x0, x1: x0 + width, y0, y1: y0 + height })
}

export function resizeRectEdge(
  rect: VideoRect,
  edge: RectEdge,
  dx: number,
  dy: number,
  videoW: number,
  videoH: number,
  minW: number,
  minH: number
): VideoRect {
  const next = { ...rect }
  if (edge === 'left') next.x0 = clamp(rect.x0 + dx, 0, rect.x1 - minW)
  if (edge === 'right') next.x1 = clamp(rect.x1 + dx, rect.x0 + minW, videoW)
  if (edge === 'top') next.y0 = clamp(rect.y0 + dy, 0, rect.y1 - minH)
  if (edge === 'bottom') next.y1 = clamp(rect.y1 + dy, rect.y0 + minH, videoH)
  return rounded(next)
}

export function resizeRectCorner(
  rect: VideoRect,
  corner: RectCorner,
  dx: number,
  dy: number,
  videoW: number,
  videoH: number,
  minW: number,
  minH: number
): VideoRect {
  const fromLeft = corner.endsWith('left')
  const fromTop = corner.startsWith('top')
  const next = { ...rect }
  if (fromLeft) next.x0 = clamp(rect.x0 + dx, 0, rect.x1 - minW)
  else next.x1 = clamp(rect.x1 + dx, rect.x0 + minW, videoW)
  if (fromTop) next.y0 = clamp(rect.y0 + dy, 0, rect.y1 - minH)
  else next.y1 = clamp(rect.y1 + dy, rect.y0 + minH, videoH)
  return rounded(next)
}

export function resizeLogoFromCorner(
  rect: VideoRect,
  corner: LogoCorner,
  dx: number,
  dy: number,
  aspect: number,
  videoW: number,
  videoH: number,
  minW: number
): VideoRect {
  const fromLeft = corner.endsWith('left')
  const fromTop = corner.startsWith('top')
  const anchorX = fromLeft ? rect.x1 : rect.x0
  const anchorY = fromTop ? rect.y1 : rect.y0
  const signX = fromLeft ? -1 : 1
  const signY = fromTop ? -1 : 1
  const proposedW = Math.max(
    minW,
    rect.x1 - rect.x0 + signX * dx,
    (rect.y1 - rect.y0 + signY * dy) * aspect
  )
  const maxWByX = fromLeft ? anchorX : videoW - anchorX
  const maxHByY = fromTop ? anchorY : videoH - anchorY
  const width = Math.min(proposedW, maxWByX, maxHByY * aspect)
  const height = width / aspect
  return rounded({
    x0: fromLeft ? anchorX - width : anchorX,
    x1: fromLeft ? anchorX : anchorX + width,
    y0: fromTop ? anchorY - height : anchorY,
    y1: fromTop ? anchorY : anchorY + height
  })
}

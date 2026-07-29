import type { JSX, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type { VideoRect } from '../../../shared/types'
import {
  arrowDelta,
  logoCornerArrowDelta,
  moveRect,
  resizeLogoFromCorner,
  type LogoCorner
} from '../lib/overlayGeometry'

interface LogoBoxProps {
  src: string
  rect: VideoRect
  setRect: (rect: VideoRect) => void
  aspect: number
  videoW: number
  videoH: number
  boxW: number
  boxH: number
  active: boolean
  onActivate: () => void
}

type DragStart = {
  kind: 'move' | LogoCorner
  x: number
  y: number
  pointerId: number
  rect: VideoRect
}

const corners: LogoCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

export default function LogoBox({
  src,
  rect,
  setRect,
  aspect,
  videoW,
  videoH,
  boxW,
  boxH,
  active,
  onActivate
}: LogoBoxProps): JSX.Element {
  const drag = useRef<DragStart | null>(null)

  const startDrag =
    (kind: DragStart['kind']) =>
    (event: ReactPointerEvent<HTMLElement>): void => {
      event.preventDefault()
      event.stopPropagation()
      onActivate()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { kind, x: event.clientX, y: event.clientY, pointerId: event.pointerId, rect: { ...rect } }
    }

  const handlePointerMove = useCallback(
    (event: PointerEvent): void => {
      const start = drag.current
      if (!start || event.pointerId !== start.pointerId) return

      const dx = (event.clientX - start.x) * (videoW / boxW)
      const dy = (event.clientY - start.y) * (videoH / boxH)
      if (start.kind === 'move') {
        setRect(moveRect(start.rect, dx, dy, videoW, videoH))
        return
      }

      const minW = Math.max(24, Math.round(videoW * 0.03))
      setRect(resizeLogoFromCorner(start.rect, start.kind, dx, dy, aspect, videoW, videoH, minW))
    },
    [aspect, boxH, boxW, setRect, videoH, videoW]
  )

  useEffect(() => {
    const stopDrag = (event: PointerEvent): void => {
      if (drag.current && event.pointerId !== drag.current.pointerId) return
      drag.current = null
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
    }
  }, [handlePointerMove])

  const handleKey =
    (kind: DragStart['kind']) =>
    (event: ReactKeyboardEvent): void => {
      const stepX = Math.max(1, Math.round(videoW * 0.005))
      const stepY = Math.max(1, Math.round(videoH * 0.005))
      const delta =
        kind === 'move'
          ? arrowDelta(event.key, stepX, stepY, event.shiftKey)
          : logoCornerArrowDelta(event.key, kind, stepX, stepY, event.shiftKey)
      if (!delta) return
      event.preventDefault()
      event.stopPropagation()
      onActivate()
      if (kind === 'move') {
        setRect(moveRect(rect, delta.dx, delta.dy, videoW, videoH))
        return
      }
      setRect(
        resizeLogoFromCorner(
          rect,
          kind,
          delta.dx,
          delta.dy,
          aspect,
          videoW,
          videoH,
          Math.max(24, Math.round(videoW * 0.03))
        )
      )
    }

  const xPct = (value: number): string => `${videoW > 0 ? (value / videoW) * 100 : 0}%`
  const yPct = (value: number): string => `${videoH > 0 ? (value / videoH) * 100 : 0}%`

  return (
    <div
      className={`logo-box ${active ? 'overlay-active' : ''}`}
      style={{
        left: xPct(rect.x0),
        top: yPct(rect.y0),
        width: xPct(rect.x1 - rect.x0),
        height: yPct(rect.y1 - rect.y0)
      }}
    >
      <div
        className="logo-box-body"
        role="group"
        tabIndex={0}
        aria-label="Di chuyển logo bằng các phím mũi tên"
        onPointerDown={startDrag('move')}
        onKeyDown={handleKey('move')}
      >
        <img src={src} draggable={false} alt="Logo" />
      </div>
      {corners.map((corner) => (
        <button
          key={corner}
          type="button"
          className={`logo-corner logo-${corner}`}
          onPointerDown={startDrag(corner)}
          onKeyDown={handleKey(corner)}
          aria-label={`Thay đổi góc ${corner} của logo bằng các phím mũi tên`}
        />
      ))}
    </div>
  )
}

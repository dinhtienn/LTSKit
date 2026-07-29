import type { CSSProperties, JSX, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type { VideoRect } from '../../../shared/types'
import {
  arrowDelta,
  moveRect,
  resizeRectCorner,
  resizeRectEdge,
  type RectCorner,
  type RectEdge
} from '../lib/overlayGeometry'

export interface Region {
  y0: number
  y1: number
}

interface RegionBoxProps {
  region: VideoRect
  setRegion: (region: VideoRect) => void
  videoW: number
  videoH: number
  boxW: number
  boxH: number
  previewBlur?: boolean
  active: boolean
  onActivate: () => void
  label?: string
  cornerHandles?: boolean
}

type DragStart = {
  kind: 'move' | RectEdge | RectCorner
  x: number
  y: number
  pointerId: number
  region: VideoRect
}

export default function RegionBox({
  region,
  setRegion,
  videoW,
  videoH,
  boxW,
  boxH,
  previewBlur = false,
  active,
  onActivate,
  label,
  cornerHandles = false
}: RegionBoxProps): JSX.Element {
  const drag = useRef<DragStart | null>(null)

  type ResizeKind = RectEdge | RectCorner
  const startDrag =
    (kind: DragStart['kind']) =>
    (event: ReactPointerEvent<HTMLElement>): void => {
      event.preventDefault()
      event.stopPropagation()
      onActivate()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { kind, x: event.clientX, y: event.clientY, pointerId: event.pointerId, region: { ...region } }
    }

  const handlePointerMove = useCallback(
    (event: PointerEvent): void => {
      const start = drag.current
      if (!start || event.pointerId !== start.pointerId) return

      const dx = (event.clientX - start.x) * (videoW / boxW)
      const dy = (event.clientY - start.y) * (videoH / boxH)
      if (start.kind === 'move') {
        setRegion(moveRect(start.region, dx, dy, videoW, videoH))
        return
      }

      const minW = Math.max(28, Math.round(videoW * 0.04))
      const minH = Math.max(28, Math.round(videoH * 0.04))
      setRegion(
        start.kind.includes('-')
          ? resizeRectCorner(start.region, start.kind as RectCorner, dx, dy, videoW, videoH, minW, minH)
          : resizeRectEdge(start.region, start.kind as RectEdge, dx, dy, videoW, videoH, minW, minH)
      )
    },
    [boxH, boxW, setRegion, videoH, videoW]
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
      const delta = arrowDelta(
        event.key,
        Math.max(1, Math.round(videoW * 0.005)),
        Math.max(1, Math.round(videoH * 0.005)),
        event.shiftKey
      )
      if (!delta) return
      event.preventDefault()
      event.stopPropagation()
      onActivate()
      if (kind === 'move') {
        setRegion(moveRect(region, delta.dx, delta.dy, videoW, videoH))
        return
      }
      const minW = Math.max(28, Math.round(videoW * 0.04))
      const minH = Math.max(28, Math.round(videoH * 0.04))
      setRegion(
        kind.includes('-')
          ? resizeRectCorner(region, kind as RectCorner, delta.dx, delta.dy, videoW, videoH, minW, minH)
          : resizeRectEdge(region, kind as RectEdge, delta.dx, delta.dy, videoW, videoH, minW, minH)
      )
    }

  const cornerStyle = (corner: RectCorner): CSSProperties => ({
    left: corner.endsWith('left') ? -12 : undefined,
    right: corner.endsWith('right') ? -12 : undefined,
    top: corner.startsWith('top') ? -12 : undefined,
    bottom: corner.startsWith('bottom') ? -12 : undefined,
    cursor: corner === 'top-left' || corner === 'bottom-right' ? 'nwse-resize' : 'nesw-resize'
  })

  const xPct = (value: number): string => `${videoW > 0 ? (value / videoW) * 100 : 0}%`
  const yPct = (value: number): string => `${videoH > 0 ? (value / videoH) * 100 : 0}%`

  return (
    <div className={`rbox-lop ${active ? 'overlay-active' : ''}`}>
      <div className="rbox-mo" style={{ top: 0, left: 0, right: 0, height: yPct(region.y0) }} />
      <div className="rbox-mo" style={{ top: yPct(region.y1), left: 0, right: 0, bottom: 0 }} />
      <div
        className="rbox-mo"
        style={{ top: yPct(region.y0), left: 0, width: xPct(region.x0), height: yPct(region.y1 - region.y0) }}
      />
      <div
        className="rbox-mo"
        style={{
          top: yPct(region.y0),
          left: xPct(region.x1),
          right: 0,
          height: yPct(region.y1 - region.y0)
        }}
      />

      <div
        className={`rbox ${previewBlur ? 'rbox-lammo' : ''}`}
        style={{
          left: xPct(region.x0),
          top: yPct(region.y0),
          width: xPct(region.x1 - region.x0),
          height: yPct(region.y1 - region.y0)
        }}
        role="group"
        tabIndex={0}
        aria-label="Di chuyển vùng chữ bằng các phím mũi tên"
        onPointerDown={startDrag('move')}
        onKeyDown={handleKey('move')}
      >
        {(['left', 'right', 'top', 'bottom'] as RectEdge[]).map((edge) => (
          <button
            key={edge}
            type="button"
            className={`rbox-tay rbox-${edge}`}
            aria-label={`Thay đổi cạnh ${edge} của vùng chữ bằng các phím mũi tên`}
            onPointerDown={startDrag(edge)}
            onKeyDown={handleKey(edge)}
          />
        ))}
        {cornerHandles && (['top-left', 'top-right', 'bottom-left', 'bottom-right'] as RectCorner[]).map((corner) => (
          <button
            key={corner}
            type="button"
            className={`rbox-tay rbox-${corner}`}
            style={cornerStyle(corner)}
            aria-label={`Thay đổi góc ${corner} của vùng chữ bằng các phím mũi tên`}
            onPointerDown={startDrag(corner as ResizeKind)}
            onKeyDown={handleKey(corner as ResizeKind)}
          />
        ))}
        <div className="rbox-nhan">{label ?? (previewBlur ? 'Vùng làm mờ' : 'Vùng chữ chạy')}</div>
      </div>
    </div>
  )
}

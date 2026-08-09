import type { CSSProperties, JSX } from 'react'
import type { TextOverlay } from '../../../shared/types'
import RegionBox from './RegionBox'

interface TextOverlayBoxProps {
  overlay: TextOverlay
  setOverlay: (overlay: TextOverlay) => void
  videoW: number
  videoH: number
  boxW: number
  boxH: number
  active: boolean
  onActivate: () => void
  visible: boolean
  fontFamily: string
}

function rgba(hex: string, opacity: number): string {
  const raw = hex.replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((part) => part + part)
          .join('')
      : raw
  const red = parseInt(full.slice(0, 2), 16)
  const green = parseInt(full.slice(2, 4), 16)
  const blue = parseInt(full.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(100, opacity)) / 100})`
}

export default function TextOverlayBox(props: TextOverlayBoxProps): JSX.Element | null {
  const { overlay, videoW, videoH, boxH, visible, fontFamily } = props
  if (!visible) return null
  const left = `${(overlay.rect.x0 / videoW) * 100}%`
  const top = `${(overlay.rect.y0 / videoH) * 100}%`
  const width = `${((overlay.rect.x1 - overlay.rect.x0) / videoW) * 100}%`
  const height = `${((overlay.rect.y1 - overlay.rect.y0) / videoH) * 100}%`
  const previewSize = Math.max(10, overlay.fontSize * (boxH / videoH))
  const shadow =
    overlay.outlinePx > 0
      ? `0 0 ${Math.max(1, overlay.outlinePx * 0.8)}px ${overlay.outlineColor}, 0 0 ${Math.max(1, overlay.outlinePx * 0.8)}px ${overlay.outlineColor}`
      : 'none'
  const style: CSSProperties = {
    left,
    top,
    width,
    height,
    fontSize: previewSize,
    fontFamily,
    color: rgba(overlay.textColor, overlay.textOpacity),
    textShadow: shadow
  }
  return (
    <>
      <RegionBox
        region={overlay.rect}
        setRegion={(rect) => props.setOverlay({ ...overlay, rect })}
        videoW={videoW}
        videoH={videoH}
        boxW={props.boxW}
        boxH={boxH}
        showMask={false}
        active={props.active}
        onActivate={props.onActivate}
        label="Text"
        cornerHandles
      />
      <div className="text-overlay-preview" style={style}>
        <span
          style={
            overlay.bgEnabled
              ? {
                  background: rgba(overlay.bgColor, overlay.bgOpacity),
                  padding: '0.18em 0.3em',
                  borderRadius: '0.2em'
                }
              : undefined
          }
        >
          {overlay.text}
        </span>
      </div>
    </>
  )
}

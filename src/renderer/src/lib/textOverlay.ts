import type { TextOverlay } from '../../../shared/types'

export function createTextOverlay(id: string, videoW: number, videoH: number): TextOverlay {
  return {
    id,
    text: 'Text mới',
    rect: {
      x0: Math.round(videoW * 0.25),
      x1: Math.round(videoW * 0.75),
      y0: Math.round(videoH * 0.2),
      y1: Math.round(videoH * 0.35)
    },
    fontSize: 48,
    textColor: '#ffffff',
    textOpacity: 100,
    outlineColor: '#000000',
    outlinePx: 2,
    bgEnabled: false,
    bgColor: '#000000',
    bgOpacity: 60,
    startSec: 0,
    endSec: null
  }
}

export function textOverlayVisible(overlay: TextOverlay, currentTime: number): boolean {
  return overlay.startSec <= currentTime && (overlay.endSec == null || currentTime < overlay.endSec)
}

export function updateTextOverlay(overlays: TextOverlay[], id: string, patch: Partial<TextOverlay>): TextOverlay[] {
  return overlays.map((overlay) => (overlay.id === id ? { ...overlay, ...patch } : overlay))
}

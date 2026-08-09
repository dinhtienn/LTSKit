export interface SubtitlePreviewCue {
  startSec: number
  endSec: number
  text: string
}

function srtTime(value: string): number | null {
  const match = /^(\d+):(\d+):(\d+)[,.](\d+)$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`)
}

export function parseSubtitlePreview(raw: string): SubtitlePreviewCue[] {
  const cues: SubtitlePreviewCue[] = []
  for (const block of raw.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) continue
    const [startRaw, endRaw] = lines[timingIndex].split('-->')
    const startSec = srtTime(startRaw)
    const endSec = srtTime(endRaw)
    const text = lines.slice(timingIndex + 1).join('\n').trim()
    if (startSec == null || endSec == null || endSec <= startSec || !text) continue
    cues.push({ startSec, endSec, text })
  }
  return cues
}

export function activeSubtitleText(cues: SubtitlePreviewCue[], currentTime: number): string {
  return cues.filter((cue) => cue.startSec <= currentTime && currentTime < cue.endSec).map((cue) => cue.text).join('\n')
}

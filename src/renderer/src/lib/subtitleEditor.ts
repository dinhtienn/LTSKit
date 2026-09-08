export interface EditableSubtitleCue {
  id: string
  index: number
  start: string
  end: string
  text: string
}

export type SubtitleCueIssueCode = 'timestamp' | 'empty-text' | 'end-before-start' | 'overlap' | 'over-cps'

export interface SubtitleCueIssue {
  cueId: string
  code: SubtitleCueIssueCode
  severity: 'error' | 'warning'
  message: string
}

export function parseSrtTimestamp(value: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (minutes > 59 || seconds > 59) return null
  return hours * 3600 + minutes * 60 + seconds + Number(match[4]) / 1000
}

export function formatSrtTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const secs = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

export function parseEditableSrt(raw: string): EditableSubtitleCue[] {
  return raw.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/).flatMap((block, blockIndex) => {
    const lines = block.split(/\r?\n/)
    const timingIndex = lines.findIndex((line) => line.includes('-->'))
    if (timingIndex < 0) return []
    const [start = '', end = ''] = lines[timingIndex].split('-->')
    return [{
      id: String(lines[0]?.trim() || blockIndex + 1),
      index: Number(lines[0]?.trim()) || blockIndex + 1,
      start: start.trim(),
      end: end.trim(),
      text: lines.slice(timingIndex + 1).join('\n').trim()
    }]
  })
}

export function serializeEditableSrt(cues: EditableSubtitleCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${cue.start} --> ${cue.end}\n${cue.text}\n`).join('\n')
}

export function editableCueCps(cue: EditableSubtitleCue): number {
  const start = parseSrtTimestamp(cue.start)
  const end = parseSrtTimestamp(cue.end)
  if (start == null || end == null || end <= start) return Number.POSITIVE_INFINITY
  const characters = [...cue.text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '')].filter((char) => !/\s/u.test(char)).length
  return characters / (end - start)
}

export function validateEditableCues(
  cues: EditableSubtitleCue[],
  targetCps: number
): { canSave: boolean; issues: SubtitleCueIssue[] } {
  const issues: SubtitleCueIssue[] = []
  let previousEnd = -Infinity
  for (const cue of cues) {
    const start = parseSrtTimestamp(cue.start)
    const end = parseSrtTimestamp(cue.end)
    if (start == null || end == null) issues.push({ cueId: cue.id, code: 'timestamp', severity: 'error', message: 'Timestamp không hợp lệ.' })
    else {
      if (end <= start) issues.push({ cueId: cue.id, code: 'end-before-start', severity: 'error', message: 'Thời gian kết thúc phải lớn hơn bắt đầu.' })
      if (start < previousEnd) issues.push({ cueId: cue.id, code: 'overlap', severity: 'error', message: 'Cue bị chồng thời gian với cue trước.' })
      previousEnd = Math.max(previousEnd, end)
    }
    if (!cue.text.trim()) issues.push({ cueId: cue.id, code: 'empty-text', severity: 'error', message: 'Nội dung cue không được rỗng.' })
    if (Number.isFinite(targetCps) && targetCps > 0 && editableCueCps(cue) > targetCps) {
      issues.push({ cueId: cue.id, code: 'over-cps', severity: 'warning', message: `CPS vượt mục tiêu ${targetCps}.` })
    }
  }
  return { canSave: !issues.some((issue) => issue.severity === 'error'), issues }
}

function reindex(cues: EditableSubtitleCue[]): EditableSubtitleCue[] {
  return cues.map((cue, index) => ({ ...cue, index: index + 1 }))
}

export function splitEditableCue(cues: EditableSubtitleCue[], id: string, cursorOffset: number, nextId: string): EditableSubtitleCue[] {
  const index = cues.findIndex((cue) => cue.id === id)
  if (index < 0) return cues
  const cue = cues[index]
  if (!Number.isInteger(cursorOffset) || cursorOffset <= 0 || cursorOffset >= cue.text.length) return cues
  const left = cue.text.slice(0, cursorOffset)
  const right = cue.text.slice(cursorOffset)
  const start = parseSrtTimestamp(cue.start)
  const end = parseSrtTimestamp(cue.end)
  if (!left.trim() || !right.trim() || start == null || end == null || end <= start) return cues
  const midpoint = formatSrtTimestamp(start + (end - start) / 2)
  const first = { ...cue, end: midpoint, text: left.trim() }
  const second: EditableSubtitleCue = { id: nextId, index: cue.index + 1, start: midpoint, end: cue.end, text: right.trim() }
  return reindex([...cues.slice(0, index), first, second, ...cues.slice(index + 1)])
}

export function mergeEditableCueWithNext(cues: EditableSubtitleCue[], id: string): EditableSubtitleCue[] {
  const index = cues.findIndex((cue) => cue.id === id)
  if (index < 0 || index >= cues.length - 1) return cues
  const first = cues[index]
  const next = cues[index + 1]
  const merged = { ...first, end: next.end, text: `${first.text.trim()}\n${next.text.trim()}` }
  return reindex([...cues.slice(0, index), merged, ...cues.slice(index + 2)])
}

export function replaceAllCueText(cues: EditableSubtitleCue[], find: string, replacement: string): { cues: EditableSubtitleCue[]; replacements: number } {
  if (!find) return { cues, replacements: 0 }
  let replacements = 0
  const next = cues.map((cue) => {
    let offset = 0
    while ((offset = cue.text.indexOf(find, offset)) >= 0) {
      replacements += 1
      offset += find.length
    }
    return { ...cue, text: cue.text.split(find).join(replacement) }
  })
  return replacements ? { cues: reindex(next), replacements } : { cues, replacements: 0 }
}

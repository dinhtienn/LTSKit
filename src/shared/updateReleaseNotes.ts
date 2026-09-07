export interface ReleaseNoteBlock {
  kind: 'heading' | 'item' | 'text'
  text: string
}

export function normalizeReleaseNotes(notes?: string): string {
  return (notes ?? '').replace(/\r\n?/g, '\n').trim()
}

export function formatReleaseNotes(notes?: string): ReleaseNoteBlock[] {
  return normalizeReleaseNotes(notes)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): ReleaseNoteBlock[] => {
      if (line.startsWith('## ')) return []
      if (line.startsWith('### ')) return [{ kind: 'heading', text: line.slice(4).trim() }]
      if (/^[-*+]\s+/.test(line)) return [{ kind: 'item', text: line.slice(2).trim() }]
      return [{ kind: 'text', text: line }]
    })
}

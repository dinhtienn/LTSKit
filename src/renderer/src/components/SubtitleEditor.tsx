import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { EditableSubtitleCue, SubtitleCueIssue } from '../lib/subtitleEditor'
import { editableCueCps, validateEditableCues } from '../lib/subtitleEditor'

export interface SubtitleEditorProps {
  path: string
  targetCps: number
  onClose: () => void
  onSaved: (output: string) => void
}

export default function SubtitleEditor({ path, targetCps, onClose, onSaved }: SubtitleEditorProps): JSX.Element {
  const [cues, setCues] = useState<EditableSubtitleCue[]>([])
  const [issues, setIssues] = useState<SubtitleCueIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setDirty(false)
    setError(null)
    void window.api.subtitleRead(path).then((result) => {
      if (!alive) return
      if (result.ok && result.cues) {
        setCues(result.cues)
        setIssues(validateEditableCues(result.cues, targetCps).issues)
      } else setError(result.error ?? 'Không đọc được file phụ đề.')
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [path, targetCps])

  const updateCue = (id: string, patch: Partial<EditableSubtitleCue>): void => {
    setCues((current) => {
      const next = current.map((cue) => cue.id === id ? { ...cue, ...patch } : cue)
      setIssues(validateEditableCues(next, targetCps).issues)
      return next
    })
    setDirty(true)
  }

  const close = (): void => {
    if (!dirty || window.confirm('Bỏ các thay đổi chưa lưu?')) onClose()
  }

  const save = async (): Promise<void> => {
    const validation = validateEditableCues(cues, targetCps)
    setIssues(validation.issues)
    if (!validation.canSave) return
    setSaving(true)
    setError(null)
    const result = await window.api.subtitleSaveEdited(path, cues)
    setSaving(false)
    if (result.ok && result.output) {
      setDirty(false)
      onSaved(result.output)
    } else setError(result.error ?? 'Không lưu được file phụ đề.')
  }

  const issueFor = (id: string): SubtitleCueIssue | undefined => issues.find((issue) => issue.cueId === id && issue.severity === 'error') ?? issues.find((issue) => issue.cueId === id)

  if (loading) return <div className="card muted">Đang đọc phụ đề…</div>
  if (error && !cues.length) return <div className="card"><div className="dy-err small">{error}</div><button className="btn" onClick={close}>Quay lại hàng đợi</button></div>

  return (
    <div className="subtitle-editor">
      <div className="cookie-head">
        <div>
          <div className="cookie-title">Sửa phụ đề</div>
          <div className="muted small">{path.split(/[\\/]/).pop()}</div>
        </div>
        <button className="btn" onClick={close}>Quay lại hàng đợi</button>
      </div>
      {error && <div className="dy-err small">{error}</div>}
      <div className="subtitle-editor-table-wrap">
        <table className="subtitle-editor-table">
          <thead><tr><th>#</th><th>Bắt đầu</th><th>Kết thúc</th><th>Nội dung</th><th>CPS</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {cues.map((cue) => {
              const issue = issueFor(cue.id)
              return (
                <tr key={cue.id}>
                  <td>{cue.index}</td>
                  <td><input value={cue.start} onChange={(event) => updateCue(cue.id, { start: event.target.value })} aria-label={`Bắt đầu cue ${cue.index}`} /></td>
                  <td><input value={cue.end} onChange={(event) => updateCue(cue.id, { end: event.target.value })} aria-label={`Kết thúc cue ${cue.index}`} /></td>
                  <td><textarea rows={2} value={cue.text} onChange={(event) => updateCue(cue.id, { text: event.target.value })} aria-label={`Nội dung cue ${cue.index}`} /></td>
                  <td>{Number.isFinite(editableCueCps(cue)) ? editableCueCps(cue).toFixed(1) : '—'}</td>
                  <td className={issue?.severity === 'error' ? 'dy-err small' : issue ? 'qwarn small' : 'muted small'}>{issue?.message ?? 'Đạt'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="cookie-actions">
        <span className="muted small">{cues.length} cue · CPS mục tiêu {targetCps}</span>
        <button className="btn primary" disabled={saving || !dirty || issues.some((issue) => issue.severity === 'error')} onClick={() => void save()}>
          {saving ? 'Đang lưu…' : 'Lưu file mới'}
        </button>
      </div>
    </div>
  )
}

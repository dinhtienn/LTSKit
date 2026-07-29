import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { DICH_LANGS, type GeminiReadiness } from '../../../shared/types'

interface TranslationControlProps {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  language: string
  setLanguage: (language: string) => void
  active: boolean
  onOpenSettings: () => void
}

export default function TranslationControl({
  enabled,
  setEnabled,
  language,
  setLanguage,
  active,
  onOpenSettings
}: TranslationControlProps): JSX.Element {
  const [readiness, setReadiness] = useState<GeminiReadiness | null>(null)

  useEffect(() => {
    if (active) void window.api.geminiReadiness().then(setReadiness)
  }, [active])

  const warning = !readiness?.hasKey
    ? 'Chưa cấu hình API key'
    : !readiness?.hasModels
      ? 'Chưa chọn model Gemini'
      : null

  return (
    <div className="card translation-control">
      <label className="check translation-toggle">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Dịch phụ đề bằng AI
      </label>
      <label className="field translation-language">
        <span className="muted small">Dịch sang</span>
        <select value={language} disabled={!enabled} onChange={(event) => setLanguage(event.target.value)}>
          {DICH_LANGS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select>
      </label>
      {enabled && warning && (
        <div className="translation-key-warning small">
          <span>{warning}</span>
          <button className="btn" onClick={onOpenSettings}>Đi đến Cài đặt</button>
        </div>
      )}
    </div>
  )
}

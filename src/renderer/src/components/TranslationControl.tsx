import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { DICH_LANGS, type GeminiReadiness, type TranslationStyle } from '../../../shared/types'
import { BUILT_IN_TRANSLATION_STYLES, createCustomTranslationStyle, resolveTranslationStyle } from '../lib/translationStyles'

interface TranslationControlProps {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
  language: string
  setLanguage: (language: string) => void
  styleId: string
  setStyleId: (styleId: string) => void
  customStyles: TranslationStyle[]
  setCustomStyles: (styles: TranslationStyle[]) => void
  active: boolean
  onOpenSettings: () => void
}

export default function TranslationControl({
  enabled,
  setEnabled,
  language,
  setLanguage,
  styleId,
  setStyleId,
  customStyles,
  setCustomStyles,
  active,
  onOpenSettings
}: TranslationControlProps): JSX.Element {
  const [readiness, setReadiness] = useState<GeminiReadiness | null>(null)
  const [manageStyles, setManageStyles] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftInstruction, setDraftInstruction] = useState('')
  const [styleError, setStyleError] = useState<string | null>(null)

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
      <label className="field translation-style">
        <span className="muted small">Văn phong</span>
        <select value={styleId} disabled={!enabled} onChange={(event) => setStyleId(event.target.value)}>
          <optgroup label="Có sẵn">
            {BUILT_IN_TRANSLATION_STYLES.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
          </optgroup>
          {customStyles.length > 0 && (
            <optgroup label="Của tôi">
              {customStyles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
            </optgroup>
          )}
        </select>
      </label>
      <button className="btn" type="button" onClick={() => setManageStyles((value) => !value)}>Quản lý style</button>
      {manageStyles && (
        <div className="translation-style-manager">
          <div className="muted small">Style có sẵn</div>
          {BUILT_IN_TRANSLATION_STYLES.map((style) => (
            <div className="translation-style-row" key={style.id}>
              <span>{style.name}</span>
              <button className="link-btn" type="button" onClick={() => {
                const copy = createCustomTranslationStyle(`${style.name} copy`, style.instruction)
                setCustomStyles([...customStyles, copy])
                setStyleId(copy.id)
              }}>Nhân bản</button>
            </div>
          ))}
          <div className="muted small">Style của tôi</div>
          {customStyles.map((style) => (
            <div className="translation-style-row" key={style.id}>
              <span>{style.name}</span>
              <span>
                <button className="link-btn" type="button" onClick={() => { setEditingId(style.id); setDraftName(style.name); setDraftInstruction(style.instruction); setStyleError(null) }}>Sửa</button>
                <button className="link-btn danger-link" type="button" onClick={() => { setCustomStyles(customStyles.filter((item) => item.id !== style.id)); if (styleId === style.id) setStyleId('natural') }}>Xóa</button>
              </span>
            </div>
          ))}
          <button className="btn" type="button" onClick={() => { setEditingId('new'); setDraftName(''); setDraftInstruction(''); setStyleError(null) }}>+ Thêm style</button>
          {editingId && (
            <div className="translation-style-form">
              <input value={draftName} maxLength={60} placeholder="Tên style" onChange={(event) => setDraftName(event.target.value)} />
              <textarea value={draftInstruction} maxLength={2000} rows={4} placeholder="Hướng dẫn văn phong" onChange={(event) => setDraftInstruction(event.target.value)} />
              {styleError && <div className="dy-err small">{styleError}</div>}
              <button className="btn" type="button" onClick={() => {
                try {
                  const current = editingId === 'new' ? null : customStyles.find((item) => item.id === editingId)
                  const next = createCustomTranslationStyle(draftName, draftInstruction, current?.id)
                  setCustomStyles(current ? customStyles.map((item) => item.id === current.id ? next : item) : [...customStyles, next])
                  setStyleId(next.id)
                  setEditingId(null)
                } catch (error) {
                  setStyleError(error instanceof Error ? error.message : 'Style không hợp lệ.')
                }
              }}>Lưu</button>
              <button className="btn" type="button" onClick={() => setEditingId(null)}>Hủy</button>
            </div>
          )}
        </div>
      )}
      {enabled && warning && (
        <div className="translation-key-warning small">
          <span>{warning}</span>
          <button className="btn" onClick={onOpenSettings}>Đi đến Cài đặt</button>
        </div>
      )}
    </div>
  )
}

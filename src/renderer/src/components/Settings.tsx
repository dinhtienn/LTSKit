import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type { CookieProfile } from '../../../shared/types'
import type { GeminiKeyDescriptor } from '../../../shared/types'
import GeminiHelp from './GeminiHelp'
import { loadSharedProxy } from '../lib/downloadConnection'
import { usePersistedState } from '../lib/persist'

const REPO_URL = 'https://github.com/dinhtienn/LTSKit'
const AUTHOR_URL = 'https://github.com/dinhtienn'
const FEEDBACK_URL = 'https://github.com/dinhtienn/LTSKit/issues'
const GEMINI_KEY_MASK = '********'

type SettingsTab = 'account' | 'connection' | 'aiTools' | 'about'

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string; icon: JSX.Element }> = [
  { key: 'account', label: 'Tài khoản', icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg> },
  { key: 'connection', label: 'Kết nối', icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2.8-2.8a5 5 0 0 0-7.1-7.1l-1.6 1.6M14 11a5 5 0 0 0-7.1-.1l-2.8 2.8a5 5 0 0 0 7.1 7.1l1.6-1.6" /></svg> },
  { key: 'aiTools', label: 'AI & Công cụ', icon: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3ZM5 16l.9 2.1L8 19l-2.1.9L5 22l-.9-2.1L2 19l2.1-.9L5 16Zm14-2 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z" /></svg> },
  { key: 'about', label: 'Giới thiệu', icon: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg> }
]

export default function Settings(): JSX.Element {
  const [tab, setTab] = useState<SettingsTab>('account')
  const [keys, setKeys] = useState<GeminiKeyDescriptor[]>([])
  const [draftKey, setDraftKey] = useState('')
  const [addingKey, setAddingKey] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const daLuu = keys.length > 0
  const [dangKiem, setDangKiem] = useState(false)
  const [kq, setKq] = useState<{ ok: boolean; message: string } | null>(null)
  const [hienHd, setHienHd] = useState(false)
  const [pool, setPool] = useState<string[]>([])
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<CookieProfile[]>([])
  const [loginUrl, setLoginUrl] = useState('')
  const [cookieBusy, setCookieBusy] = useState(false)
  const [cookieMsg, setCookieMsg] = useState<string | null>(null)
  const [proxy, setProxy] = usePersistedState('ltskit.download.sharedProxy', loadSharedProxy())
  const [proxyBusy, setProxyBusy] = useState(false)
  const [proxyMsg, setProxyMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [ytVer, setYtVer] = useState<string | null>(null)
  const [toolBusy, setToolBusy] = useState(false)
  const [toolMsg, setToolMsg] = useState<string | null>(null)

  const refreshProfiles = (): void => { void window.api.cookieProfiles().then(setProfiles) }

  useEffect(() => {
    void window.api.geminiKeys().then(setKeys)
    void window.api.geminiModels().then(setPool)
    refreshProfiles()
    void window.api.ytdlpVersion().then(setYtVer)
  }, [])

  const isDouyin = (url: string): boolean => {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') === 'douyin.com' } catch { return false }
  }
  const openLogin = async (url = loginUrl): Promise<void> => {
    setCookieBusy(true); setCookieMsg(null)
    const douyin = isDouyin(url)
    const off = douyin
      ? window.api.onDyCookieEvent((event) => setCookieMsg(event.message))
      : window.api.onCookieCaptureEvent((event) => setCookieMsg(event.message))
    const result = douyin ? await window.api.dyCookieCapture() : await window.api.cookieCapture(url)
    off(); setCookieBusy(false)
    setCookieMsg(result.ok ? `Đã lưu ${result.count} cookie.` : `Lỗi: ${result.error ?? ''}`)
    refreshProfiles()
  }
  const clearProfile = async (id: string): Promise<void> => { await window.api.cookieClearProfile(id); refreshProfiles() }
  const testProxyNow = async (): Promise<void> => {
    setProxyBusy(true); setProxyMsg(null)
    setProxyMsg(await window.api.testProxy(proxy)); setProxyBusy(false)
  }
  const updateTool = async (): Promise<void> => {
    setToolBusy(true); setToolMsg(null)
    const result = await window.api.ytdlpUpdate(); setToolMsg(result.message); setToolBusy(false)
    void window.api.ytdlpVersion().then(setYtVer)
  }

  const refreshKeys = async (): Promise<void> => setKeys(await window.api.geminiKeys())

  const kiemKeyMoi = async (): Promise<void> => {
    if (!draftKey.trim()) return
    setDangKiem(true); setKq(null)
    try {
      const result = await window.api.geminiCheckNewKey(draftKey.trim())
      setKq(result)
      if (result.ok) { setDraftKey(''); setAddingKey(false); await refreshKeys() }
    } finally { setDangKiem(false) }
  }

  const kiemKeyCu = async (id: string): Promise<void> => {
    setCheckingId(id); setKq(null)
    try {
      const result = await window.api.geminiCheckStoredKey(id)
      if (result.key) setRevealed((prev) => ({ ...prev, [id]: result.key }))
      setKq(result)
    } finally {
      setRevealed((prev) => { const next = { ...prev }; delete next[id]; return next })
      setCheckingId(null)
    }
  }

  const xoa = async (id: string): Promise<void> => {
    await window.api.geminiRemoveKey(id)
    await refreshKeys()
    setKq(null)
  }

  const discover = async (): Promise<void> => {
    setLoadingModels(true)
    setModelError(null)
    const result = await window.api.geminiDiscoverModels()
    setLoadingModels(false)
    if (!result.ok) {
      setModelError(result.error)
      return
    }
    setAvailableModels(result.models)
  }

  const savePool = async (next: string[]): Promise<void> => {
    try {
      await window.api.geminiSaveModels(next)
      setPool(next)
      setModelError(null)
    } catch {
      setModelError('Không lưu được danh sách model.')
    }
  }

  const addModel = (model: string): void => {
    if (!pool.includes(model)) void savePool([...pool, model])
  }

  const removeModel = (model: string): void => {
    void savePool(pool.filter((item) => item !== model))
  }

  const moveModel = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= pool.length) return
    const next = [...pool]
    ;[next[index], next[target]] = [next[target], next[index]]
    void savePool(next)
  }

  return (
    <div className="settings-page">
      <div className="settings-tabs-wrapper">
        <div className="settings-tabs" role="tablist" aria-label="Nhóm cài đặt">
          {SETTINGS_TABS.map((item) => (
            <button
              key={item.key}
              className={`settings-tab ${tab === item.key ? 'active' : ''}`}
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
            >
              <span className="settings-tab-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-pane" key={tab}>
      {tab === 'account' && <>
        <div className="card settings-card">
        <div className="cookie-title">Cookie đăng nhập</div>
        <div className="muted small">Nhập trang cần đăng nhập. Douyin được tự nhận diện; đăng nhập xong hãy đóng cửa sổ.</div>
        <div className="gk-row">
          <input value={loginUrl} onChange={(event) => setLoginUrl(event.target.value)} placeholder="https://youtube.com hoặc https://douyin.com" disabled={cookieBusy} />
          <button className="btn primary" onClick={() => openLogin()} disabled={cookieBusy || !loginUrl.trim()}>{cookieBusy ? 'Đang xử lý…' : 'Mở đăng nhập'}</button>
        </div>
        <div className="cookie-profile-list">
          {profiles.length === 0 ? <div className="muted small">Chưa có cookie đăng nhập.</div> : profiles.map((profile) => <div className="cookie-profile" key={profile.id}>
            <span><b>{profile.label}</b> <span className="muted small">· {profile.count} cookie</span></span>
            <div className="model-actions">{profile.loginUrl && <button className="btn" onClick={() => openLogin(profile.loginUrl)} disabled={cookieBusy}>Đăng nhập lại</button>}<button className="btn" onClick={() => clearProfile(profile.id)} disabled={cookieBusy}>Xóa</button></div>
          </div>)}
        </div>
        {cookieMsg && <div className="cookie-msg small">{cookieMsg}</div>}
        </div>
      </>}

      {tab === 'connection' && <>
        <div className="card settings-card">
        <div className="cookie-title">Proxy dùng chung</div>
        <div className="muted small">Dùng cho cả tải web và Douyin khi bạn bật “Dùng proxy” ở trang Tải xuống.</div>
        <div className="gk-row"><input value={proxy} onChange={(event) => { setProxy(event.target.value); setProxyMsg(null) }} placeholder="socks5://127.0.0.1:1080" spellCheck={false} /><button className="btn" onClick={testProxyNow} disabled={proxyBusy || !proxy.trim()}>{proxyBusy ? 'Đang kiểm tra…' : 'Kiểm tra proxy'}</button></div>
        {proxyMsg && <div className={`gk-kq small ${proxyMsg.ok ? 'ok' : 'err'}`}>{proxyMsg.ok ? '✔' : '✗'} {proxyMsg.message}</div>}
        </div>
      </>}

      {tab === 'aiTools' && <>
        <div className="card settings-card">
        <div className="cookie-head">
          <div>
            <div className="cookie-title">Gemini API key</div>
            <div className="muted small">Dùng để dịch phụ đề bằng AI. Khoá chỉ được lưu trên máy bạn.</div>
          </div>
          <span className={`gk-badge ${daLuu ? 'ok' : ''}`}>{daLuu ? 'Đã có khoá' : 'Chưa cấu hình'}</span>
        </div>

         <div className="gemini-key-list">
           {keys.length === 0 && !addingKey && <div className="muted small">Chưa có API key.</div>}
           {keys.map((item, index) => <div className="gemini-key-row" key={item.id}>
             <span className="gemini-key-value"><b>{index + 1}.</b> {revealed[item.id] ?? GEMINI_KEY_MASK}</span>
             <div className="model-actions">
               <button className="btn" disabled={checkingId !== null} onClick={() => kiemKeyCu(item.id)}>{checkingId === item.id ? 'Đang kiểm…' : 'Kiểm tra key'}</button>
               <button className="btn" disabled={checkingId !== null} onClick={() => xoa(item.id)}>Xóa</button>
             </div>
           </div>)}
           {addingKey && <div className="gemini-key-add gk-row">
             <input type="password" placeholder="Dán API key mới" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} spellCheck={false} />
             <button className="btn primary" disabled={dangKiem || !draftKey.trim()} onClick={kiemKeyMoi}>{dangKiem ? 'Đang kiểm…' : 'Kiểm tra key'}</button>
             <button className="btn" disabled={dangKiem} onClick={() => { setAddingKey(false); setDraftKey('') }}>Hủy</button>
           </div>}
           {!addingKey && <button className="btn gemini-key-add-button" aria-label="Thêm Gemini API key" onClick={() => setAddingKey(true)}>+ Thêm key</button>}
         </div>

        {kq && <div className={`gk-kq small ${kq.ok ? 'ok' : 'err'}`}>{kq.ok ? '✔' : '✗'} {kq.message}</div>}

        <div className="muted small gk-note">Việc dùng 1 API key quá nhiều lần trong ngày sẽ giảm chất lượng dịch.</div>
        <button className="btn settings-help" onClick={() => setHienHd(true)}>📖 Hướng dẫn lấy key</button>
        </div>

        <div className="card settings-card">
        <div>
          <div className="cookie-title">Model dịch Gemini</div>
          <div className="muted small">Chỉ các model trong pool này mới được dùng để dịch. Thứ tự quyết định lượt xoay ban đầu.</div>
        </div>
        <button className="btn" disabled={!daLuu || loadingModels} onClick={discover}>
          {loadingModels ? 'Đang lấy model…' : 'Lấy model từ Gemini'}
        </button>
        {modelError && <div className="gk-kq err small">✗ {modelError}</div>}

        {availableModels.length > 0 && (
          <div>
            <div className="muted small">Model tìm thấy</div>
            <div className="model-list">
              {availableModels.filter((model) => !pool.includes(model)).map((model) => (
                <div className="model-row" key={model}>
                  <code className="model-name">{model}</code>
                  <button className="btn" onClick={() => addModel(model)}>Thêm</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="muted small">Pool dịch ({pool.length})</div>
          {pool.length === 0 ? (
            <div className="muted small">Chưa chọn model nào.</div>
          ) : (
            <div className="model-list">
              {pool.map((model, index) => (
                <div className="model-row" key={model}>
                  <code className="model-name">{index + 1}. {model}</code>
                  <div className="model-actions">
                    <button className="btn" title="Đưa lên" disabled={index === 0} onClick={() => moveModel(index, -1)}>↑</button>
                    <button className="btn" title="Đưa xuống" disabled={index === pool.length - 1} onClick={() => moveModel(index, 1)}>↓</button>
                    <button className="btn" onClick={() => removeModel(model)}>Xóa</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
        <div className="card settings-card"><div className="cookie-title">yt-dlp</div><div className="muted small">Phiên bản: <b>{ytVer || '…'}</b> · tự cập nhật hằng ngày</div><div className="cookie-actions"><button className="btn" onClick={updateTool} disabled={toolBusy}>{toolBusy ? 'Đang cập nhật…' : '⟳ Cập nhật công cụ'}</button></div>{toolMsg && <div className="muted small">{toolMsg}</div>}</div>
      </>}

      {tab === 'about' && (
        <div className="settings-about">
          <div className="settings-about-identity">
            <span className="settings-about-mark">
              <svg viewBox="0 0 1024 1024" role="img" aria-label="LTSKit Horizon Ring">
                <defs>
                  <radialGradient id="settings-about-ring" cx="30%" cy="25%" r="95%">
                    <stop offset="0%" stopColor="#60a5fa" />
                    <stop offset="45%" stopColor="#2563eb" />
                    <stop offset="100%" stopColor="#0f766e" />
                  </radialGradient>
                </defs>
                <rect width="1024" height="1024" rx="296" fill="url(#settings-about-ring)" />
                <g fill="none" stroke="#fff" strokeWidth="57" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="512" cy="512" r="295" />
                  <path d="M223 574h578M346 574c34-113 108-176 166-176s132 63 166 176M352 687h320" />
                </g>
                <circle cx="512" cy="307" r="40" fill="#fff" />
              </svg>
            </span>
            <div><h2>LTSKit</h2><p>Công cụ tải, xử lý và dịch nội dung đa nền tảng.</p></div>
          </div>
          <div className="settings-about-grid">
            <button className="settings-about-card" onClick={() => window.api.openExternal(AUTHOR_URL)}>
              <span className="settings-about-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg></span>
              <span className="settings-about-copy"><b>Tác giả</b><small>dinhtienn</small></span><span className="settings-about-arrow">-&gt;</span>
            </button>
            <button className="settings-about-card" onClick={() => window.api.openExternal(REPO_URL)}>
              <span className="settings-about-icon"><svg viewBox="0 0 24 24" aria-hidden="true" data-icon="github-octocat" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.05-.01-1.91-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.35 9.35 0 0 1 12 6.2c.85 0 1.71.12 2.51.35 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.92.68 1.85 0 1.34-.01 2.42-.01 2.75 0 .27.18.59.69.49A10.25 10.25 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" /></svg></span>
              <span className="settings-about-copy"><b>GitHub</b><small>Mã nguồn LTSKit</small></span><span className="settings-about-arrow">-&gt;</span>
            </button>
            <button className="settings-about-card" onClick={() => window.api.openExternal(FEEDBACK_URL)}>
              <span className="settings-about-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.4 9.4 0 0 1-4-.9L3 21l1.8-4.2A8.3 8.3 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z" /></svg></span>
              <span className="settings-about-copy"><b>Phản hồi</b><small>Báo lỗi hoặc góp ý</small></span><span className="settings-about-arrow">-&gt;</span>
            </button>
          </div>
        </div>
      )}
      </div>

      {hienHd && <GeminiHelp onClose={() => setHienHd(false)} />}
    </div>
  )
}

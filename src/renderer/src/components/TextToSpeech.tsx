import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type {
  CapcutEngineStatus,
  CapcutInstallProgress,
  TtsProvider,
  VieneuInstallProgress,
  VieneuVoice
} from '../../../shared/types'
import { usePersistedState } from '../lib/persist'

const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

export default function TextToSpeech({
  outputDir,
  setOutputDir
}: {
  outputDir: string
  setOutputDir: (d: string) => void
}): JSX.Element {
  const [provider, setProvider] = usePersistedState<TtsProvider>('ltskit.tts.provider', 'vieneu')
  const [hasEngine, setHasEngine] = useState<boolean | null>(null)
  const [capcutStatus, setCapcutStatus] = useState<CapcutEngineStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installProgress, setInstallProgress] = useState<VieneuInstallProgress | null>(null)
  const [installErr, setInstallErr] = useState<string | null>(null)
  const [capcutInstalling, setCapcutInstalling] = useState(false)
  const [capcutInstallProgress, setCapcutInstallProgress] = useState<CapcutInstallProgress | null>(
    null
  )
  const [capcutInstallErr, setCapcutInstallErr] = useState<string | null>(null)

  const [voices, setVoices] = useState<VieneuVoice[]>([])
  const [voiceIdVieneu, setVoiceIdVieneu] = usePersistedState('ltskit.tts.voice', 'Phạm Tuyên')
  const [voiceIdCapcut, setVoiceIdCapcut] = usePersistedState(
    'ltskit.tts.voice.capcut',
    'BV421_vivn_streaming'
  )
  const voiceId = provider === 'capcut' ? voiceIdCapcut : voiceIdVieneu
  const setVoiceId = provider === 'capcut' ? setVoiceIdCapcut : setVoiceIdVieneu
  const [speed, setSpeed] = usePersistedState('ltskit.tts.speed', 1)
  const [capcutProfiles, setCapcutProfiles] = usePersistedState('ltskit.tts.capcutProfiles', 1)
  const [srtPath, setSrtPath] = useState('')
  const [running, setRunning] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)
  const [statusLine, setStatusLine] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewErr, setPreviewErr] = useState<string | null>(null)

  const [draftPath, setDraftPath] = useState<string | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloneBusy, setCloneBusy] = useState(false)
  const [draftPreviewBusy, setDraftPreviewBusy] = useState(false)
  const [cloneMsg, setCloneMsg] = useState<string | null>(null)
  const [cloneErr, setCloneErr] = useState<string | null>(null)

  const refreshEngine = useCallback(async (): Promise<void> => {
    if (provider === 'capcut') {
      const status = await window.api.capcutEngineStatus()
      setCapcutStatus(status)
      setHasEngine(status.has)
      return
    }
    setCapcutStatus(null)
    const status = await window.api.vieneuEngineStatus()
    setHasEngine(status.has)
  }, [provider])

  const refreshVoices = useCallback(async (): Promise<void> => {
    const list =
      provider === 'capcut'
        ? await window.api.capcutListVoices()
        : await window.api.vieneuListVoices()
    setVoices(list)
    if (list.length && !list.some((x) => x.id === voiceId)) setVoiceId(list[0].id)
  }, [provider, voiceId, setVoiceId])

  useEffect(() => {
    setHasEngine(null)
    void refreshEngine()
    void refreshVoices()
  }, [refreshEngine, refreshVoices])

  useEffect(() => {
    const onProgress = (p: {
      id: string
      percent: number
      line: string | null
      status: string
    }): void => {
      if (jobId && p.id !== jobId) return
      if (p.percent >= 0) setPercent(p.percent)
      if (p.line) setStatusLine(p.line)
      if (p.status === 'error' && p.line) setError(p.line)
    }
    const off =
      provider === 'capcut'
        ? window.api.onCapcutProgress(onProgress)
        : window.api.onVieneuProgress(onProgress)
    return off
  }, [jobId, provider])

  const installEngine = async (): Promise<void> => {
    setInstalling(true)
    setInstallErr(null)
    setInstallProgress(null)
    const off = window.api.onVieneuInstallProgress(setInstallProgress)
    const res = await window.api.vieneuInstallEngine()
    off()
    setInstalling(false)
    if (res.ok) {
      setHasEngine(true)
      await refreshVoices()
    } else setInstallErr(res.error ?? 'Tải công cụ Text→Giọng thất bại.')
  }

  const installCapcut = async (): Promise<void> => {
    setCapcutInstalling(true)
    setCapcutInstallErr(null)
    setCapcutInstallProgress(null)
    const off = window.api.onCapcutInstallProgress(setCapcutInstallProgress)
    const res = await window.api.capcutInstallEngine()
    off()
    setCapcutInstalling(false)
    if (res.ok) {
      await refreshEngine()
      await refreshVoices()
    } else setCapcutInstallErr(res.error ?? 'Tải công cụ CapCut thất bại.')
  }

  const chooseSrtFile = async (): Promise<void> => {
    const p = await window.api.chooseSrt()
    if (p) {
      setSrtPath(p)
      setOutput(null)
      setError(null)
    }
  }

  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setOutputDir(dir)
  }

  const pickDraftSample = async (): Promise<void> => {
    setCloneErr(null)
    setCloneMsg(null)
    const audio = await window.api.chooseAudio()
    if (!audio) return
    setDraftPath(audio)
    if (!cloneName.trim()) setCloneName(baseName(audio).replace(/\.[^.]+$/, ''))
  }

  const previewDraft = async (): Promise<void> => {
    if (!draftPath) {
      setCloneErr('Chọn file mẫu trước.')
      return
    }
    setDraftPreviewBusy(true)
    setCloneErr(null)
    setCloneMsg(null)
    try {
      const res = await window.api.vieneuPreviewDraft(draftPath, speed)
      if (res.ok && res.path) {
        setCloneMsg('Đã tạo bản nghe thử — kiểm tra file vừa mở.')
        await window.api.openPath(res.path)
      } else setCloneErr(res.error ?? 'Nghe thử thất bại.')
    } finally {
      setDraftPreviewBusy(false)
    }
  }

  const saveDraft = async (): Promise<void> => {
    if (!draftPath) {
      setCloneErr('Chọn file mẫu trước.')
      return
    }
    const name = cloneName.trim()
    if (!name) {
      setCloneErr('Nhập tên giọng để lưu vào danh sách bên trái.')
      return
    }
    setCloneBusy(true)
    setCloneErr(null)
    setCloneMsg(null)
    const res = await window.api.vieneuAddVoice(name, draftPath)
    setCloneBusy(false)
    if (res.ok && res.voice) {
      setCloneMsg(`Đã lưu “${name}” — chọn ở khung SRT → MP3.`)
      setDraftPath(null)
      setCloneName('')
      await refreshVoices()
      setVoiceId(res.voice.id)
    } else setCloneErr(res.error ?? 'Lưu giọng thất bại.')
  }

  const removeClone = async (id: string): Promise<void> => {
    const res = await window.api.vieneuRemoveVoice(id)
    if (res.ok) {
      await refreshVoices()
      if (voiceId === id) setVoiceId('Phạm Tuyên')
    } else setError(res.error ?? 'Xóa giọng thất bại.')
  }

  const previewSaved = async (): Promise<void> => {
    setPreviewBusy(true)
    setPreviewErr(null)
    try {
      const res =
        provider === 'capcut'
          ? await window.api.capcutPreview(voiceId, speed)
          : await window.api.vieneuPreview(voiceId, speed)
      if (res.ok && res.path) await window.api.openPath(res.path)
      else setPreviewErr(res.error ?? 'Nghe thử thất bại.')
    } finally {
      setPreviewBusy(false)
    }
  }

  const start = async (): Promise<void> => {
    if (!srtPath || !outputDir || running || !hasEngine) return
    const id = crypto.randomUUID()
    setJobId(id)
    setRunning(true)
    setPercent(0)
    setStatusLine('Đang chuẩn bị…')
    setError(null)
    setOutput(null)
    const req = { srt: srtPath, outputDir, voiceId, speed }
    const res =
      provider === 'capcut'
        ? await window.api.capcutSrtToMp3(id, { ...req, profileCount: capcutProfiles })
        : await window.api.vieneuSrtToMp3(id, req)
    setRunning(false)
    setJobId(null)
    if (res.ok && res.output) {
      setOutput(res.output)
      setPercent(100)
      setStatusLine('Xong')
    } else setError(res.error ?? 'Tạo MP3 thất bại.')
  }

  const cancel = async (): Promise<void> => {
    if (!jobId) return
    if (provider === 'capcut') await window.api.capcutCancel(jobId)
    else await window.api.vieneuCancel(jobId)
  }

  if (hasEngine === null) {
    return (
      <div className="lam-viec">
        <div className="muted">Đang kiểm tra công cụ…</div>
      </div>
    )
  }

  if (!hasEngine && provider === 'vieneu') {
    return (
      <div className="lam-viec">
        <div className="card dy-install-card">
          <div className="dy-install-title">Cần tải VieNeu-TTS v3 Turbo native</div>
          <p className="muted">
            Tải <b>VieNeu-TTS v3 native CPU</b> và model khoảng <b>1.43 GB</b> vào appdata. Không cần
            Python hoặc CUDA. Lần đầu cần mạng; sau đó chạy cục bộ.
          </p>
          <label className="field" style={{ display: 'block', marginBottom: 12 }}>
            <span>Nguồn giọng</span>
            <select
              className="mini-input"
              style={{ width: '100%', marginTop: 4 }}
              value={provider}
              onChange={(e) => setProvider(e.target.value as TtsProvider)}
            >
              <option value="vieneu">VieNeu (local)</option>
              <option value="capcut">CapCut (online)</option>
            </select>
          </label>
          {installing ? (
            <>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${installProgress?.percent ?? 0}%` }} />
              </div>
              <div className="muted small">
                {installProgress?.asset ?? 'Đang chuẩn bị…'} {installProgress?.percent ?? 0}%
              </div>
            </>
          ) : (
            <button className="btn primary" onClick={() => void installEngine()}>
              Tải công cụ Text→Giọng
            </button>
          )}
          {installErr && <div className="dy-err small">{installErr}</div>}
        </div>
      </div>
    )
  }

  if (!hasEngine && provider === 'capcut') {
    const showPythonLink =
      capcutStatus?.needsPython === true ||
      /python 3\.9/i.test(capcutStatus?.message ?? '')
    return (
      <div className="lam-viec">
        <div className="card dy-install-card">
          <div className="dy-install-title">Cần tải công cụ CapCut TTS</div>
          <p className="muted">
            Cài package vào <b>appdata</b> (venv, vài MB). Cần <b>Python 3.9+</b> đã cài trên máy
            một lần. Không cài vào Python global.
          </p>
          <label className="field" style={{ display: 'block', marginBottom: 12 }}>
            <span>Nguồn giọng</span>
            <select
              className="mini-input"
              style={{ width: '100%', marginTop: 4 }}
              value={provider}
              onChange={(e) => setProvider(e.target.value as TtsProvider)}
            >
              <option value="vieneu">VieNeu (local)</option>
              <option value="capcut">CapCut (online)</option>
            </select>
          </label>
          {capcutStatus?.message && (
            <div className="muted small" style={{ marginBottom: 10 }}>
              {capcutStatus.message}
            </div>
          )}
          {capcutInstalling ? (
            <>
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{ width: `${capcutInstallProgress?.percent ?? 0}%` }}
                />
              </div>
              <div className="muted small">
                {capcutInstallProgress?.line ?? 'Đang cài…'}{' '}
                {capcutInstallProgress?.percent ?? 0}%
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => void installCapcut()}>
                Tải công cụ CapCut
              </button>
              {showPythonLink && (
                <button
                  className="btn"
                  onClick={() => void window.api.openExternal('https://www.python.org/downloads/')}
                >
                  Mở trang tải Python
                </button>
              )}
              <button className="btn" onClick={() => void refreshEngine()}>
                Kiểm tra lại
              </button>
            </div>
          )}
          {capcutInstallErr && <div className="dy-err small">{capcutInstallErr}</div>}
        </div>
      </div>
    )
  }

  const presets = voices.filter((v) => v.kind === 'preset')
  const clones = provider === 'vieneu' ? voices.filter((v) => v.kind === 'clone') : []
  const canStart = !!srtPath && !!outputDir && !running

  return (
    <div className="lam-viec">
      <div className="cot-cauhinh">
        <div className="cot-tieude">SRT → MP3</div>
        <div className="card options-card">
          <label className="field" style={{ display: 'block', marginBottom: 12 }}>
            <span>Nguồn giọng</span>
            <select
              className="mini-input"
              style={{ width: '100%', marginTop: 4 }}
              value={provider}
              disabled={running}
              onChange={(e) => setProvider(e.target.value as TtsProvider)}
            >
              <option value="vieneu">VieNeu (local)</option>
              <option value="capcut">CapCut (online)</option>
            </select>
          </label>

          <div className="folder-row">
            <input
              className="folder-input"
              value={outputDir}
              readOnly
              title={outputDir}
              placeholder="Thư mục lưu MP3"
            />
            <button className="btn" onClick={() => void chooseFolder()}>
              Thư mục
            </button>
          </div>

          <div className="folder-row" style={{ marginTop: 12 }}>
            <input
              className="folder-input"
              value={srtPath ? baseName(srtPath) : ''}
              readOnly
              title={srtPath}
              placeholder="Chưa chọn file .srt"
            />
            <button className="btn" onClick={() => void chooseSrtFile()}>
              Chọn .srt
            </button>
          </div>

          <label className="field" style={{ marginTop: 12, display: 'block' }}>
            <span>Giọng đọc</span>
            <select
              className="mini-input"
              style={{ width: '100%', marginTop: 4 }}
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              disabled={running}
            >
              <optgroup label="Giọng sẵn">
                {presets.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </optgroup>
              {clones.length > 0 && (
                <optgroup label="Giọng đã clone">
                  {clones.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <label className="field" style={{ marginTop: 12, display: 'block' }}>
            <span>Tốc độ ({speed.toFixed(1)})</span>
            <input
              style={{ width: '100%', marginTop: 4 }}
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={speed}
              disabled={running}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </label>

          {provider === 'capcut' && (
            <label className="field" style={{ marginTop: 12, display: 'block' }}>
              <span>Số luồng CapCut</span>
              <input
                className="mini-input"
                style={{ width: '100%', marginTop: 4 }}
                type="number"
                min={1}
                max={20}
                step={1}
                value={capcutProfiles}
                disabled={running}
                onChange={(event) =>
                  setCapcutProfiles(
                    Math.max(1, Math.min(20, Math.trunc(Number(event.target.value) || 1))
                  )
                  )
                }
              />
              <span className="muted small">Tăng luồng có thể nhanh hơn nhưng dễ gặp busy hoặc SHARK.</span>
            </label>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn"
              disabled={previewBusy || running}
              onClick={() => void previewSaved()}
            >
              {previewBusy ? 'Đang tạo…' : 'Nghe thử giọng'}
            </button>
            {!running ? (
              <button className="btn primary" disabled={!canStart} onClick={() => void start()}>
                Tạo MP3
              </button>
            ) : (
              <button className="btn danger" onClick={() => void cancel()}>
                Hủy
              </button>
            )}
          </div>

          {previewErr && (
            <div className="dy-err small" style={{ marginTop: 8 }}>
              {previewErr}
            </div>
          )}
          {error && (
            <div className="dy-err small" style={{ marginTop: 8 }}>
              {error}
            </div>
          )}

          {running && (
            <div style={{ marginTop: 12 }}>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${Math.max(0, percent)}%` }} />
              </div>
              <div className="muted small" style={{ marginTop: 6 }}>
                {percent >= 0 ? `${percent}%` : '…'}
                {statusLine ? ` — ${statusLine}` : ''}
              </div>
            </div>
          )}

          {output && !running && (
            <div style={{ marginTop: 12 }}>
              <div className="muted small">Đã lưu:</div>
              <button className="link-btn" onClick={() => window.api.showItem(output)}>
                {baseName(output)}
              </button>
            </div>
          )}

          {provider === 'vieneu' && clones.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="muted small" style={{ marginBottom: 6 }}>
                Giọng clone đã lưu:
              </div>
              {clones.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 4
                  }}
                >
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => setVoiceId(c.id)}
                    style={{ textAlign: 'left' }}
                  >
                    {voiceId === c.id ? '✓ ' : ''}
                    {c.label}
                  </button>
                  <button
                    className="link-btn"
                    type="button"
                    disabled={running}
                    onClick={() => void removeClone(c.id)}
                  >
                    Xóa
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {provider === 'vieneu' && (
        <div className="cot-ketqua">
          <div className="cot-tieude">Clone giọng</div>
          <div className="card options-card">
            <p className="muted small" style={{ marginTop: 0 }}>
              1) Chọn file mẫu (3–10s) → 2) <b>Nghe thử</b> → 3) Ổn thì đặt tên và{' '}
              <b>Lưu vào danh sách</b> (dùng ở khung SRT → MP3).
            </p>

            <div className="folder-row">
              <input
                className="folder-input"
                value={draftPath ? baseName(draftPath) : ''}
                readOnly
                title={draftPath ?? ''}
                placeholder="Chưa chọn file mẫu"
              />
              <button className="btn" disabled={running} onClick={() => void pickDraftSample()}>
                Chọn mẫu…
              </button>
            </div>

            <label className="field" style={{ marginTop: 12, display: 'block' }}>
              <span>Tên giọng (khi lưu)</span>
              <input
                className="mini-input"
                style={{ width: '100%', marginTop: 4 }}
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                placeholder="vd: Giọng A"
                disabled={running || cloneBusy}
              />
            </label>

            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn"
                disabled={!draftPath || draftPreviewBusy || running}
                onClick={() => void previewDraft()}
              >
                {draftPreviewBusy ? 'Đang tạo…' : 'Nghe thử (chưa lưu)'}
              </button>
              <button
                className="btn primary"
                disabled={!draftPath || cloneBusy || running}
                onClick={() => void saveDraft()}
              >
                {cloneBusy ? 'Đang lưu…' : 'Lưu vào danh sách'}
              </button>
            </div>

            {cloneMsg && (
              <div className="muted small" style={{ marginTop: 10, color: 'var(--ok, #7dcea0)' }}>
                {cloneMsg}
              </div>
            )}
            {cloneErr && (
              <div className="dy-err small" style={{ marginTop: 8 }}>
                {cloneErr}
              </div>
            )}

            <p className="muted small" style={{ marginTop: 20 }}>
              Clip nên có một người nói rõ, ít ồn, dài khoảng 8–20 giây. VieNeu native chạy CPU.
            </p>
          </div>
        </div>
      )}

      {provider === 'capcut' && (
        <div className="cot-ketqua">
          <div className="cot-tieude">CapCut</div>
          <div className="card options-card">
            <p className="muted small" style={{ marginTop: 0 }}>
              Giọng CapCut online (API không chính thức). Cần mạng. Device identity tự random và đổi
              khi bị SHARK block.
            </p>
            {capcutStatus?.message && <p className="muted small">{capcutStatus.message}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

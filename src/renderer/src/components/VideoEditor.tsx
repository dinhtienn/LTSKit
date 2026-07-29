import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { CoChu, MediaProbe, VideoRect } from '../../../shared/types'
import { usePersistedState } from '../lib/persist'
import { hasFeature } from '../lib/license'
import { mediaUrl } from '../lib/mediaUrl'
import { voicePreviewDecision } from '../lib/voicePreviewSync'
import LogoBox from './LogoBox'
import RegionBox from './RegionBox'
import VideoStage from './VideoStage'

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path

export default function VideoEditor({
  outputDir,
  setOutputDir
}: {
  outputDir: string
  setOutputDir: (directory: string) => void
}): JSX.Element {
  const [video, setVideo] = useState<string | null>(null)
  const [media, setMedia] = useState<MediaProbe | null>(null)
  const [videoSeconds, setVideoSeconds] = useState(0)
  const [srtSeconds, setSrtSeconds] = useState(0)
  const [srtNgoai, setSrtNgoai] = useState('')
  const [subtitleEnabled, setSubtitleEnabled] = useState(false)
  const [blurEnabled, setBlurEnabled] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [voice, setVoice] = useState('')
  const [videoVolume, setVideoVolume] = useState(100)
  const [voiceVolume, setVoiceVolume] = useState(100)
  const [logoEnabled, setLogoEnabled] = useState(false)
  const [logo, setLogo] = useState('')
  const [logoAspect, setLogoAspect] = useState(1)
  const [region, setRegion] = useState<VideoRect>({ x0: 0, x1: 0, y0: 0, y1: 0 })
  const [logoRect, setLogoRect] = useState<VideoRect>({ x0: 0, x1: 0, y0: 0, y1: 0 })
  const [activeOverlay, setActiveOverlay] = useState<'region' | 'logo'>('region')
  const [coChu, setCoChu] = usePersistedState('ltskit.ocr.cochu', 'auto')
  const [ghepMode, setGhepMode] = useState<'burn' | 'soft'>('burn')
  const [ghep, setGhep] = useState<'idle' | 'chay' | 'xong' | 'loi'>('idle')
  const [ghepPct, setGhepPct] = useState(0)
  const [ghepOut, setGhepOut] = useState('')
  const [ghepLoi, setGhepLoi] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const videoRequestRef = useRef(0)
  const logoRequestRef = useRef(0)
  const voiceRequestRef = useRef(0)
  const voiceSyncRef = useRef(0)
  const unlocked = hasFeature('ocr')

  useEffect(() => {
    if (!media) return
    setRegion({ x0: 0, x1: media.width, y0: Math.round(media.height * 0.75), y1: media.height })
  }, [media])

  useEffect(() => {
    if (!srtNgoai) {
      setSrtSeconds(0)
      return
    }
    let cancelled = false
    void Promise.resolve()
      .then(() => window.api.srtGiay(srtNgoai))
      .then((seconds) => {
        if (!cancelled) setSrtSeconds(seconds || 0)
      })
      .catch(() => {
        if (!cancelled) setSrtSeconds(0)
      })
    return () => { cancelled = true }
  }, [srtNgoai])

  useEffect(() => {
    const videoEl = videoRef.current
    if (videoEl) videoEl.volume = Math.min(1, videoVolume / 100)
  }, [video, videoVolume])

  const syncVoice = async (shouldPlay: boolean, canStart = true): Promise<void> => {
    const sync = ++voiceSyncRef.current
    const videoEl = videoRef.current
    const voiceEl = audioRef.current
    if (!videoEl || !voiceEl || !voiceEnabled || !voice) {
      voiceEl?.pause()
      return
    }
    voiceEl.volume = Math.min(1, voiceVolume / 100)
    voiceEl.playbackRate = videoEl.playbackRate
    const decision = voicePreviewDecision({
      shouldPlay, canStart, videoTime: videoEl.currentTime, voiceTime: voiceEl.currentTime,
      voiceDuration: voiceEl.duration, voicePaused: voiceEl.paused
    })
    if (decision.seekTo != null) voiceEl.currentTime = decision.seekTo
    if (decision.action === 'play') {
      await voiceEl.play().catch(() => undefined)
      if (sync !== voiceSyncRef.current || videoEl.paused || videoEl.ended) voiceEl.pause()
    } else if (decision.action === 'pause') voiceEl.pause()
  }

  useEffect(() => {
    if (!voiceEnabled || !voice) {
      voiceSyncRef.current += 1
      audioRef.current?.pause()
    } else void syncVoice(!(videoRef.current?.paused ?? true))
  }, [voiceEnabled, voice, voiceVolume])

  const chooseVideo = async (): Promise<void> => {
    const paths = await window.api.chooseFiles()
    if (!paths.length) return
    const selected = paths[0]
    const request = ++videoRequestRef.current
    logoRequestRef.current += 1
    voiceRequestRef.current += 1
    voiceSyncRef.current += 1
    audioRef.current?.pause()
    setVideo(selected)
    setMedia(null)
    setVideoSeconds(0)
    setSrtNgoai('')
    setSubtitleEnabled(false)
    setBlurEnabled(false)
    setVoiceEnabled(false)
    setVoice('')
    setVideoVolume(100)
    setVoiceVolume(100)
    setLogoEnabled(false)
    setLogo('')
    setLogoAspect(1)
    setLogoRect({ x0: 0, x1: 0, y0: 0, y1: 0 })
    setActiveOverlay('region')
    setGhep('idle')
    setGhepOut('')
    setGhepLoi(null)
    try {
      const probed = await window.api.burnProbe(selected)
      if (request !== videoRequestRef.current) return
      setMedia(probed)
      setVideoSeconds(probed.duration)
    } catch {
      if (request === videoRequestRef.current) setGhepLoi('Không đọc được thông tin video.')
    }
  }

  const chooseSrt = async (): Promise<void> => {
    const selected = await window.api.chooseSrt()
    if (!selected) return
    setSrtNgoai(selected)
    setGhep('idle')
    setGhepOut('')
    setGhepLoi(null)
  }

  const chooseVoice = async (): Promise<void> => {
    const request = ++voiceRequestRef.current
    const selected = await window.api.chooseAudio()
    if (request !== voiceRequestRef.current || !selected) return
    setVoice(selected)
    setGhepLoi(null)
  }

  const chooseLogo = async (): Promise<void> => {
    const request = ++logoRequestRef.current
    const selected = await window.api.chooseImage()
    if (request !== logoRequestRef.current || !selected || !media) return
    try {
      const dimensions = await window.api.logoDimensions(selected)
      if (request !== logoRequestRef.current) return
      const aspect = dimensions.width / dimensions.height
      const maxHeight = media.height - Math.round(media.height * 0.08)
      const width = Math.min(Math.round(media.width * 0.2), Math.round(maxHeight * aspect))
      const height = Math.round(width / aspect)
      const right = Math.round(media.width * 0.04)
      const top = Math.round(media.height * 0.04)
      setLogo(selected)
      setLogoAspect(aspect)
      setLogoRect({ x0: media.width - right - width, x1: media.width - right, y0: top, y1: top + height })
      setLogoEnabled(true)
      setActiveOverlay('logo')
      setGhepLoi(null)
    } catch (error) {
      if (request !== logoRequestRef.current) return
      setLogoEnabled(false)
      setLogo('')
      setGhepLoi(error instanceof Error ? error.message : 'Không đọc được kích thước ảnh logo.')
    }
  }

  const subtitleMismatch = videoSeconds > 0 && srtSeconds > 0
    ? srtSeconds > videoSeconds + 30 ? 'dai' : srtSeconds < videoSeconds * 0.5 ? 'ngan' : null
    : null
  const hasOperation = subtitleEnabled || blurEnabled || voiceEnabled || logoEnabled || videoVolume !== 100
  const canExport = hasOperation && (!subtitleEnabled || !!srtNgoai) && (!voiceEnabled || !!voice) && (!logoEnabled || !!logo)
  const minutes = (seconds: number): string => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`

  const exportVideo = async (): Promise<void> => {
    if (!video || !outputDir || !canExport) return
    setGhep('chay')
    setGhepPct(0)
    setGhepLoi(null)
    let off = (): void => undefined
    try {
      off = window.api.onBurnProgress((progress) => setGhepPct(progress.percent < 0 ? 0 : progress.percent))
      const result = await window.api.burnStart({
        video, outputDir, srt: subtitleEnabled ? srtNgoai : null, mode: subtitleEnabled ? ghepMode : undefined,
        region: blurEnabled || (subtitleEnabled && ghepMode === 'burn') ? region : null,
        lamMo: blurEnabled, coChu: coChu as CoChu, catSrt: subtitleEnabled && subtitleMismatch === 'dai',
        voice: voiceEnabled ? voice : null, videoVolume, voiceVolume,
        logo: logoEnabled && logo ? { path: logo, rect: logoRect } : null
      })
      if (!result.ok) {
        if (result.error === 'Đã huỷ.') setGhep('idle')
        else { setGhepLoi(result.error ?? 'Xuất video thất bại.'); setGhep('loi') }
        return
      }
      setGhepOut(result.output!)
      setGhep('xong')
    } catch {
      setGhepLoi('Xuất video thất bại.')
      setGhep('loi')
    } finally {
      try { off() } catch { /* Export state is already finalized. */ }
    }
  }

  if (!unlocked) return <div className="card muted">Tính năng đang khoá.</div>

  return (
    <div className="lam-viec">
      <div className="cot-cauhinh">
        <div className="cot-tieude">Cấu hình</div>
        <div className="card options-card">
          <button className="btn primary" onClick={chooseVideo} disabled={ghep === 'chay'}>🎞 Chọn video</button>
          {video && <div className="muted small ocr-ten">{baseName(video)}</div>}
        </div>
        <div className="card options-card">
          <label className="field"><span className="muted small">Thư mục lưu kết quả</span><div className="gk-row">
            <input value={outputDir} readOnly />
            <button className="btn" onClick={async () => { const directory = await window.api.chooseFolder(); if (directory) setOutputDir(directory) }}>Chọn thư mục</button>
          </div></label>
        </div>
        {video && <div className="card options-card">
          <div className="cot-tieude">Xuất video</div>
          <div className="muted small">Chọn riêng từng thay đổi cần áp dụng rồi xuất tất cả trong một video.</div>
          <div className="composer-section"><b>Âm thanh gốc</b>
            <label className="volume-row"><span>Âm lượng video</span><input type="range" min="0" max="100" step="1" value={videoVolume} disabled={media?.hasAudio !== true} onChange={(event) => setVideoVolume(Number(event.target.value))} /><span className="volume-value">{videoVolume}%</span></label>
            {media?.hasAudio === false && <div className="muted small">Video không có âm thanh gốc.</div>}
          </div>
          <div className="composer-section"><label className="gk-check composer-head"><input type="checkbox" checked={subtitleEnabled} onChange={(event) => setSubtitleEnabled(event.target.checked)} /><b>Phụ đề</b></label>
            {subtitleEnabled && <><button className="btn" onClick={chooseSrt}>📄 Dùng file phụ đề (.srt) có sẵn</button>
              {!srtNgoai ? <div className="muted small">Chưa có phụ đề — chọn file phụ đề (.srt) có sẵn.</div> : <label className="field"><span className="muted small">Ghép phụ đề nào</span><select value={srtNgoai} onChange={(event) => setSrtNgoai(event.target.value)}><option value={srtNgoai}>Có sẵn — {baseName(srtNgoai)}</option></select></label>}
              {subtitleMismatch && <div className="qwarn small">⚠ File phụ đề dài <b>{minutes(srtSeconds)}</b>, video dài <b>{minutes(videoSeconds)}</b>{subtitleMismatch === 'dai' ? ' — phần phụ đề vượt quá thời lượng video sẽ không hiện.' : ' — phụ đề chỉ phủ được phần đầu video.'}{subtitleMismatch === 'dai' && ghepMode === 'soft' && <div className="muted small" style={{ marginTop: 4 }}>Nếu vẫn ghép, phần phụ đề thừa sẽ được <b>cắt bỏ</b> cho vừa video.</div>}</div>}
              <label className="field"><span className="muted small">Cách gắn phụ đề</span><select value={ghepMode} onChange={(event) => setGhepMode(event.target.value as 'burn' | 'soft')}><option value="burn">Gắn cố định vào hình (đăng lại đâu cũng còn)</option><option value="soft">Phụ đề rời, bật/tắt được (chỉ xem trên máy)</option></select></label>
              {ghepMode === 'burn' && <label className="field"><span className="muted small">Cỡ chữ</span><select value={coChu} onChange={(event) => setCoChu(event.target.value)}><option value="auto">Tự động (theo khung)</option><option value="nho">Nhỏ</option><option value="vua">Vừa</option><option value="lon">Lớn</option><option value="ratlon">Rất lớn</option></select></label>}
            </>}
          </div>
          <div className="composer-section"><label className="gk-check composer-head"><input type="checkbox" checked={blurEnabled} onChange={(event) => setBlurEnabled(event.target.checked)} /><b>Làm mờ</b></label>{blurEnabled && <div className="muted small overlay-help">Làm mờ vùng trong khung xanh. Khung này cũng chọn tâm phụ đề gắn cố định.</div>}</div>
          <div className="composer-section"><label className="gk-check composer-head"><input type="checkbox" checked={voiceEnabled} onChange={(event) => setVoiceEnabled(event.target.checked)} /><b>Voice</b></label>{voiceEnabled && <><button className="btn" onClick={chooseVoice}>🎙 Chọn file voice</button>{voice && <div className="muted small ocr-ten">{baseName(voice)}</div>}<label className="volume-row"><span>Âm lượng voice</span><input type="range" min="0" max="100" step="1" value={voiceVolume} onChange={(event) => setVoiceVolume(Number(event.target.value))} /><span className="volume-value">{voiceVolume}%</span></label></>}</div>
          <div className="composer-section"><label className="gk-check composer-head"><input type="checkbox" checked={logoEnabled} onChange={(event) => setLogoEnabled(event.target.checked)} /><b>Logo</b></label><button className="btn" onClick={chooseLogo} disabled={!media}>🖼 Chọn ảnh logo</button>{logo && <div className="muted small ocr-ten">{baseName(logo)}</div>}</div>
          <div className="cookie-actions">{ghep !== 'chay' ? <button className="btn primary" disabled={!canExport || !outputDir} onClick={exportVideo}>🎬 Xuất video</button> : <><button className="btn danger" onClick={() => window.api.burnCancel()}>■ Dừng</button><span className="cookie-status ok">Đang xuất... {ghepPct}%</span></>}</div>
          {ghep === 'chay' && <div className="bar" style={{ marginTop: 10, height: 8 }}><div className="bar-fill" style={{ width: `${ghepPct}%` }} /></div>}
          {ghepLoi && <div className="dy-err small">{ghepLoi}</div>}
          {ghep === 'xong' && <div className="muted small" style={{ marginTop: 8 }}>✅ Đã xuất · <button className="link-btn" onClick={() => window.api.showItem(ghepOut)}>{baseName(ghepOut)}</button></div>}
        </div>}
      </div>
      <div className="cot-ketqua cot-video"><div className="cot-tieude">Video &amp; vùng chữ</div>
        {video && media ? <><div className="muted small">Kéo hoặc dùng phím mũi tên để di chuyển; giữ Shift để đi nhanh hơn. Chọn lớp cần sửa bằng các nút bên dưới.</div>
          <div className="overlay-selector" role="group" aria-label="Chọn lớp phủ cần chỉnh sửa"><button type="button" className={`btn ${activeOverlay === 'region' ? 'active' : ''}`} aria-pressed={activeOverlay === 'region'} onClick={() => setActiveOverlay('region')}>Vùng chữ</button><button type="button" className={`btn ${activeOverlay === 'logo' ? 'active' : ''}`} aria-pressed={activeOverlay === 'logo'} disabled={!logoEnabled || !logo} onClick={() => setActiveOverlay('logo')}>Logo</button></div>
          <VideoStage path={video} media={media} videoRef={videoRef} videoProps={{ controls: true, onLoadedMetadata: () => { const element = videoRef.current; if (element) setVideoSeconds(Number.isFinite(element.duration) ? element.duration : 0) }, onError: () => setGhepLoi('Không mở được video này. Thử định dạng khác (mp4/webm).'), onPlay: () => void syncVoice(true), onPause: () => void syncVoice(false), onTimeUpdate: () => void syncVoice(!(videoRef.current?.paused ?? true), false), onWaiting: () => void syncVoice(false), onStalled: () => void syncVoice(false), onPlaying: () => void syncVoice(!(videoRef.current?.paused ?? true)), onCanPlay: () => void syncVoice(!(videoRef.current?.paused ??true)), onSeeking: () => void syncVoice(false), onSeeked: () => void syncVoice(!(videoRef.current?.paused ?? true)), onRateChange: () => void syncVoice(!(videoRef.current?.paused ?? true)), onEnded: () => void syncVoice(false) }}>{({ boxW, boxH }) => <><audio ref={audioRef} src={voice ? mediaUrl(voice) : undefined} preload="metadata" onLoadedMetadata={() => void syncVoice(!(videoRef.current?.paused ?? true))} /><RegionBox region={region} setRegion={setRegion} videoW={media.width} videoH={media.height} boxW={boxW} boxH={boxH} previewBlur={blurEnabled} active={activeOverlay === 'region'} onActivate={() => setActiveOverlay('region')} />{logoEnabled && logo && <LogoBox src={mediaUrl(logo)} rect={logoRect} setRect={setLogoRect} aspect={logoAspect} videoW={media.width} videoH={media.height} boxW={boxW} boxH={boxH} active={activeOverlay === 'logo'} onActivate={() => setActiveOverlay('logo')} />}</>}</VideoStage>
          <div className="muted small ocr-toado">Video {media.width}×{media.height} · X: {region.x0} → {region.x1} px | Y: {region.y0} → {region.y1} px</div>
        </> : <div className="ocr-sanh"><div className="muted small">Chưa chọn video — bấm “Chọn video” bên trái.</div></div>}
      </div>
    </div>
  )
}

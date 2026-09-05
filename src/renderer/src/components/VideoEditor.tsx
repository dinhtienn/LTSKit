import type { JSX } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BlurRegion, CoChu, ExportSpeed, MediaProbe, SubtitleStyle, TextOverlay, VideoRect } from '../../../shared/types'
import { duckGainAt, mergeDuckWindows } from '../../../shared/duckingEnvelope'
import { subtitleFontSize } from '../../../shared/subtitleLayout'
import { usePersistedState } from '../lib/persist'
import { hasFeature } from '../lib/license'
import { mediaUrl } from '../lib/mediaUrl'
import { activeSubtitleText, parseSubtitlePreview, type SubtitlePreviewCue } from '../lib/subtitlePreview'
import { createTextOverlay, textOverlayVisible, updateTextOverlay } from '../lib/textOverlay'
import { voicePreviewDecision } from '../lib/voicePreviewSync'
import LogoBox from './LogoBox'
import RegionBox from './RegionBox'
import TextOverlayBox from './TextOverlayBox'
import VideoStage from './VideoStage'

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path
const FONT_OPTIONS = [
  ['arial', 'Arial'],
  ['segoe', 'Segoe UI'],
  ['times', 'Times New Roman'],
  ['tahoma', 'Tahoma']
] as const
const FONT_FAMILIES: Record<string, string> = Object.fromEntries(FONT_OPTIONS)
type EditorPanel = 'audio' | 'subtitle' | 'text' | 'blur' | 'logo' | 'export'

function hexAlpha(hex: string, opacity: number): string {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw
  const red = parseInt(full.slice(0, 2), 16)
  const green = parseInt(full.slice(2, 4), 16)
  const blue = parseInt(full.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(100, opacity)) / 100})`
}

export default function VideoEditor({ outputDir, setOutputDir }: { outputDir: string; setOutputDir: (directory: string) => void }): JSX.Element {
  const [video, setVideo] = useState<string | null>(null)
  const [media, setMedia] = useState<MediaProbe | null>(null)
  const [videoSeconds, setVideoSeconds] = useState(0)
  const [srtSeconds, setSrtSeconds] = useState(0)
  const [subtitleCues, setSubtitleCues] = useState<SubtitlePreviewCue[]>([])
  const [srtNgoai, setSrtNgoai] = useState('')
  const [subtitleEnabled, setSubtitleEnabled] = useState(false)
  const [blurEnabled, setBlurEnabled] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [voice, setVoice] = useState('')
  const [videoVolume, setVideoVolume] = useState(100)
  const [voiceVolume, setVoiceVolume] = useState(100)
  const [duckingEnabled, setDuckingEnabled] = usePersistedState('ltskit.editor.ducking', false)
  const [duckPercent, setDuckPercent] = usePersistedState('ltskit.editor.duckPercent', 35)
  const [duckAttackMs, setDuckAttackMs] = usePersistedState('ltskit.editor.duckAttackMs', 150)
  const [duckReleaseMs, setDuckReleaseMs] = usePersistedState('ltskit.editor.duckReleaseMs', 400)
  const [logoEnabled, setLogoEnabled] = useState(false)
  const [logo, setLogo] = useState('')
  const [logoAspect, setLogoAspect] = useState(1)
  const [subRegion, setSubRegion] = useState<VideoRect>({
    x0: 0,
    x1: 0,
    y0: 0,
    y1: 0
  })
  const [blurRegions, setBlurRegions] = useState<BlurRegion[]>([])
  const [activeBlurId, setActiveBlurId] = useState<string | null>(null)
  const [textEnabled, setTextEnabled] = useState(false)
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([])
  const [activeTextId, setActiveTextId] = useState<string | null>(null)
  const [textFontId, setTextFontId] = usePersistedState('ltskit.editor.textFont', 'arial')
  const [currentTime, setCurrentTime] = useState(0)
  const [subtitleFontId, setSubtitleFontId] = usePersistedState('ltskit.editor.subtitleFont', 'arial')
  const [subtitleTextColor, setSubtitleTextColor] = usePersistedState('ltskit.editor.subtitleTextColor', '#ffffff')
  const [subtitleTextOpacity, setSubtitleTextOpacity] = usePersistedState('ltskit.editor.subtitleTextOpacity', 100)
  const [subtitleOutlineColor, setSubtitleOutlineColor] = usePersistedState('ltskit.editor.subtitleOutlineColor', '#000000')
  const [subtitleOutlinePx, setSubtitleOutlinePx] = usePersistedState('ltskit.editor.subtitleOutlinePx', 2)
  const [subtitleBgEnabled, setSubtitleBgEnabled] = usePersistedState('ltskit.editor.subtitleBgEnabled', false)
  const [subtitleBgColor, setSubtitleBgColor] = usePersistedState('ltskit.editor.subtitleBgColor', '#000000')
  const [subtitleBgOpacity, setSubtitleBgOpacity] = usePersistedState('ltskit.editor.subtitleBgOpacity', 60)
  const [logoRect, setLogoRect] = useState<VideoRect>({
    x0: 0,
    x1: 0,
    y0: 0,
    y1: 0
  })
  const [panel, setPanel] = useState<EditorPanel>('subtitle')
  const [showLayers, setShowLayers] = usePersistedState('ltskit.editor.showLayers', true)
  const [showInspector, setShowInspector] = usePersistedState('ltskit.editor.showInspector', true)
  const [coChu, setCoChu] = usePersistedState('ltskit.ocr.cochu', 'auto')
  const [ghepMode, setGhepMode] = useState<'burn' | 'soft'>('burn')
  const [exportSpeed, setExportSpeed] = usePersistedState('ltskit.editor.exportSpeed', 'balanced')
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
    setSubRegion({
      x0: Math.round(media.width * 0.1),
      x1: Math.round(media.width * 0.9),
      y0: Math.round(media.height * 0.78),
      y1: Math.round(media.height * 0.94)
    })
    const initial: BlurRegion = {
      id: crypto.randomUUID(),
      x0: 0,
      x1: media.width,
      y0: Math.round(media.height * 0.75),
      y1: media.height
    }
    setBlurRegions([initial])
    setActiveBlurId(initial.id)
  }, [media])

  useEffect(() => {
    if (!srtNgoai) {
      setSrtSeconds(0)
      setSubtitleCues([])
      return
    }
    let cancelled = false
    void Promise.all([window.api.srtGiay(srtNgoai), window.api.srtNoiDung(srtNgoai)])
      .then(([seconds, raw]) => {
        if (!cancelled) {
          setSrtSeconds(seconds || 0)
          setSubtitleCues(parseSubtitlePreview(raw))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSrtSeconds(0)
          setSubtitleCues([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [srtNgoai])

  // Preview phai nghe giong ban xuat: dung cung duong bao gain voi FFmpeg.
  const duckWindows = useMemo(
    () =>
      duckingEnabled && voiceEnabled && voice && subtitleCues.length > 0
        ? mergeDuckWindows(
            subtitleCues.map((cue) => ({ start: cue.startSec, end: cue.endSec })),
            duckAttackMs,
            duckReleaseMs
          )
        : [],
    [duckingEnabled, voiceEnabled, voice, subtitleCues, duckAttackMs, duckReleaseMs]
  )

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    const base = Math.min(1, videoVolume / 100)
    if (!duckWindows.length) {
      videoEl.volume = base
      return
    }
    const options = {
      baseVolume: videoVolume / 100,
      duckPercent,
      attackMs: duckAttackMs,
      releaseMs: duckReleaseMs
    }
    // `timeupdate` chi ban khoang 4 lan/giay nen ramp 150ms se nghe giat cap.
    // Bam theo khung hinh trong luc phat de duong bao muot nhu ban xuat.
    const apply = (): void => {
      videoEl.volume = duckGainAt(duckWindows, videoEl.currentTime, options)
    }
    apply()
    let frame = 0
    const tick = (): void => {
      apply()
      frame = requestAnimationFrame(tick)
    }
    if (!videoEl.paused) frame = requestAnimationFrame(tick)
    const start = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tick)
    }
    const stop = (): void => {
      cancelAnimationFrame(frame)
      apply()
    }
    videoEl.addEventListener('play', start)
    videoEl.addEventListener('pause', stop)
    videoEl.addEventListener('seeked', apply)
    return () => {
      cancelAnimationFrame(frame)
      videoEl.removeEventListener('play', start)
      videoEl.removeEventListener('pause', stop)
      videoEl.removeEventListener('seeked', apply)
      videoEl.volume = base
    }
  }, [video, videoVolume, duckWindows, duckPercent, duckAttackMs, duckReleaseMs])

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
      shouldPlay,
      canStart,
      videoTime: videoEl.currentTime,
      voiceTime: voiceEl.currentTime,
      voiceDuration: voiceEl.duration,
      voicePaused: voiceEl.paused
    })
    if (decision.seekTo != null) voiceEl.currentTime = decision.seekTo
    if (decision.action === 'play') {
      await voiceEl.play().catch(() => undefined)
      if (sync !== voiceSyncRef.current || videoEl.paused || videoEl.ended) voiceEl.pause()
    } else if (decision.action === 'pause') voiceEl.pause()
  }

  // Chi nap lai the audio khi doi file voice. Gop them voiceVolume vao day se
  // khien moi nac keo thanh am luong tua voice ve dau.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !voice) return
    audio.pause()
    audio.currentTime = 0
    audio.load()
  }, [voice])

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
    setBlurRegions([])
    setActiveBlurId(null)
    setTextEnabled(false)
    setTextOverlays([])
    setActiveTextId(null)
    setCurrentTime(0)
    setVoiceEnabled(false)
    setVoice('')
    setVideoVolume(100)
    setVoiceVolume(100)
    setLogoEnabled(false)
    setLogo('')
    setLogoAspect(1)
    setLogoRect({ x0: 0, x1: 0, y0: 0, y1: 0 })
    setPanel('subtitle')
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
    setVoiceEnabled(true)
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
      setLogoRect({
        x0: media.width - right - width,
        x1: media.width - right,
        y0: top,
        y1: top + height
      })
      setLogoEnabled(true)
      setPanel('logo')
      setGhepLoi(null)
    } catch (error) {
      if (request !== logoRequestRef.current) return
      setLogoEnabled(false)
      setLogo('')
      setGhepLoi(error instanceof Error ? error.message : 'Không đọc được kích thước ảnh logo.')
    }
  }

  const subtitleMismatch =
    videoSeconds > 0 && srtSeconds > 0 ? (srtSeconds > videoSeconds + 30 ? 'dai' : srtSeconds < videoSeconds * 0.5 ? 'ngan' : null) : null
  const activeText = textOverlays.find((item) => item.id === activeTextId) ?? null
  const subtitleStyle: SubtitleStyle = {
    fontId: subtitleFontId,
    textColor: subtitleTextColor,
    textOpacity: subtitleTextOpacity,
    outlineColor: subtitleOutlineColor,
    outlinePx: subtitleOutlinePx,
    bgEnabled: subtitleBgEnabled,
    bgColor: subtitleBgColor,
    bgOpacity: subtitleBgOpacity
  }
  const subtitlePreviewText = activeSubtitleText(subtitleCues, currentTime)
  const hasOperation = subtitleEnabled || blurEnabled || textEnabled || voiceEnabled || logoEnabled || videoVolume !== 100
  const canExport =
    hasOperation && (!subtitleEnabled || !!srtNgoai) && (!textEnabled || textOverlays.length > 0) && (!voiceEnabled || !!voice) && (!logoEnabled || !!logo)
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
        video,
        outputDir,
        srt: subtitleEnabled ? srtNgoai : null,
        mode: subtitleEnabled ? ghepMode : undefined,
        subRegion: subtitleEnabled && ghepMode === 'burn' ? subRegion : null,
        subtitleStyle,
        textFontId,
        textOverlays: textEnabled ? textOverlays : [],
        blurRegions: blurEnabled ? blurRegions : [],
        lamMo: blurEnabled,
        coChu: coChu as CoChu,
        catSrt: subtitleEnabled && subtitleMismatch === 'dai',
        voice: voiceEnabled ? voice : null,
        videoVolume,
        voiceVolume,
        ducking: {
          enabled: duckingEnabled && voiceEnabled && !!voice && !!srtNgoai,
          timingSrt: srtNgoai || null,
          duckPercent: duckPercent,
          attackMs: duckAttackMs,
          releaseMs: duckReleaseMs
        },
        logo: logoEnabled && logo ? { path: logo, rect: logoRect } : null,
        exportSpeed: exportSpeed as ExportSpeed
      })
      if (!result.ok) {
        if (result.error === 'Đã huỷ.') setGhep('idle')
        else {
          setGhepLoi(result.error ?? 'Xuất video thất bại.')
          setGhep('loi')
        }
        return
      }
      setGhepOut(result.output!)
      setGhep('xong')
    } catch {
      setGhepLoi('Xuất video thất bại.')
      setGhep('loi')
    } finally {
      try {
        off()
      } catch {
        /* Export state is already finalized. */
      }
    }
  }

  const addBlurRegion = (): void => {
    if (!media) return
    const id = crypto.randomUUID()
    setBlurRegions((current) => [
      ...current,
      {
        id,
        x0: Math.round(media.width * 0.1),
        x1: Math.round(media.width * 0.4),
        y0: Math.round(media.height * 0.1),
        y1: Math.round(media.height * 0.25)
      }
    ])
    setActiveBlurId(id)
  }

  const updateBlurRegion = (id: string, next: VideoRect): void => {
    setBlurRegions((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)))
  }

  const removeBlurRegion = (id: string): void => {
    setBlurRegions((current) => current.filter((item) => item.id !== id))
    setActiveBlurId((current) => (current === id ? null : current))
  }

  const addTextOverlay = (): void => {
    if (!media) return
    const id = crypto.randomUUID()
    setTextOverlays((current) => [...current, createTextOverlay(id, media.width, media.height)])
    setActiveTextId(id)
    setTextEnabled(true)
  }

  const patchActiveText = (patch: Partial<TextOverlay>): void => {
    if (!activeTextId) return
    setTextOverlays((current) => updateTextOverlay(current, activeTextId, patch))
  }

  const removeTextOverlay = (id: string): void => {
    setTextOverlays((current) => current.filter((item) => item.id !== id))
    setActiveTextId((current) => (current === id ? null : current))
  }

  if (!unlocked) return <div className="card muted">Tính năng đang khoá.</div>

  return (
    <div
      className="lam-viec"
      style={{
        gridTemplateColumns: `${showLayers || !video ? '168px ' : ''}minmax(0, 1fr)${showInspector && video ? ' minmax(280px, 26%)' : ''}`
      }}
    >
      {(showLayers || !video) && <div className="cot-cauhinh editor-layers">
        <div className="cot-tieude">Video</div>
        <div className="card options-card">
          <button className="btn primary" onClick={chooseVideo} disabled={ghep === 'chay'}>
            🎞 Chọn video
          </button>
          {video && <div className="muted small ocr-ten">{baseName(video)}</div>}
        </div>
        {video && (
          <>
            <div className="cot-tieude">Lớp</div>
            <div className={`blur-region-item ${panel === 'subtitle' ? 'active' : ''}`}>
              <label className="gk-check">
                <input type="checkbox" checked={subtitleEnabled} onChange={(event) => setSubtitleEnabled(event.target.checked)} />
              </label>
              <button type="button" className="link-btn" onClick={() => setPanel('subtitle')}>
                <span>Phụ đề</span>
              </button>
            </div>
            <div className={`blur-region-item ${panel === 'text' ? 'active' : ''}`}>
              <label className="gk-check">
                <input type="checkbox" checked={textEnabled} onChange={(event) => setTextEnabled(event.target.checked)} />
              </label>
              <button type="button" className="link-btn" onClick={() => setPanel('text')}>
                <span>Text</span>
              </button>
              {textOverlays.length > 0 && <span className="layer-count">{textOverlays.length}</span>}
            </div>
            <div className={`blur-region-item ${panel === 'blur' ? 'active' : ''}`}>
              <label className="gk-check">
                <input type="checkbox" checked={blurEnabled} onChange={(event) => setBlurEnabled(event.target.checked)} />
              </label>
              <button type="button" className="link-btn" onClick={() => setPanel('blur')}>
                <span>Làm mờ</span>
              </button>
              {blurRegions.length > 0 && <span className="layer-count">{blurRegions.length}</span>}
            </div>
            <div className={`blur-region-item ${panel === 'logo' ? 'active' : ''}`}>
              <label className="gk-check">
                <input type="checkbox" checked={logoEnabled} onChange={(event) => setLogoEnabled(event.target.checked)} />
              </label>
              <button type="button" className="link-btn" onClick={() => setPanel('logo')}>
                <span>Logo</span>
              </button>
            </div>
            <div className="cot-tieude">Cố định</div>
            <div className={`blur-region-item ${panel === 'audio' ? 'active' : ''}`}>
              <button type="button" className="link-btn" onClick={() => setPanel('audio')}>
                Âm thanh
              </button>
            </div>
            <div className={`blur-region-item ${panel === 'export' ? 'active' : ''}`}>
              <button type="button" className="link-btn" onClick={() => setPanel('export')}>
                Xuất video
              </button>
            </div>
          </>
        )}
        <div className="layer-footer">
          {ghep === 'chay' && <span className="cookie-status ok">Đang xuất... {ghepPct}%</span>}
        </div>
      </div>}
      {showInspector && video && <div className="cot-cauhinh editor-inspector">
        {video && (
          <div className="card options-card">
            {panel === 'audio' && (
              <>
                <div className="composer-section">
              <b>Âm thanh gốc</b>
              <label className="volume-row">
                <span>Âm lượng video</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={videoVolume}
                  disabled={media?.hasAudio !== true}
                  onChange={(event) => setVideoVolume(Number(event.target.value))}
                />
                <span className="volume-value">{videoVolume}%</span>
              </label>
              {media?.hasAudio === false && <div className="muted small">Video không có âm thanh gốc.</div>}
              <label className="gk-check composer-head" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={duckingEnabled}
                  disabled={!media?.hasAudio || !voiceEnabled || !voice || !srtNgoai}
                  onChange={(event) => setDuckingEnabled(event.target.checked)}
                />
                <b>Tự giảm âm thanh nền khi có voice-over</b>
              </label>
              {!srtNgoai ? (
                <>
                  <div className="muted small">Cần một file phụ đề (.srt) để biết lúc nào giọng đọc đang nói.</div>
                  <button className="btn small-btn" onClick={chooseSrt} disabled={!media?.hasAudio}>
                    📄 Chọn file phụ đề (.srt)
                  </button>
                </>
              ) : (
                <div className="muted small">
                  Nhạc nền giảm còn {duckPercent}% trong lúc giọng đọc nói, theo mốc của {baseName(srtNgoai)}.
                </div>
              )}
              {duckingEnabled && (
                <>
                  <label className="volume-row">
                    <span>Nhạc nền giảm còn</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={duckPercent}
                      onChange={(event) => setDuckPercent(Number(event.target.value))}
                    />
                    <span className="volume-value">{duckPercent}%</span>
                  </label>
                  <label className="volume-row">
                    <span>Nhỏ dần trong</span>
                    <input
                      type="range"
                      min="0"
                      max="1000"
                      step="50"
                      value={duckAttackMs}
                      onChange={(event) => setDuckAttackMs(Number(event.target.value))}
                    />
                    <span className="volume-value">{duckAttackMs}ms</span>
                  </label>
                  <label className="volume-row">
                    <span>To lại trong</span>
                    <input
                      type="range"
                      min="0"
                      max="2000"
                      step="50"
                      value={duckReleaseMs}
                      onChange={(event) => setDuckReleaseMs(Number(event.target.value))}
                    />
                    <span className="volume-value">{duckReleaseMs}ms</span>
                  </label>
                </>
              )}
                </div>
                <div className="composer-section">
                  <label className="gk-check composer-head">
                    <input type="checkbox" checked={voiceEnabled} onChange={(event) => setVoiceEnabled(event.target.checked)} />
                    <b>Voice</b>
                  </label>
                  {voiceEnabled && (
                    <>
                      <button className="btn" onClick={chooseVoice}>
                        🎙 Chọn file voice
                      </button>
                      {voice && <div className="muted small ocr-ten">{baseName(voice)}</div>}
                      <label className="volume-row">
                        <span>Âm lượng voice</span>
                        <input type="range" min="0" max="100" step="1" value={voiceVolume} onChange={(event) => setVoiceVolume(Number(event.target.value))} />
                        <span className="volume-value">{voiceVolume}%</span>
                      </label>
                    </>
                  )}
                </div>
              </>
            )}
            {panel === 'subtitle' && (
              <div className="composer-section">
              <b>Phụ đề</b>
              {subtitleEnabled && (
                <>
                  <button className="btn" onClick={chooseSrt}>
                    📄 Dùng file phụ đề (.srt) có sẵn
                  </button>
                  {!srtNgoai ? (
                    <div className="muted small">Chưa có phụ đề — chọn file phụ đề (.srt) có sẵn.</div>
                  ) : (
                    <label className="field">
                      <span className="muted small">Ghép phụ đề nào</span>
                      <select value={srtNgoai} onChange={(event) => setSrtNgoai(event.target.value)}>
                        <option value={srtNgoai}>Có sẵn — {baseName(srtNgoai)}</option>
                      </select>
                    </label>
                  )}
                  {subtitleMismatch && (
                    <div className="qwarn small">
                      ⚠ File phụ đề dài <b>{minutes(srtSeconds)}</b>, video dài <b>{minutes(videoSeconds)}</b>
                      {subtitleMismatch === 'dai' ? ' — phần phụ đề vượt quá thời lượng video sẽ không hiện.' : ' — phụ đề chỉ phủ được phần đầu video.'}
                      {subtitleMismatch === 'dai' && ghepMode === 'soft' && (
                        <div className="muted small" style={{ marginTop: 4 }}>
                          Nếu vẫn ghép, phần phụ đề thừa sẽ được <b>cắt bỏ</b> cho vừa video.
                        </div>
                      )}
                    </div>
                  )}
                  <label className="field">
                    <span className="muted small">Cách gắn phụ đề</span>
                    <select value={ghepMode} onChange={(event) => setGhepMode(event.target.value as 'burn' | 'soft')}>
                      <option value="burn">Gắn cố định vào hình (đăng lại đâu cũng còn)</option>
                      <option value="soft">Phụ đề rời, bật/tắt được (chỉ xem trên máy)</option>
                    </select>
                  </label>
                  {ghepMode === 'burn' && (
                    <div className="overlay-style-grid">
                      <label className="field">
                        <span className="muted small">Cỡ chữ</span>
                        <select value={coChu} onChange={(event) => setCoChu(event.target.value)}>
                          <option value="auto">Tự động (theo khung)</option>
                          <option value="nho">Nhỏ</option>
                          <option value="vua">Vừa</option>
                          <option value="lon">Lớn</option>
                          <option value="ratlon">Rất lớn</option>
                        </select>
                      </label>
                      <label className="field">
                        <span className="muted small">Font phụ đề</span>
                        <select value={subtitleFontId} onChange={(event) => setSubtitleFontId(event.target.value)}>
                          {FONT_OPTIONS.map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="muted small">Màu chữ</span>
                        <input type="color" value={subtitleTextColor} onChange={(event) => setSubtitleTextColor(event.target.value)} />
                      </label>
                      <label className="field">
                        <span className="muted small">Độ mờ chữ: {subtitleTextOpacity}%</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={subtitleTextOpacity}
                          onChange={(event) => setSubtitleTextOpacity(Number(event.target.value))}
                        />
                      </label>
                      <label className="field">
                        <span className="muted small">Màu viền</span>
                        <input type="color" value={subtitleOutlineColor} onChange={(event) => setSubtitleOutlineColor(event.target.value)} />
                      </label>
                      <label className="field">
                        <span className="muted small">Độ dày viền: {subtitleOutlinePx}px</span>
                        <input type="range" min="0" max="8" value={subtitleOutlinePx} onChange={(event) => setSubtitleOutlinePx(Number(event.target.value))} />
                      </label>
                      <label className="gk-check">
                        <input type="checkbox" checked={subtitleBgEnabled} onChange={(event) => setSubtitleBgEnabled(event.target.checked)} /> Nền phụ đề
                      </label>
                      {subtitleBgEnabled && (
                        <>
                          <label className="field">
                            <span className="muted small">Màu nền</span>
                            <input type="color" value={subtitleBgColor} onChange={(event) => setSubtitleBgColor(event.target.value)} />
                          </label>
                          <label className="field">
                            <span className="muted small">Độ mờ nền: {subtitleBgOpacity}%</span>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={subtitleBgOpacity}
                              onChange={(event) => setSubtitleBgOpacity(Number(event.target.value))}
                            />
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              </div>
            )}
            {panel === 'text' && (
              <div className="composer-section">
              <b>Text</b>
              {textEnabled && (
                <>
                  <label className="field">
                    <span className="muted small">Font dùng chung</span>
                    <select value={textFontId} onChange={(event) => setTextFontId(event.target.value)}>
                      {FONT_OPTIONS.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn small-btn" onClick={addTextOverlay} disabled={textOverlays.length >= 20}>
                    + Thêm text
                  </button>
                  <div className="blur-region-list">
                    {textOverlays.map((item, index) => (
                      <div key={item.id} className={`blur-region-item ${activeTextId === item.id ? 'active' : ''}`}>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => {
                            setActiveTextId(item.id)
                            setPanel('text')
                          }}
                        >
                          Text {index + 1}
                        </button>
                        <button type="button" className="link-btn danger-link" onClick={() => removeTextOverlay(item.id)}>
                          Xóa
                        </button>
                      </div>
                    ))}
                  </div>
                  {activeText && (
                    <div className="overlay-style-grid">
                      <label className="field overlay-wide">
                        <span className="muted small">Nội dung</span>
                        <textarea rows={3} value={activeText.text} onChange={(event) => patchActiveText({ text: event.target.value })} />
                      </label>
                      <label className="field">
                        <span className="muted small">Cỡ chữ</span>
                        <input
                          type="number"
                          min="8"
                          max="300"
                          value={activeText.fontSize}
                          onChange={(event) =>
                            patchActiveText({
                              fontSize: Number(event.target.value)
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="muted small">Màu chữ</span>
                        <input type="color" value={activeText.textColor} onChange={(event) => patchActiveText({ textColor: event.target.value })} />
                      </label>
                      <label className="field">
                        <span className="muted small">Độ mờ chữ: {activeText.textOpacity}%</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={activeText.textOpacity}
                          onChange={(event) =>
                            patchActiveText({
                              textOpacity: Number(event.target.value)
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="muted small">Màu viền</span>
                        <input
                          type="color"
                          value={activeText.outlineColor}
                          onChange={(event) =>
                            patchActiveText({
                              outlineColor: event.target.value
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="muted small">Độ dày viền: {activeText.outlinePx}px</span>
                        <input
                          type="range"
                          min="0"
                          max="8"
                          value={activeText.outlinePx}
                          onChange={(event) =>
                            patchActiveText({
                              outlinePx: Number(event.target.value)
                            })
                          }
                        />
                      </label>
                      <label className="gk-check">
                        <input type="checkbox" checked={activeText.bgEnabled} onChange={(event) => patchActiveText({ bgEnabled: event.target.checked })} /> Nền
                        text
                      </label>
                      {activeText.bgEnabled && (
                        <>
                          <label className="field">
                            <span className="muted small">Màu nền</span>
                            <input type="color" value={activeText.bgColor} onChange={(event) => patchActiveText({ bgColor: event.target.value })} />
                          </label>
                          <label className="field">
                            <span className="muted small">Độ mờ nền: {activeText.bgOpacity}%</span>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={activeText.bgOpacity}
                              onChange={(event) =>
                                patchActiveText({
                                  bgOpacity: Number(event.target.value)
                                })
                              }
                            />
                          </label>
                        </>
                      )}
                      <label className="field overlay-wide">
                        <span className="muted small">Thời gian hiển thị</span>
                        <select
                          value={activeText.endSec == null ? 'all' : 'range'}
                          onChange={(event) =>
                            patchActiveText(
                              event.target.value === 'all'
                                ? { startSec: 0, endSec: null }
                                : {
                                    startSec: currentTime,
                                    endSec: videoSeconds || media?.duration || 1
                                  }
                            )
                          }
                        >
                          <option value="all">Toàn bộ video</option>
                          <option value="range">Giới hạn thời gian</option>
                        </select>
                      </label>
                      {activeText.endSec != null && (
                        <>
                          <label className="field">
                            <span className="muted small">Bắt đầu (giây)</span>
                            <input
                              type="number"
                              min="0"
                              max={videoSeconds}
                              step="0.1"
                              value={activeText.startSec}
                              onChange={(event) =>
                                patchActiveText({
                                  startSec: Number(event.target.value)
                                })
                              }
                            />
                          </label>
                          <label className="field">
                            <span className="muted small">Kết thúc (giây)</span>
                            <input
                              type="number"
                              min="0"
                              max={videoSeconds}
                              step="0.1"
                              value={activeText.endSec}
                              onChange={(event) =>
                                patchActiveText({
                                  endSec: Number(event.target.value)
                                })
                              }
                            />
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
              </div>
            )}
            {panel === 'blur' && (
              <div className="composer-section">
              <b>Làm mờ</b>
              {blurEnabled && (
                <>
                  <div className="muted small overlay-help">Có {blurRegions.length} vùng mờ.</div>
                  <button className="btn small-btn" onClick={addBlurRegion}>
                    + Thêm vùng mờ
                  </button>
                  <div className="blur-region-list">
                    {blurRegions.map((item, index) => (
                      <div key={item.id} className={`blur-region-item ${activeBlurId === item.id ? 'active' : ''}`}>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => {
                            setActiveBlurId(item.id)
                            setPanel('blur')
                          }}
                        >
                          Vùng mờ {index + 1}
                        </button>
                        {blurRegions.length > 1 && (
                          <button type="button" className="link-btn danger-link" onClick={() => removeBlurRegion(item.id)}>
                            Xóa
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
              </div>
            )}
            {panel === 'logo' && (
              <div className="composer-section">
              <b>Logo</b>
              <button className="btn" onClick={chooseLogo} disabled={!media}>
                🖼 Chọn ảnh logo
              </button>
              {logo && <div className="muted small ocr-ten">{baseName(logo)}</div>}
              </div>
            )}
            {panel === 'export' && (
              <>
                <label className="field">
                  <span className="muted small">Thư mục lưu kết quả</span>
                  <div className="gk-row">
                    <input value={outputDir} readOnly />
                    <button
                      className="btn"
                      onClick={async () => {
                        const directory = await window.api.chooseFolder()
                        if (directory) setOutputDir(directory)
                      }}
                    >
                      Chọn thư mục
                    </button>
                  </div>
                </label>
                <div className="composer-section">
              <b>Tốc độ xuất</b>
              <label className="field">
                <span className="muted small">Ưu tiên gì khi xuất video</span>
                <select value={exportSpeed} onChange={(event) => setExportSpeed(event.target.value)}>
                  <option value="fast">Nhanh — video dài xong sớm, file lớn hơn</option>
                  <option value="balanced">Cân bằng</option>
                  <option value="quality">Chất lượng cao — chậm hơn, file gọn hơn</option>
                </select>
              </label>
              <div className="muted small">
                Máy sẽ tự dùng GPU nếu được; xem tab Nhật ký để biết encoder nào đã chạy.
              </div>
                </div>
                <div className="cookie-actions">
              {ghep !== 'chay' ? (
                <button className="btn primary" disabled={!canExport || !outputDir} onClick={exportVideo}>
                  🎬 Xuất video
                </button>
              ) : (
                <>
                  <button className="btn danger" onClick={() => window.api.burnCancel()}>
                    ■ Dừng
                  </button>
                  <span className="cookie-status ok">Đang xuất... {ghepPct}%</span>
                </>
              )}
                </div>
                {ghep === 'chay' && (
              <div className="bar" style={{ marginTop: 10, height: 8 }}>
                <div className="bar-fill" style={{ width: `${ghepPct}%` }} />
              </div>
                )}
                {ghepLoi && <div className="dy-err small">{ghepLoi}</div>}
                {ghep === 'xong' && (
              <div className="muted small" style={{ marginTop: 8 }}>
                ✅ Đã xuất ·{' '}
                <button className="link-btn" onClick={() => window.api.showItem(ghepOut)}>
                  {baseName(ghepOut)}
                </button>
              </div>
                )}
              </>
            )}
          </div>
        )}
      </div>}
      <div className="cot-ketqua cot-video editor-preview">
        <div className="cot-tieude">Video &amp; vùng chữ</div>
        <div className="overlay-selector" role="group" aria-label="Hiển thị cột editor">
          <button
            type="button"
            className={`btn ${showLayers ? 'active' : ''}`}
            aria-pressed={showLayers}
            onClick={() => setShowLayers((current) => !current)}
          >
            Lớp
          </button>
          <button
            type="button"
            className={`btn ${showInspector ? 'active' : ''}`}
            aria-pressed={showInspector}
            onClick={() => setShowInspector((current) => !current)}
          >
            Cấu hình
          </button>
        </div>
        {video && media ? (
          <>
            <div className="muted small">Kéo hoặc dùng phím mũi tên để di chuyển; giữ Shift để đi nhanh hơn. Chọn lớp cần sửa bằng các nút bên dưới.</div>
            <VideoStage
              path={video}
              media={media}
              videoRef={videoRef}
              videoProps={{
                controls: true,
                onLoadedMetadata: () => {
                  const element = videoRef.current
                  if (element) setVideoSeconds(Number.isFinite(element.duration) ? element.duration : 0)
                },
                onError: () => setGhepLoi('Không mở được video này.'),
                onPlay: () => void syncVoice(true),
                onPause: () => void syncVoice(false),
                onTimeUpdate: () => {
                  setCurrentTime(videoRef.current?.currentTime ?? 0)
                  void syncVoice(!(videoRef.current?.paused ?? true), false)
                },
                onWaiting: () => void syncVoice(false),
                onStalled: () => void syncVoice(false),
                onPlaying: () => void syncVoice(!(videoRef.current?.paused ?? true)),
                onCanPlay: () => void syncVoice(!(videoRef.current?.paused ?? true)),
                onSeeking: () => void syncVoice(false),
                onSeeked: () => {
                  setCurrentTime(videoRef.current?.currentTime ?? 0)
                  void syncVoice(!(videoRef.current?.paused ?? true))
                },
                onRateChange: () => void syncVoice(!(videoRef.current?.paused ?? true)),
                onEnded: () => {
                  setCurrentTime(videoSeconds)
                  void syncVoice(false)
                }
              }}
            >
              {({ boxW, boxH }) => (
                <>
                  <audio
                    ref={audioRef}
                    src={voice ? mediaUrl(voice) : undefined}
                    preload="metadata"
                    onLoadedMetadata={() => void syncVoice(!(videoRef.current?.paused ?? true))}
                    onCanPlay={() => void syncVoice(!(videoRef.current?.paused ?? true))}
                    onError={() => setGhepLoi('Không mở được file voice preview.')}
                  />
                  {blurEnabled &&
                    blurRegions.map((item, index) => (
                      <RegionBox
                        key={item.id}
                        region={item}
                        setRegion={(next) => updateBlurRegion(item.id, next)}
                        videoW={media.width}
                        videoH={media.height}
                        boxW={boxW}
                        boxH={boxH}
                        previewBlur
                        showMask={activeBlurId === item.id}
                        active={activeBlurId === item.id}
                        onActivate={() => {
                          setActiveBlurId(item.id)
                          setPanel('blur')
                        }}
                        label={`Vùng mờ ${index + 1}`}
                      />
                    ))}
                  {logoEnabled && logo && (
                    <LogoBox
                      src={mediaUrl(logo)}
                      rect={logoRect}
                      setRect={setLogoRect}
                      aspect={logoAspect}
                      videoW={media.width}
                      videoH={media.height}
                      boxW={boxW}
                      boxH={boxH}
                       active={panel === 'logo'}
                       onActivate={() => setPanel('logo')}
                    />
                  )}
                  {textEnabled &&
                    textOverlays.map((item) => (
                      <TextOverlayBox
                        key={item.id}
                        overlay={item}
                        setOverlay={(next) => setTextOverlays((current) => current.map((existing) => (existing.id === item.id ? next : existing)))}
                        videoW={media.width}
                        videoH={media.height}
                        boxW={boxW}
                        boxH={boxH}
                        active={activeTextId === item.id}
                         onActivate={() => {
                           setActiveTextId(item.id)
                           setPanel('text')
                         }}
                        visible={textOverlayVisible(item, currentTime)}
                        fontFamily={FONT_FAMILIES[textFontId] ?? 'Arial'}
                      />
                    ))}
                  {subtitleEnabled && ghepMode === 'burn' && (
                    <>
                      {subtitlePreviewText && (
                        <div
                          className="subtitle-preview"
                          style={{
                            left: `${(subRegion.x0 / media.width) * 100}%`,
                            top: `${(subRegion.y0 / media.height) * 100}%`,
                            width: `${((subRegion.x1 - subRegion.x0) / media.width) * 100}%`,
                            height: `${((subRegion.y1 - subRegion.y0) / media.height) * 100}%`,
                            fontFamily: FONT_FAMILIES[subtitleFontId] ?? 'Arial',
                            fontSize: Math.max(
                              10,
                              subtitleFontSize({
                                w: media.width,
                                h: media.height,
                                coChu: coChu as CoChu,
                                region: subRegion
                              }) * (boxH / media.height)
                            ),
                            color: hexAlpha(subtitleTextColor, subtitleTextOpacity),
                            textShadow: subtitleOutlinePx > 0 ? `0 0 ${Math.max(1, subtitleOutlinePx * boxH / media.height)}px ${subtitleOutlineColor}` : 'none'
                          }}
                        >
                          <span style={subtitleBgEnabled ? { background: hexAlpha(subtitleBgColor, subtitleBgOpacity) } : undefined}>{subtitlePreviewText}</span>
                        </div>
                      )}
                      <RegionBox
                        region={subRegion}
                        setRegion={setSubRegion}
                        videoW={media.width}
                        videoH={media.height}
                        boxW={boxW}
                        boxH={boxH}
                        showMask={false}
                         active={panel === 'subtitle'}
                         onActivate={() => setPanel('subtitle')}
                        label="Vùng đặt phụ đề"
                        cornerHandles
                      />
                    </>
                  )}
                </>
              )}
            </VideoStage>
            <div className="muted small ocr-toado">
              Video {media.width}×{media.height} · Phụ đề X: {subRegion.x0} → {subRegion.x1} px | Y: {subRegion.y0} → {subRegion.y1} px
            </div>
          </>
        ) : (
          <div className="ocr-sanh">
            <div className="muted small">Chưa chọn video — bấm “Chọn video” bên trái.</div>
          </div>
        )}
      </div>
    </div>
  )
}

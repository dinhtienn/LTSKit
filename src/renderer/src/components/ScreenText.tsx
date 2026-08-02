import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { MediaProbe, VideoRect } from '../../../shared/types'
import { hasFeature } from '../lib/license'
import { defaultOcrRegion, formatOcrRegionForNotebook } from '../lib/ocrRegionGeometry'
import { usePersistedState } from '../lib/persist'
import RegionBox from './RegionBox'
import TranslationControl from './TranslationControl'
import VideoStage from './VideoStage'

type Buoc = 'idle' | 'doc' | 'dich' | 'xong' | 'loi'

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path

function legacyTarget(key: string): string | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw == null ? null : JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return null
  }
}

export default function ScreenText({
  outputDir,
  setOutputDir,
  active,
  onOpenSettings
}: {
  outputDir: string
  setOutputDir: (directory: string) => void
  active: boolean
  onOpenSettings: () => void
}): JSX.Element {
  const [video, setVideo] = useState<string | null>(null)
  const [media, setMedia] = useState<MediaProbe | null>(null)
  const [ocrRegion, setOcrRegion] = useState<VideoRect>({ x0: 0, x1: 0, y0: 0, y1: 0 })
  const storedDich = legacyTarget('ltskit.ocr.dich')
  const [dich, setDich] = usePersistedState('ltskit.ocr.dich', storedDich && storedDich !== 'none' ? storedDich : 'vi')
  const [translationEnabled, setTranslationEnabled] = usePersistedState(
    'ltskit.ocr.dichEnabled',
    storedDich != null && storedDich !== 'none'
  )
  const translationTarget = translationEnabled ? dich : 'none'
  const [buoc, setBuoc] = useState<Buoc>('idle')
  const [pct, setPct] = useState(0)
  const [dongChu, setDongChu] = useState('')
  const [dangDung, setDangDung] = useState(false)
  const [ketQua, setKetQua] = useState<string[]>([])
  const [loi, setLoi] = useState<string | null>(null)
  const [canhBaoDich, setCanhBaoDich] = useState<string | null>(null)
  const [hasEngine, setHasEngine] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installPct, setInstallPct] = useState(0)
  const [installErr, setInstallErr] = useState<string | null>(null)
  const [roiCopyStatus, setRoiCopyStatus] = useState<'copied' | 'error' | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoRequestRef = useRef(0)
  const unlocked = hasFeature('ocr')

  useEffect(() => {
    void window.api.ocrEngineStatus().then((status) => setHasEngine(status.has))
  }, [])

  useEffect(() => {
    if (!media) return
    setOcrRegion(defaultOcrRegion(media.width, media.height))
  }, [media])

  const caiCongCu = async (): Promise<void> => {
    setInstalling(true)
    setInstallErr(null)
    setInstallPct(0)
    let off = (): void => undefined
    try {
      off = window.api.onOcrInstallProgress(setInstallPct)
      const result = await window.api.ocrInstallEngine()
      if (result.ok) setHasEngine(true)
      else setInstallErr(result.error ?? 'Tải công cụ Dịch màn hình thất bại.')
    } catch {
      setInstallErr('Tải công cụ Dịch màn hình thất bại.')
    } finally {
      try { off() } finally { setInstalling(false) }
    }
  }

  const chonVideo = async (): Promise<void> => {
    const paths = await window.api.chooseFiles()
    if (!paths.length) return
    const selected = paths[0]
    const request = ++videoRequestRef.current
    setVideo(selected)
    setMedia(null)
    setOcrRegion({ x0: 0, x1: 0, y0: 0, y1: 0 })
    setBuoc('idle')
    setKetQua([])
    setLoi(null)
    setCanhBaoDich(null)
    setRoiCopyStatus(null)
    try {
      const probed = await window.api.burnProbe(selected)
      if (request === videoRequestRef.current) setMedia(probed)
    } catch {
      if (request === videoRequestRef.current) setLoi('Không đọc được thông tin video.')
    }
  }

  const dung = async (): Promise<void> => {
    setDangDung(true)
    await window.api.ocrCancel()
  }

  const copyOcrRegion = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(formatOcrRegionForNotebook(ocrRegion))
      setRoiCopyStatus('copied')
    } catch {
      setRoiCopyStatus('error')
    }
  }

  const chay = async (): Promise<void> => {
    if (!video || !outputDir || !media) return
    if (translationEnabled) {
      const readiness = await window.api.geminiReadiness()
      if (!readiness.hasKey) {
        setLoi('Chưa cấu hình Gemini API key. Hãy đi đến Cài đặt để thêm key.')
        setBuoc('loi')
        return
      }
      if (!readiness.hasModels) {
        setLoi('Chưa chọn model Gemini. Hãy đi đến Cài đặt để thêm model.')
        setBuoc('loi')
        return
      }
    }

    setBuoc('doc')
    setPct(0)
    setLoi(null)
    setCanhBaoDich(null)
    setKetQua([])
    setDongChu('')
    setDangDung(false)
    let off = (): void => undefined
    try {
      off = window.api.onOcrProgress((progress) => {
        setPct(progress.percent)
        if (progress.text) setDongChu(progress.text)
      })
      const result = await window.api.ocrVideo(
        video,
        outputDir,
        ocrRegion.x0,
        ocrRegion.x1,
        ocrRegion.y0,
        ocrRegion.y1
      )
      if (!result.ok) {
        if (result.error === 'Đã huỷ.') {
          setBuoc('idle')
          setDongChu('')
        } else {
          setLoi(result.error ?? 'Đọc chữ thất bại.')
          setBuoc('loi')
        }
        return
      }

      const outputs = [result.output!]
      if (translationTarget !== 'none') {
        setBuoc('dich')
        const translated = result.output!.replace(/\.srt$/i, `.${translationTarget}.srt`)
        const translation = await window.api.geminiTranslateSrt(result.output!, translated, translationTarget)
        if (!translation.ok || !translation.output) {
          setLoi(`Dịch: ${translation.error}`)
          setBuoc('loi')
          return
        }
        outputs.push(translation.output!)
        if (translation.verified === false) {
          setCanhBaoDich('Bản dịch chưa được xác nhận đúng ngôn ngữ; đã lưu file .unverified.srt để kiểm tra.')
        }
      }

      if (result.bandTop != null && result.bandBot != null && result.bandBot > result.bandTop) {
        const pad = Math.round(media.height * 0.012)
        const bandTop = result.bandTop
        const bandBot = result.bandBot
        setOcrRegion((current) => ({
          ...current,
          y0: Math.max(0, bandTop - pad),
          y1: Math.min(media.height, bandBot + pad)
        }))
      }
      setKetQua(outputs)
      setBuoc('xong')
    } catch {
      setLoi('Đọc chữ thất bại.')
      setBuoc('loi')
    } finally {
      try { off() } finally { setDangDung(false) }
    }
  }

  if (!unlocked) return <div className="card muted">Tính năng đang khoá.</div>
  if (hasEngine === false) {
    return (
      <div className="dy-setup"><div className="card dy-install-card"><div className="dy-install-title">🔍 Cần tải công cụ Dịch màn hình</div><p className="muted">Tính năng đọc chữ trên video chạy <b>ngay trên máy bạn</b>. Bấm để tải một lần (~230MB).</p>{installing ? <><div className="bar"><div className="bar-fill" style={{ width: `${installPct}%` }} /></div><div className="muted small">Đang tải công cụ… {installPct}%</div></> : <button className="btn primary" onClick={caiCongCu}>Tải công cụ Dịch màn hình</button>}{installErr && <div className="dy-err small">{installErr}</div>}</div></div>
    )
  }

  const dangChay = buoc === 'doc' || buoc === 'dich'
  return (
    <div className="lam-viec">
      <div className="cot-cauhinh">
        <div className="cot-tieude">Đọc chữ trên video</div>
        <div className="card options-card"><button className="btn primary" onClick={chonVideo} disabled={dangChay}>🎞 Chọn video</button>{video && <div className="muted small ocr-ten">{baseName(video)}</div>}<div className="muted small">Dành cho video chỉ có chữ chạy, không có tiếng.</div></div>
        <div className="card options-card"><button className="btn small" onClick={caiCongCu} disabled={dangChay || installing}>{installing ? `Đang cài lại… ${installPct}%` : 'Cài lại công cụ OCR'}</button>{installErr && <div className="dy-err small">{installErr}</div>}</div>
        <div className="card options-card"><label className="field"><span className="muted small">Thư mục lưu kết quả</span><div className="gk-row"><input value={outputDir} readOnly /><button className="btn" onClick={async () => { const directory = await window.api.chooseFolder(); if (directory) setOutputDir(directory) }}>Chọn thư mục</button></div></label></div>
        <TranslationControl enabled={translationEnabled} setEnabled={setTranslationEnabled} language={dich} setLanguage={setDich} active={active} onOpenSettings={onOpenSettings} />
        {video && <div className="card"><div className="cookie-actions">{!dangChay && <button className="btn primary" disabled={!outputDir || !media} onClick={chay}>▶ Bắt đầu đọc chữ</button>}{buoc === 'doc' && <button className="btn danger" onClick={dung} disabled={dangDung}>{dangDung ? 'Đang dừng…' : '■ Dừng'}</button>}{buoc === 'doc' && <span className="cookie-status ok">Đang đọc… {pct}%</span>}{buoc === 'dich' && <span className="cookie-status ok">✨ Đang dịch…</span>}</div>{dangChay && <><div className="bar" style={{ marginTop: 10, height: 8 }}><div className="bar-fill" style={{ width: `${buoc === 'dich' ? 100 : pct}%` }} /></div>{dongChu && <div className="muted small ocr-dong">{dongChu}</div>}</>}{loi && <div className="dy-err small">{loi}</div>}{canhBaoDich && <div className="qwarn small">{canhBaoDich}</div>}{buoc === 'xong' && <div className="muted small" style={{ marginTop: 8 }}>✅ Xong · {ketQua.map((output) => <button key={output} className="link-btn" onClick={() => window.api.showItem(output)}>{baseName(output)}</button>)}</div>}</div>}
      </div>
      <div className="cot-ketqua cot-video">
        <div className="cot-tieude">Video &amp; vùng đọc chữ</div>
        <div className="muted small">Kéo khung để trùm lên chữ chạy; kéo các cạnh hoặc góc để co giãn vùng OCR.</div>
        {video && media ? <>
          <VideoStage path={video} media={media} videoRef={videoRef} videoProps={{ controls: true }}>
            {({ boxW, boxH }) => <RegionBox region={ocrRegion} setRegion={setOcrRegion} videoW={media.width} videoH={media.height} boxW={boxW} boxH={boxH} active onActivate={() => undefined} label="Vùng đọc chữ OCR" cornerHandles />}
          </VideoStage>
          <div className="ocr-toado-row"><div className="muted small ocr-toado">Video {media.width}×{media.height} · X0: {ocrRegion.x0} · X1: {ocrRegion.x1} · Y0: {ocrRegion.y0} · Y1: {ocrRegion.y1}</div><button className="btn small-btn" onClick={copyOcrRegion} disabled={!media}>Sao chép tọa độ</button>{roiCopyStatus === 'copied' && <span className="muted small">Đã sao chép tọa độ.</span>}{roiCopyStatus === 'error' && <span className="dy-err small">Không sao chép được tọa độ.</span>}</div>
        </> : <div className="ocr-sanh"><div className="muted small">Chưa chọn video.</div></div>}
      </div>
    </div>
  )
}

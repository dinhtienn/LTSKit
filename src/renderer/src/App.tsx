import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Downloader from './components/Downloader'
import AudioText from './components/AudioText'
import ScreenText from './components/ScreenText'
import VideoEditor from './components/VideoEditor'
import TextToSpeech from './components/TextToSpeech'
import License from './components/License'
import Logs from './components/Logs'
import Settings from './components/Settings'
import type { UpdateStatus } from '../../shared/types'

type Stage = 'checking' | 'setup' | 'ready'
type TabKey = 'download' | 'audiotext' | 'screen' | 'editor' | 'tts' | 'settings' | 'logs' | 'license'

interface Tab {
  key: TabKey
  label: string
  icon: string
  title: string
  subtitle: string
}

// Tab tinh nang chinh (o tren). Them tinh nang moi = them 1 entry vao day.
const TABS: Tab[] = [
  {
    key: 'download',
    label: 'Tải xuống',
    icon: '⬇',
    title: 'Tải xuống',
    subtitle: 'Video, âm thanh & kênh đa nền tảng'
  },
  {
    key: 'audiotext',
    label: 'Phụ đề',
    icon: '📝',
    title: 'Audio → Text',
    subtitle: 'Tạo phụ đề .srt từ giọng nói bằng AI'
  },
  {
    key: 'screen',
    label: 'Dịch màn hình',
    icon: '🔍',
    title: 'Dịch màn hình',
    // Anh em voi tab Phu de: mot ben tu TIENG, mot ben tu HINH.
    // Danh cho video chi co chu chay, khong co tieng -> tab Phu de bo tay.
    subtitle: 'Đọc chữ chạy trên video → tạo phụ đề .srt'
  },
  {
    key: 'editor',
    label: 'Chỉnh sửa video',
    icon: '✂',
    title: 'Chỉnh sửa video',
    subtitle: 'Ghép phụ đề, làm mờ, voice và logo vào video'
  },
  {
    key: 'tts',
    label: 'Giọng nói',
    icon: '🔊',
    title: 'Text → Giọng',
    subtitle: 'Phụ đề .srt → file MP3 (VieNeu-TTS v3 + clone)'
  }
]

// Muc phu o day sidebar
const BOTTOM_TABS: Tab[] = [
  {
    key: 'settings',
    label: 'Cài đặt',
    icon: '⚙',
    title: 'Cài đặt',
    subtitle: 'Tài khoản, kết nối, công cụ tải và dịch AI'
  },
  {
    key: 'logs',
    label: 'Nhật ký',
    icon: '📋',
    title: 'Nhật ký hoạt động',
    subtitle: 'Theo dõi hoạt động & lỗi phát sinh'
  },
  {
    key: 'license',
    label: 'Giấy phép',
    icon: '📜',
    title: 'Giấy phép & Điều khoản',
    subtitle: 'Bản quyền và trách nhiệm sử dụng'
  }
]

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('checking')
  // KHONG nho tab cuoi — moi lan mo app deu ve tab mac dinh (Tai xuong).
  // Chi nho cau hinh user setup cho tung tab (qua usePersistedState trong moi component).
  const [tab, setTab] = useState<TabKey>('download')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  // Thu muc luu dung CHUNG cho moi tab; nho qua cac lan mo app
  const [outputDir, setOutputDir] = useState('')
  // "Hop thu" gui file tu tab Tai xuong sang tab Audio->Text (nut "Lay sub")
  const [subInbox, setSubInbox] = useState<{ path: string; id: string } | null>(null)

  const sendToSub = (filePath: string): void => {
    setSubInbox({ path: filePath, id: crypto.randomUUID() })
    setTab('audiotext')
  }

  const openSettings = (): void => setTab('settings')

  const updateOutputDir = (d: string): void => {
    setOutputDir(d)
    try {
      localStorage.setItem('ltskit.outputDir', d)
    } catch {
      /* bo qua */
    }
  }

  const check = async (): Promise<void> => {
    setStage('checking')
    const status = await window.api.checkDeps()
    setStage(status.ytdlp && status.ffmpeg ? 'ready' : 'setup')
  }

  useEffect(() => {
    void check()
    void window.api.appVersion().then(setVersion)
    const saved = localStorage.getItem('ltskit.outputDir')
    if (saved) setOutputDir(saved)
    else void window.api.downloadsDir().then(setOutputDir)
    const offUpd = window.api.onUpdateStatus(setUpdate)
    return offUpd
  }, [])

  if (stage === 'checking') {
    return (
      <div className="boot">
        <div className="center">
          <div className="spinner" />
          <p>Đang kiểm tra môi trường…</p>
        </div>
      </div>
    )
  }

  if (stage === 'setup') {
    return (
      <div className="boot">
        <SetupScreen onDone={() => setStage('ready')} />
      </div>
    )
  }

  const active = [...TABS, ...BOTTOM_TABS].find((t) => t.key === tab) ?? TABS[0]

  const renderTab = (t: Tab): JSX.Element => (
    <button
      key={t.key}
      className={`side-item ${t.key === tab ? 'active' : ''}`}
      onClick={() => setTab(t.key)}
    >
      <span className="side-ico">{t.icon}</span>
      <span>{t.label}</span>
    </button>
  )

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-brand">
          <span className="side-logo">LTSKit</span>
        </div>
        <nav className="side-nav">{TABS.map(renderTab)}</nav>
        <div className="side-hint muted small">Sắp có thêm tính năng…</div>

        <div className="side-bottom">
          {BOTTOM_TABS.map(renderTab)}

          <div className="side-version">Phiên bản {version || '…'}</div>

          {update?.state === 'downloaded' && (
            <button
              className="side-update ready"
              onClick={() => window.api.installAppUpdate()}
              title="Khởi động lại để cài bản mới"
            >
              🎉 Có bản mới {update.version} — Cập nhật ngay
            </button>
          )}
          {update?.state === 'downloading' && (
            <div className="side-update">Đang tải bản mới… {update.percent ?? 0}%</div>
          )}
          {update?.state === 'available' && (
            <div className="side-update">Đã có bản {update.version}, đang tải…</div>
          )}
        </div>
      </aside>

      <main className="content">
        <header className="content-head">
          <div>
            <h1 className="content-title">{active.title}</h1>
            <p className="content-sub muted">{active.subtitle}</p>
          </div>
        </header>
        <div className="content-body">
          {/* Giữ màn hình tải luôn mounted để không mất hàng đợi và tiến độ khi chuyển tab. */}
          <div className={`tab-pane ${tab === 'download' ? '' : 'hidden'}`}>
            <Downloader
              outputDir={outputDir}
              setOutputDir={updateOutputDir}
              onGetSub={sendToSub}
              onOpenSettings={openSettings}
            />
          </div>
          <div className={`tab-pane ${tab === 'audiotext' ? '' : 'hidden'}`}>
            <AudioText
              outputDir={outputDir}
              setOutputDir={updateOutputDir}
              subInbox={subInbox}
              active={tab === 'audiotext'}
              onOpenSettings={openSettings}
            />
          </div>
          {/* GIU SONG (khong unmount): user chon video + keo khung xong ma qua
              tab khac mot cai la mat sach, phai lam lai tu dau. Nho toi khi tat
              app — dung y user chot. */}
          <div className={`tab-pane ${tab === 'screen' ? '' : 'hidden'}`}>
            <ScreenText
              outputDir={outputDir}
              setOutputDir={updateOutputDir}
              active={tab === 'screen'}
              onOpenSettings={openSettings}
            />
          </div>
          <div className={`tab-pane ${tab === 'editor' ? '' : 'hidden'}`}>
            <VideoEditor outputDir={outputDir} setOutputDir={updateOutputDir} />
          </div>
          <div className={`tab-pane ${tab === 'tts' ? '' : 'hidden'}`}>
            <TextToSpeech outputDir={outputDir} setOutputDir={updateOutputDir} />
          </div>
          {tab === 'settings' && <Settings />}
          {tab === 'logs' && <Logs />}
          {tab === 'license' && <License />}
        </div>
      </main>
    </div>
  )
}

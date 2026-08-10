import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import type {
  DownloadKind,
  DownloadRequest,
  PlaylistEntry,
  VideoFormat,
  VideoInfo
} from '../../../shared/types'
import { formatBytes, formatEta, formatSpeed } from '../lib/format'
import { classifyDownloadInput } from '../lib/downloadUrl'
import { usePersistedState } from '../lib/persist'
import { loadSharedProxy, sharedProxyFor } from '../lib/downloadConnection'
import { useQueueRunner } from '../lib/useQueueRunner'
import {
  createDouyinQueueItem,
  dispatchQueueItem,
  replaceQueuePlaceholder,
  selectedRunnableQueueItems,
  type DouyinOptions,
  type DouyinQueueItem,
  type GenericQueueItem,
  type UnifiedQueueItem
} from '../lib/unifiedDownloadQueue'
import { queueSelectionState, toggleAllQueueItems } from '../lib/queueSelection'
import LinkInput from './LinkInput'
import RunControls from './RunControls'

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav']
// Do phan giai muc tieu (lay ban tot nhat <= gia tri nay)
const RES_PRESETS: { label: string; value: number | null }[] = [
  { label: 'Tốt nhất', value: null },
  { label: '2160p (4K)', value: 2160 },
  { label: '1440p', value: 1440 },
  { label: '1080p', value: 1080 },
  { label: '720p', value: 720 },
  { label: '480p', value: 480 },
  { label: '360p', value: 360 }
]

// Kieu dat ten file: nhan bang chu de hieu, ben trong la mau ky thuat
const NAME_PRESETS: { label: string; tpl: string; ex: string }[] = [
  { label: 'Tiêu đề video', tpl: '%(title)s.%(ext)s', ex: 'Tên video.mp4' },
  { label: 'Tiêu đề + mã video', tpl: '%(title)s [%(id)s].%(ext)s', ex: 'Tên video [aBc123].mp4' },
  { label: 'Kênh - Tiêu đề', tpl: '%(uploader)s - %(title)s.%(ext)s', ex: 'Tên kênh - Tên video.mp4' },
  { label: 'Ngày đăng - Tiêu đề', tpl: '%(upload_date)s - %(title)s.%(ext)s', ex: '20240115 - Tên video.mp4' },
  {
    label: 'Số thứ tự - Tiêu đề (playlist)',
    tpl: '%(playlist_index)s - %(title)s.%(ext)s',
    ex: '01 - Tên video.mp4'
  }
]

// Cach sap xep file vao thu muc
type FolderMode = 'flat' | 'playlist' | 'channel'

// Lam sach ten thu muc: bo ky tu cam tren Windows, gom khoang trang
function cleanFolder(s: string): string {
  const out = s
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return out || 'Playlist'
}

type SelEntry = PlaylistEntry & { checked: boolean; playlistTitle: string }
type PendingChoice =
  | { kind: 'playlist'; placeholderId: string; entries: SelEntry[] }
  | { kind: 'sublists'; placeholderId: string; lists: { title: string; url: string; count: number | null }[] }

/** Tu 1 VideoFormat, dung chuoi selector + nhan hien thi. */
function buildFormatChoice(f: VideoFormat): { selector: string; label: string } {
  const hasV = !!f.vcodec
  const hasA = !!f.acodec
  let selector = f.format_id
  if (hasV && !hasA) selector = `${f.format_id}+bestaudio/${f.format_id}` // video-only -> ghep audio
  const res = f.height ? `${f.height}p` : hasA && !hasV ? 'Âm thanh' : f.resolution ?? f.format_id
  const parts = [res, f.ext.toUpperCase()]
  if (f.fps) parts.push(`${f.fps}fps`)
  return { selector, label: parts.join(' · ') }
}

export default function Downloader({
  outputDir,
  setOutputDir,
  onGetSub,
  onOpenSettings
}: {
  outputDir: string
  setOutputDir: (d: string) => void
  onGetSub: (filePath: string) => void
  onOpenSettings: () => void
}): JSX.Element {
  // Tuy chon chung ap dung cho ca hang doi (tu nho qua cac lan mo app)
  const [kind, setKind] = usePersistedState<DownloadKind>('ltskit.dl.kind', 'video')
  const [height, setHeight] = usePersistedState<number | null>('ltskit.dl.height', 1080)
  const [audioFormat, setAudioFormat] = usePersistedState('ltskit.dl.audioFormat', 'mp3')
  const [embedThumbnail, setEmbedThumbnail] = usePersistedState('ltskit.dl.embedThumbnail', true)
  const [embedMetadata, setEmbedMetadata] = usePersistedState('ltskit.dl.embedMetadata', true)
  const [folderMode, setFolderMode] = usePersistedState<FolderMode>('ltskit.dl.folderMode', 'flat')

  // Tuy chon nang cao (tu nho)
  const [showAdvanced, setShowAdvanced] = usePersistedState('ltskit.dl.showAdvanced', false)
  const [container, setContainer] = usePersistedState('ltskit.dl.container', 'mp4')
  const [outputTemplate, setOutputTemplate] = usePersistedState(
    'ltskit.dl.outputTemplate',
    '%(title)s [%(id)s].%(ext)s'
  )
  const [customName, setCustomName] = usePersistedState('ltskit.dl.customName', false)
  const [writeSubs, setWriteSubs] = usePersistedState('ltskit.dl.writeSubs', false)
  const [autoSubs, setAutoSubs] = usePersistedState('ltskit.dl.autoSubs', false)
  const [subLangs, setSubLangs] = usePersistedState('ltskit.dl.subLangs', 'vi,en')
  const [embedSubs, setEmbedSubs] = usePersistedState('ltskit.dl.embedSubs', true)
  const [useArchive, setUseArchive] = usePersistedState('ltskit.dl.useArchive', false)
  const [forceOverwrite, setForceOverwrite] = usePersistedState('ltskit.dl.forceOverwrite', false)

  const [useCookies, setUseCookies] = usePersistedState('ltskit.download.useCookies', false)
  const [useProxy, setUseProxy] = usePersistedState('ltskit.download.useProxy', false)
  const [sharedProxy] = usePersistedState('ltskit.download.sharedProxy', loadSharedProxy())
  const [hasCookies, setHasCookies] = useState(false)
  const proxyArg = (): string | null => sharedProxyFor(useProxy, sharedProxy)

  const [urlInput, setUrlInput] = useState('')
  const [items, setItems] = useState<UnifiedQueueItem[]>([])
  const runner = useQueueRunner<UnifiedQueueItem>()
  const [inputMsg, setInputMsg] = useState<string | null>(null)

  // Playlist
  const [probing, setProbing] = useState(false)
  const [playlistSel, setPlaylistSel] = useState<{ open: boolean; entries: SelEntry[] }>({
    open: false,
    entries: []
  })
  // Khoang chon (tu so x den so y) — huu ich cho kenh/playlist rat nhieu video
  const [plRange, setPlRange] = useState<{ from: number; to: number }>({ from: 1, to: 1 })
  // Bang chon danh sach con (tab kenh: Videos/Shorts, hoac cac playlist)
  const [subChooser, setSubChooser] = useState<{
    open: boolean
    placeholderId: string | null
    parent: string
    lists: { title: string; url: string; count: number | null }[]
  }>({ open: false, placeholderId: null, parent: '', lists: [] })
  const [playlistPlaceholderId, setPlaylistPlaceholderId] = useState<string | null>(null)
  const [pendingChoices, setPendingChoices] = useState<PendingChoice[]>([])

  // Chon dinh dang nang cao (per-item)
  const [formatPick, setFormatPick] = useState<{
    open: boolean
    itemId: string | null
    formats: VideoFormat[]
  }>({ open: false, itemId: null, formats: [] })

  const [hasEngine, setHasEngine] = useState<boolean | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installPct, setInstallPct] = useState(0)
  const [installErr, setInstallErr] = useState<string | null>(null)
  const [dyMusic, setDyMusic] = usePersistedState('ltskit.dy.music', true)
  const [dyCover, setDyCover] = usePersistedState('ltskit.dy.cover', true)
  const [dyAvatar, setDyAvatar] = usePersistedState('ltskit.dy.avatar', false)
  const [dyMetaJson, setDyMetaJson] = usePersistedState('ltskit.dy.metaJson', true)
  const [dyMode, setDyMode] = usePersistedState<'all' | 'batch' | 'new'>('ltskit.dy.mode', 'all')
  const [dyBatchSize, setDyBatchSize] = usePersistedState('ltskit.dy.batchSize', 15)
  const [channels, setChannels] = useState<
    { url: string; name: string; lastRun: string; count: number }[]
  >([])

  const refreshChannels = (): void => {
    void window.api.dyChannels().then(setChannels)
  }

  const cookiesFile = async (): Promise<string | null> => useCookies ? window.api.cookieRender() : null

  useEffect(() => {
    void window.api.cookieProfiles().then((profiles) => setHasCookies(profiles.length > 0))
    void window.api.dyEngineStatus().then((s) => setHasEngine(s.has))
    refreshChannels()
    const offGeneric = window.api.onProgress((p) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === p.id && it.engine === 'generic' ? { ...it, progress: p } : it
        )
      )
    })
    const offDouyin = window.api.onDyProgress((p) => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === p.id && it.engine === 'douyin'
            ? {
                ...it,
                success: p.success,
                lastFile: p.lastFile ?? it.lastFile,
                status:
                  p.status === 'finished'
                    ? 'done'
                    : p.status === 'error'
                      ? 'error'
                      : 'downloading',
                error: p.status === 'error' ? p.line : it.error
              }
            : it
        )
      )
    })
    return () => {
      offGeneric()
      offDouyin()
    }
  }, [])

  const installDy = async (): Promise<void> => {
    setInstalling(true)
    setInstallErr(null)
    setInstallPct(0)
    const off = window.api.onDyInstallProgress(setInstallPct)
    const result = await window.api.dyInstallEngine()
    off()
    setInstalling(false)
    if (result.ok) {
      setHasEngine(true)
      setItems((prev) => prev.map((item) => item.status === 'blocked' ? { ...item, status: 'ready' } as UnifiedQueueItem : item))
    } else {
      setInstallErr(result.error ?? 'Tải công cụ Douyin thất bại.')
    }
  }

  const patch = (id: string, upd: Partial<UnifiedQueueItem>): void => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? ({ ...it, ...upd } as UnifiedQueueItem) : it))
    )
  }

  const makeGenericPlaceholder = (url: string): GenericQueueItem => ({
    id: crypto.randomUUID(), engine: 'generic', url, title: url, info: null, status: 'fetching', selected: true,
    progress: null, result: null, error: null, formatId: null, formatLabel: null, subfolder: null
  })

  const probeGeneric = async (item: GenericQueueItem, cf: string | null): Promise<void> => {
    try {
      const res = await window.api.getInfo(item.url, cf, proxyArg())
      if (res.ok && res.info) patch(item.id, { info: res.info, title: res.info.title, status: 'ready' })
      else patch(item.id, { status: 'error', error: res.error ?? 'Không lấy được thông tin.' })
    } catch (err) {
      patch(item.id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  }

  const showChoice = (choice: PendingChoice): void => {
    if (choice.kind === 'playlist') {
      setPlRange({ from: 1, to: choice.entries.length })
      setPlaylistPlaceholderId(choice.placeholderId)
      setPlaylistSel({ open: true, entries: choice.entries })
    } else {
      setSubChooser({ open: true, placeholderId: choice.placeholderId, parent: '', lists: choice.lists })
    }
  }

  const finishChoice = (): void => {
    setPlaylistSel({ open: false, entries: [] })
    setSubChooser({ open: false, placeholderId: null, parent: '', lists: [] })
    setPlaylistPlaceholderId(null)
    setPendingChoices((pending) => {
      const [next, ...rest] = pending
      if (next) queueMicrotask(() => showChoice(next))
      return rest
    })
  }

  const cancelChoice = (): void => {
    const placeholderId = playlistPlaceholderId ?? subChooser.placeholderId
    if (placeholderId) setItems((prev) => prev.filter((item) => item.id !== placeholderId))
    finishChoice()
  }

  const addUrls = async (): Promise<void> => {
    const classified = classifyDownloadInput(urlInput)
    if (classified.invalid.length) {
      setInputMsg(`Đã bỏ qua ${classified.invalid.length} liên kết không hợp lệ.`)
    } else {
      setInputMsg(null)
    }
    if (classified.urls.length === 0) return
    setUrlInput('')
    setProbing(true)
    const cf = await cookiesFile()

    const queueItems: UnifiedQueueItem[] = classified.urls.map((u) =>
      u.engine === 'douyin'
        ? createDouyinQueueItem(crypto.randomUUID(), u.url, u.isChannel, {
          mode: dyMode,
          batchSize: dyBatchSize,
          music: dyMusic,
          cover: dyCover,
          avatar: dyAvatar,
          metaJson: dyMetaJson,
          proxy: proxyArg(),
          useCookies
        })
        : makeGenericPlaceholder(u.url)
    )
    setItems((prev) => [...prev, ...queueItems])

    const choices: PendingChoice[] = []
    for (const item of queueItems) {
      if (item.engine !== 'generic') continue
      try {
        const res = await window.api.getPlaylist(item.url, cf, proxyArg())
        if (res.ok && res.playlist?.isPlaylist && res.playlist.entries.length > 0) {
          const plTitle = res.playlist.title ?? 'Playlist'
          const collected: SelEntry[] = []
          const sublists: { title: string; url: string; count: number | null }[] = []
          for (const e of res.playlist.entries) {
            if (e.isPlaylist) {
              sublists.push({ title: e.title, url: e.url, count: e.count ?? null })
            } else {
              collected.push({ ...e, checked: true, playlistTitle: plTitle })
            }
          }
          if (sublists.length) {
            choices.push({ kind: 'sublists', placeholderId: item.id, lists: sublists })
          } else if (collected.length) {
            choices.push({ kind: 'playlist', placeholderId: item.id, entries: collected })
          }
        } else {
          await probeGeneric(item, cf)
        }
      } catch {
        await probeGeneric(item, cf)
      }
    }
    if (choices.length) {
      showChoice(choices[0])
      setPendingChoices(choices.slice(1))
    }
    setProbing(false)
  }

  // Thao tac tren bang chon playlist
  const toggleEntry = (idx: number): void =>
    setPlaylistSel((s) => ({
      ...s,
      entries: s.entries.map((e, i) => (i === idx ? { ...e, checked: !e.checked } : e))
    }))
  const setAllEntries = (val: boolean): void =>
    setPlaylistSel((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, checked: val })) }))
  // Chi tich chon cac video co so thu tu trong [from, to], bo tich phan con lai
  const applyRange = (from: number, to: number): void =>
    setPlaylistSel((s) => ({
      ...s,
      entries: s.entries.map((e, i) => ({ ...e, checked: i + 1 >= from && i + 1 <= to }))
    }))

  // Dao vao 1 danh sach con: lay video that (hoac hien tiep bang chon neu van long nhau)
  const openSubList = async (url: string): Promise<void> => {
    const placeholderId = subChooser.placeholderId
    setSubChooser({ open: false, placeholderId: null, parent: '', lists: [] })
    setProbing(true)
    const cf = await cookiesFile()
    try {
      const res = await window.api.getPlaylist(url, cf, proxyArg())
      if (res.ok && res.playlist?.isPlaylist && res.playlist.entries.length > 0) {
        const nested = res.playlist.entries.filter((e) => e.isPlaylist)
        if (nested.length > 0) {
          setSubChooser({
            open: true,
            placeholderId,
            parent: url,
            lists: nested.map((e) => ({ title: e.title, url: e.url, count: e.count ?? null }))
          })
        } else {
          const plTitle = res.playlist.title ?? 'Playlist'
          const collected: SelEntry[] = res.playlist.entries.map((e) => ({
            ...e,
            checked: true,
            playlistTitle: plTitle
          }))
          setPlRange({ from: 1, to: collected.length })
          setPlaylistPlaceholderId(placeholderId)
          setPlaylistSel({ open: true, entries: collected })
        }
      } else {
        const id = placeholderId
        if (id) await probeGeneric({ ...makeGenericPlaceholder(url), id }, cf)
      }
    } catch {
      const id = placeholderId
      if (id) await probeGeneric({ ...makeGenericPlaceholder(url), id }, cf)
    }
    setProbing(false)
  }

  const confirmAddPlaylist = (): void => {
    const chosen = playlistSel.entries.filter((e) => e.checked)
    const newItems: GenericQueueItem[] = chosen.map((e) => ({
      id: crypto.randomUUID(),
      engine: 'generic',
      url: e.url,
      title: e.title,
      info: null,
      status: 'ready',
      selected: true,
      progress: null,
      result: null,
      error: null,
      formatId: null,
      formatLabel: null,
      subfolder: cleanFolder(e.playlistTitle) // playlist -> thu muc theo ten playlist
    }))
    if (playlistPlaceholderId) {
      setItems((prev) => replaceQueuePlaceholder(prev, playlistPlaceholderId, newItems))
    }
    finishChoice()
  }

  // Chon dinh dang nang cao
  const openFormatPicker = (item: GenericQueueItem): void => {
    if (!item.info?.formats?.length) return
    setFormatPick({ open: true, itemId: item.id, formats: item.info.formats })
  }
  const chooseFormat = (f: VideoFormat): void => {
    const { selector, label } = buildFormatChoice(f)
    if (formatPick.itemId) patch(formatPick.itemId, { formatId: selector, formatLabel: label })
    setFormatPick({ open: false, itemId: null, formats: [] })
  }
  const clearFormat = (id: string): void => patch(id, { formatId: null, formatLabel: null })

  const chooseFolder = async (): Promise<void> => {
    const dir = await window.api.chooseFolder()
    if (dir) setOutputDir(dir)
  }

  // Chen thu muc con vao truoc mau ten file tuy theo cach sap xep
  const templateFor = (item: GenericQueueItem): string => {
    if (folderMode === 'channel') return `%(uploader)s/${outputTemplate}`
    if (folderMode === 'playlist' && item.subfolder) return `${item.subfolder}/${outputTemplate}`
    return outputTemplate
  }

  const buildReq = (item: GenericQueueItem): DownloadRequest => ({
    url: item.info?.webpageUrl ?? item.url,
    kind,
    height: kind === 'video' ? height : null,
    audioFormat,
    outputDir,
    embedThumbnail,
    embedMetadata,
    cookiesFile: null,
    formatId: item.formatId,
    container,
    outputTemplate: templateFor(item),
    writeSubs,
    autoSubs,
    subLangs,
    embedSubs,
    useArchive,
    forceOverwrite,
    proxy: proxyArg()
  })

  const runItem = async (it: UnifiedQueueItem): Promise<void> => {
    if (it.engine === 'douyin') {
      patch(it.id, { status: 'downloading', error: null })
      const result = await dispatchQueueItem(it, null, outputDir, window.api)
      setItems((prev) =>
        prev.map((current) =>
          current.id === it.id && current.engine === 'douyin'
            ? {
                ...current,
                status: result.ok ? 'done' : 'error',
                selected: result.ok ? false : true,
                result: 'success' in result ? result : current.result,
                success: 'success' in result ? result.success : current.success,
                error: result.ok ? null : result.error
              }
            : current
        )
      )
      return
    }
    patch(it.id, { status: 'downloading', progress: null, result: null, error: null })
    const request = buildReq(it)
    request.cookiesFile = await cookiesFile()
    const result = await dispatchQueueItem(it, request, outputDir, window.api)
    patch(it.id, {
      status: result.ok ? 'done' : 'error',
      selected: result.ok ? false : true,
      result: 'file' in result ? result : null,
      error: result.ok ? null : result.error
    })
  }

  const startRun = (): void => {
    if (!outputDir) return
    if (hasEngine !== true) {
      setItems((prev) =>
        prev.map((item) =>
          item.engine === 'douyin' && (item.status === 'ready' || item.status === 'error')
            ? { ...item, status: 'blocked', error: 'Cần cài công cụ Douyin trước.' }
            : item
        )
      )
    }
    const queue = selectedRunnableQueueItems(items, hasEngine === true)
    void runner.run(queue, runItem)
  }

  const removeItem = (id: string): void => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }
  const clearAll = (): void => {
    if (runner.active) return
    setItems([])
  }

  const addChannelUpdate = (channel: { url: string }): void => {
    setItems((prev) => [
      ...prev,
      createDouyinQueueItem(crypto.randomUUID(), channel.url, true, {
        mode: 'new', batchSize: dyBatchSize, music: dyMusic, cover: dyCover,
        avatar: dyAvatar, metaJson: dyMetaJson, proxy: proxyArg(), useCookies
      })
    ])
  }

  const removeChannel = async (url: string): Promise<void> => {
    setChannels(await window.api.dyRemoveChannel(url))
  }

  const pending = selectedRunnableQueueItems(items, hasEngine === true).length
  const selectionState = queueSelectionState(items, new Set(['downloading']))
  const toggleAll = (): void => {
    setItems((current) => toggleAllQueueItems(current, selectionState !== 'all', new Set(['downloading'])))
  }
  const done = items.filter((it) => it.status === 'done').length
  const failed = items.filter((it) => it.status === 'error').length
  const classifiedInput = classifyDownloadInput(urlInput).urls
  const showDouyinControls =
    classifiedInput.some((url) => url.engine === 'douyin') || items.some((item) => item.engine === 'douyin')
  const inputHasDouyinChannel = classifiedInput.some(
    (url) => url.engine === 'douyin' && url.isChannel
  )

  return (
    <div className="lam-viec">
      {/* ---------- COT GIUA: tuy chon + dan link ---------- */}
      <div className="cot-cauhinh">
        <div className="cot-tieude">Tùy chọn &amp; liên kết</div>
      {/* Tuy chon chung */}
      <div className="card options-card">
        <div className="options">
          <div className="seg">
            <button
              className={`seg-btn ${kind === 'video' ? 'active' : ''}`}
              onClick={() => setKind('video')}
            >
              🎬 Video (mp4)
            </button>
            <button
              className={`seg-btn ${kind === 'audio' ? 'active' : ''}`}
              onClick={() => setKind('audio')}
            >
              🎵 Âm thanh
            </button>
          </div>

          {kind === 'video' ? (
            <label className="field">
              <span>Độ phân giải</span>
              <select
                value={height ?? ''}
                onChange={(e) => setHeight(e.target.value ? Number(e.target.value) : null)}
              >
                {RES_PRESETS.map((r) => (
                  <option key={r.label} value={r.value ?? ''}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="field">
              <span>Định dạng âm thanh</span>
              <select value={audioFormat} onChange={(e) => setAudioFormat(e.target.value)}>
                {AUDIO_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="check">
            <input
              type="checkbox"
              checked={embedThumbnail}
              onChange={(e) => setEmbedThumbnail(e.target.checked)}
            />
            Kèm ảnh bìa
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={embedMetadata}
              onChange={(e) => setEmbedMetadata(e.target.checked)}
            />
            Kèm thông tin (tác giả, tên…)
          </label>
          <label className={`check ${hasCookies ? '' : 'disabled'}`}>
            <input type="checkbox" checked={useCookies} disabled={!hasCookies} onChange={(e) => setUseCookies(e.target.checked)} />
            Dùng cookie
          </label>
          <label className={`check ${sharedProxy.trim() ? '' : 'disabled'}`}>
            <input type="checkbox" checked={useProxy} disabled={!sharedProxy.trim()} onChange={(e) => setUseProxy(e.target.checked)} />
            Dùng proxy
          </label>
          {(!hasCookies || !sharedProxy.trim()) && <button className="link-btn" onClick={onOpenSettings}>Thiết lập trong Cài đặt</button>}
        </div>

        <div className="folder-row">
          <input className="folder-input" value={outputDir} readOnly title={outputDir} />
          <button className="btn" onClick={chooseFolder}>
            Chọn thư mục
          </button>
        </div>

        <label className="field folder-mode-row">
          <span>Sắp xếp vào thư mục</span>
          <select value={folderMode} onChange={(e) => setFolderMode(e.target.value as FolderMode)}>
            <option value="flat">Chung một thư mục</option>
            <option value="playlist">Mỗi playlist một thư mục riêng</option>
            <option value="channel">Theo kênh / tác giả</option>
          </select>
          <span className="muted small folder-mode-hint">
            {folderMode === 'flat' && 'Tất cả video lưu chung vào thư mục đã chọn.'}
            {folderMode === 'playlist' &&
              'Playlist tự vào thư mục con theo tên playlist. Video lẻ nằm ở thư mục gốc.'}
            {folderMode === 'channel' && 'Mỗi kênh/tác giả một thư mục con riêng.'}
          </span>
        </label>
      </div>

      {/* Tuy chon nang cao */}
      <div className="card adv-card">
        <button className="adv-toggle" onClick={() => setShowAdvanced((v) => !v)}>
          <span>⚙ Tùy chọn nâng cao</span>
          <span className="adv-arrow">{showAdvanced ? '▴' : '▾'}</span>
        </button>
        {showAdvanced && (
          <div className="adv-body">
            <div className="adv-row">
              <label className="field">
                <span>Định dạng file (video)</span>
                <select value={container} onChange={(e) => setContainer(e.target.value)}>
                  <option value="mp4">MP4</option>
                  <option value="mkv">MKV</option>
                  <option value="webm">WEBM</option>
                </select>
              </label>
              <label className="field grow">
                <span>Kiểu đặt tên file</span>
                <select
                  value={customName ? 'custom' : outputTemplate}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === 'custom') {
                      setCustomName(true)
                    } else {
                      setCustomName(false)
                      setOutputTemplate(v)
                    }
                  }}
                >
                  {NAME_PRESETS.map((p) => (
                    <option key={p.tpl} value={p.tpl}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Tùy chỉnh…</option>
                </select>
              </label>
            </div>

            {customName ? (
              <label className="field">
                <span>Mẫu tùy chỉnh (nâng cao)</span>
                <input
                  className="folder-input"
                  value={outputTemplate}
                  onChange={(e) => setOutputTemplate(e.target.value)}
                  spellCheck={false}
                  placeholder="%(title)s.%(ext)s"
                />
                <span className="muted small">
                  Ví dụ: <code>%(uploader)s/%(title)s.%(ext)s</code> = lưu theo thư mục kênh. Dùng
                  các biến: <code>title</code> (tên), <code>id</code> (mã), <code>ext</code> (đuôi
                  file), <code>uploader</code> (kênh), <code>upload_date</code> (ngày).
                </span>
              </label>
            ) : (
              <div className="name-preview muted small">
                Tên file sẽ là:{' '}
                <b>{NAME_PRESETS.find((p) => p.tpl === outputTemplate)?.ex ?? outputTemplate}</b>
              </div>
            )}

            <div className="adv-subs">
              <label className="check">
                <input
                  type="checkbox"
                  checked={writeSubs}
                  onChange={(e) => setWriteSubs(e.target.checked)}
                />
                Tải phụ đề <span className="muted small">(chỉ khi tải Video)</span>
              </label>
              {writeSubs && (
                <div className="adv-subs-detail">
                  <label className="field">
                    <span>Ngôn ngữ</span>
                    <input
                      className="mini-input"
                      value={subLangs}
                      onChange={(e) => setSubLangs(e.target.value)}
                      placeholder="vi,en"
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={autoSubs}
                      onChange={(e) => setAutoSubs(e.target.checked)}
                    />
                    Kèm cả phụ đề tự động
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={embedSubs}
                      onChange={(e) => setEmbedSubs(e.target.checked)}
                    />
                    Gắn vào video
                  </label>
                </div>
              )}
            </div>

            <div className="adv-checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={useArchive}
                  onChange={(e) => setUseArchive(e.target.checked)}
                />
                Bỏ qua file đã tải (nhớ lịch sử)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={forceOverwrite}
                  onChange={(e) => setForceOverwrite(e.target.checked)}
                />
                Ghi đè file trùng
              </label>
            </div>

          </div>
        )}
      </div>

      {showDouyinControls && (
        <>
          {!hasEngine && (
            <div className="card dy-install-card">
              <div className="dy-install-title">🎬 Cần tải công cụ Douyin</div>
              <p className="muted small">Douyin dùng công cụ tải chuyên biệt. Tải một lần rồi dùng cho các lần sau.</p>
              {installing ? (
                <><div className="bar"><div className="bar-fill" style={{ width: `${installPct}%` }} /></div><div className="muted small">Đang tải công cụ… {installPct}%</div></>
              ) : <button className="btn primary" onClick={installDy}>Tải công cụ Douyin</button>}
              {installErr && <div className="dy-err small">{installErr}</div>}
            </div>
          )}
          <div className="card options-card">
            <div className="options">
              <label className="check"><input type="checkbox" checked={dyMusic} onChange={(e) => setDyMusic(e.target.checked)} /> Tải kèm nhạc</label>
              <label className="check"><input type="checkbox" checked={dyCover} onChange={(e) => setDyCover(e.target.checked)} /> Tải kèm ảnh bìa</label>
              <label className="check"><input type="checkbox" checked={dyAvatar} onChange={(e) => setDyAvatar(e.target.checked)} /> Tải avatar kênh</label>
              <label className="check"><input type="checkbox" checked={dyMetaJson} onChange={(e) => setDyMetaJson(e.target.checked)} /> Lưu thông tin (JSON)</label>
            </div>
          </div>
          {inputHasDouyinChannel && (
            <div className="card dy-mode-card">
              <div className="dy-mode-title">Kiểu tải kênh Douyin</div>
              <label className="dy-mode-opt"><input type="radio" checked={dyMode === 'all'} onChange={() => setDyMode('all')} /><span><b>Tải tất cả video</b></span></label>
              <label className="dy-mode-opt"><input type="radio" checked={dyMode === 'batch'} onChange={() => setDyMode('batch')} /><span><b>Tải theo đợt</b> <input className="mini-input dy-batch" type="number" min={1} max={999} value={dyBatchSize} onChange={(e) => setDyBatchSize(Number(e.target.value) || 15)} disabled={dyMode !== 'batch'} /></span></label>
              <label className="dy-mode-opt"><input type="radio" checked={dyMode === 'new'} onChange={() => setDyMode('new')} /><span><b>Chỉ video mới kể từ lần trước</b></span></label>
            </div>
          )}
        </>
      )}

      {/* Them URL vao hang doi */}
      <div className="url-row">
        <LinkInput
          placeholder="Dán 1 hoặc nhiều liên kết — Enter để thêm, Shift+Enter để xuống dòng"
          value={urlInput}
          onChange={setUrlInput}
          onSubmit={addUrls}
          disabled={probing}
        />
        <button className="btn primary" onClick={addUrls} disabled={!urlInput.trim() || probing}>
          {probing ? 'Đang phân tích…' : '+ Thêm'}
        </button>
      </div>

      <p className="hint muted small">
        💡 Link <b>video/playlist</b> hoặc <b>Douyin video/kênh</b> → tự nhận diện engine và thêm vào hàng đợi.
      </p>
      {inputMsg && <p className="hint dy-err small">{inputMsg}</p>}
      </div>

      {/* ---------- COT PHAI: hang doi ---------- */}
      <div className="cot-ketqua cot-hangdoi">
        <div className="cot-tieude">Hàng đợi</div>

      {/* Hang doi */}
      {items.length > 0 && (
        <>
          <div className="queue-bar">
            <div className="queue-summary muted small">
              {items.length} mục · {done} xong{failed > 0 ? ` · ${failed} lỗi` : ''}
            </div>
            <div className="queue-actions">
              <QueueSelectAll state={selectionState} onToggle={toggleAll} />
              <button className="btn" onClick={clearAll} disabled={runner.active}>
                Xóa hết
              </button>
              <RunControls
                runState={runner.runState}
                startLabel={`Tải đã chọn (${pending})`}
                canStart={pending > 0 && !!outputDir}
                onStart={startRun}
                onPause={runner.pause}
                onResume={runner.resume}
                onStop={runner.stop}
              />
            </div>
          </div>

          <div className="queue-list">
            {items.map((it) =>
              it.engine === 'generic' ? (
                <QueueRow
                  key={it.id}
                  item={it}
                  selKind={kind}
                  selHeight={height}
                  folderMode={folderMode}
                  onRemove={() => removeItem(it.id)}
                  onSelectedChange={(selected) => patch(it.id, { selected })}
                  onPickFormat={() => openFormatPicker(it)}
                  onClearFormat={() => clearFormat(it.id)}
                  onGetSub={onGetSub}
                />
              ) : (
                <DouyinQueueRow key={it.id} item={it} onRemove={() => removeItem(it.id)} onSelectedChange={(selected) => patch(it.id, { selected })} />
              )
            )}
          </div>
        </>
      )}

      {items.length === 0 && (
        <div className="empty muted">
          <div className="empty-title">Hàng đợi trống</div>
          <div>
            Dán link <b>video</b> hoặc <b>playlist</b> ở trên rồi bấm <b>Thêm</b>.
          </div>
          <div className="small" style={{ marginTop: 8 }}>
            Sau khi thêm, mỗi video sẽ có nút <b>⚙</b> để chọn định dạng (độ phân giải, codec…).
          </div>
        </div>
      )}
      {showDouyinControls && (
        <div className="card dy-library">
          <div className="dy-lib-head"><div className="dy-lib-title">📚 Thư viện kênh Douyin</div><button className="link-btn" onClick={refreshChannels}>Làm mới</button></div>
          {channels.length === 0 ? <div className="muted small">Chưa có kênh nào. Tải một link kênh để theo dõi.</div> : (
            <div className="dy-chan-list">
              {channels.map((channel) => (
                <div className="dy-chan" key={channel.url}>
                  <div className="dy-chan-info"><div className="dy-chan-name" title={channel.url}>👤 {channel.name}</div><div className="muted small">{channel.count} video · cập nhật {new Date(channel.lastRun).toLocaleDateString('vi-VN')}</div></div>
                  <div className="dy-chan-actions"><button className="btn small-btn" onClick={() => addChannelUpdate(channel)}>🔔 Lấy video mới</button><button className="ibtn" title="Bỏ theo dõi" onClick={() => removeChannel(channel.url)}>✕</button></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Bang chon danh sach con (tab kenh / nhieu playlist) */}
      {subChooser.open && (
        <div
          className="modal-overlay"
          onClick={cancelChoice}
        >
          <div className="modal" onClick={(ev) => ev.stopPropagation()}>
            <div className="modal-head">
              <h3>Chọn danh sách để tải</h3>
              <span className="muted small">{subChooser.lists.length} danh sách</span>
            </div>
            <div className="sub-note muted small">
              Link này chứa nhiều danh sách. Chọn 1 danh sách để xem video bên trong (kèm số lượng),
              rồi mới chọn khoảng tải.
            </div>
            <div className="modal-list">
              {subChooser.lists.map((l, i) => (
                <button className="sub-item" key={l.url || i} onClick={() => openSubList(l.url)}>
                  <span className="sub-ico">📃</span>
                  <span className="sub-title" title={l.title}>
                    {l.title}
                  </span>
                  <span className="sub-count muted small">
                    {l.count != null ? `${l.count} video` : 'Mở →'}
                  </span>
                </button>
              ))}
            </div>
            <div className="modal-foot">
              <button
                className="btn"
                onClick={cancelChoice}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bang chon video tu playlist */}
      {playlistSel.open &&
        (() => {
          const total = playlistSel.entries.length
          const checkedCount = playlistSel.entries.filter((e) => e.checked).length
          const from = Math.max(1, Math.min(plRange.from || 1, total))
          const to = Math.max(from, Math.min(plRange.to || total, total))
          const RENDER_CAP = 500 // gioi han so dong ve DOM cho khoi lag
          const rows: { e: SelEntry; i: number }[] = []
          for (let i = from - 1; i < to && rows.length < RENDER_CAP; i++)
            rows.push({ e: playlistSel.entries[i], i })
          const hidden = to - from + 1 - rows.length

          return (
            <div
              className="modal-overlay"
              onClick={cancelChoice}
            >
              <div className="modal" onClick={(ev) => ev.stopPropagation()}>
                <div className="modal-head">
                  <h3>Chọn video từ playlist</h3>
                  <span className="muted small">
                    {total} video · đã chọn {checkedCount}
                  </span>
                </div>

                <div className="modal-tools">
                  <div className="pl-range">
                    <span className="muted small">Tải từ</span>
                    <input
                      className="mini-input pl-num"
                      type="number"
                      min={1}
                      max={total}
                      value={plRange.from}
                      onChange={(ev) =>
                        setPlRange((r) => ({ ...r, from: Number(ev.target.value) || 1 }))
                      }
                    />
                    <span className="muted small">đến</span>
                    <input
                      className="mini-input pl-num"
                      type="number"
                      min={1}
                      max={total}
                      value={plRange.to}
                      onChange={(ev) =>
                        setPlRange((r) => ({ ...r, to: Number(ev.target.value) || total }))
                      }
                    />
                    <span className="muted small">/ {total}</span>
                    <button className="btn small-btn" onClick={() => applyRange(from, to)}>
                      ✓ Chọn khoảng này
                    </button>
                  </div>
                  <div className="pl-tool-btns">
                    <button className="btn small-btn" onClick={() => setAllEntries(true)}>
                      Chọn tất cả
                    </button>
                    <button className="btn small-btn" onClick={() => setAllEntries(false)}>
                      Bỏ chọn
                    </button>
                  </div>
                </div>

                <div className="modal-list">
                  {rows.map(({ e, i }) => (
                    <label className="pl-entry" key={e.id || i}>
                      <input type="checkbox" checked={e.checked} onChange={() => toggleEntry(i)} />
                      <span className="pl-idx">{i + 1}</span>
                      <span className="pl-title" title={e.title}>
                        {e.title}
                      </span>
                      {e.durationString && <span className="pl-dur muted">{e.durationString}</span>}
                    </label>
                  ))}
                  {hidden > 0 && (
                    <div className="pl-more muted small">
                      … còn {hidden} video nữa trong khoảng (thu hẹp “Từ…đến” để xem). Nút “Chọn khoảng
                      này” vẫn áp dụng cho toàn bộ khoảng {from}–{to}.
                    </div>
                  )}
                </div>

                <div className="modal-foot">
                  <button
                    className="btn"
                    onClick={cancelChoice}
                  >
                    Hủy
                  </button>
                  <button
                    className="btn primary"
                    onClick={confirmAddPlaylist}
                    disabled={checkedCount === 0}
                  >
                    Thêm {checkedCount} video vào hàng đợi
                  </button>
                </div>
              </div>
            </div>
          )
        })()}

      {/* Bang huong dan proxy da chuyen sang Cai dat. */}
      {false && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-head">
              <h3>Hướng dẫn nhập Proxy</h3>
            </div>
            <div className="proxy-guide-body">
              <p className="muted small">
                Proxy giúp tải nội dung bị <b>khóa theo khu vực</b> (ví dụ Bilibili, một số đài TV).
                Bạn cần có sẵn proxy/VPN, rồi dán địa chỉ theo mẫu:
              </p>
              <div className="proxy-fmt">scheme://[tài_khoản:mật_khẩu@]host:cổng</div>

              <div className="proxy-ex-title small">Ví dụ dán đúng:</div>
              <table className="proxy-ex">
                <tbody>
                  <tr>
                    <td>
                      <code>socks5://127.0.0.1:1080</code>
                    </td>
                    <td className="muted">Proxy SOCKS5 chạy trên máy (v2ray, Shadowsocks…)</td>
                  </tr>
                  <tr>
                    <td>
                      <code>socks5h://127.0.0.1:1080</code>
                    </td>
                    <td className="muted">SOCKS5 + phân giải tên miền qua proxy (khuyên dùng)</td>
                  </tr>
                  <tr>
                    <td>
                      <code>http://1.2.3.4:8080</code>
                    </td>
                    <td className="muted">Proxy HTTP</td>
                  </tr>
                  <tr>
                    <td>
                      <code>socks5://user:pass@1.2.3.4:1080</code>
                    </td>
                    <td className="muted">Proxy có tài khoản/mật khẩu</td>
                  </tr>
                </tbody>
              </table>

              <div className="proxy-note small">
                ⚠ Bắt buộc có <b>phần đầu</b> (<code>socks5://</code>, <code>http://</code>…). Chỉ dán{' '}
                <code>1.2.3.4:1080</code> (thiếu phần đầu) sẽ báo lỗi.
              </div>
              <div className="proxy-note small">
                📋 Nếu mua proxy (DataImpulse, v.v.): copy <b>đúng nguyên chuỗi</b> nhà cung cấp đưa,
                kể cả phần đuôi trong tên đăng nhập (vd <code>__cr.eg</code> để chọn quốc gia). Thiếu
                đuôi này vẫn chạy nhưng có thể ra sai khu vực.
              </div>
              <p className="muted small">
                Sau khi dán, bấm <b>Kiểm tra proxy</b>: xanh là dùng được (kèm IP thoát), đỏ là sai
                định dạng hoặc không kết nối được.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn primary">
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay khi dang tai danh sach (dao vao tab lon co the mat vai giay) */}
      {probing && !subChooser.open && !playlistSel.open && (
        <div className="modal-overlay">
          <div className="probing-box">
            <div className="spinner" />
            <div className="muted small">Đang tải danh sách…</div>
          </div>
        </div>
      )}

      {/* Bang chon dinh dang nang cao */}
      {formatPick.open && (
        <div
          className="modal-overlay"
          onClick={() => setFormatPick({ open: false, itemId: null, formats: [] })}
        >
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Chọn định dạng</h3>
              <span className="muted small">
                Chọn 1 dòng · video không tiếng sẽ tự ghép âm thanh tốt nhất
              </span>
            </div>
            <div className="modal-list">
              <table className="fmt-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Độ phân giải</th>
                    <th>Đuôi</th>
                    <th>FPS</th>
                    <th>Codec</th>
                    <th>Kích thước</th>
                  </tr>
                </thead>
                <tbody>
                  {[...formatPick.formats]
                    .sort(
                      (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0)
                    )
                    .map((f) => (
                      <tr key={f.format_id} onClick={() => chooseFormat(f)}>
                        <td className="fmt-kind">
                          {f.vcodec ? (f.acodec ? '🎬' : '🎞') : '🎵'}
                        </td>
                        <td>
                          {f.height
                            ? `${f.height}p`
                            : f.acodec && !f.vcodec
                              ? 'Âm thanh'
                              : f.resolution ?? '—'}
                        </td>
                        <td>{f.ext}</td>
                        <td className="num">{f.fps ?? ''}</td>
                        <td className="fmt-codec">
                          {[f.vcodec, f.acodec].filter(Boolean).join(' / ') || '—'}
                        </td>
                        <td className="num">{formatBytes(f.filesize ?? f.filesizeApprox)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="modal-foot">
              <button
                className="btn"
                onClick={() => setFormatPick({ open: false, itemId: null, formats: [] })}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function statusLabel(it: GenericQueueItem): string {
  switch (it.status) {
    case 'fetching':
      return 'Đang lấy thông tin…'
    case 'ready':
      return 'Chờ tải'
    case 'downloading':
      switch (it.progress?.status) {
        case 'postprocessing':
          return 'Đang xử lý…'
        case 'preparing':
          return 'Đang chuẩn bị…'
        default:
          return 'Đang tải…'
      }
    case 'done':
      return 'Xong'
    case 'error':
      return 'Lỗi'
    default:
      return 'Chờ tải'
  }
}

function QueueRow({
  item,
  selKind,
  selHeight,
  folderMode,
  onRemove,
  onSelectedChange,
  onPickFormat,
  onClearFormat,
  onGetSub
}: {
  item: GenericQueueItem
  selKind: DownloadKind
  selHeight: number | null
  folderMode: FolderMode
  onRemove: () => void
  onSelectedChange: (selected: boolean) => void
  onPickFormat: () => void
  onClearFormat: () => void
  onGetSub: (filePath: string) => void
}): JSX.Element {
  const p = item.progress
  const pct = p ? Math.round(p.percent) : 0
  const busy = p?.status === 'postprocessing'
  const title = item.info?.title || item.title || item.url
  const canPickFormat = !!item.info?.formats?.length && item.status !== 'downloading'

  // Thu muc con dich (de nguoi dung biet file se luu o dau)
  const folderHint =
    folderMode === 'playlist' && item.subfolder
      ? item.subfolder
      : folderMode === 'channel'
        ? item.info?.uploader || 'theo kênh'
        : null

  const maxH = item.info?.heights?.[0] ?? null
  const resWarn =
    selKind === 'video' &&
    selHeight != null &&
    maxH != null &&
    selHeight > maxH &&
    !item.formatLabel &&
    item.status !== 'downloading' &&
    item.status !== 'done'
      ? `Video này tối đa ${maxH}p — chọn ${selHeight}p sẽ chỉ tải được ${maxH}p. Hãy chọn ${maxH}p hoặc "Tốt nhất".`
      : null

  return (
    <div className={`qrow ${item.status} ${item.selected ? 'selected' : 'not-selected'}`}>
      <div className="queue-select-cell">
        <input className="queue-row-select" type="checkbox" checked={item.selected} disabled={item.status === 'downloading'} onChange={(event) => onSelectedChange(event.target.checked)} aria-label={`Chọn ${title}`} />
      </div>
      <div className="qthumb">
        {item.info?.thumbnail ? (
          <img src={item.info.thumbnail} alt="" />
        ) : (
          <div className="qthumb-ph">{item.status === 'fetching' ? '…' : '🎞'}</div>
        )}
      </div>

      <div className="qmain">
        <div className="qtitle" title={title}>
          {title}
        </div>

        {item.formatLabel && item.status !== 'downloading' && (
          <div className="qfmt">
            <span className="fmt-badge">⚙ {item.formatLabel}</span>
            <button className="link-btn" onClick={onClearFormat}>
              bỏ chọn
            </button>
          </div>
        )}

        {folderHint && item.status !== 'downloading' && item.status !== 'done' && (
          <div className="qfolder muted small" title={folderHint}>
            📁 {folderHint}
          </div>
        )}

        {resWarn && <div className="qwarn small">⚠ {resWarn}</div>}

        {item.status === 'downloading' && (
          <>
            <div className="bar mini">
              <div
                className={`bar-fill ${busy ? 'indeterminate' : ''}`}
                style={busy ? undefined : { width: `${pct}%` }}
              />
            </div>
            {p?.status === 'downloading' && (
              <div className="qstats muted small">
                <span>
                  {formatBytes(p.downloadedBytes)} / {formatBytes(p.totalBytes)}
                </span>
                <span>{formatSpeed(p.speed)}</span>
                <span>Còn {formatEta(p.eta)}</span>
              </div>
            )}
          </>
        )}

        {item.status === 'error' && item.error && (
          <div className="qerr small" title={item.error}>
            {item.error}
          </div>
        )}
      </div>

      <div className="qside">
        <span className={`qbadge ${item.status}`}>
          {statusLabel(item)}
          {item.status === 'downloading' && !busy ? ` ${pct}%` : ''}
        </span>
        <div className="qbtns">
          {canPickFormat && (
            <button className="ibtn" title="Chọn định dạng" onClick={onPickFormat}>
              ⚙
            </button>
          )}
          {item.status === 'done' && item.result?.file && (
            <>
              <button
                className="ibtn"
                title="Mở file"
                onClick={() => window.api.openPath(item.result!.file!)}
              >
                ▶
              </button>
              <button
                className="ibtn"
                title="Mở thư mục"
                onClick={() => window.api.showItem(item.result!.file!)}
              >
                📂
              </button>
              <button
                className="ibtn"
                title="Lấy phụ đề (Audio → Text)"
                onClick={() => onGetSub(item.result!.file!)}
              >
                📝
              </button>
            </>
          )}
          {item.status !== 'downloading' && (
            <button className="ibtn" title="Xóa khỏi hàng đợi" onClick={onRemove}>
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function QueueSelectAll({ state, onToggle }: { state: 'none' | 'some' | 'all'; onToggle: () => void }): JSX.Element {
  return <label className="queue-select-all"><input type="checkbox" checked={state === 'all'} ref={(element) => { if (element) element.indeterminate = state === 'some' }} onChange={onToggle} /> Chọn tất cả</label>
}

function DouyinQueueRow({
  item,
  onRemove,
  onSelectedChange
}: {
  item: DouyinQueueItem
  onRemove: () => void
  onSelectedChange: (selected: boolean) => void
}): JSX.Element {
  const mode = item.request.mode === 'all' ? 'Tất cả' : item.request.mode === 'batch' ? `Theo đợt ${item.request.batchSize}` : 'Chỉ video mới'
  const label = item.status === 'downloading'
    ? `Đang tải… đã xong ${item.success}`
    : item.status === 'done'
      ? `Xong · ${item.success} video`
      : item.status === 'blocked'
        ? 'Cần công cụ Douyin'
        : item.status === 'error'
          ? `Lỗi: ${item.error ?? ''}`
          : 'Chờ tải'
  return (
    <div className={`qrow ${item.status} ${item.selected ? 'selected' : 'not-selected'}`}>
      <div className="queue-select-cell">
        <input className="queue-row-select" type="checkbox" checked={item.selected} disabled={item.status === 'downloading'} onChange={(event) => onSelectedChange(event.target.checked)} aria-label={`Chọn ${item.title}`} />
      </div>
      <div className="qmain">
        <div className="qtitle" title={item.url}>
          {item.request.isChannel ? '📺 ' : '🎬 '}
          {item.lastFile || item.url}
        </div>
        <div className="muted small">
          {item.request.isChannel ? `Kiểu: ${mode} · ` : ''}{label}
        </div>
      </div>
      <div className="qside">
        <span className={`qbadge ${item.status}`}>
          {item.status === 'downloading' ? 'Đang tải' : item.status === 'done' ? 'Xong' : item.status === 'error' ? 'Lỗi' : item.status === 'blocked' ? 'Cần công cụ' : 'Chờ'}
        </span>
        {item.status !== 'downloading' && (
          <button className="ibtn" title="Xóa" onClick={onRemove}>✕</button>
        )}
      </div>
    </div>
  )
}

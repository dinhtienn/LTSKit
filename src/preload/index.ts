import { contextBridge, ipcRenderer } from 'electron'
import {
  CookieCaptureEvent,
  CookieCaptureResult,
  CookieProfile,
  CookieStatus,
  DepStatus,
  DouyinProgress,
  DouyinRequest,
  DouyinResult,
  GpuInfo,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  DyChannel,
  DyCookieStatus,
  DyEngineStatus,
  BurnProgress,
  BurnReq,
  BurnResult,
  GeminiStatus,
  GeminiKeyDescriptor,
  GeminiStoredKeyCheck,
  GeminiProgress,
  GeminiModelDiscovery,
  GeminiReadiness,
  GeminiTranslationResult,
  LogEntry,
  LogoDimensions,
  MediaProbe,
  OcrEngineStatus,
  OcrProgress,
  OcrResult,
  OptimizeSrtRequest,
  OptimizeSrtResult,
  SubtitleOptimizeProgress,
  EditableSubtitleCue,
  SubtitleReadResult,
  SubtitleSaveResult,
  PlaylistProbe,
  ProxyTestResult,
  SetupProgress,
  UpdateStatus,
  VideoInfo,
  WhisperCudaStatus,
  WhisperEngineStatus,
  WhisperProgress,
  WhisperRequest,
  WhisperResult,
  CapcutEngineStatus,
  CapcutInstallProgress,
  CapcutSrtRequest,
  VieneuAddVoiceResult,
  VieneuEngineStatus,
  VieneuInstallProgress,
  VieneuPreviewResult,
  VieneuProgress,
  VieneuSrtRequest,
  VieneuResult,
  VieneuVoice
} from '../shared/types'

const api = {
  checkDeps: (): Promise<DepStatus> => ipcRenderer.invoke('deps:check'),

  runSetup: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('deps:setup'),
  onSetupProgress: (cb: (p: SetupProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: SetupProgress): void => cb(p)
    ipcRenderer.on('deps:setup-progress', listener)
    return () => ipcRenderer.removeListener('deps:setup-progress', listener)
  },

  getInfo: (
    url: string,
    cookiesFile?: string | null,
    proxy?: string | null
  ): Promise<{ ok: boolean; info?: VideoInfo; error?: string }> =>
    ipcRenderer.invoke('ytdlp:info', url, cookiesFile, proxy),

  getPlaylist: (
    url: string,
    cookiesFile?: string | null,
    proxy?: string | null
  ): Promise<{ ok: boolean; playlist?: PlaylistProbe; error?: string }> =>
    ipcRenderer.invoke('ytdlp:playlist', url, cookiesFile, proxy),

  testProxy: (proxy: string): Promise<ProxyTestResult> => ipcRenderer.invoke('proxy:test', proxy),

  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseFolder'),
  chooseFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:chooseFiles'),
  chooseSrt: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseSrt'),
  chooseSrts: (): Promise<string[]> => ipcRenderer.invoke('dialog:chooseSrts'),
  chooseAudio: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseAudio'),
  chooseImage: (): Promise<string | null> => ipcRenderer.invoke('dialog:chooseImage'),
  downloadsDir: (): Promise<string> => ipcRenderer.invoke('app:downloadsDir'),
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),

  // Tu cap nhat app
  checkAppUpdate: (): Promise<void> => ipcRenderer.invoke('update:check'),
  installAppUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (s: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, s: UpdateStatus): void => cb(s)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },

  ytdlpVersion: (): Promise<string | null> => ipcRenderer.invoke('ytdlp:version'),
  ytdlpUpdate: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('ytdlp:update'),

  cookieProfiles: (): Promise<CookieProfile[]> => ipcRenderer.invoke('cookies:profiles'),
  cookieRender: (): Promise<string | null> => ipcRenderer.invoke('cookies:render'),
  cookieClearProfile: (id: string): Promise<void> => ipcRenderer.invoke('cookies:clearProfile', id),

  download: (id: string, req: DownloadRequest): Promise<DownloadResult> =>
    ipcRenderer.invoke('ytdlp:download', id, req),
  onProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: DownloadProgress): void => cb(p)
    ipcRenderer.on('ytdlp:progress', listener)
    return () => ipcRenderer.removeListener('ytdlp:progress', listener)
  },

  showItem: (filePath: string): Promise<void> => ipcRenderer.invoke('shell:showItem', filePath),
  openPath: (p: string): Promise<void> => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),

  // ---- Douyin ----
  dyEngineStatus: (): Promise<DyEngineStatus> => ipcRenderer.invoke('douyin:engineStatus'),
  dyInstallEngine: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('douyin:installEngine'),
  onDyInstallProgress: (cb: (percent: number) => void): (() => void) => {
    const listener = (_e: unknown, p: number): void => cb(p)
    ipcRenderer.on('douyin:install-progress', listener)
    return () => ipcRenderer.removeListener('douyin:install-progress', listener)
  },
  dyDownload: (id: string, req: DouyinRequest): Promise<DouyinResult> =>
    ipcRenderer.invoke('douyin:download', id, req),
  onDyProgress: (cb: (p: DouyinProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: DouyinProgress): void => cb(p)
    ipcRenderer.on('douyin:progress', listener)
    return () => ipcRenderer.removeListener('douyin:progress', listener)
  },
  dyCookieStatus: (): Promise<DyCookieStatus> => ipcRenderer.invoke('douyin:cookieStatus'),
  dyCookieClear: (): Promise<void> => ipcRenderer.invoke('douyin:cookieClear'),
  dyCookieCapture: (): Promise<CookieCaptureResult> => ipcRenderer.invoke('douyin:cookieCapture'),
  onDyCookieEvent: (cb: (e: CookieCaptureEvent) => void): (() => void) => {
    const listener = (_e: unknown, ev: CookieCaptureEvent): void => cb(ev)
    ipcRenderer.on('douyin:cookie-event', listener)
    return () => ipcRenderer.removeListener('douyin:cookie-event', listener)
  },
  dyChannels: (): Promise<DyChannel[]> => ipcRenderer.invoke('douyin:channels'),
  dyRemoveChannel: (url: string): Promise<DyChannel[]> =>
    ipcRenderer.invoke('douyin:removeChannel', url),

  // ---- Audio -> Text (whisper) ----
  whisperEngineStatus: (): Promise<WhisperEngineStatus> =>
    ipcRenderer.invoke('whisper:engineStatus'),
  whisperInstallEngine: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('whisper:installEngine'),
  onWhisperInstallProgress: (cb: (percent: number) => void): (() => void) => {
    const listener = (_e: unknown, p: number): void => cb(p)
    ipcRenderer.on('whisper:install-progress', listener)
    return () => ipcRenderer.removeListener('whisper:install-progress', listener)
  },
  whisperTranscribe: (id: string, req: WhisperRequest): Promise<WhisperResult> =>
    ipcRenderer.invoke('whisper:transcribe', id, req),
  whisperDetectGpu: (): Promise<GpuInfo> => ipcRenderer.invoke('whisper:detectGpu'),

  // ---- Dich man hinh (doc chu chay tren video) ----
  ocrEngineStatus: (): Promise<OcrEngineStatus> => ipcRenderer.invoke('ocr:engineStatus'),
  ocrInstallEngine: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('ocr:installEngine'),
  onOcrInstallProgress: (cb: (percent: number) => void): (() => void) => {
    const listener = (_e: unknown, p: number): void => cb(p)
    ipcRenderer.on('ocr:install-progress', listener)
    return () => ipcRenderer.removeListener('ocr:install-progress', listener)
  },
  ocrVideo: (
    input: string,
    outputDir: string,
    x0: number,
    x1: number,
    y0: number,
    y1: number
  ): Promise<OcrResult> => ipcRenderer.invoke('ocr:video', input, outputDir, x0, x1, y0, y1),
  ocrCancel: (): Promise<void> => ipcRenderer.invoke('ocr:cancel'),
  onOcrProgress: (cb: (p: OcrProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: OcrProgress): void => cb(p)
    ipcRenderer.on('ocr:progress', listener)
    return () => ipcRenderer.removeListener('ocr:progress', listener)
  },

  // ---- Ghep phu de vao video ----
  burnProbe: (path: string): Promise<MediaProbe> => ipcRenderer.invoke('burn:probe', path),
  logoDimensions: (path: string): Promise<LogoDimensions> =>
    ipcRenderer.invoke('burn:logoDimensions', path),
  burnStart: (req: BurnReq): Promise<BurnResult> => ipcRenderer.invoke('burn:start', req),
  burnCancel: (): Promise<void> => ipcRenderer.invoke('burn:cancel'),
  /** Do dai file .srt (giay) — de canh bao khi lech han so voi video. */
  srtGiay: (duong: string): Promise<number> => ipcRenderer.invoke('burn:srtGiay', duong),
  srtNoiDung: (duong: string): Promise<string> => ipcRenderer.invoke('burn:srtNoiDung', duong),
  subtitleOptimize: (jobId: string, request: OptimizeSrtRequest): Promise<OptimizeSrtResult> =>
    ipcRenderer.invoke('subtitle:optimize', jobId, request),
  onSubtitleOptimizeProgress: (cb: (progress: SubtitleOptimizeProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: SubtitleOptimizeProgress): void => cb(progress)
    ipcRenderer.on('subtitle:optimize-progress', listener)
    return () => ipcRenderer.removeListener('subtitle:optimize-progress', listener)
  },
  subtitleRead: (path: string): Promise<SubtitleReadResult> => ipcRenderer.invoke('subtitle:read', path),
  subtitleSaveEdited: (path: string, cues: EditableSubtitleCue[]): Promise<SubtitleSaveResult> =>
    ipcRenderer.invoke('subtitle:saveEdited', path, cues),
  onBurnProgress: (cb: (p: BurnProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: BurnProgress): void => cb(p)
    ipcRenderer.on('burn:progress', listener)
    return () => ipcRenderer.removeListener('burn:progress', listener)
  },

  // ---- Dich phu de bang API key cua user ----
  geminiHasKey: (): Promise<boolean> => ipcRenderer.invoke('gemini:hasKey'),
  geminiKeys: (): Promise<GeminiKeyDescriptor[]> => ipcRenderer.invoke('gemini:keys'),
  geminiCheckNewKey: (key: string): Promise<GeminiStatus> => ipcRenderer.invoke('gemini:checkNewKey', key),
  geminiCheckStoredKey: (id: string): Promise<GeminiStoredKeyCheck> => ipcRenderer.invoke('gemini:checkStoredKey', id),
  geminiRemoveKey: (id: string): Promise<void> => ipcRenderer.invoke('gemini:removeKey', id),
  geminiSaveKey: (key: string): Promise<void> => ipcRenderer.invoke('gemini:saveKey', key),
  geminiCheckKey: (key: string): Promise<GeminiStatus> => ipcRenderer.invoke('gemini:checkKey', key),
  geminiModels: (): Promise<string[]> => ipcRenderer.invoke('gemini:models'),
  geminiDiscoverModels: (): Promise<GeminiModelDiscovery> => ipcRenderer.invoke('gemini:discoverModels'),
  geminiSaveModels: (models: string[]): Promise<void> => ipcRenderer.invoke('gemini:saveModels', models),
  geminiReadiness: (): Promise<GeminiReadiness> => ipcRenderer.invoke('gemini:readiness'),
  geminiTranslateSrt: (
    jobId: string,
    srtPath: string,
    outPath: string,
    dich: string
  ): Promise<GeminiTranslationResult> =>
    ipcRenderer.invoke('gemini:translateSrt', jobId, srtPath, outPath, dich),
  onGeminiProgress: (cb: (p: GeminiProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: GeminiProgress): void => cb(p)
    ipcRenderer.on('gemini:progress', listener)
    return () => ipcRenderer.removeListener('gemini:progress', listener)
  },

  whisperCudaStatus: (): Promise<WhisperCudaStatus> => ipcRenderer.invoke('whisper:cudaStatus'),
  whisperInstallCuda: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('whisper:installCuda'),
  onWhisperCudaProgress: (cb: (percent: number) => void): (() => void) => {
    const listener = (_e: unknown, p: number): void => cb(p)
    ipcRenderer.on('whisper:cuda-progress', listener)
    return () => ipcRenderer.removeListener('whisper:cuda-progress', listener)
  },
  onWhisperProgress: (cb: (p: WhisperProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: WhisperProgress): void => cb(p)
    ipcRenderer.on('whisper:progress', listener)
    return () => ipcRenderer.removeListener('whisper:progress', listener)
  },

  // ---- Text -> Giọng (VieNeu-TTS v3 native) ----
  vieneuEngineStatus: (): Promise<VieneuEngineStatus> => ipcRenderer.invoke('vieneu:engineStatus'),
  vieneuInstallEngine: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('vieneu:installEngine'),
  onVieneuInstallProgress: (cb: (progress: VieneuInstallProgress) => void): (() => void) => {
    const listener = (_e: unknown, progress: VieneuInstallProgress): void => cb(progress)
    ipcRenderer.on('vieneu:install-progress', listener)
    return () => ipcRenderer.removeListener('vieneu:install-progress', listener)
  },
  vieneuListVoices: (): Promise<VieneuVoice[]> => ipcRenderer.invoke('vieneu:listVoices'),
  vieneuPreview: (voiceId: string, speed?: number): Promise<VieneuPreviewResult> =>
    ipcRenderer.invoke('vieneu:preview', voiceId, speed),
  vieneuPreviewDraft: (refAudio: string, speed?: number): Promise<VieneuPreviewResult> =>
    ipcRenderer.invoke('vieneu:previewDraft', refAudio, speed),
  vieneuSrtToMp3: (id: string, req: VieneuSrtRequest): Promise<VieneuResult> =>
    ipcRenderer.invoke('vieneu:srtToMp3', id, req),
  vieneuCancel: (id: string): Promise<void> => ipcRenderer.invoke('vieneu:cancel', id),
  vieneuAddVoice: (label: string, refAudio: string): Promise<VieneuAddVoiceResult> =>
    ipcRenderer.invoke('vieneu:addVoice', label, refAudio),
  vieneuRemoveVoice: (voiceId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('vieneu:removeVoice', voiceId),
  onVieneuProgress: (cb: (progress: VieneuProgress) => void): (() => void) => {
    const listener = (_e: unknown, progress: VieneuProgress): void => cb(progress)
    ipcRenderer.on('vieneu:progress', listener)
    return () => ipcRenderer.removeListener('vieneu:progress', listener)
  },

  // ---- Text -> Giọng (CapCut online) ----
  capcutEngineStatus: (): Promise<CapcutEngineStatus> => ipcRenderer.invoke('capcut:engineStatus'),
  capcutInstallEngine: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('capcut:installEngine'),
  onCapcutInstallProgress: (cb: (progress: CapcutInstallProgress) => void): (() => void) => {
    const listener = (_e: unknown, progress: CapcutInstallProgress): void => cb(progress)
    ipcRenderer.on('capcut:install-progress', listener)
    return () => ipcRenderer.removeListener('capcut:install-progress', listener)
  },
  capcutListVoices: (): Promise<VieneuVoice[]> => ipcRenderer.invoke('capcut:listVoices'),
  capcutPreview: (voiceId: string, speed?: number): Promise<VieneuPreviewResult> =>
    ipcRenderer.invoke('capcut:preview', voiceId, speed),
  capcutSrtToMp3: (id: string, req: CapcutSrtRequest): Promise<VieneuResult> =>
    ipcRenderer.invoke('capcut:srtToMp3', id, req),
  capcutCancel: (id: string): Promise<void> => ipcRenderer.invoke('capcut:cancel', id),
  onCapcutProgress: (cb: (progress: VieneuProgress) => void): (() => void) => {
    const listener = (_e: unknown, progress: VieneuProgress): void => cb(progress)
    ipcRenderer.on('capcut:progress', listener)
    return () => ipcRenderer.removeListener('capcut:progress', listener)
  },

  // ---- Nhat ky hoat dong ----
  getLogs: (): Promise<LogEntry[]> => ipcRenderer.invoke('logs:get'),
  clearLogs: (): Promise<void> => ipcRenderer.invoke('logs:clear'),
  openLogFile: (): Promise<void> => ipcRenderer.invoke('logs:openFile'),

  // ---- Cache ket qua job ----
  cacheUsage: (): Promise<number> => ipcRenderer.invoke('cache:usage'),
  clearCache: (): Promise<void> => ipcRenderer.invoke('cache:clear'),
  onLog: (cb: (e: LogEntry) => void): (() => void) => {
    const listener = (_e: unknown, entry: LogEntry): void => cb(entry)
    ipcRenderer.on('logs:entry', listener)
    return () => ipcRenderer.removeListener('logs:entry', listener)
  },
  onLogsCleared: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('logs:cleared', listener)
    return () => ipcRenderer.removeListener('logs:cleared', listener)
  },

  // ---- Cookie dang nhap ----
  cookieStatus: (): Promise<CookieStatus> => ipcRenderer.invoke('cookies:status'),
  cookieClear: (): Promise<void> => ipcRenderer.invoke('cookies:clear'),
  cookieCapture: (url: string): Promise<CookieCaptureResult> =>
    ipcRenderer.invoke('cookies:capture', url),
  onCookieCaptureEvent: (cb: (e: CookieCaptureEvent) => void): (() => void) => {
    const listener = (_e: unknown, ev: CookieCaptureEvent): void => cb(ev)
    ipcRenderer.on('cookies:capture-event', listener)
    return () => ipcRenderer.removeListener('cookies:capture-event', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type TblaoApi = typeof api

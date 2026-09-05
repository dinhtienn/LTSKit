// Kieu du lieu dung chung giua main <-> preload <-> renderer

export type LogLevel = 'info' | 'warn' | 'error'
export interface LogEntry {
  time: string // ISO
  level: LogLevel
  msg: string
}

export interface DepStatus {
  ytdlp: boolean
  ffmpeg: boolean
  platform: NodeJS.Platform
}

export type SetupPhase = 'checking' | 'downloading-ytdlp' | 'downloading-ffmpeg' | 'extracting' | 'done' | 'error'

export interface SetupProgress {
  phase: SetupPhase
  message: string
  percent: number // 0..100, -1 neu khong xac dinh
}

export interface VideoFormat {
  format_id: string
  ext: string
  resolution: string | null
  height: number | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  filesize: number | null
  filesizeApprox: number | null
  tbr: number | null // total bitrate
  note: string | null
}

export interface VideoInfo {
  id: string
  title: string
  uploader: string | null
  duration: number | null // giay
  durationString: string | null
  thumbnail: string | null
  webpageUrl: string
  isPlaylist: boolean
  playlistCount: number | null
  formats: VideoFormat[]
  heights: number[] // cac do phan giai san co (video), giam dan
}

export interface PlaylistEntry {
  id: string
  title: string
  url: string
  uploader: string | null
  duration: number | null
  durationString: string | null
  isPlaylist?: boolean // entry nay ban than la playlist con (vd tab kenh: Videos/Shorts)
  count?: number | null // so video trong playlist con (neu biet)
}

export interface PlaylistProbe {
  isPlaylist: boolean
  title: string | null
  count: number
  entries: PlaylistEntry[]
}

export type DownloadKind = 'video' | 'audio'

export interface DownloadRequest {
  url: string
  kind: DownloadKind
  height: number | null // do phan giai mong muon cho video (null = tot nhat)
  audioFormat: string // vd 'mp3'
  outputDir: string
  embedThumbnail: boolean
  embedMetadata: boolean
  cookiesFile: string | null // duong dan cookies.txt neu dung cookie dang nhap
  formatId: string | null // bo chon dinh dang tuy chon (vd '137+bestaudio'); null = dung kind/height
  // --- P1 nang cao ---
  container: string // dinh dang file video khi ghep: mp4/mkv/webm
  outputTemplate: string // mau ten file yt-dlp (vd '%(title)s [%(id)s].%(ext)s')
  writeSubs: boolean // tai phu de
  autoSubs: boolean // ke ca phu de tu dong (ASR)
  subLangs: string // ngon ngu phu de, vd 'vi,en'
  embedSubs: boolean // nhung phu de vao video
  useArchive: boolean // bo qua file da tai (download archive)
  forceOverwrite: boolean // ghi de file trung
  proxy: string | null // proxy vuot khoa vung, vd 'socks5://127.0.0.1:1080' (null = khong dung)
}

export interface ProxyTestResult {
  ok: boolean
  message: string
}

// Tu cap nhat app
export interface UpdateStatus {
  state: 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

// ---- Douyin ----
export type DyMode = 'all' | 'batch' | 'new' // kieu tai (chi cho link kenh)

export interface DouyinRequest {
  url: string
  outputDir: string
  isChannel: boolean // link kenh/user (co Kieu tai) hay video don
  mode: DyMode
  batchSize: number // so video moi dot cho mode 'batch'
  music: boolean
  cover: boolean
  avatar: boolean
  metaJson: boolean
  proxy: string | null
  useCookies: boolean
}

export interface DouyinResult {
  id: string
  ok: boolean
  total: number
  success: number
  failed: number
  skipped: number
  error: string | null
}

export interface DouyinProgress {
  id: string
  status: 'preparing' | 'downloading' | 'finished' | 'error'
  line: string | null
  lastFile: string | null // ten video vua tai xong
  success: number
}

export interface DyEngineStatus {
  has: boolean
}

export interface DyCookieStatus {
  has: boolean
  count: number
}

export interface DyChannel {
  url: string
  name: string
  lastRun: string // ISO
  count: number // tong so video da tai tu kenh
}

// ---- Audio -> Text (whisper) ----
export type WhisperTask = 'transcribe' | 'translate'

export type WhisperDevice = 'cpu' | 'cuda'

export interface WhisperRequest {
  input: string // duong dan file audio/video
  outputDir: string
  model: string // 'base' | 'small' | 'medium'
  language: string // 'auto' | 'vi' | 'en' ...
  task: WhisperTask
  formats: string[] // ['srt','txt','vtt']
  device: WhisperDevice // 'cuda' neu user bat GPU va da co goi tang toc
  diarize: boolean // nhan dien ai noi luc nao (gan nhan [SPEAKER_xx])
  speakers: number // so nguoi noi (0 = tu doan)
}

export interface WhisperCudaStatus {
  has: boolean // da tai + giai nen goi tang toc CUDA chua
}

export interface WhisperProgress {
  id: string
  status: 'preparing' | 'transcribing' | 'finished' | 'error'
  percent: number // 0..100, -1 neu chua biet
  language: string | null
  line: string | null // doan text vua nhan / thong bao
}

export interface WhisperResult {
  id: string
  ok: boolean
  outputs: string[] // duong dan cac file .srt/.txt/.vtt
  segments: number
  speakers: number // so nguoi noi nhan dien duoc (0 neu khong bat diarize)
  error: string | null
}

export interface WhisperEngineStatus {
  has: boolean
}

// ---- Tab Dich man hinh (doc chu chay tren video) ----
export interface OcrEngineStatus {
  has: boolean
}
export interface OcrProgress {
  percent: number // -1 = chua tinh duoc (dang tach khung)
  text: string
}
export interface OcrResult {
  ok: boolean
  output?: string
  count?: number
  error?: string
  // Dai chu goc (pixel video) — buoc ghep video dung de che phu de cung san co.
  bandTop?: number | null
  bandBot?: number | null
}

// ---- Ghep phu de vao video (buoc phu cua tab Dich man hinh) ----
export interface VideoRect {
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface BlurRegion extends VideoRect {
  id: string
}

export interface TextOverlay {
  id: string
  text: string
  rect: VideoRect
  fontSize: number
  textColor: string
  textOpacity: number
  outlineColor: string
  outlinePx: number
  bgEnabled: boolean
  bgColor: string
  bgOpacity: number
  startSec: number
  endSec: number | null
}

export interface SubtitleStyle {
  fontId: string | null
  textColor: string
  textOpacity: number
  outlineColor: string
  outlinePx: number
  bgEnabled: boolean
  bgColor: string
  bgOpacity: number
}

export interface LogoOverlay {
  path: string
  rect: VideoRect
}

export interface MediaProbe {
  width: number
  height: number
  duration: number
  hasAudio: boolean
}

export interface LogoDimensions {
  width: number
  height: number
}

export interface BurnReq {
  video: string
  outputDir: string
  srt?: string | null
  mode?: 'burn' | 'soft'
  region?: VideoRect | null
  subRegion?: VideoRect | null
  subtitleStyle?: SubtitleStyle
  textFontId?: string | null
  textOverlays?: TextOverlay[]
  blurRegions?: BlurRegion[]
  lamMo?: boolean
  coChu?: CoChu
  catSrt?: boolean
  voice?: string | null
  videoVolume: number
  voiceVolume: number
  logo?: LogoOverlay | null
  ducking?: DuckingOptions
  /** Uu tien toc do hay chat luong khi xuat; mac dinh 'balanced'. */
  exportSpeed?: ExportSpeed
}
/** Muc uu tien khi xuat video: nhanh, can bang, hoac chat luong cao. */
export type ExportSpeed = 'fast' | 'balanced' | 'quality'
export interface DuckingOptions {
  enabled: boolean
  /** SRT dung de lay moc thoi gian giam am nen, doc lap voi phu de duoc ghep. */
  timingSrt?: string | null
  duckPercent: number
  attackMs: number
  releaseMs: number
}
/** Muc co chu user chon o tab Dich man hinh. */
export type CoChu = 'auto' | 'nho' | 'vua' | 'lon' | 'ratlon'
export interface BurnProgress {
  percent: number // -1 = chua tinh duoc
}
export interface BurnResult {
  ok: boolean
  output?: string
  error?: string
}

// ---- Text -> Giong (VieNeu-TTS v3 native CPU) ----
export interface CpsOptions {
  enabled: boolean
  targetCps: number
  maxExpandSeconds: number
  minGapSeconds: number
  maxBoundaryShiftSeconds: number
  minDurationSeconds: number
  balancePasses: number
}

export interface DubbingRewriteOptions {
  enabled: boolean
  maxAttempts: number
  overrunRatio: number
}

export type VieneuVoiceKind = 'preset' | 'clone'

export interface VieneuEngineStatus {
  has: boolean
  missing: string[]
}

export interface VieneuVoice {
  id: string
  label: string
  kind: VieneuVoiceKind
  gender: 'male' | 'female' | 'unknown'
  style?: 'tu_nhien' | 'tin_tuc' | 'doc_truyen'
  refAudio?: string
}

export interface VieneuInstallProgress {
  percent: number
  asset: string
  phase: 'downloading' | 'extracting' | 'validating' | 'smoke-test'
}

export interface VieneuSrtRequest {
  srt: string
  outputDir: string
  voiceId: string
  speed: number
}

export type SubtitlePurpose = 'standard' | 'dubbing'

export interface OptimizeSrtRequest {
  inputPath: string
  outputDir: string
  targetCps: number
}

export interface SubtitleOptimizeWarning {
  cueIndex: number
  message: string
}

export interface OptimizeSrtResult {
  ok: boolean
  output?: string
  totalCues?: number
  rewrittenCues?: number
  retimedCues?: number
  remainingOverCps?: number
  averageCps?: number
  warnings?: SubtitleOptimizeWarning[]
  error?: string
}

export interface SubtitleOptimizeProgress {
  jobId: string
  done: number
  total: number
}

export interface EditableSubtitleCue {
  id: string
  index: number
  start: string
  end: string
  text: string
}

export interface SubtitleReadResult {
  ok: boolean
  cues?: EditableSubtitleCue[]
  error?: string
}

export interface SubtitleSaveResult {
  ok: boolean
  output?: string
  error?: string
}

export interface VieneuProgress {
  id: string
  status: 'preparing' | 'synthesizing' | 'mixing' | 'finished' | 'error'
  percent: number
  current: number
  total: number
  line: string | null
}

export interface VieneuResult {
  id: string
  ok: boolean
  output: string | null
  error: string | null
}

export interface VieneuPreviewResult {
  ok: boolean
  path: string | null
  error: string | null
}

export interface VieneuAddVoiceResult {
  ok: boolean
  voice?: VieneuVoice
  error?: string
}

// ---- CapCut TTS (online, optional provider) ----
export type TtsProvider = 'vieneu' | 'capcut'

export interface CapcutEngineStatus {
  has: boolean
  python: string | null
  message: string
  needsPython?: boolean
}

export interface CapcutInstallProgress {
  percent: number
  phase: 'venv' | 'pip' | 'verify'
  line: string
}

export interface CapcutSrtRequest extends VieneuSrtRequest {
  profileCount: number
}

/** Ket qua kiem tra API key. `message` di THANG len UI — khong duoc mang chi
 *  tiet ky thuat nao. */
export interface GeminiStatus {
  ok: boolean
  message: string
}

export interface GeminiKeyDescriptor {
  id: string
  masked: '********'
}

export interface GeminiStoredKeyCheck extends GeminiStatus {
  key: string
}

export interface GeminiProgress {
  jobId: string
  done: number
  total: number
}

export interface GeminiReadiness {
  hasKey: boolean
  hasModels: boolean
}

export type GeminiModelDiscovery = { ok: true; models: string[] } | { ok: false; error: string }

export interface GeminiTranslationResult {
  ok: boolean
  error?: string
  count?: number
  output?: string
  verified?: boolean
}

/** 1 khoi phu de: moc thoi gian + chu. Moc thoi gian KHONG bao gio gui cho AI. */
export interface SrtBlock {
  time: string
  text: string
}

/** Dich phu de sang tieng nao. AI dich duoc moi thu — day chi la danh sach goi y. */
export const DICH_LANGS = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'Tiếng Anh' },
  { code: 'zh', label: 'Tiếng Trung' },
  { code: 'ja', label: 'Tiếng Nhật' },
  { code: 'ko', label: 'Tiếng Hàn' }
] as const

// Ket qua quet GPU (buoc an toan truoc khi cho tai goi tang toc CUDA)
export interface GpuInfo {
  hasNvidia: boolean // may co GPU NVIDIA + driver (nvidia-smi chay duoc) khong
  name: string | null // vd 'NVIDIA GeForce GTX 1050 Ti'
  driverVersion: string | null // vd '582.28'
  cudaVersion: string | null // CUDA toi da driver ganh duoc, vd '13.0'
  cudaMajor: number | null // phan nguyen, vd 13
  canAccelerate: boolean // du dieu kien tang toc (NVIDIA + CUDA >= 12)
  reason: string | null // ly do KHONG tang toc duoc (de bao user)
}

export type DownloadStatus = 'preparing' | 'downloading' | 'postprocessing' | 'finished' | 'error'

export interface DownloadProgress {
  id: string
  status: DownloadStatus
  percent: number // 0..100
  downloadedBytes: number | null
  totalBytes: number | null
  speed: number | null // bytes/s
  eta: number | null // giay
  line: string | null // dong log tho (neu can)
}

export interface DownloadResult {
  id: string
  ok: boolean
  file: string | null
  error: string | null
}

// ---- Cookie dang nhap (Playwright) ----

export interface CookieDepStatus {
  python: boolean
  playwright: boolean
  chromium: boolean
}

export interface CookieStatus {
  has: boolean
  path: string
  count: number
}

export interface CookieProfile {
  id: string
  kind: 'web' | 'legacy' | 'douyin'
  label: string
  loginUrl: string
  count: number
}

export type CookieInstallPhase = 'checking' | 'installing-playwright' | 'installing-chromium' | 'done' | 'error'

export interface CookieInstallProgress {
  phase: CookieInstallPhase
  message: string
}

export type CookieCapturePhase = 'launching' | 'ready' | 'saved' | 'error'

export interface CookieCaptureEvent {
  phase: CookieCapturePhase
  message: string
  count?: number
}

export interface CookieCaptureResult {
  ok: boolean
  count: number
  path: string | null
  error: string | null
}

import { spawn, type ChildProcess } from 'node:child_process'
import { basename, join } from 'node:path'
import { copyFile, mkdtemp, readFile, writeFile, stat, rm, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolveFfmpeg } from './deps'
import { debugRaw, errLabel, logInfo } from './logger'
import {
  buildComposerPlan,
  decodeAuxiliaryAsset,
  probeAsset,
  probeMediaWithFfmpeg,
  validateBurnRequest,
  validateAndDecodeComposerAssets
} from './videoComposer'
import type { BurnReq, BurnProgress, BurnResult, CoChu, SubtitleStyle, TextOverlay, VideoRect } from '../shared/types'

let child: ChildProcess | null = null

type BurnState = 'idle' | 'running' | 'committing'

export class BurnLifecycle {
  private state: BurnState = 'idle'
  private cancelled = false

  start(): boolean {
    if (this.state !== 'idle') return false
    this.state = 'running'
    this.cancelled = false
    return true
  }

  cancel(): boolean {
    if (this.state !== 'running') return false
    this.cancelled = true
    return true
  }

  isCancelled(): boolean {
    return this.cancelled
  }

  beginCommit(): boolean {
    if (this.state !== 'running' || this.cancelled) return false
    this.state = 'committing'
    return true
  }

  finish(): void {
    this.state = 'idle'
    this.cancelled = false
  }

  current(): BurnState {
    return this.state
  }
}

const burnLifecycle = new BurnLifecycle()

/** Huy giua chung: giet ffmpeg. child.kill() thoat ma null -> hieu la huy, khong loi. */
export function cancelBurn(): void {
  if (!burnLifecycle.cancel()) return
  if (!child) return
  try {
    child.kill()
  } catch {
    /* bo qua */
  }
}

interface Meta {
  w: number
  h: number
  giay: number
}

export interface BoCuc {
  che: boolean // co che phu de goc khong
  x: number // mep trai dai che (pixel)
  bw: number // chieu rong dai che
  y: number // mep tren dai che (pixel)
  bh: number // chieu cao dai che
  sigma: number // do manh blur (gaussian)
  fontSize: number // co chu (PIXEL VIDEO — nho .ass co PlayResY = chieu cao video)
  vien: number // do day vien
  marginV: number // le duoi (pixel video)
  marginH: number // le trai/phai (pixel video)
  tamX: number | null // tam ngang khung — dat chu can giua quanh diem nay
  tamY: number | null // tam doc khung — dat chu can giua quanh diem nay (null = canh day)
}

/**
 * Bo tham so bo cuc — video NGANG va DOC dung 2 bo KHAC NHAU.
 * Vi sao phai tach: video doc (9:16) co chieu cao rat lon nhung khung hep, ma
 * thang co chu lai tinh theo chieu cao -> 3.5%/4.5%/5.5% cua 1920 deu vuot xa
 * muc be rong cho phep, bi chan het ve cung MOT so (user doi Vua/Lon/Rat lon ma
 * chu khong nhuc nhich). Voi video doc phai lay moc theo BE RONG.
 */
interface ThamSo {
  theoCao: boolean // moc tinh co chu: chieu cao (ngang) hay be rong (doc)
  tuDong: number // co chu tu dong khi KHONG co khung mo
  thang: Record<'nho' | 'vua' | 'lon' | 'ratlon', number>
  min: number
  max: number
  le: number // le trai/phai (ti le be rong)
}
// Ngang: GIU NGUYEN so cu (dang chay tot, khong dung vao).
const NGANG: ThamSo = {
  theoCao: true,
  tuDong: 0.042,
  thang: { nho: 0.025, vua: 0.035, lon: 0.045, ratlon: 0.055 },
  min: 0.02,
  max: 0.055,
  le: 0.04
}
// Doc: moc theo be rong, chu to hon va cho phep 2-3 dong (kieu TikTok/Reels).
// Thang trai deu tu min den max nen khong con canh 3 muc ra cung mot co.
const DOC: ThamSo = {
  theoCao: false,
  tuDong: 0.045,
  thang: { nho: 0.035, vua: 0.045, lon: 0.055, ratlon: 0.065 },
  min: 0.035,
  max: 0.065,
  le: 0.05
}

/**
 * Tinh bo cuc dot chu tu kich thuoc video + dai chu goc.
 * Che phu de goc kieu BLUR (kinh mo, giong CapCut) — do that dep hon thanh den
 * cung. Huong video (ngang/doc) lay tu ffprobe -> chon bo tham so tuong ung.
 * Dai mo giu DUNG khung user keo; chu can giua quanh tam dai do va duoc phep
 * tran ra ngoai.
 */
export function boCuc(meta: Meta, region?: VideoRect | null, coChu?: CoChu, lamMo?: boolean): BoCuc {
  const co = meta.h > 0 ? meta.h : 720
  const rong = meta.w > 0 ? meta.w : 1280
  // Vuong (1:1) tinh la DOC -> moc theo be rong, dung y do.
  const ts = rong < co ? DOC : NGANG
  const moc = ts.theoCao ? co : rong
  const marginH = Math.round(rong * ts.le)
  const fMin = Math.round(moc * ts.min)
  const fMax = Math.max(fMin, Math.round(moc * ts.max))
  const chan = (px: number): number => Math.max(fMin, Math.min(fMax, Math.round(px)))
  // KHONG con chan theo be rong nua: tu xuong dong (WrapStyle 0) da lo chuyen
  // tran ngang, nen chan them chi lam thang co chu bi bop lai.
  const tay = coChu && coChu !== 'auto' ? ts.thang[coChu] : null

  let fontSize = tay ? chan(moc * tay) : chan(moc * ts.tuDong)
  let che = false
  let x = 0
  let bw = rong
  let y = 0
  let bh = 0
  let marginV = Math.round(co * 0.04)

  // KHUNG USER KEO = NOI DAT CHU (doc lap voi chuyen lam mo). Tick lam mo chi
  // THEM nen mo vao dung vung do. Nho vay bat/tat lam mo khong lam chu nhay cho.
  const coKhung = region != null && region.x1 > region.x0 && region.y1 > region.y0
  if (coKhung) {
    x = Math.max(0, region.x0)
    y = Math.max(0, region.y0)
    bw = Math.min(rong - x, region.x1 - region.x0)
    bh = Math.min(co - y, region.y1 - region.y0)
    // Tu dong khi CO khung: theo chieu cao khung user keo (1 dong vua khung).
    fontSize = tay ? chan(moc * tay) : chan(bh * 0.5)
    che = !!lamMo // chi mo khi user tick
  }
  const tamX = coKhung ? Math.round(((region as VideoRect).x0 + (region as VideoRect).x1) / 2) : null
  const tamY = coKhung ? Math.round(((region as VideoRect).y0 + (region as VideoRect).y1) / 2) : null

  // !! DAI MO = DUNG KHUNG USER KEO, HE THONG KHONG TU DOI.
  // Truoc day co doan tu noi dai mo cho vua so dong chu — da BO. User keo bao
  // nhieu thi mo bay nhieu, ton trong lua chon cua ho. Chu duoc phep tran ra
  // ngoai vung mo mot cach tu do (van doc duoc nho vien den quanh chu).
  // Bo luon ca bo uoc luong so dong: no chi phuc vu viec noi dai mo, ma uoc
  // luong tu so ky tu thi khong bao gio chuan.

  // crop/overlay tren yuv420p: toa do va kich thuoc le se lam ffmpeg vo.
  x = Math.floor(x / 2) * 2
  y = Math.floor(y / 2) * 2
  bw = Math.floor(bw / 2) * 2
  bh = Math.floor(bh / 2) * 2
  if (bw < 2) bw = 2
  if (bh < 2) bh = 2
  if (x + bw > rong) bw = Math.max(2, rong - x - ((rong - x) % 2))
  if (y + bh > co) bh = Math.max(2, co - y - ((co - y) % 2))
  const vien = Math.max(1, Math.round(fontSize * 0.12)) // vien ti le co chu
  // Co KHUNG -> dat chu can giua quanh tam khung (xem taoAss), du co lam mo hay
  // khong. Khong co khung -> null, chu ve vi tri phu de tieu chuan (sat day).
  return {
    che,
    x,
    bw,
    y,
    bh,
    sigma: Math.max(8, Math.round(co * 0.03)),
    fontSize,
    vien,
    marginV,
    marginH,
    tamX,
    tamY
  }
}

/** Mot cau phu de da tach khoi .srt. */
export interface SrtCue {
  a: string // moc bat dau
  b: string // moc ket thuc
  chu: string // noi dung (nhieu dong noi bang \N)
}

/**
 * Tach .srt thanh danh sach cau. Tach RIENG (khong nam trong taoAss) vi phan
 * tinh bo cuc cung can dem so ky tu de biet chu se xuong may dong.
 */
export function docSrt(srtRaw: string): SrtCue[] {
  const out: SrtCue[] = []
  // Moi khoi = so thu tu / moc "a --> b" / cac dong chu.
  for (const k of srtRaw.replace(/^﻿/, '').split(/\r?\n\r?\n+/)) {
    const dong = k
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
    const iMoc = dong.findIndex((d) => d.includes('-->'))
    if (iMoc < 0) continue
    const [a, b] = dong[iMoc].split('-->')
    const chu = dong
      .slice(iMoc + 1)
      .join('\\N')
      .replace(/[{}]/g, '') // { } la ky tu dieu khien cua .ass -> bo di
    if (!chu) continue
    out.push({ a, b, chu })
  }
  return out
}

/** Moc thoi gian .srt "HH:MM:SS,mmm" -> so giay. Hong thi tra 0. */
export function srtTimeToSeconds(t: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t.trim())
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
}

/**
 * Thoi diem KET THUC cua cau cuoi trong file .srt (giay). Dung de canh bao user
 * khi ho chon nham file phu de lech han so voi video.
 */
export async function srtGiay(duong: string): Promise<number> {
  try {
    const cues = docSrt(await readFile(duong, 'utf8'))
    let max = 0
    for (const c of cues) max = Math.max(max, srtTimeToSeconds(c.b))
    return max
  } catch {
    return 0
  }
}

export async function srtNoiDung(duong: string): Promise<string> {
  try {
    return await readFile(duong, 'utf8')
  } catch {
    return ''
  }
}

/** So giay -> moc .srt "HH:MM:SS,mmm". */
function mocSrt(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000))
  const p = (n: number, d = 2): string => String(n).padStart(d, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`
}

/**
 * Cat .srt cho vua thoi luong video: bo han cau bat dau sau khi video da het,
 * va keo mep cuoi cua cau VAT NGANG ve dung luc video ket thuc.
 *
 * !! TU CAT chu KHONG dung co san cua ffmpeg — da do that ca hai deu sai:
 *    - `-shortest`: LAM MAT HAN cau vat ngang (cau 2s->10s tren video 3s cho ra
 *      luong phu de rong tuot, mat ca doan dang le phai hien tu giay 2 den 3).
 *    - `-t` / `-to`: khong dung gi toi luong phu de (van de nguyen 10s).
 */
export function catSrtTheoVideo(cues: SrtCue[], giayVideo: number): string {
  const ra: string[] = []
  for (const c of cues) {
    const batDau = srtTimeToSeconds(c.a)
    if (batDau >= giayVideo) continue // cau khong bao gio hien -> bo
    const ketThuc = Math.min(srtTimeToSeconds(c.b), giayVideo) // cau vat ngang -> keo ve cuoi video
    if (ketThuc <= batDau) continue
    ra.push(`${ra.length + 1}\n${mocSrt(batDau)} --> ${mocSrt(ketThuc)}\n` + `${c.chu.split('\\N').join('\n')}\n`)
  }
  return ra.join('\n')
}

/** Doi mot moc thoi gian .srt "HH:MM:SS,mmm" -> .ass "H:MM:SS.cc". */
function gioAss(t: string): string {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t.trim())
  if (!m) return '0:00:00.00'
  const cs = Math.round(Number((m[4] + '00').slice(0, 3)) / 10)
  return `${Number(m[1])}:${m[2]}:${m[3]}.${String(cs).padStart(2, '0')}`
}

function giayAss(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100))
  const hours = Math.floor(centiseconds / 360000)
  const minutes = Math.floor((centiseconds % 360000) / 6000)
  const secs = Math.floor((centiseconds % 6000) / 100)
  const fraction = centiseconds % 100
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`
}

function assColor(hex: string, opacity = 100): string {
  const raw = hex.replace(/^#/, '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((part) => part + part)
          .join('')
      : raw
  const alpha = Math.round(255 * (1 - Math.max(0, Math.min(100, opacity)) / 100))
  return `&H${alpha.toString(16).padStart(2, '0')}${full.slice(4, 6)}${full.slice(2, 4)}${full.slice(0, 2)}&`.toUpperCase()
}

function assText(text: string): string {
  return text.replace(/[{}]/g, '').replace(/\r\n|\r|\n/g, '\\N')
}

const FONT_FAMILIES: Record<string, string> = {
  arial: 'Arial',
  segoe: 'Segoe UI',
  times: 'Times New Roman',
  tahoma: 'Tahoma'
}

/**
 * .srt -> .ass, ĐẶT PlayResX/Y = KICH THUOC VIDEO. Vi sao KHONG dung filter
 * `subtitles=...:force_style`: no doc .srt voi PlayResY mac dinh (~288) nen
 * FontSize/MarginV (tinh theo pixel video) bi phong ~2.5x va DAT SAI CHO -> chu
 * khong nam trong dai mo. Da do that. Voi PlayRes = video thi moi so la pixel that.
 */
export function taoAss(
  cues: SrtCue[],
  meta: Meta,
  bc: BoCuc | null,
  textOverlays: TextOverlay[] = [],
  textFontFamily = 'Arial',
  subtitleStyle?: SubtitleStyle
): string {
  const w = meta.w > 0 ? meta.w : 1280
  const h = meta.h > 0 ? meta.h : 720
  const styles: string[] = []
  const events: string[] = []

  if (bc) {
    const subtitleFont = FONT_FAMILIES[subtitleStyle?.fontId ?? 'arial'] ?? 'Arial'
    const primary = assColor(subtitleStyle?.textColor ?? '#ffffff', subtitleStyle?.textOpacity ?? 100)
    const outline = assColor(subtitleStyle?.outlineColor ?? '#000000', 100)
    const outlinePx = subtitleStyle?.outlinePx ?? bc.vien
    styles.push(
      `Style: D,${subtitleFont},${bc.fontSize},${primary},&H00000000&,${outline},&H00000000&,` +
        `0,0,0,0,100,100,0,0,1,${outlinePx},0,2,${bc.marginH},${bc.marginH},${bc.marginV},1`
    )
    if (subtitleStyle?.bgEnabled) {
      const background = assColor(subtitleStyle.bgColor, subtitleStyle.bgOpacity)
      styles.push(
        `Style: DBox,${subtitleFont},${bc.fontSize},&HFF000000&,&H00000000&,${background},&H00000000&,` +
          `0,0,0,0,100,100,0,0,3,8,0,2,${bc.marginH},${bc.marginH},${bc.marginV},1`
      )
    }

    const dat = bc.tamX != null && bc.tamY != null ? `{\\an5\\pos(${bc.tamX},${bc.tamY})}` : ''
    for (const cue of cues) {
      if (subtitleStyle?.bgEnabled) {
        events.push(`Dialogue: 0,${gioAss(cue.a)},${gioAss(cue.b)},DBox,,0,0,0,,${dat}${cue.chu}`)
        events.push(`Dialogue: 1,${gioAss(cue.a)},${gioAss(cue.b)},D,,0,0,0,,${dat}${cue.chu}`)
      } else {
        events.push(`Dialogue: 0,${gioAss(cue.a)},${gioAss(cue.b)},D,,0,0,0,,${dat}${cue.chu}`)
      }
    }
  }

  for (const [index, item] of textOverlays.entries()) {
    const name = `Text${index}`
    const primary = assColor(item.textColor, item.textOpacity)
    const outline = assColor(item.outlineColor, 100)
    const marginLeft = Math.round(item.rect.x0)
    const marginRight = Math.round(w - item.rect.x1)
    styles.push(
      `Style: ${name},${textFontFamily},${item.fontSize},${primary},&H00000000&,${outline},&H00000000&,` +
        `0,0,0,0,100,100,0,0,1,${item.outlinePx},0,5,${marginLeft},${marginRight},0,1`
    )
    if (item.bgEnabled) {
      const boxName = `${name}Box`
      const background = assColor(item.bgColor, item.bgOpacity)
      styles.push(
        `Style: ${boxName},${textFontFamily},${item.fontSize},&HFF000000&,&H00000000&,${background},&H00000000&,` +
          `0,0,0,0,100,100,0,0,3,8,0,5,${marginLeft},${marginRight},0,1`
      )
    }
    const x = Math.round((item.rect.x0 + item.rect.x1) / 2)
    const y = Math.round((item.rect.y0 + item.rect.y1) / 2)
    const position = `{\\an5\\pos(${x},${y})}`
    const start = giayAss(item.startSec)
    const end = giayAss(item.endSec ?? meta.giay)
    const text = assText(item.text)
    if (item.bgEnabled) {
      events.push(`Dialogue: 0,${start},${end},${name}Box,,0,0,0,,${position}${text}`)
      events.push(`Dialogue: 1,${start},${end},${name},,0,0,0,,${position}${text}`)
    } else {
      events.push(`Dialogue: 0,${start},${end},${name},,0,0,0,,${position}${text}`)
    }
  }

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    // 0 = tu xuong dong thong minh (cac dong deu nhau). PHAI la 0: truoc dung 2
    // (= TAT tu xuong dong) nen cau dai chay thang ra ngoai khung, video doc 9:16
    // tran nang nhat. \N trong text van xuong dong nhu cu.
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ''
  ].join('\n')
}

/** Chay 1 lan ffmpeg, bao tien do theo `time=` tren stderr. */
async function chay(ff: string, args: string[], cwd: string, meta: Meta, onProgress: (p: BurnProgress) => void): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn(ff, args, { cwd, windowsHide: true })
    child = p
    let errTail = ''
    let settled = false
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      if (child === p) child = null
      resolve(code)
    }
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s)
      if (m && meta.giay > 0) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        onProgress({
          percent: Math.min(99, Math.round((sec / meta.giay) * 100))
        })
      }
      const last = s.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })
    p.on('error', (err) => {
      debugRaw('burn spawn', err)
      finish(-1)
    })
    p.on('close', (code) => {
      if (settled) return
      if (code !== 0 && errTail) debugRaw('burn close', errTail)
      finish(code)
    })
  })
}

async function duLon(f: string): Promise<boolean> {
  try {
    return (await stat(f)).size > 4096 // nvenc hong -> file 0 byte / vai byte
  } catch {
    return false
  }
}

/**
 * Ghep phu de vao video.
 *  - 'soft': ghep mem (ranh sub), nhanh, giu nguyen chat — xem tren may.
 *  - 'burn': dot chet vao pixel (dang lai) + che phu de goc bang BLUR (kinh mo).
 * Encoder: thu h264_nvenc (GPU) -> tut libx264 (nvenc de chet vi driver, ra 0 byte).
 */
export async function burnSubtitle(req: BurnReq, onProgress: (p: BurnProgress) => void): Promise<BurnResult> {
  if (!burnLifecycle.start()) return { ok: false, error: 'Đang xử lý một video khác.' }
  let tam: string | null = null
  try {
    const ff = await resolveFfmpeg()
    if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

    const goc = basename(req.video).replace(/\.[^.]+$/, '')
    const output = join(req.outputDir, `${goc}-xuat.mp4`)
    tam = await mkdtemp(join(req.outputDir, '.ltskit-burn-'))
    const srtTam = join(tam, 'sub.srt')
    const assTam = join(tam, 'sub.ass')
    let probe
    try {
      probe = await probeMediaWithFfmpeg(ff, req.video)
    } catch (err) {
      return { ok: false, error: errLabel(err) }
    }
    const error = validateBurnRequest(req, probe)
    if (error) return { ok: false, error }
    let voiceProbe = null
    let logoProbe = null
    try {
      if (req.voice) voiceProbe = await probeAsset(ff, req.voice)
    } catch {
      return {
        ok: false,
        error: 'File voice không tồn tại, không đọc được hoặc không có âm thanh hợp lệ.'
      }
    }
    try {
      if (req.logo) logoProbe = await probeAsset(ff, req.logo.path)
    } catch {
      return {
        ok: false,
        error: 'File logo không tồn tại hoặc không đọc được hình ảnh hợp lệ.'
      }
    }
    const assetError = await validateAndDecodeComposerAssets(req, { voice: voiceProbe, logo: logoProbe }, (kind, path) => decodeAuxiliaryAsset(ff, kind, path))
    if (assetError) return { ok: false, error: assetError }
    const meta: Meta = {
      w: probe.width,
      h: probe.height,
      giay: probe.duration
    }
    let composerReq = req
    const textOverlays = req.textOverlays ?? []
    const hasBurnAss = (Boolean(req.srt) && req.mode === 'burn') || textOverlays.length > 0

    if (req.srt) {
      await copyFile(req.srt, srtTam)
      if (req.catSrt) {
        const cues = docSrt(await readFile(srtTam, 'utf8'))
        await writeFile(srtTam, catSrtTheoVideo(cues, meta.giay), 'utf8')
        logInfo('Dịch màn hình: đã cắt phụ đề cho vừa độ dài video.')
      }
      composerReq = { ...req, srt: 'sub.srt' }
    }

    if (hasBurnAss) {
      const cues = req.srt && req.mode === 'burn' ? docSrt(await readFile(srtTam, 'utf8')) : []
      const subRect = req.subRegion ?? req.region
      const bc = cues.length > 0 ? boCuc(meta, subRect, req.coChu, false) : null
      const textFontFamily = FONT_FAMILIES[req.textFontId ?? 'arial'] ?? 'Arial'
      await writeFile(assTam, taoAss(cues, meta, bc, textOverlays, textFontFamily, req.subtitleStyle), 'utf8')
    }

    const plan = buildComposerPlan(composerReq, probe, 'sub.ass')
    const inputArgs: string[] = ['-i', req.video]
    for (const [index, input] of plan.inputs.entries()) {
      if (req.logo && index === 0) inputArgs.push('-loop', '1')
      inputArgs.push('-i', input)
    }
    const commonArgs = ['-y', ...inputArgs]
    if (plan.filterComplex) commonArgs.push('-filter_complex', plan.filterComplex)
    for (const map of plan.maps) commonArgs.push('-map', map)
    if (plan.softSubtitleInput !== null) {
      commonArgs.push('-c:s', 'mov_text', '-metadata:s:s:0', 'language=vie')
    }
    commonArgs.push(...(plan.changesAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'copy']))
    commonArgs.push('-t', String(meta.giay))

    const encoders: Array<{ ten: string; gpu: boolean; args: string[] }> = plan.changesPixels
      ? [
          {
            ten: 'h264_nvenc',
            gpu: true,
            args: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23']
          },
          {
            ten: 'h264_amf',
            gpu: true,
            args: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23']
          },
          {
            ten: 'h264_qsv',
            gpu: true,
            args: ['-c:v', 'h264_qsv', '-global_quality', '23']
          },
          {
            ten: 'libx264',
            gpu: false,
            args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '20']
          }
        ]
      : [{ ten: 'copy', gpu: false, args: ['-c:v', 'copy'] }]

    logInfo(`Dịch màn hình: ghép nội dung vào ${basename(req.video)}…`)
    for (const [attempt, enc] of encoders.entries()) {
      if (burnLifecycle.isCancelled()) break
      const attemptOutput = temporaryOutputPath(tam, attempt)
      const code = await chay(ff, [...commonArgs, ...enc.args, attemptOutput], tam, meta, onProgress)
      if (burnLifecycle.isCancelled()) return { ok: false, error: 'Đã huỷ.' }
      const validOutput = code === 0 && (await duLon(attemptOutput))
      if (burnLifecycle.isCancelled()) return { ok: false, error: 'Đã huỷ.' }
      if (validOutput) {
        const promotion = await promoteOutput(attemptOutput, output, burnLifecycle)
        if (promotion === 'cancelled') return { ok: false, error: 'Đã huỷ.' }
        logInfo(`Dịch màn hình: ghép video xong${enc.gpu ? ' (tăng tốc GPU)' : ''}.`)
        return { ok: true, output }
      }
      await rm(attemptOutput, { force: true })
    }
    if (burnLifecycle.isCancelled()) return { ok: false, error: 'Đã huỷ.' }
    return { ok: false, error: 'Ghép video thất bại.' }
  } finally {
    try {
      if (tam) {
        try {
          await rm(tam, { recursive: true, force: true })
        } catch (err) {
          debugRaw('burn cleanup', err)
        }
      }
    } finally {
      burnLifecycle.finish()
    }
  }
}

export function temporaryOutputPath(jobDir: string, attempt: number): string {
  return join(jobDir, `attempt-${attempt}-${randomUUID()}.mp4`)
}

export interface PromotionHooks {
  afterBackup?: () => void | Promise<void>
  afterPromote?: () => void | Promise<void>
  afterCommitBoundary?: () => void | Promise<void>
}

interface PromotionControl {
  isCancelled: () => boolean
  beginCommit: () => boolean
}

export async function promoteOutput(
  source: string,
  destination: string,
  cancellation: (() => boolean) | PromotionControl = () => false,
  hooks: PromotionHooks = {}
): Promise<'committed' | 'cancelled'> {
  const control: PromotionControl =
    typeof cancellation === 'function'
      ? {
          isCancelled: cancellation,
          beginCommit: () => !cancellation()
        }
      : cancellation
  const backup = `${destination}.backup-${randomUUID()}`
  let hasBackup = false
  let promoted = false
  const rollbackCancellation = async (): Promise<'cancelled'> => {
    if (promoted) await rm(destination, { force: true })
    else await rm(source, { force: true })
    if (hasBackup) {
      await rename(backup, destination)
      hasBackup = false
    }
    return 'cancelled'
  }
  try {
    try {
      await rename(destination, backup)
      hasBackup = true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    await hooks.afterBackup?.()
    if (control.isCancelled()) return await rollbackCancellation()
    try {
      await rename(source, destination)
      promoted = true
    } catch (err) {
      if (hasBackup) {
        await rename(backup, destination)
        hasBackup = false
      }
      throw err
    }
    await hooks.afterPromote?.()
    if (!control.beginCommit()) return await rollbackCancellation()
    await hooks.afterCommitBoundary?.()
    if (hasBackup) {
      hasBackup = false
      try {
        await rm(backup, { force: true })
      } catch (err) {
        debugRaw('burn backup cleanup', err)
      }
    }
    return 'committed'
  } catch (err) {
    if (hasBackup) {
      try {
        await stat(destination)
      } catch {
        try {
          await rename(backup, destination)
        } catch (restoreError) {
          debugRaw('burn destination restore', restoreError)
        }
      }
    }
    throw err
  }
}

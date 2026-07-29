import { readFile, writeFile, rm } from 'node:fs/promises'
import { debugRaw, errLabel, logInfo } from './logger'
import {
  DICH_LANGS,
  type GeminiStatus,
  type GeminiTranslationResult,
  type SrtBlock
} from '../shared/types'
import { hasKey, loadKey, saveKey } from './geminiStore'
import { advanceModelCursor, orderedPool } from './geminiModels'
export { hasKey, loadKey, saveKey }

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export interface GenKQ {
  ok: boolean
  text?: string
  lui?: boolean
  status?: number
  err?: string
  timeout?: boolean
}

export type GeminiGenerate = (sys: string, user: string, schema: object) => Promise<GenKQ>

export function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError'
}

// fetch cua Node KHONG tu het gio. Google mo ket noi roi im -> cho VINH VIEN,
// nut quay mai, khong co duong thoat. Bat buoc phai tu dat han.
const HAN_KIEM = 20_000 // kiem key: 1 cau "xin chào", 20s la qua du
const HAN_DICH = 180_000 // dich 1 chunk 6k ky tu: do that 14-60s

async function goi(
  key: string,
  model: string,
  sys: string,
  user: string,
  schema?: object,
  han = HAN_DICH
): Promise<GenKQ> {
  const cfg: Record<string, unknown> = { temperature: 0.2 }
  if (schema) {
    cfg.responseMimeType = 'application/json'
    cfg.responseSchema = schema
  }
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: cfg
  }
  if (sys) body.systemInstruction = { parts: [{ text: sys }] }
  let res: Response
  try {
    res = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(han)
    })
  } catch (e) {
    return { ok: false, lui: true, status: 0, err: String(e), timeout: isTimeoutError(e) }
  }
  if (!res.ok) {
    const t = await res.text()
    return { ok: false, lui: res.status === 429 || res.status >= 500, status: res.status, err: t }
  }
  const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text.trim()) return { ok: false, lui: false, status: 200, err: 'rỗng' }
  return { ok: true, text }
}

export async function callModelsInRotation(
  models: string[],
  request: (model: string) => Promise<GenKQ>,
  onSuccess: (model: string) => Promise<void>
): Promise<GenKQ> {
  if (!models.length) return { ok: false, err: 'Chưa chọn model Gemini.' }
  let last: GenKQ = { ok: false, err: 'Hết model Gemini.' }
  for (const model of models) {
    const result = await request(model)
    if (result.ok) {
      await onSuccess(model)
      return result
    }
    debugRaw(`gemini ${model}`, result.err)
    last = result
    if (!result.lui) return result
  }
  return last
}

async function goiCoLui(
  key: string,
  sys: string,
  user: string,
  schema?: object,
  han?: number
): Promise<GenKQ> {
  return callModelsInRotation(
    await orderedPool(),
    (model) => goi(key, model, sys, user, schema, han),
    advanceModelCursor
  )
}

/**
 * Kiem tra khoa = gui MOT cau chao that don gian, co tra loi la khoa con song.
 * Khong system instruction, khong schema — cang it thu cang it cho hong.
 * UI chi duoc bao dung/khong: khong ten model, khong so lieu.
 */
export async function checkKey(key: string): Promise<GeminiStatus> {
  const k = key.trim() || (await loadKey())
  if (!k) return { ok: false, message: 'Chưa nhập API key.' }

  const models = await orderedPool()
  if (!models.length) {
    return { ok: false, message: 'Đã lưu API key. Hãy bấm “Lấy model từ Gemini” để chọn model dịch.' }
  }

  // Co mang thi Google LUON tra loi — chi la tra bang loi. Nen ket luan "khoa
  // chet" chi duoc rut ra khi da di HET danh sach ma khong cai nao tra loi.
  // (Truoc day chi thu 5 -> 5 cai dau ket hạn la bao chet, trong khi nhung cai
  //  sau van song -> bao oan.)
  let ketHan = 0
  let loiKhac = ''
  for (const m of models) {
    const r = await goi(k, m, '', 'xin chào', undefined, HAN_KIEM)
    if (r.ok) return { ok: true, message: 'API KEY của bạn dùng được.' }
    debugRaw(`checkKey ${m}`, r.err)

    // Mat mang / het gio -> dung ngay, thu tiep cung vo ich
    if (r.status === 0) return { ok: false, message: `Kiểm tra thất bại: ${errLabel(r.err)}` }
    // Khoa sai/bi thu hoi -> chac chan chet, khong can thu tiep
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      return { ok: false, message: 'API KEY không dùng được. Vui lòng tạo khoá mới và dán lại.' }
    }
    if (r.status === 429) ketHan++
    else loiKhac = r.err ?? ''
  }

  // Di het danh sach, khong cai nao tra loi
  if (ketHan && !loiKhac) {
    return { ok: false, message: 'API KEY đã dùng hết lượt hôm nay. Vui lòng thử lại sau.' }
  }
  return { ok: false, message: `API KEY không dùng được: ${errLabel(loiKhac)}` }
}

// ---- Dich .srt ----
const MAX_CHARS = 6000

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { n: { type: 'INTEGER' }, t: { type: 'STRING' } },
    required: ['n', 't']
  }
}

const KIEM_NGON_NGU_SCHEMA = {
  type: 'OBJECT',
  properties: { valid: { type: 'BOOLEAN' } },
  required: ['valid']
}

function huongDan(ma: string, thuLai = false): string {
  // Nhan vao la MA ngon ngu (dung dat ten file). Doi sang TEN de bao cho AI.
  const ten = DICH_LANGS.find((l) => l.code === ma)?.label ?? ma
  return [
    'Bạn là một dịch giả phụ đề chuyên nghiệp. Nội dung đầu vào chủ yếu là tiếng Trung.',
    `Hãy chuyển TOÀN BỘ nội dung của từng dòng sang ${ten}.`,
    '',
    'Yêu cầu bắt buộc:',
    '1. Mỗi phần tử trả về: n = đúng số thứ tự dòng gốc, t = bản dịch hoàn chỉnh của dòng đó.',
    '2. Phải dịch TẤT CẢ nội dung trong từng dòng, kể cả câu rất ngắn, tiếng đệm, tiếng cảm thán,',
    '   tên người, biệt danh, địa danh, tổ chức và danh xưng.',
    '3. Tuyệt đối không sao chép hoặc để sót bất kỳ chữ, từ, cụm từ hay câu tiếng Trung nào trong t.',
    `   Tên riêng cũng phải được dịch hoặc phiên âm phù hợp sang ${ten}.`,
    '4. Trả về ĐÚNG số dòng đã nhận. KHÔNG gộp, KHÔNG tách và KHÔNG bỏ sót dòng.',
    '5. Giữ nguyên ranh giới dòng; dùng các dòng xung quanh làm ngữ cảnh để dịch cho đúng.',
    '6. Dịch đầy đủ, sát nghĩa, tự nhiên, đúng văn phong gốc. Không tóm tắt, thêm bớt hoặc giải thích.',
    '7. Trước khi trả JSON, rà lại từng trường t. Nếu còn bất kỳ nội dung tiếng Trung nào,',
    '   phải dịch hết sang ngôn ngữ đích rồi mới trả kết quả.',
    ...(thuLai
      ? ['8. Bản trước còn sót nội dung nguồn. Hãy dịch lại toàn bộ và tuyệt đối không để lại bất kỳ chữ tiếng Trung nào.']
      : [])
  ].join('\n')
}

function huongDanKiemTra(ma: string): string {
  const ten = DICH_LANGS.find((l) => l.code === ma)?.label ?? ma
  return [
    `Kiểm tra các dòng phụ đề có thực sự được viết bằng ${ten} hay không.`,
    'Bỏ qua tên riêng, số, URL, dấu câu và mảnh rất ngắn không thể dịch.',
    'Chỉ trả JSON theo schema: valid = true khi phần văn bản có nghĩa dùng đúng ngôn ngữ đích; ngược lại false.'
  ].join('\n')
}

/** Gom khoi toi sat nguong. Ranh gioi LUON giua 2 khoi -> moc thoi gian an toan. */
function chia(blocks: SrtBlock[]): SrtBlock[][] {
  const out: SrtBlock[][] = []
  let cur: SrtBlock[] = []
  let len = 0
  for (const b of blocks) {
    const cost = b.text.length + 5
    if (cur.length && len + cost > MAX_CHARS) {
      out.push(cur)
      cur = []
      len = 0
    }
    cur.push(b)
    len += cost
  }
  if (cur.length) out.push(cur)
  return out
}

export function parseSrt(raw: string): SrtBlock[] {
  return raw
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((b) => {
      const lines = b.split('\n')
      const i = lines.findIndex((l) => l.includes('-->'))
      if (i < 0) return null
      return { time: lines[i].trim(), text: lines.slice(i + 1).join(' ').trim() }
    })
    .filter((b): b is SrtBlock => !!b && !!b.text)
}

export function buildSrt(blocks: SrtBlock[]): string {
  return blocks.map((b, i) => `${i + 1}\n${b.time}\n${b.text}`).join('\n\n') + '\n'
}

type ChunkResult =
  | { ok: true; blocks: SrtBlock[]; verified: boolean }
  | { ok: false; error: string }

async function processChunk(
  blocks: SrtBlock[],
  dich: string,
  call: GeminiGenerate,
  onDone: (count: number) => void
): Promise<ChunkResult> {
  const split = async (): Promise<ChunkResult> => {
    if (blocks.length === 1) return { ok: false, error: 'Gemini hết giờ khi xử lý một câu phụ đề.' }
    const mid = Math.floor(blocks.length / 2)
    const left = await processChunk(blocks.slice(0, mid), dich, call, onDone)
    if (!left.ok) return left
    const right = await processChunk(blocks.slice(mid), dich, call, onDone)
    if (!right.ok) return right
    return { ok: true, blocks: [...left.blocks, ...right.blocks], verified: left.verified && right.verified }
  }

  const payload = blocks.map((b, j) => `${j + 1}. ${b.text}`).join('\n')
  let candidate: SrtBlock[] = blocks.map((b) => ({ ...b }))
  for (let attempt = 1; attempt <= 3; attempt++) {
    const translated = await call(huongDan(dich, attempt > 1), payload, SCHEMA)
    if (!translated.ok) return translated.timeout ? split() : { ok: false, error: errLabel(translated.err) }

    let arr: { n: number; t: string }[]
    try {
      arr = JSON.parse(translated.text as string)
    } catch {
      return { ok: false, error: 'Kết quả dịch không đọc được.' }
    }
    const map = new Map<number, string>()
    let complete = arr.length === blocks.length
    for (const line of arr) {
      if (!Number.isInteger(line.n) || line.n < 1 || line.n > blocks.length || !line.t?.trim() || map.has(line.n)) {
        complete = false
        continue
      }
      map.set(line.n, line.t.trim())
    }
    candidate = blocks.map((b, j) => ({ time: b.time, text: map.get(j + 1) ?? b.text }))
    if (!complete || map.size !== blocks.length) continue

    const checked = await call(
      huongDanKiemTra(dich),
      candidate.map((b, j) => `${j + 1}. ${b.text}`).join('\n'),
      KIEM_NGON_NGU_SCHEMA
    )
    if (!checked.ok) return checked.timeout ? split() : { ok: false, error: errLabel(checked.err) }
    let valid: boolean
    try {
      valid = (JSON.parse(checked.text as string) as { valid?: unknown }).valid === true
    } catch {
      return { ok: false, error: 'Kết quả kiểm tra ngôn ngữ không đọc được.' }
    }
    if (valid) {
      onDone(candidate.length)
      return { ok: true, blocks: candidate, verified: true }
    }
  }
  onDone(candidate.length)
  return { ok: true, blocks: candidate, verified: false }
}

/**
 * Dich 1 file .srt. Timestamp KHONG bao gio gui di — giu o may, ghep lai sau.
 * Khoi nao khong co ban dich -> giu nguyen chu goc (tha 1 dong chua dich con
 * hon ca file sai gio).
 */
export async function translateSrt(
  srtPath: string,
  outPath: string,
  dich: string,
  onProgress?: (done: number, total: number) => void,
  generate?: GeminiGenerate
): Promise<GeminiTranslationResult> {
  const key = generate ? '' : await loadKey()
  if (!generate && !key) return { ok: false, error: 'Chưa có API key.' }

  const blocks = parseSrt(await readFile(srtPath, 'utf-8'))
  if (!blocks.length) return { ok: false, error: 'File phụ đề trống.' }

  const call: GeminiGenerate = generate ?? ((sys, user, schema) => goiCoLui(key, sys, user, schema))
  const chunks = chia(blocks)
  logInfo(`Dịch phụ đề: ${blocks.length} câu…`)

  const ra: SrtBlock[] = []
  let verified = true
  let done = 0
  for (const chunk of chunks) {
    const result = await processChunk(chunk, dich, call, (count) => {
      done += count
      onProgress?.(done, blocks.length)
    })
    if (!result.ok) return { ok: false, error: result.error }
    verified = verified && result.verified
    ra.push(...result.blocks)
  }

  const unverified = outPath.replace(/\.srt$/i, '.unverified.srt')
  const saved = verified ? outPath : unverified
  if (verified) await rm(unverified, { force: true })
  else await rm(outPath, { force: true })
  await writeFile(saved, buildSrt(ra), 'utf-8')
  logInfo(`Dịch phụ đề: xong ${ra.length} câu${verified ? '' : ' (chưa xác nhận ngôn ngữ)'}.`)
  return { ok: true, count: ra.length, output: saved, verified }
}

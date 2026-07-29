export interface VieneuCliInput {
  modelDir: string
  codecDir: string
  voicesJson: string
  text: string
  output: string
  voiceId?: string
  refAudio?: string
}

export function buildVieneuCliArgs(input: VieneuCliInput): string[] {
  const args = [
    '--profile',
    'vieneu-v3-native',
    '--model-dir',
    input.modelDir,
    '--codec-dir',
    input.codecDir,
    '--voices-json',
    input.voicesJson,
    '--text',
    input.text,
    '--output',
    input.output,
    '--temperature',
    '0.8',
    '--top-k',
    '25',
    '--top-p',
    '0.95',
    '--max-chars',
    '384'
  ]
  if (input.refAudio) args.push('--ref-audio', input.refAudio, '--max-new-frames', '180')
  else if (input.voiceId) args.push('--voice', input.voiceId)
  return args
}

export function usefulVieneuError(raw: string, code: number): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const line = lines.reverse().find((entry) => /failed|error/i.test(entry))
  return (line?.replace(/^\[CLI\]\s*/, '') ?? `Engine thoát mã ${code}`).trim()
}

export function resolveVieneuSelection(
  voices: VieneuVoice[],
  voiceId: string
): { voiceId?: string; refAudio?: string } {
  const voice = voices.find((candidate) => candidate.id === voiceId)
  if (!voice) throw new Error('Không tìm thấy giọng đã chọn.')
  if (voice.kind === 'clone') {
    if (!voice.refAudio) throw new Error('Giọng clone không còn file mẫu.')
    return { refAudio: voice.refAudio }
  }
  return { voiceId: voice.id }
}

export function safeVieneuJobId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Mã tác vụ không hợp lệ.')
  }
  return id
}
import type { VieneuVoice } from '../shared/types'

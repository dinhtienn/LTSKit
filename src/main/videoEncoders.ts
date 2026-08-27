/**
 * Chon encoder video cho buoc xuat.
 *
 * Thu tu thu: NVENC -> AMF -> QuickSync -> libx264. Ba encoder dau chay bang
 * phan cung nen nhanh hon nhieu; libx264 la duong lui luon chay duoc nhung ton
 * CPU. Cac lan thu that bai chi mat khoang 0.1-0.2s nen khong dang ke.
 *
 * Con so do thuc te tren video 1080p dai 100s, 3 vung lam mo:
 *   libx264 -preset medium    137.5 s
 *   libx264 -preset veryfast   47.6 s
 *   h264_qsv                   32.6 s
 */
export type { ExportSpeed } from '../shared/types'
import type { ExportSpeed } from '../shared/types'

export interface VideoEncoderCandidate {
  ten: string
  gpu: boolean
  args: string[]
}

interface SpeedProfile {
  nvencPreset: string
  cpuPreset: string
  /** CRF cho libx264; so cao hon = file nho hon, chat luong thap hon. */
  crf: number
  /** Muc chat luong co dinh cho encoder phan cung. */
  hardwareQuality: number
}

const PROFILES: Record<ExportSpeed, SpeedProfile> = {
  fast: { nvencPreset: 'p2', cpuPreset: 'veryfast', crf: 23, hardwareQuality: 26 },
  balanced: { nvencPreset: 'p4', cpuPreset: 'medium', crf: 20, hardwareQuality: 23 },
  quality: { nvencPreset: 'p6', cpuPreset: 'slow', crf: 18, hardwareQuality: 20 }
}

export function videoEncoderCandidates(speed: ExportSpeed = 'balanced'): VideoEncoderCandidate[] {
  const profile = PROFILES[speed] ?? PROFILES.balanced
  const quality = String(profile.hardwareQuality)
  return [
    {
      ten: 'h264_nvenc',
      gpu: true,
      args: ['-c:v', 'h264_nvenc', '-preset', profile.nvencPreset, '-cq', quality, '-pix_fmt', 'yuv420p']
    },
    {
      ten: 'h264_amf',
      gpu: true,
      args: [
        '-c:v', 'h264_amf',
        '-quality', speed === 'quality' ? 'quality' : speed === 'fast' ? 'speed' : 'balanced',
        '-rc', 'cqp',
        '-qp_i', quality,
        '-qp_p', quality,
        '-pix_fmt', 'yuv420p'
      ]
    },
    {
      ten: 'h264_qsv',
      gpu: true,
      args: ['-c:v', 'h264_qsv', '-global_quality', quality, '-pix_fmt', 'nv12']
    },
    {
      ten: 'libx264',
      gpu: false,
      args: ['-c:v', 'libx264', '-preset', profile.cpuPreset, '-crf', String(profile.crf), '-pix_fmt', 'yuv420p']
    }
  ]
}

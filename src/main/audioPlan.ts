import type { BurnReq, MediaProbe } from '../shared/types'

export type AudioRole = 'source' | 'narration'

export interface AudioAssetPlan {
  role: AudioRole
  input: 'video' | string
  volume: number
  duckingExpression?: string
}

export interface AudioPlan {
  assets: AudioAssetPlan[]
}

export function buildAudioPlan(
  req: Pick<BurnReq, 'voice' | 'videoVolume' | 'voiceVolume'>,
  media: Pick<MediaProbe, 'hasAudio'>,
  duckingExpression?: string
): AudioPlan {
  const assets: AudioAssetPlan[] = []
  if (media.hasAudio) {
    assets.push({
      role: 'source',
      input: 'video',
      volume: req.videoVolume,
      ...(duckingExpression ? { duckingExpression } : {})
    })
  }
  if (req.voice) assets.push({ role: 'narration', input: req.voice, volume: req.voiceVolume })
  return { assets }
}

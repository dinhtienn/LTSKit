export interface VoicePreviewState {
  shouldPlay: boolean
  canStart: boolean
  videoTime: number
  voiceTime: number
  voiceDuration: number
  voicePaused: boolean
}

export interface VoicePreviewDecision {
  seekTo: number | null
  action: 'none' | 'play' | 'pause'
}

export function voicePreviewDecision(state: VoicePreviewState): VoicePreviewDecision {
  const voiceEnded = Number.isFinite(state.voiceDuration) && state.videoTime >= state.voiceDuration
  const seekTo = !voiceEnded && Math.abs(state.voiceTime - state.videoTime) > 0.15
    ? Math.min(state.videoTime, state.voiceDuration || state.videoTime)
    : null
  if (!state.shouldPlay || voiceEnded) {
    return { seekTo, action: state.voicePaused ? 'none' : 'pause' }
  }
  return { seekTo, action: state.voicePaused && state.canStart ? 'play' : 'none' }
}

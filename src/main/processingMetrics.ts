export interface ProcessingMetric {
  job: string
  elapsedMs: number
  outcome: 'xong' | 'lỗi'
  device?: string
  cache?: 'hit' | 'miss'
  provider?: string
}

function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

export function formatElapsedMs(elapsedMs: number): string {
  const seconds = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1000
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  return `${seconds.toFixed(1)}s`
}

export function formatProcessingMetric(metric: ProcessingMetric): string {
  const parts = [clean(metric.job) || 'Job', `${metric.outcome}`, formatElapsedMs(metric.elapsedMs)]
  const device = clean(metric.device)
  const provider = clean(metric.provider)
  if (device) parts.push(device)
  if (provider) parts.push(provider)
  if (metric.cache) parts.push(`cache ${metric.cache}`)
  return `${parts[0]}: ${parts.slice(1).join(' · ')}`
}

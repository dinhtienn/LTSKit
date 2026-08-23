import { createHash } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DubbingRewriteOptions } from '../shared/types'

export type CapcutRetryKind = 'shark' | 'busy' | 'network'
export type CapcutTerminalStatus = 'finished' | 'failed' | 'cancelled'

const AUDIO_PROCESSING_VERSION = 2

export interface CapcutCue {
  cueIndex: number
  start: number
  end: number
  text: string
}

export interface CapcutCheckpointEntry {
  cueIndex: number
  fingerprint: string
  path: string
  start: number
  dur: number
  voiceText?: string
}

export interface CapcutCheckpointManifest {
  version: number
  entries: CapcutCheckpointEntry[]
}

export interface CapcutJobMetrics {
  profileCount: number
  completed: number
  sharks: number
  sharksByProfile: number[]
  busyRetries: number
  networkRetries: number
}

/** Remove Unicode symbols/control characters that CapCut TTS rejects. */
export function sanitizeCapcutText(text: string): string {
  return text
    .replace(/[\p{S}\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function validateProfileCount(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 20) {
    throw new Error('Số profile CapCut phải là số nguyên từ 1 đến 20.')
  }
  return Number(value)
}

export function createCapcutJobMetrics(profileCount: number): CapcutJobMetrics {
  const count = validateProfileCount(profileCount)
  return {
    profileCount: count,
    completed: 0,
    sharks: 0,
    sharksByProfile: Array(count).fill(0),
    busyRetries: 0,
    networkRetries: 0
  }
}

export function capcutCueFingerprint(
  cue: CapcutCue,
  voiceId: string,
  speed: number,
  dubbingRewrite: DubbingRewriteOptions = { enabled: false, maxAttempts: 2, overrunRatio: 1 }
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        text: cue.text,
        start: cue.start,
        end: cue.end,
        voiceId,
        speed,
        dubbingRewrite,
        audioProcessingVersion: AUDIO_PROCESSING_VERSION
      })
    )
    .digest('hex')
}

export function capcutCheckpointDir(
  workRoot: string,
  srtPath: string,
  voiceId: string,
  speed: number
): string {
  const key = createHash('sha256')
    .update(JSON.stringify({ srtPath: srtPath.toLowerCase(), voiceId, speed }))
    .digest('hex')
  return join(workRoot, `checkpoint-${key}`)
}

export async function readReusableCheckpoint(
  manifestPath: string,
  expectedFingerprints: ReadonlyMap<number, string>
): Promise<Map<number, CapcutCheckpointEntry>> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CapcutCheckpointManifest
    if (manifest.version !== 1 || !Array.isArray(manifest.entries)) return new Map()
    const reusable = new Map<number, CapcutCheckpointEntry>()
    for (const entry of manifest.entries) {
      if (expectedFingerprints.get(entry.cueIndex) !== entry.fingerprint) continue
      try {
        const clip = await stat(entry.path)
        if (clip.isFile() && clip.size > 44) reusable.set(entry.cueIndex, entry)
      } catch {
        // Missing checkpoint clip is regenerated.
      }
    }
    return reusable
  } catch {
    return new Map()
  }
}

export async function writeCheckpointManifest(
  manifestPath: string,
  manifest: CapcutCheckpointManifest
): Promise<void> {
  const temporary = `${manifestPath}.${process.pid}.${Date.now()}.tmp`
  const backup = `${manifestPath}.${process.pid}.${Date.now()}.bak`
  await writeFile(temporary, JSON.stringify(manifest, null, 2), 'utf8')
  let hadExisting = false
  try {
    try {
      await rename(manifestPath, backup)
      hadExisting = true
    } catch {
      // First manifest write.
    }
    await rename(temporary, manifestPath)
    await rm(backup, { force: true })
  } catch (error) {
    if (hadExisting) {
      try {
        await rename(backup, manifestPath)
      } catch {
        // Preserve backup for recovery.
      }
    }
    throw error
  } finally {
    await rm(temporary, { force: true })
  }
}

export function recordCapcutRetry(
  metrics: CapcutJobMetrics,
  profileIndex: number,
  kind: CapcutRetryKind
): void {
  if (kind === 'shark') {
    metrics.sharks += 1
    metrics.sharksByProfile[profileIndex - 1] += 1
  } else if (kind === 'busy') metrics.busyRetries += 1
  else metrics.networkRetries += 1
}

export async function runCapcutPool<T, R>(
  items: readonly T[],
  profileCount: number,
  processItem: (item: T, itemIndex: number, profileIndex: number) => Promise<R>,
  shouldStop: () => boolean
): Promise<R[]> {
  const results = Array<R>(items.length)
  let next = 0
  const worker = async (profileIndex: number): Promise<void> => {
    while (!shouldStop()) {
      const itemIndex = next++
      if (itemIndex >= items.length) return
      results[itemIndex] = await processItem(items[itemIndex], itemIndex, profileIndex)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(validateProfileCount(profileCount), items.length) }, (_, index) =>
      worker(index + 1)
    )
  )
  return results
}

export function formatCapcutJobSummary(
  status: CapcutTerminalStatus,
  metrics: CapcutJobMetrics,
  total: number
): string[] {
  const lines = [
    `CapCut job summary: status=${status} profiles=${metrics.profileCount} cues=${total} completed=${metrics.completed} sharks=${metrics.sharks} busyRetries=${metrics.busyRetries} networkRetries=${metrics.networkRetries}`
  ]
  if (metrics.sharks > 0) {
    lines.push(
      `CapCut SHARK by profile: ${metrics.sharksByProfile
        .map((count, index) => `${String(index + 1).padStart(2, '0')}=${count}`)
        .join(', ')}`
    )
  }
  return lines
}

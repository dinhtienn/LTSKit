import { writeCheckpointManifest, type CapcutCheckpointEntry } from './capcutJob'

/**
 * Debounced checkpoint manifest writer.
 *
 * Writing the whole manifest after every cue costs O(n^2) serialization on
 * 4,000-cue jobs. Crash safety is unaffected: readReusableCheckpoint already
 * validates every entry against its fingerprint AND a non-empty clip on disk,
 * so a cue whose WAV exists but whose entry was not yet flushed is simply
 * re-synthesized — the same outcome as an interrupted per-cue write.
 */
export class CapcutManifestWriter {
  private readonly map = new Map<number, CapcutCheckpointEntry>()
  private timer: NodeJS.Timeout | null = null
  private chain: Promise<void> = Promise.resolve()
  private dirty = false

  constructor(
    private readonly manifestPath: string,
    private readonly intervalMs = 2000
  ) {}

  get entries(): Map<number, CapcutCheckpointEntry> {
    return this.map
  }

  record(entry: CapcutCheckpointEntry): void {
    this.map.set(entry.cueIndex, entry)
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.intervalMs)
    this.timer.unref?.()
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return this.chain
    this.dirty = false
    const snapshot = [...this.map.values()].sort((left, right) => left.cueIndex - right.cueIndex)
    this.chain = this.chain.then(() =>
      writeCheckpointManifest(this.manifestPath, { version: 1, entries: snapshot })
    )
    return this.chain
  }
}

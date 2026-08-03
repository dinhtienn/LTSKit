export interface TranslationQueueItem {
  id: string
  kind: 'media' | 'srt'
}

export interface TranslationQueueControls {
  shouldStop: () => boolean
  shouldPause: () => Promise<void>
}

export async function runTranslationPipeline<T extends TranslationQueueItem>(
  items: T[],
  transcribe: (item: T) => Promise<string | null>,
  translate: (item: T, srtPath: string) => Promise<void>,
  controls: TranslationQueueControls = { shouldStop: () => false, shouldPause: async () => undefined }
): Promise<void> {
  const background = new Set<Promise<void>>()
  const launchTranslation = (item: T, srtPath: string): void => {
    const task = translate(item, srtPath).catch(() => undefined)
    background.add(task)
    void task.finally(() => background.delete(task))
  }

  for (const item of items) {
    if (controls.shouldStop()) break
    await controls.shouldPause()
    if (controls.shouldStop()) break
    if (item.kind === 'srt') {
      launchTranslation(item, item.id)
      continue
    }
    const srtPath = await transcribe(item)
    if (srtPath) launchTranslation(item, srtPath)
  }
  await Promise.allSettled([...background])
}

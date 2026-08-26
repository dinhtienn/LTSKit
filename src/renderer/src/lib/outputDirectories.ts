export const OUTPUT_DIRECTORY_KEYS = ['download', 'audiotext', 'screen', 'editor', 'tts'] as const

export type OutputDirectoryKey = (typeof OUTPUT_DIRECTORY_KEYS)[number]
export type OutputDirectories = Record<OutputDirectoryKey, string>

const storageKeyPrefix = 'ltskit.outputDir.'

export function outputDirectoryStorageKey(key: OutputDirectoryKey): string {
  return `${storageKeyPrefix}${key}`
}

export function loadOutputDirectories(legacy: string | null, fallback: string): OutputDirectories {
  const result = {} as OutputDirectories
  for (const key of OUTPUT_DIRECTORY_KEYS) {
    const saved = localStorage.getItem(outputDirectoryStorageKey(key))
    const directory = saved || legacy || fallback
    result[key] = directory
    if (!saved && directory) localStorage.setItem(outputDirectoryStorageKey(key), directory)
  }
  return result
}

export function saveOutputDirectory(key: OutputDirectoryKey, directory: string): void {
  localStorage.setItem(outputDirectoryStorageKey(key), directory)
}

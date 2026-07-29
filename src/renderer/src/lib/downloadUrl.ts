export type DownloadUrl =
  | { url: string; engine: 'generic'; isChannel: false }
  | { url: string; engine: 'douyin'; isChannel: boolean }

function isHost(hostname: string, root: string): boolean {
  return hostname === root || hostname.endsWith(`.${root}`)
}

export function classifyDownloadUrl(value: string): DownloadUrl | null {
  const raw = value.trim()
  if (!raw) return null

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const hostname = parsed.hostname.toLowerCase()
    if (isHost(hostname, 'douyin.com') || isHost(hostname, 'iesdouyin.com')) {
      return { url: raw, engine: 'douyin', isChannel: /\/user\//i.test(parsed.pathname) }
    }
    return { url: raw, engine: 'generic', isChannel: false }
  } catch {
    return null
  }
}

export function classifyDownloadInput(value: string): {
  urls: DownloadUrl[]
  invalid: string[]
} {
  const urls: DownloadUrl[] = []
  const invalid: string[] = []
  for (const token of value.split(/\s+/).map((part) => part.trim()).filter(Boolean)) {
    const classified = classifyDownloadUrl(token)
    if (classified) urls.push(classified)
    else invalid.push(token)
  }
  return { urls, invalid }
}

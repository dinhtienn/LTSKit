const SHARED_PROXY = 'ltskit.download.sharedProxy'

export function sharedProxyFor(enabled: boolean, value: string): string | null {
  return enabled && value.trim() ? value.trim() : null
}

export function loadSharedProxy(storage: Storage = localStorage): string {
  const saved = storage.getItem(SHARED_PROXY)
  if (saved != null) return JSON.parse(saved) as string
  const generic = JSON.parse(storage.getItem('ltskit.dl.proxy') ?? '""') as string
  const douyin = JSON.parse(storage.getItem('ltskit.dy.proxy') ?? '""') as string
  const value = generic.trim() || douyin.trim()
  storage.setItem(SHARED_PROXY, JSON.stringify(value))
  return value
}

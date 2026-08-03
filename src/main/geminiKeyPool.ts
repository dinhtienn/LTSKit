import type { GeminiKeyDescriptor } from '../shared/types'

export interface KeyPoolSource {
  list: () => Promise<GeminiKeyDescriptor[]>
  get: (id: string) => Promise<string>
}

export interface GeminiKeyLease {
  id: string
  key: string
  release: () => Promise<void>
}

interface Waiter {
  runId: string
  preferredId?: string
  resolve: (lease: GeminiKeyLease) => void
  reject: (error: Error) => void
}

export interface GeminiKeyPool {
  acquire: (runId: string, preferredId?: string) => Promise<GeminiKeyLease>
  disable: (runId: string, keyId: string) => Promise<void>
  release: (lease: GeminiKeyLease) => Promise<void>
  keysChanged: () => Promise<void>
  remove: (keyId: string) => Promise<void>
}

export function createGeminiKeyPool(source: KeyPoolSource): GeminiKeyPool {
  const busy = new Set<string>()
  const pendingRemoval = new Set<string>()
  const disabledByRun = new Map<string, Set<string>>()
  const waiters: Waiter[] = []
  let descriptors: GeminiKeyDescriptor[] = []

  const refresh = async (): Promise<void> => {
    descriptors = await source.list()
  }

  const hasEligible = (waiter: Waiter): boolean => {
    const disabled = disabledByRun.get(waiter.runId) ?? new Set<string>()
    return descriptors.some((item) =>
      (!waiter.preferredId || item.id === waiter.preferredId) &&
      !busy.has(item.id) &&
      !pendingRemoval.has(item.id) &&
      !disabled.has(item.id)
    )
  }

  const leaseFor = async (id: string, waiter: Waiter): Promise<GeminiKeyLease> => {
    const key = await source.get(id)
    if (!key) throw new Error('API key không tồn tại.')
    busy.add(id)
    let released = false
    return {
      id,
      key,
      release: async () => {
        if (released) return
        released = true
        await release({ id, key, release: async () => undefined })
      }
    }
  }

  const dispatch = async (): Promise<void> => {
    await refresh()
    for (let index = 0; index < waiters.length;) {
      const waiter = waiters[index]
      const disabled = disabledByRun.get(waiter.runId) ?? new Set<string>()
      const candidate = descriptors.find((item) =>
        (!waiter.preferredId || item.id === waiter.preferredId) &&
        !busy.has(item.id) &&
        !pendingRemoval.has(item.id) &&
        !disabled.has(item.id)
      )
      if (!candidate) {
        if (!hasEligible(waiter) && descriptors.length > 0 && descriptors.every((item) =>
          disabled.has(item.id) || pendingRemoval.has(item.id) || (waiter.preferredId && item.id !== waiter.preferredId)
        )) {
          waiters.splice(index, 1)
          waiter.reject(new Error('Không còn API key Gemini dùng được.'))
          continue
        }
        index++
        continue
      }
      waiters.splice(index, 1)
      try {
        waiter.resolve(await leaseFor(candidate.id, waiter))
      } catch (error) {
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  const release = async (lease: GeminiKeyLease): Promise<void> => {
    busy.delete(lease.id)
    if (pendingRemoval.has(lease.id)) pendingRemoval.delete(lease.id)
    await dispatch()
  }

  return {
    acquire: async (runId, preferredId) => {
      await refresh()
      return new Promise<GeminiKeyLease>((resolve, reject) => {
        waiters.push({ runId, preferredId, resolve, reject })
        void dispatch()
      })
    },
    disable: async (runId, keyId) => {
      const disabled = disabledByRun.get(runId) ?? new Set<string>()
      disabled.add(keyId)
      disabledByRun.set(runId, disabled)
      await dispatch()
    },
    release,
    keysChanged: dispatch,
    remove: async (keyId) => {
      if (busy.has(keyId)) pendingRemoval.add(keyId)
      else {
        pendingRemoval.add(keyId)
        await dispatch()
      }
      await dispatch()
    }
  }
}

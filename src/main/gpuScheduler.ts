export interface GpuLease {
  release(): void
}

interface Waiter {
  resolve: (lease: GpuLease) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort?: () => void
}

let locked = false
const waiters: Waiter[] = []

function abortError(): Error {
  return new DOMException('Đã huỷ.', 'AbortError')
}

function grant(): void {
  while (waiters.length) {
    const waiter = waiters.shift()!
    if (waiter.signal?.aborted) {
      waiter.reject(abortError())
      continue
    }
    locked = true
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
    let released = false
    waiter.resolve({ release: () => { if (!released) { released = true; grant() } } })
    return
  }
  locked = false
}

export function acquireGpu(signal?: AbortSignal): Promise<GpuLease> {
  if (!locked && waiters.length === 0) {
    locked = true
    let released = false
    return Promise.resolve({ release: () => { if (!released) { released = true; grant() } } })
  }
  return new Promise((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal }
    const onAbort = (): void => {
      const index = waiters.indexOf(waiter)
      if (index >= 0) waiters.splice(index, 1)
      reject(abortError())
    }
    waiter.onAbort = onAbort
    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    waiters.push(waiter)
  })
}

export function resetGpuSchedulerForTests(): void {
  locked = false
  while (waiters.length) waiters.shift()!.reject(abortError())
}

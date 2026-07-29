import { spawn, type ChildProcess } from 'node:child_process'

export interface CapcutWorkerRequest {
  text: string
  voice: string
  devicePath: string
  outPath: string
  catalogPath: string
}

export interface CapcutWorkerResponse {
  ok: boolean
  outPath?: string
  error?: string
  code?: string
}

interface Pending {
  resolve: (value: CapcutWorkerResponse) => void
}

interface Worker {
  child: ChildProcess
  buffer: string
  queue: Pending[]
  alive: boolean
}

function failure(error: string, code: string): CapcutWorkerResponse {
  return { ok: false, error, code }
}

/**
 * One long-lived Python `serve` process per profile index.
 *
 * Requests on a single profile are strictly sequential — the caller
 * (runCapcutPool) already guarantees one in-flight cue per profile — so
 * responses correlate by FIFO order with no request ids.
 */
export class CapcutWorkerPool {
  private readonly workers = new Map<number, Worker>()

  constructor(
    private readonly pythonPath: string,
    private readonly workerScript: string,
    private readonly onSpawn?: (child: ChildProcess) => void
  ) {}

  private settleAll(worker: Worker, response: CapcutWorkerResponse): void {
    worker.alive = false
    const pending = worker.queue.splice(0, worker.queue.length)
    for (const item of pending) item.resolve(response)
  }

  private consume(worker: Worker, chunk: string): void {
    worker.buffer += chunk
    let newline = worker.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = worker.buffer.slice(0, newline).trim()
      worker.buffer = worker.buffer.slice(newline + 1)
      if (line) {
        const pending = worker.queue.shift()
        if (pending) {
          try {
            pending.resolve(JSON.parse(line) as CapcutWorkerResponse)
          } catch {
            pending.resolve(failure(`Worker trả dữ liệu lỗi: ${line.slice(0, 200)}`, 'network'))
          }
        }
      }
      newline = worker.buffer.indexOf('\n')
    }
  }

  private start(profileIndex: number): Worker {
    const child = spawn(this.pythonPath, [this.workerScript, 'serve'], {
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const worker: Worker = { child, buffer: '', queue: [], alive: true }
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (data: string) => this.consume(worker, data))
    child.on('error', () => {
      this.settleAll(worker, failure('Không khởi động được worker CapCut.', 'network'))
      if (this.workers.get(profileIndex) === worker) this.workers.delete(profileIndex)
    })
    child.on('close', (code) => {
      this.settleAll(worker, failure(`Worker CapCut dừng đột ngột (exit ${code ?? -1}).`, 'network'))
      if (this.workers.get(profileIndex) === worker) this.workers.delete(profileIndex)
    })
    this.onSpawn?.(child)
    this.workers.set(profileIndex, worker)
    return worker
  }

  send(profileIndex: number, request: CapcutWorkerRequest): Promise<CapcutWorkerResponse> {
    let worker = this.workers.get(profileIndex)
    if (!worker || !worker.alive) worker = this.start(profileIndex)
    const active = worker
    return new Promise<CapcutWorkerResponse>((resolve) => {
      active.queue.push({ resolve })
      const line = `${JSON.stringify({ cmd: 'synth', ...request })}\n`
      try {
        active.child.stdin?.write(line, (error) => {
          if (!error) return
          const pending = active.queue.shift()
          pending?.resolve(failure('Không gửi được yêu cầu tới worker CapCut.', 'network'))
        })
      } catch {
        const pending = active.queue.shift()
        pending?.resolve(failure('Không gửi được yêu cầu tới worker CapCut.', 'network'))
      }
    })
  }

  /** Drop the process for a profile so the next request starts a fresh one. */
  recycle(profileIndex: number): void {
    const worker = this.workers.get(profileIndex)
    if (!worker) return
    this.workers.delete(profileIndex)
    worker.alive = false
    try {
      worker.child.kill()
    } catch {
      // Already exited.
    }
  }

  disposeAll(): void {
    for (const profileIndex of [...this.workers.keys()]) this.recycle(profileIndex)
  }
}

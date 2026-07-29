import { randomInt } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export function capcutPaths(dataDir: string): {
  root: string
  deviceJson: string
  workDir: string
  venvDir: string
  venvPython: string
} {
  const root = join(dataDir, 'capcut-tts')
  const venvDir = join(root, 'venv')
  return {
    root,
    deviceJson: join(root, 'device.json'),
    workDir: join(root, 'work'),
    venvDir,
    venvPython: join(
      venvDir,
      process.platform === 'win32' ? join('Scripts', 'python.exe') : join('bin', 'python')
    )
  }
}

function randomDigits(len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += String(randomInt(0, 10))
  if (out[0] === '0') out = '7' + out.slice(1)
  return out
}

/** Upstream device.json.example / DEFAULT_DEVICE shape (Mac CapCut PC). */
export function randomCapcutDevice(): Record<string, string> {
  const deviceId = randomDigits(19)
  return {
    aid: '359289',
    app_name: 'CapCut',
    appvr: '8.7.0',
    version_name: '8.7.0',
    version_code: '8.7.0',
    channel: 'capcutpc_google',
    device_platform: 'mac',
    device_type: 'MacBookPro17,4',
    device_brand: 'MacBookPro17,4',
    os_version: '15.7.4',
    device_id: deviceId,
    iid: randomDigits(19),
    tdid: deviceId,
    region: 'VN',
    loc: 'VN',
    lan: 'vi-VN',
    pf: '3'
  }
}

export function isSharkBlockError(message: string): boolean {
  const t = message.toLowerCase()
  return (
    t.includes('shark') ||
    t.includes('shark_block') ||
    t.includes('risk control') ||
    t.includes('device blocked') ||
    t.includes('blocked by') ||
    (/\b403\b/.test(t) && t.includes('block'))
  )
}

export async function writeCapcutDeviceFile(
  devicePath: string,
  device: Record<string, string>
): Promise<void> {
  await mkdir(dirname(devicePath), { recursive: true })
  await writeFile(devicePath, JSON.stringify(device, null, 2), 'utf8')
}

export async function ensureCapcutDeviceFile(
  devicePath: string
): Promise<Record<string, string>> {
  try {
    const raw = JSON.parse(await readFile(devicePath, 'utf8')) as Record<string, string>
    if (raw.device_id && raw.iid && raw.tdid) return raw
  } catch {
    // create below
  }
  const device = randomCapcutDevice()
  await writeCapcutDeviceFile(devicePath, device)
  return device
}

export async function rotateCapcutDeviceFile(
  devicePath: string
): Promise<Record<string, string>> {
  const device = randomCapcutDevice()
  await writeCapcutDeviceFile(devicePath, device)
  return device
}

export function capcutProfilePath(dataDir: string, profileIndex: number): string {
  if (!Number.isInteger(profileIndex) || profileIndex < 1 || profileIndex > 20) {
    throw new Error('Số profile CapCut phải từ 1 đến 20.')
  }
  return join(
    capcutPaths(dataDir).root,
    'devices',
    `profile-${String(profileIndex).padStart(2, '0')}.json`
  )
}

function isValidDevice(device: Record<string, string>): boolean {
  return Boolean(device.device_id && device.iid && device.tdid)
}

async function writeCapcutDeviceAtomic(
  devicePath: string,
  device: Record<string, string>
): Promise<void> {
  const temporary = `${devicePath}.${process.pid}.${Date.now()}.tmp`
  const backup = `${devicePath}.${process.pid}.${Date.now()}.bak`
  await writeCapcutDeviceFile(temporary, device)
  let hadExisting = false
  try {
    try {
      await rename(devicePath, backup)
      hadExisting = true
    } catch {
      // No existing profile.
    }
    await rename(temporary, devicePath)
    await rm(backup, { force: true })
  } catch (error) {
    if (hadExisting) {
      try {
        await rename(backup, devicePath)
      } catch {
        // Keep the backup for recovery.
      }
    }
    throw error
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function ensureCapcutProfile(dataDir: string, profileIndex: number): Promise<string> {
  const profilePath = capcutProfilePath(dataDir, profileIndex)
  try {
    const current = JSON.parse(await readFile(profilePath, 'utf8')) as Record<string, string>
    if (isValidDevice(current)) return profilePath
  } catch {
    // Create below.
  }
  if (profileIndex === 1) {
    try {
      const legacy = JSON.parse(
        await readFile(capcutPaths(dataDir).deviceJson, 'utf8')
      ) as Record<string, string>
      if (isValidDevice(legacy)) {
        await writeCapcutDeviceAtomic(profilePath, legacy)
        return profilePath
      }
    } catch {
      // Generate below.
    }
  }
  await writeCapcutDeviceAtomic(profilePath, randomCapcutDevice())
  return profilePath
}

export async function rotateCapcutProfile(
  dataDir: string,
  profileIndex: number
): Promise<Record<string, string>> {
  const device = randomCapcutDevice()
  await writeCapcutDeviceAtomic(capcutProfilePath(dataDir, profileIndex), device)
  return device
}

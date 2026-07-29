import { access, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function replaceEngineDirectory(
  candidateDir: string,
  targetDir: string,
  executableName: string,
  activate: (from: string, to: string) => Promise<void> = rename
): Promise<void> {
  if (!(await exists(join(candidateDir, executableName)))) {
    throw new Error('Gói tải về không có file thực thi OCR.')
  }

  const backupDir = `${targetDir}.backup`
  await rm(backupDir, { recursive: true, force: true })
  const hadTarget = await exists(targetDir)
  if (hadTarget) await rename(targetDir, backupDir)
  try {
    await activate(candidateDir, targetDir)
    await rm(backupDir, { recursive: true, force: true })
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true })
    if (hadTarget && (await exists(backupDir))) await rename(backupDir, targetDir)
    throw error
  }
}

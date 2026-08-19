import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Write JSON via temp-file + rename so a crash mid-write can never leave a
 * half-written document on disk. fs.rename overwrites atomically on Windows.
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/**
 * Guard every renderer-supplied path. The renderer is a browser context; treat
 * its input as untrusted and refuse anything that escapes the data root.
 */
export function assertInsideRoot(target: string, root: string): string {
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(target)
  const rel = path.relative(resolvedRoot, resolved)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path is outside the workspace root: ${target}`)
  }
  return resolved
}

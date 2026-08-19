import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic } from './fs/atomic'
import type { AppSettings } from '@shared/types'

/**
 * Preferred data root. If the drive is absent (different machine, unplugged
 * external), fall back to Documents so the app still starts.
 */
const PREFERRED_DATA_ROOT = 'E:\\drawrix-data'

function defaultDataRoot(): string {
  const drive = path.parse(PREFERRED_DATA_ROOT).root
  if (existsSync(drive)) return PREFERRED_DATA_ROOT
  return path.join(app.getPath('documents'), 'Drawrix')
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache

  const fallback: AppSettings = { version: 1, dataRoot: defaultDataRoot(), theme: 'dark' }
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>
    cache = {
      version: 1,
      dataRoot:
        typeof raw.dataRoot === 'string' && raw.dataRoot.trim() ? raw.dataRoot : fallback.dataRoot,
      theme: raw.theme === 'light' ? 'light' : 'dark'
    }
  } catch {
    // No settings yet, or unreadable — first run.
    cache = fallback
  }
  return cache
}

export async function patchSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next: AppSettings = { ...getSettings(), ...patch, version: 1 }
  cache = next
  await writeJsonAtomic(settingsPath(), next)
  return next
}

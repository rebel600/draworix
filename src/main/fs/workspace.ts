import { shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertInsideRoot, exists, readJson, writeJsonAtomic } from './atomic'
import { getSettings } from '../settings'
import { slugifyName } from '@shared/dgm'
import { DOC_EXT, WORKSPACE_FILE, type WorkspaceInfo, type WorkspaceManifest } from '@shared/types'

export async function ensureDataRoot(): Promise<string> {
  const root = getSettings().dataRoot
  await fs.mkdir(root, { recursive: true })
  return root
}

/** Resolve a workspace id to its folder, refusing ids that escape the root. */
export async function workspacePath(id: string): Promise<string> {
  const root = await ensureDataRoot()
  return assertInsideRoot(path.join(root, id), root)
}

async function countDocuments(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile() && e.name.endsWith(DOC_EXT)).length
  } catch {
    return 0
  }
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  const root = await ensureDataRoot()
  const entries = await fs.readdir(root, { withFileTypes: true })

  const workspaces: WorkspaceInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = path.join(root, entry.name)
    const manifestPath = path.join(dir, WORKSPACE_FILE)
    if (!(await exists(manifestPath))) continue

    try {
      const manifest = await readJson<WorkspaceManifest>(manifestPath)
      workspaces.push({
        id: entry.name,
        name: manifest.name || entry.name,
        path: dir,
        icon: manifest.icon || '📁',
        createdAt: manifest.createdAt,
        documentCount: await countDocuments(dir)
      })
    } catch {
      // Corrupt manifest — still show the folder rather than hiding the user's work.
      workspaces.push({
        id: entry.name,
        name: entry.name,
        path: dir,
        icon: '⚠️',
        createdAt: new Date(0).toISOString(),
        documentCount: await countDocuments(dir)
      })
    }
  }

  return workspaces.sort((a, b) => a.name.localeCompare(b.name))
}

/** Append -2, -3 … until the folder name is free. */
async function uniqueFolder(root: string, base: string): Promise<string> {
  let candidate = base
  let n = 2
  while (await exists(path.join(root, candidate))) {
    candidate = `${base}-${n++}`
  }
  return candidate
}

export async function createWorkspace(name: string, icon: string): Promise<WorkspaceInfo> {
  const root = await ensureDataRoot()
  const slug = slugifyName(name)
  if (!slug) throw new Error('Workspace name must contain at least one letter or number')

  const id = await uniqueFolder(root, slug)
  const dir = assertInsideRoot(path.join(root, id), root)
  await fs.mkdir(dir, { recursive: true })

  const manifest: WorkspaceManifest = {
    version: 1,
    name: name.trim(),
    icon: icon || '📁',
    createdAt: new Date().toISOString()
  }
  await writeJsonAtomic(path.join(dir, WORKSPACE_FILE), manifest)

  return { id, name: manifest.name, path: dir, icon: manifest.icon, createdAt: manifest.createdAt, documentCount: 0 }
}

/**
 * Rename/re-icon a workspace. The folder name (id) intentionally stays fixed so
 * open tabs and index rows keep resolving.
 */
export async function updateWorkspace(
  id: string,
  patch: { name?: string; icon?: string }
): Promise<WorkspaceInfo> {
  const dir = await workspacePath(id)
  const manifestPath = path.join(dir, WORKSPACE_FILE)
  const manifest = await readJson<WorkspaceManifest>(manifestPath)

  const next: WorkspaceManifest = {
    ...manifest,
    version: 1,
    name: patch.name?.trim() || manifest.name,
    icon: patch.icon || manifest.icon
  }
  await writeJsonAtomic(manifestPath, next)

  return {
    id,
    name: next.name,
    path: dir,
    icon: next.icon,
    createdAt: next.createdAt,
    documentCount: await countDocuments(dir)
  }
}

/** Send to the OS recycle bin rather than unlinking — deletion must be recoverable. */
export async function deleteWorkspace(id: string): Promise<void> {
  const dir = await workspacePath(id)
  await shell.trashItem(dir)
}

export async function revealWorkspace(id: string): Promise<void> {
  const dir = await workspacePath(id)
  await shell.openPath(dir)
}

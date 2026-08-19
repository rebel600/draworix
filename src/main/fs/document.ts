import { shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { assertInsideRoot, exists, readJson, writeJsonAtomic } from './atomic'
import { ensureDataRoot, workspacePath } from './workspace'
import { createDocument, normalizeDocument, slugifyName } from '@shared/dgm'
import {
  DOC_EXT,
  HISTORY_DIR,
  HISTORY_KEEP,
  type DgmDocument,
  type DiagramType,
  type DocumentInfo
} from '@shared/types'

/** Every path crossing the IPC boundary is re-validated against the data root. */
async function safeDocPath(docPath: string): Promise<string> {
  const root = await ensureDataRoot()
  const resolved = assertInsideRoot(docPath, root)
  if (!resolved.endsWith(DOC_EXT)) throw new Error(`Not a ${DOC_EXT} document: ${docPath}`)
  return resolved
}

function workspaceIdOf(docPath: string, root: string): string {
  const rel = path.relative(root, docPath)
  return rel.split(path.sep)[0] ?? ''
}

async function toInfo(docPath: string, root: string): Promise<DocumentInfo> {
  const stat = await fs.stat(docPath)
  const name = path.basename(docPath, DOC_EXT)
  let title = name
  let type: DiagramType = 'erd'
  try {
    const doc = normalizeDocument(await readJson(docPath), name)
    title = doc.title
    type = doc.type
  } catch {
    // Unreadable document still gets listed so the user can see and fix it.
  }
  return {
    path: docPath,
    workspaceId: workspaceIdOf(docPath, root),
    name,
    title,
    type,
    updatedAt: stat.mtime.toISOString()
  }
}

export async function listDocuments(workspaceId: string): Promise<DocumentInfo[]> {
  const root = await ensureDataRoot()
  const dir = await workspacePath(workspaceId)
  let entries: string[] = []
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(DOC_EXT))
      .map((e) => path.join(dir, e.name))
  } catch {
    return []
  }

  const infos = await Promise.all(entries.map((p) => toInfo(p, root)))
  return infos.sort((a, b) => a.title.localeCompare(b.title))
}

export async function readDocument(docPath: string): Promise<DgmDocument> {
  const resolved = await safeDocPath(docPath)
  const name = path.basename(resolved, DOC_EXT)
  return normalizeDocument(await readJson(resolved), name)
}

/**
 * Keep the last HISTORY_KEEP versions beside the document so an accidental
 * overwrite is recoverable without any cloud service.
 */
async function snapshot(docPath: string): Promise<void> {
  if (!(await exists(docPath))) return
  const dir = path.join(path.dirname(docPath), HISTORY_DIR)
  await fs.mkdir(dir, { recursive: true })

  const name = path.basename(docPath, DOC_EXT)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await fs.copyFile(docPath, path.join(dir, `${name}.${stamp}${DOC_EXT}`))

  const mine = (await fs.readdir(dir))
    .filter((f) => f.startsWith(`${name}.`) && f.endsWith(DOC_EXT))
    .sort()
  for (const stale of mine.slice(0, Math.max(0, mine.length - HISTORY_KEEP))) {
    await fs.rm(path.join(dir, stale), { force: true }).catch(() => {})
  }
}

export async function writeDocument(docPath: string, doc: DgmDocument): Promise<DocumentInfo> {
  const resolved = await safeDocPath(docPath)
  const root = await ensureDataRoot()
  await snapshot(resolved)
  await writeJsonAtomic(resolved, { ...doc, version: 1, updatedAt: new Date().toISOString() })
  return toInfo(resolved, root)
}

export async function createNewDocument(
  workspaceId: string,
  title: string,
  type: DiagramType
): Promise<DocumentInfo> {
  const root = await ensureDataRoot()
  const dir = await workspacePath(workspaceId)
  const slug = slugifyName(title) || 'untitled'

  let name = slug
  let n = 2
  while (await exists(path.join(dir, `${name}${DOC_EXT}`))) name = `${slug}-${n++}`

  const target = path.join(dir, `${name}${DOC_EXT}`)
  await writeJsonAtomic(target, createDocument(title.trim() || 'Untitled', type))
  return toInfo(target, root)
}

export async function renameDocument(docPath: string, title: string): Promise<DocumentInfo> {
  const resolved = await safeDocPath(docPath)
  const root = await ensureDataRoot()
  const doc = await readDocument(resolved)
  const dir = path.dirname(resolved)

  const slug = slugifyName(title) || path.basename(resolved, DOC_EXT)
  let name = slug
  let n = 2
  while (name !== path.basename(resolved, DOC_EXT) && (await exists(path.join(dir, `${name}${DOC_EXT}`)))) {
    name = `${slug}-${n++}`
  }

  const target = path.join(dir, `${name}${DOC_EXT}`)
  await writeJsonAtomic(resolved, { ...doc, title: title.trim(), updatedAt: new Date().toISOString() })
  if (target !== resolved) await fs.rename(resolved, target)
  return toInfo(target, root)
}

export async function deleteDocument(docPath: string): Promise<void> {
  const resolved = await safeDocPath(docPath)
  await shell.trashItem(resolved)
}

/** Walk every workspace to rebuild the derived index from the files on disk. */
export async function scanAllDocuments(workspaceIds: string[]): Promise<DocumentInfo[]> {
  const all = await Promise.all(workspaceIds.map((id) => listDocuments(id)))
  return all.flat()
}

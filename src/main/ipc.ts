import { BrowserWindow, dialog, ipcMain } from 'electron'
import { CH } from '@shared/ipc'
import type {
  AppSettings,
  DgmDocument,
  DiagramType,
  DocumentInfo,
  RecentEntry,
  Result,
  WorkspaceInfo
} from '@shared/types'
import { getSettings, patchSettings } from './settings'
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  revealWorkspace,
  updateWorkspace
} from './fs/workspace'
import {
  createNewDocument,
  deleteDocument,
  listDocuments,
  readDocument,
  renameDocument,
  scanAllDocuments,
  writeDocument
} from './fs/document'
import type { IndexStore } from './store/index-store'

/**
 * Wrap a handler so the renderer always receives a Result envelope instead of
 * a serialized Error — no unhandled rejection can cross the boundary.
 */
function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Result<R>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[drawrix] ${channel} failed:`, message)
      return { ok: false, error: message }
    }
  })
}

export function registerIpc(index: IndexStore): void {
  handle<[], AppSettings>(CH.settingsGet, () => getSettings())
  handle<[string], AppSettings>(CH.settingsSetDataRoot, (dataRoot) => patchSettings({ dataRoot }))
  handle<['dark' | 'light'], AppSettings>(CH.settingsSetTheme, (theme) => patchSettings({ theme }))

  handle<[], string | null>(CH.dialogPickFolder, async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle<[], WorkspaceInfo[]>(CH.workspaceList, () => listWorkspaces())
  handle<[string, string], WorkspaceInfo>(CH.workspaceCreate, (name, icon) =>
    createWorkspace(name, icon)
  )
  handle<[string, { name?: string; icon?: string }], WorkspaceInfo>(
    CH.workspaceUpdate,
    (id, patch) => updateWorkspace(id, patch)
  )
  handle<[string], true>(CH.workspaceDelete, async (id) => {
    await deleteWorkspace(id)
    index.removeWorkspace(id)
    return true as const
  })
  handle<[string], true>(CH.workspaceReveal, async (id) => {
    await revealWorkspace(id)
    return true as const
  })

  handle<[string], DocumentInfo[]>(CH.docList, async (workspaceId) => {
    const docs = await listDocuments(workspaceId)
    for (const doc of docs) index.upsertDocument(doc)
    return docs
  })

  handle<[string, string, DiagramType], DocumentInfo>(
    CH.docCreate,
    async (workspaceId, title, type) => {
      const info = await createNewDocument(workspaceId, title, type)
      index.upsertDocument(info)
      return info
    }
  )

  handle<[string], DgmDocument>(CH.docRead, async (docPath) => {
    const doc = await readDocument(docPath)
    return doc
  })

  handle<[string, DgmDocument], DocumentInfo>(CH.docWrite, async (docPath, doc) => {
    const info = await writeDocument(docPath, doc)
    index.upsertDocument(info)
    return info
  })

  handle<[string, string], DocumentInfo>(CH.docRename, async (docPath, title) => {
    const info = await renameDocument(docPath, title)
    if (info.path !== docPath) index.removeDocument(docPath)
    index.upsertDocument(info)
    return info
  })

  handle<[string], true>(CH.docDelete, async (docPath) => {
    await deleteDocument(docPath)
    index.removeDocument(docPath)
    return true as const
  })

  handle<[RecentEntry | undefined, number | undefined], RecentEntry[]>(
    CH.indexRecents,
    (entry, limit) => {
      if (entry) index.touchRecent(entry)
      return index.recents(limit ?? 10)
    }
  )

  handle<[string, number | undefined], DocumentInfo[]>(CH.indexSearch, (query, limit) =>
    query.trim() ? index.search(query.trim(), limit ?? 25) : []
  )

  handle<[], number>(CH.indexRebuild, async () => {
    const workspaces = await listWorkspaces()
    const docs = await scanAllDocuments(workspaces.map((w) => w.id))
    index.replaceAll(docs)
    return docs.length
  })
}

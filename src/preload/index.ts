import { contextBridge, ipcRenderer } from 'electron'
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

/**
 * The entire surface the renderer can reach. Nothing else is exposed —
 * no fs, no path, no ipcRenderer.
 */
const api = {
  settings: {
    get: (): Promise<Result<AppSettings>> => ipcRenderer.invoke(CH.settingsGet),
    setDataRoot: (dataRoot: string): Promise<Result<AppSettings>> =>
      ipcRenderer.invoke(CH.settingsSetDataRoot, dataRoot),
    setTheme: (theme: 'dark' | 'light'): Promise<Result<AppSettings>> =>
      ipcRenderer.invoke(CH.settingsSetTheme, theme)
  },
  dialog: {
    pickFolder: (): Promise<Result<string | null>> => ipcRenderer.invoke(CH.dialogPickFolder)
  },
  workspaces: {
    list: (): Promise<Result<WorkspaceInfo[]>> => ipcRenderer.invoke(CH.workspaceList),
    create: (name: string, icon: string): Promise<Result<WorkspaceInfo>> =>
      ipcRenderer.invoke(CH.workspaceCreate, name, icon),
    update: (id: string, patch: { name?: string; icon?: string }): Promise<Result<WorkspaceInfo>> =>
      ipcRenderer.invoke(CH.workspaceUpdate, id, patch),
    remove: (id: string): Promise<Result<true>> => ipcRenderer.invoke(CH.workspaceDelete, id),
    reveal: (id: string): Promise<Result<true>> => ipcRenderer.invoke(CH.workspaceReveal, id)
  },
  docs: {
    list: (workspaceId: string): Promise<Result<DocumentInfo[]>> =>
      ipcRenderer.invoke(CH.docList, workspaceId),
    create: (workspaceId: string, title: string, type: DiagramType): Promise<Result<DocumentInfo>> =>
      ipcRenderer.invoke(CH.docCreate, workspaceId, title, type),
    read: (docPath: string): Promise<Result<DgmDocument>> => ipcRenderer.invoke(CH.docRead, docPath),
    write: (docPath: string, doc: DgmDocument): Promise<Result<DocumentInfo>> =>
      ipcRenderer.invoke(CH.docWrite, docPath, doc),
    rename: (docPath: string, title: string): Promise<Result<DocumentInfo>> =>
      ipcRenderer.invoke(CH.docRename, docPath, title),
    remove: (docPath: string): Promise<Result<true>> => ipcRenderer.invoke(CH.docDelete, docPath)
  },
  index: {
    recents: (entry?: RecentEntry, limit?: number): Promise<Result<RecentEntry[]>> =>
      ipcRenderer.invoke(CH.indexRecents, entry, limit),
    search: (query: string, limit?: number): Promise<Result<DocumentInfo[]>> =>
      ipcRenderer.invoke(CH.indexSearch, query, limit),
    rebuild: (): Promise<Result<number>> => ipcRenderer.invoke(CH.indexRebuild)
  }
}

export type DrawrixApi = typeof api

contextBridge.exposeInMainWorld('drawrix', api)

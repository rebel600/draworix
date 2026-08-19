import { create } from 'zustand'
import { api, call, keyedDebounce } from '@/lib/api'
import type {
  AppSettings,
  DgmDocument,
  DiagramType,
  DocumentInfo,
  WorkspaceInfo
} from '@shared/types'

const AUTOSAVE_MS = 800
const scheduleSave = keyedDebounce(AUTOSAVE_MS)

export interface Tab {
  path: string
  title: string
  workspaceId: string
  doc: DgmDocument
  dirty: boolean
  saving: boolean
}

interface AppState {
  settings: AppSettings | null
  workspaces: WorkspaceInfo[]
  activeWorkspaceId: string | null
  documents: DocumentInfo[]
  tabs: Tab[]
  activeTabPath: string | null
  loading: boolean
  error: string | null

  bootstrap: () => Promise<void>
  setError: (error: string | null) => void

  selectWorkspace: (id: string) => Promise<void>
  createWorkspace: (name: string, icon: string) => Promise<void>
  renameWorkspace: (id: string, name: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  revealWorkspace: (id: string) => Promise<void>

  createDocument: (title: string, type: DiagramType) => Promise<void>
  openDocument: (info: DocumentInfo) => Promise<void>
  renameDocument: (docPath: string, title: string) => Promise<void>
  deleteDocument: (docPath: string) => Promise<void>

  closeTab: (docPath: string) => void
  setActiveTab: (docPath: string) => void
  editSource: (docPath: string, source: string) => void
  saveNow: (docPath: string) => Promise<void>

  changeDataRoot: () => Promise<void>
}

export const useApp = create<AppState>((set, get) => {
  /** Run an async action, surfacing any failure as a dismissible error banner. */
  async function guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  /**
   * Reload a workspace's documents and re-sync its sidebar count from the same
   * response, so the count can't drift after a create or delete.
   */
  async function refreshDocuments(workspaceId: string): Promise<void> {
    const documents = await call(api.docs.list(workspaceId))
    set((s) => ({
      documents,
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, documentCount: documents.length } : w
      )
    }))
  }

  return {
    settings: null,
    workspaces: [],
    activeWorkspaceId: null,
    documents: [],
    tabs: [],
    activeTabPath: null,
    loading: true,
    error: null,

    setError: (error) => set({ error }),

    bootstrap: () =>
      guard(async () => {
        const settings = await call(api.settings.get())
        const workspaces = await call(api.workspaces.list())
        const activeWorkspaceId = workspaces[0]?.id ?? null
        set({ settings, workspaces, activeWorkspaceId, loading: false })
        if (activeWorkspaceId) await refreshDocuments(activeWorkspaceId)
      }),

    selectWorkspace: (id) =>
      guard(async () => {
        set({ activeWorkspaceId: id, documents: [] })
        await refreshDocuments(id)
      }),

    createWorkspace: (name, icon) =>
      guard(async () => {
        const ws = await call(api.workspaces.create(name, icon))
        set((s) => ({
          workspaces: [...s.workspaces, ws].sort((a, b) => a.name.localeCompare(b.name)),
          activeWorkspaceId: ws.id,
          documents: []
        }))
      }),

    renameWorkspace: (id, name) =>
      guard(async () => {
        const ws = await call(api.workspaces.update(id, { name }))
        set((s) => ({
          workspaces: s.workspaces
            .map((w) => (w.id === id ? ws : w))
            .sort((a, b) => a.name.localeCompare(b.name))
        }))
      }),

    deleteWorkspace: (id) =>
      guard(async () => {
        await call(api.workspaces.remove(id))
        set((s) => {
          const workspaces = s.workspaces.filter((w) => w.id !== id)
          const stillOpen = s.tabs.filter((t) => t.workspaceId !== id)
          const active = s.activeWorkspaceId === id ? (workspaces[0]?.id ?? null) : s.activeWorkspaceId
          return {
            workspaces,
            tabs: stillOpen,
            activeTabPath: stillOpen.some((t) => t.path === s.activeTabPath)
              ? s.activeTabPath
              : (stillOpen[0]?.path ?? null),
            activeWorkspaceId: active,
            documents: []
          }
        })
        const next = get().activeWorkspaceId
        if (next) await refreshDocuments(next)
      }),

    revealWorkspace: (id) => guard(async () => void (await call(api.workspaces.reveal(id)))),

    createDocument: (title, type) =>
      guard(async () => {
        const workspaceId = get().activeWorkspaceId
        if (!workspaceId) throw new Error('Create or select a workspace first')
        const info = await call(api.docs.create(workspaceId, title, type))
        await refreshDocuments(workspaceId)
        await get().openDocument(info)
      }),

    openDocument: (info) =>
      guard(async () => {
        const existing = get().tabs.find((t) => t.path === info.path)
        if (existing) {
          set({ activeTabPath: info.path })
          return
        }
        const doc = await call(api.docs.read(info.path))
        set((s) => ({
          tabs: [
            ...s.tabs,
            {
              path: info.path,
              title: doc.title,
              workspaceId: info.workspaceId,
              doc,
              dirty: false,
              saving: false
            }
          ],
          activeTabPath: info.path
        }))
        await call(
          api.index.recents({
            path: info.path,
            workspaceId: info.workspaceId,
            name: info.name,
            openedAt: new Date().toISOString()
          })
        )
      }),

    renameDocument: (docPath, title) =>
      guard(async () => {
        const info = await call(api.docs.rename(docPath, title))
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.path === docPath
              ? { ...t, path: info.path, title: info.title, doc: { ...t.doc, title: info.title } }
              : t
          ),
          activeTabPath: s.activeTabPath === docPath ? info.path : s.activeTabPath
        }))
        const workspaceId = get().activeWorkspaceId
        if (workspaceId) await refreshDocuments(workspaceId)
      }),

    deleteDocument: (docPath) =>
      guard(async () => {
        await call(api.docs.remove(docPath))
        get().closeTab(docPath)
        const workspaceId = get().activeWorkspaceId
        if (workspaceId) await refreshDocuments(workspaceId)
      }),

    closeTab: (docPath) =>
      set((s) => {
        const tabs = s.tabs.filter((t) => t.path !== docPath)
        return {
          tabs,
          activeTabPath:
            s.activeTabPath === docPath ? (tabs[tabs.length - 1]?.path ?? null) : s.activeTabPath
        }
      }),

    setActiveTab: (docPath) => set({ activeTabPath: docPath }),

    /**
     * Local edit: update in memory, mark dirty, and schedule a debounced save.
     * The write itself is atomic in main, so a crash mid-typing loses at most
     * AUTOSAVE_MS of work and never corrupts the file.
     */
    editSource: (docPath, source) => {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.path === docPath ? { ...t, doc: { ...t.doc, source }, dirty: true } : t
        )
      }))
      scheduleSave(docPath, () => {
        void get().saveNow(docPath)
      })
    },

    saveNow: (docPath) =>
      guard(async () => {
        const tab = get().tabs.find((t) => t.path === docPath)
        if (!tab || !tab.dirty) return
        set((s) => ({
          tabs: s.tabs.map((t) => (t.path === docPath ? { ...t, saving: true } : t))
        }))
        const info = await call(api.docs.write(docPath, tab.doc))
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.path === docPath ? { ...t, dirty: false, saving: false } : t
          ),
          documents: s.documents.map((d) => (d.path === info.path ? info : d))
        }))
      }),

    changeDataRoot: () =>
      guard(async () => {
        const picked = await call(api.dialog.pickFolder())
        if (!picked) return
        const settings = await call(api.settings.setDataRoot(picked))
        const workspaces = await call(api.workspaces.list())
        set({
          settings,
          workspaces,
          activeWorkspaceId: workspaces[0]?.id ?? null,
          documents: [],
          tabs: [],
          activeTabPath: null
        })
        const next = get().activeWorkspaceId
        if (next) await refreshDocuments(next)
      })
  }
})

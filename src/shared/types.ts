/**
 * Shared contracts between main, preload and renderer.
 * Nothing in here may import from node: or dom — it is compiled into all three.
 */

export type DiagramType = 'erd' | 'flow' | 'arch'

export const DOC_EXT = '.dgm'
export const WORKSPACE_FILE = 'workspace.json'
export const HISTORY_DIR = '.history'
export const HISTORY_KEEP = 20

/** Node position, kept out of `source` so dragging never rewrites hand-authored DSL. */
export interface Point {
  x: number
  y: number
}

/** On-disk shape of a *.dgm document. */
export interface DgmDocument {
  /** Schema version of this envelope, for future migrations. */
  version: 1
  type: DiagramType
  title: string
  /** The DSL text. Source of truth for *structure*. */
  source: string
  /** Source of truth for *position*, keyed by stable node id (table name for erd). */
  layout: Record<string, Point>
  createdAt: string
  updatedAt: string
}

export interface WorkspaceInfo {
  /** Folder name inside the data root. Stable id. */
  id: string
  name: string
  path: string
  /** Single emoji shown in the sidebar. */
  icon: string
  createdAt: string
  documentCount: number
}

/** On-disk shape of workspace.json (a subset of WorkspaceInfo). */
export interface WorkspaceManifest {
  version: 1
  name: string
  icon: string
  createdAt: string
}

export interface DocumentInfo {
  /** Absolute path. Stable id for tabs and the index. */
  path: string
  workspaceId: string
  /** File base name without extension. */
  name: string
  title: string
  type: DiagramType
  updatedAt: string
}

export interface AppSettings {
  version: 1
  dataRoot: string
  theme: 'dark' | 'light'
}

/** Every ipc handler returns this envelope so the renderer never sees a raw throw. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface RecentEntry {
  path: string
  workspaceId: string
  name: string
  openedAt: string
}

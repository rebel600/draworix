import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DocumentInfo, RecentEntry } from '@shared/types'

/**
 * Derived index over the files on disk. Never the source of truth: it exists
 * only to make recents and search fast, and can be deleted and rebuilt at will.
 */
export interface IndexStore {
  readonly kind: 'sqlite' | 'json'
  upsertDocument(doc: DocumentInfo): void
  removeDocument(docPath: string): void
  removeWorkspace(workspaceId: string): void
  replaceAll(docs: DocumentInfo[]): void
  touchRecent(entry: RecentEntry): void
  recents(limit: number): RecentEntry[]
  search(query: string, limit: number): DocumentInfo[]
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  path         TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
CREATE TABLE IF NOT EXISTS recents (
  path         TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  opened_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recents_opened ON recents(opened_at DESC);
`

interface DocRow {
  path: string
  workspace_id: string
  name: string
  title: string
  type: string
  updated_at: string
}

interface RecentRow {
  path: string
  workspace_id: string
  name: string
  opened_at: string
}

function rowToDoc(r: DocRow): DocumentInfo {
  return {
    path: r.path,
    workspaceId: r.workspace_id,
    name: r.name,
    title: r.title,
    type: r.type as DocumentInfo['type'],
    updatedAt: r.updated_at
  }
}

class SqliteIndexStore implements IndexStore {
  readonly kind = 'sqlite' as const
  // Typed loosely: better-sqlite3 is optional at runtime, so we avoid a hard type dep here.
  private db: any

  constructor(db: any) {
    this.db = db
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  upsertDocument(doc: DocumentInfo): void {
    this.db
      .prepare(
        `INSERT INTO documents (path, workspace_id, name, title, type, updated_at)
         VALUES (@path, @workspaceId, @name, @title, @type, @updatedAt)
         ON CONFLICT(path) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           name = excluded.name,
           title = excluded.title,
           type = excluded.type,
           updated_at = excluded.updated_at`
      )
      .run(doc)
  }

  removeDocument(docPath: string): void {
    this.db.prepare('DELETE FROM documents WHERE path = ?').run(docPath)
    this.db.prepare('DELETE FROM recents WHERE path = ?').run(docPath)
  }

  removeWorkspace(workspaceId: string): void {
    this.db.prepare('DELETE FROM documents WHERE workspace_id = ?').run(workspaceId)
    this.db.prepare('DELETE FROM recents WHERE workspace_id = ?').run(workspaceId)
  }

  replaceAll(docs: DocumentInfo[]): void {
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO documents (path, workspace_id, name, title, type, updated_at)
       VALUES (@path, @workspaceId, @name, @title, @type, @updatedAt)`
    )
    this.db.transaction((rows: DocumentInfo[]) => {
      this.db.prepare('DELETE FROM documents').run()
      for (const row of rows) insert.run(row)
    })(docs)
  }

  touchRecent(entry: RecentEntry): void {
    this.db
      .prepare(
        `INSERT INTO recents (path, workspace_id, name, opened_at)
         VALUES (@path, @workspaceId, @name, @openedAt)
         ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at`
      )
      .run(entry)
  }

  recents(limit: number): RecentEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM recents ORDER BY opened_at DESC LIMIT ?')
      .all(limit) as RecentRow[]
    return rows.map((r) => ({
      path: r.path,
      workspaceId: r.workspace_id,
      name: r.name,
      openedAt: r.opened_at
    }))
  }

  search(query: string, limit: number): DocumentInfo[] {
    const like = `%${query}%`
    const rows = this.db
      .prepare(
        `SELECT * FROM documents WHERE title LIKE ? OR name LIKE ?
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(like, like, limit) as DocRow[]
    return rows.map(rowToDoc)
  }
}

interface JsonShape {
  documents: DocumentInfo[]
  recents: RecentEntry[]
}

/** Fallback used when the native sqlite binding will not load. Same contract. */
class JsonIndexStore implements IndexStore {
  readonly kind = 'json' as const
  private data: JsonShape = { documents: [], recents: [] }

  constructor(private file: string) {
    try {
      if (existsSync(file)) this.data = JSON.parse(readFileSync(file, 'utf8')) as JsonShape
    } catch {
      this.data = { documents: [], recents: [] }
    }
  }

  private flush(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.data), 'utf8')
    } catch {
      // The index is disposable; losing it must never surface as a user error.
    }
  }

  upsertDocument(doc: DocumentInfo): void {
    this.data.documents = this.data.documents.filter((d) => d.path !== doc.path)
    this.data.documents.push(doc)
    this.flush()
  }

  removeDocument(docPath: string): void {
    this.data.documents = this.data.documents.filter((d) => d.path !== docPath)
    this.data.recents = this.data.recents.filter((r) => r.path !== docPath)
    this.flush()
  }

  removeWorkspace(workspaceId: string): void {
    this.data.documents = this.data.documents.filter((d) => d.workspaceId !== workspaceId)
    this.data.recents = this.data.recents.filter((r) => r.workspaceId !== workspaceId)
    this.flush()
  }

  replaceAll(docs: DocumentInfo[]): void {
    this.data.documents = [...docs]
    this.flush()
  }

  touchRecent(entry: RecentEntry): void {
    this.data.recents = this.data.recents.filter((r) => r.path !== entry.path)
    this.data.recents.push(entry)
    this.flush()
  }

  recents(limit: number): RecentEntry[] {
    return [...this.data.recents]
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
      .slice(0, limit)
  }

  search(query: string, limit: number): DocumentInfo[] {
    const q = query.toLowerCase()
    return this.data.documents
      .filter((d) => d.title.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
  }
}

export function openIndexStore(userDataDir: string): IndexStore {
  try {
    // Required lazily: a missing/mismatched native build must not stop startup.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3')
    return new SqliteIndexStore(new Database(path.join(userDataDir, 'index.sqlite')))
  } catch (err) {
    console.warn('[drawrix] sqlite index unavailable, using json index:', (err as Error).message)
    return new JsonIndexStore(path.join(userDataDir, 'index.json'))
  }
}

import { type DgmDocument, type DiagramType, type Point } from './types'

const STARTER_SOURCE: Record<DiagramType, string> = {
  erd: `// Tables and their columns. Relationships go at the bottom.
users {
  id         string     pk
  email      string     unique
  name       string
  created_at timestamp
}

orders {
  id      string  pk
  user_id string  fk
  total   decimal
  status  string
}

// >  many-to-one    <  one-to-many    -  one-to-one    <>  many-to-many
orders.user_id > users.id
`,
  flow: `// Nodes and arrows.
start > validate
validate > save
save > done
`,
  arch: `// Groups and services.
vpc {
  alb
  api
  db
}

alb > api
api > db
`
}

export function createDocument(title: string, type: DiagramType): DgmDocument {
  const now = new Date().toISOString()
  return {
    version: 1,
    type,
    title,
    source: STARTER_SOURCE[type],
    layout: {},
    createdAt: now,
    updatedAt: now
  }
}

/**
 * Coerce arbitrary parsed JSON into a DgmDocument.
 * A hand-edited or partially-written file must degrade, never crash the app.
 */
export function normalizeDocument(raw: unknown, fallbackTitle: string): DgmDocument {
  const now = new Date().toISOString()
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const type: DiagramType =
    o.type === 'flow' || o.type === 'arch' || o.type === 'erd' ? o.type : 'erd'

  const layout: Record<string, Point> = {}
  if (typeof o.layout === 'object' && o.layout !== null) {
    for (const [key, value] of Object.entries(o.layout as Record<string, unknown>)) {
      const p = value as { x?: unknown; y?: unknown } | null
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        layout[key] = { x: p.x, y: p.y }
      }
    }
  }

  return {
    version: 1,
    type,
    title: typeof o.title === 'string' && o.title.trim() ? o.title : fallbackTitle,
    source: typeof o.source === 'string' ? o.source : '',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
    layout
  }
}

/** Punctuation Windows forbids in a path segment. */
const RESERVED_NAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])

/** Highest C0 control code point; anything at or below is unsafe in a filename. */
const LAST_CONTROL_CODE = 31

/**
 * Windows-safe file/folder name. Returns '' when nothing usable remains.
 * Reserved punctuation and control characters are tested by code point rather
 * than matched with a regex range, so no control literal appears in this file.
 */
export function slugifyName(input: string): string {
  let sanitized = ''
  for (const ch of input.trim()) {
    const code = ch.codePointAt(0) ?? 0
    sanitized += RESERVED_NAME_CHARS.has(ch) || code <= LAST_CONTROL_CODE ? '-' : ch
  }

  return sanitized
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
}

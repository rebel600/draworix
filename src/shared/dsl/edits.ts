/**
 * Turning a canvas action into a change to the source text.
 *
 * The canvas never re-serialises a diagram. Printing the parsed model back out
 * would reformat hand-written DSL, reorder statements and drop every comment —
 * the one thing this app promises never to do. So each action produces a
 * handful of replacements aimed at the ranges the parser recorded, which keeps
 * the rest of the file byte-for-byte untouched and lets the editor's own undo
 * stack absorb the change.
 *
 * Everything here is pure: text in, edits out. The renderer is the only place
 * that knows these edits end up in a Monaco model.
 */
import type { Diagram, EdgeKind, Range } from './ast'
import { EDGE_OPERATORS } from './ast'

/** A replacement of `source[start, end)` with `text`. */
export interface TextEdit {
  start: number
  end: number
  text: string
}

/** A bare name needs no quotes; anything else does. */
const BARE_NAME = /^[A-Za-z_]\w*$/

export function formatName(name: string): string {
  const trimmed = name.trim()
  if (BARE_NAME.test(trimmed)) return trimmed
  return `"${trimmed.replace(/["\n]/g, '')}"`
}

/** Rename a node, following every reference to it. */
export function renameNode(
  source: string,
  diagram: Diagram,
  id: string,
  newName: string
): TextEdit[] {
  const node = diagram.nodes.find((n) => n.id === id)
  const text = formatName(newName)
  if (!node || !text || text === formatName(node.name)) return []

  const edits: TextEdit[] = []
  // An implicit node has no declaration of its own — its "name range" is the
  // reference that invented it, which the endpoint pass below already covers.
  if (!node.implicit) {
    edits.push({ start: node.nameRange.start, end: node.nameRange.end, text })
  }
  for (const edge of diagram.edges) {
    for (const endpoint of [edge.from, edge.to]) {
      if (endpoint.node !== id) continue
      edits.push({ start: endpoint.nodeRange.start, end: endpoint.nodeRange.end, text })
    }
  }
  return normalize(source, edits)
}

/**
 * Delete a node: its declaration, anything nested inside it, and every
 * relationship that mentions any of them.
 */
export function removeNode(source: string, diagram: Diagram, id: string): TextEdit[] {
  const doomed = new Set<string>()
  const collect = (nodeId: string): void => {
    if (doomed.has(nodeId)) return
    doomed.add(nodeId)
    for (const child of diagram.nodes) {
      if (child.parentId === nodeId) collect(child.id)
    }
  }
  collect(id)
  if (!diagram.nodes.some((n) => n.id === id)) return []

  const edits: TextEdit[] = []
  for (const node of diagram.nodes) {
    // Implicit nodes exist only as references; deleting the edges removes them.
    if (!doomed.has(node.id) || node.implicit) continue
    edits.push(deletion(source, node.range))
  }
  for (const edge of diagram.edges) {
    if (!doomed.has(edge.from.node) && !doomed.has(edge.to.node)) continue
    edits.push(deletion(source, edge.range))
  }
  return normalize(source, edits)
}

/** Delete one relationship, leaving the nodes it joined in place. */
export function removeEdge(source: string, diagram: Diagram, edgeId: string): TextEdit[] {
  const edge = diagram.edges.find((e) => e.id === edgeId)
  if (!edge) return []
  return normalize(source, [deletion(source, edge.range)])
}

/**
 * Add a relationship. It goes at the end of the file, where the starter
 * documents keep them and where it cannot land inside somebody's block.
 */
export function addEdge(
  source: string,
  diagram: Diagram,
  from: string,
  to: string,
  kind: EdgeKind = 'many-to-one'
): TextEdit[] {
  if (from === to) return []
  const exists = diagram.edges.some(
    (e) =>
      (e.from.node === from && e.to.node === to) || (e.from.node === to && e.to.node === from)
  )
  if (exists) return []

  const statement = `${formatName(from)} ${EDGE_OPERATORS[kind]} ${formatName(to)}\n`
  const lead = source.length === 0 || source.endsWith('\n') ? '' : '\n'
  return [{ start: source.length, end: source.length, text: lead + statement }]
}

/** Apply edits to a string. The renderer hands them to Monaco instead. */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let out = source
  // Back to front, so earlier offsets stay valid as we go.
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}

// ------------------------------------------------------------------- internals

/**
 * A statement's range plus the whitespace and line break around it, so
 * deleting it does not leave a blank gutter or an orphaned newline behind.
 */
function deletion(source: string, range: Range): TextEdit {
  let start = range.start
  while (start > 0 && source[start - 1] !== '\n' && isSpace(source[start - 1])) start--

  let end = range.end
  while (end < source.length && source[end] !== '\n' && isSpace(source[end])) end++
  // A comment trailing the statement described the statement; it goes too.
  if (source.startsWith('//', end)) {
    while (end < source.length && source[end] !== '\n') end++
  }
  if (source[end] === '\r') end++
  if (source[end] === '\n') end++

  return { start, end, text: '' }
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r'
}

/**
 * Sort, and fold away any overlap. Overlaps only arise between deletions —
 * a group and the member inside it — where the wider one wins.
 */
function normalize(source: string, edits: TextEdit[]): TextEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: TextEdit[] = []

  for (const edit of sorted) {
    const last = out[out.length - 1]
    if (!last || edit.start >= last.end) {
      out.push({ ...edit })
      continue
    }
    if (last.text === '' && edit.text === '') {
      last.end = Math.max(last.end, edit.end)
      continue
    }
    // Two different replacements of the same span would be a parser bug, but
    // dropping one is still better than handing Monaco an invalid edit set.
    if (source.slice(last.start, last.end) !== source.slice(edit.start, edit.end)) continue
  }

  return out
}

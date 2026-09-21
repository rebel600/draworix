/**
 * The parsed shape of a diagram.
 *
 * Every declaration carries the source range it came from, so the editor can
 * mark it, the canvas can highlight the line behind a node, and M4 can map a
 * canvas edit back to the exact span of text that produced it.
 *
 * Like the rest of src/shared this file is compiled into main, preload and
 * renderer, so it may not import from node: or dom.
 */
import type { DiagramType } from '../types'

/** A span of source. Offsets are for slicing; line/column are for the editor. */
export interface Range {
  /** 0-based offsets into the source string, [start, end). */
  start: number
  end: number
  /** 1-based, because that is what Monaco markers speak. */
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

/** Column flags an ERD field can carry. Order here is the order we suggest. */
export const FIELD_MODIFIERS = ['pk', 'fk', 'unique', 'index', 'null', 'notnull'] as const
export type FieldModifier = (typeof FIELD_MODIFIERS)[number]

/** Column types we know about. Unknown types parse fine, they just aren't suggested. */
export const FIELD_TYPES = [
  'string',
  'text',
  'int',
  'bigint',
  'float',
  'decimal',
  'bool',
  'date',
  'timestamp',
  'uuid',
  'json',
  'enum'
] as const

export interface Field {
  name: string
  /** Declared type, with any argument list kept verbatim: `decimal(10,2)`. */
  type: string | null
  modifiers: FieldModifier[]
  /** The whole field line. */
  range: Range
  /** Just the name, for precise diagnostics and go-to-definition later. */
  nameRange: Range
}

/**
 * `table` is an ERD entity, `group` is a block that contains other nodes
 * (arch/flow), `node` is a plain box.
 */
export type NodeKind = 'table' | 'group' | 'node'

export interface DiagramNode {
  /** The declared name. Stable id: this is the key used by `layout`. */
  id: string
  name: string
  kind: NodeKind
  /** Enclosing group, for arch diagrams. */
  parentId: string | null
  fields: Field[]
  /** True when the node was never declared, only mentioned by an edge. */
  implicit: boolean
  range: Range
  nameRange: Range
}

/** `>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many. */
export type EdgeKind = 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many'

export interface Endpoint {
  node: string
  /** Column name for `orders.user_id`; null for a bare node reference. */
  field: string | null
  /** The whole reference, `orders.user_id`. */
  range: Range
  /** Just the node name, so a rename can rewrite it and leave the column be. */
  nodeRange: Range
  /** Just the column name, when one was written. */
  fieldRange: Range | null
}

export interface Edge {
  /** Derived from both endpoints, so it survives edits elsewhere in the file. */
  id: string
  from: Endpoint
  to: Endpoint
  kind: EdgeKind
  /** Text after `:` on the statement line. */
  label: string | null
  range: Range
}

export interface Diagram {
  type: DiagramType
  /** Declaration order; implicit nodes come last. */
  nodes: DiagramNode[]
  edges: Edge[]
}

export type Severity = 'error' | 'warning'

export interface Diagnostic {
  message: string
  severity: Severity
  /** Short stable code, handy for tests and for muting a rule later. */
  code: string
  range: Range
}

export interface ParseResult {
  diagram: Diagram
  diagnostics: Diagnostic[]
}

/** The operator that produced an edge kind, for rendering it back to text. */
export const EDGE_OPERATORS: Record<EdgeKind, string> = {
  'many-to-one': '>',
  'one-to-many': '<',
  'one-to-one': '-',
  'many-to-many': '<>'
}

export function emptyDiagram(type: DiagramType): Diagram {
  return { type, nodes: [], edges: [] }
}

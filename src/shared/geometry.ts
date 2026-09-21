/**
 * How big a node is, in pixels.
 *
 * Sizes are computed rather than measured from the DOM. That is what lets ELK
 * place nodes in one pass, and it is what lets the SVG export draw the same
 * diagram the canvas shows without a browser in the loop.
 *
 * Everything here is arithmetic over the parsed model: no DOM, no node:.
 */
import type { DiagramNode } from './dsl'

export interface Size {
  width: number
  height: number
}

export interface Box extends Size {
  x: number
  y: number
}

/** Width of one character in the 12px mono the node bodies render in. */
export const CHAR = 7
export const ROW_HEIGHT = 20
export const HEADER_HEIGHT = 30
export const BODY_PADDING = 8
export const MIN_WIDTH = 150
export const MAX_WIDTH = 340
export const PLAIN_HEIGHT = 38
/** Room a group leaves around its members. ELK is told the same numbers. */
export const GROUP_PADDING = { top: 34, right: 16, bottom: 16, left: 16 }
export const EMPTY_GROUP: Size = { width: MIN_WIDTH, height: 70 }

/** The text drawn on the right of a column row: its type and its flags. */
export function fieldDetail(field: DiagramNode['fields'][number]): string {
  return [field.type, ...field.modifiers].filter(Boolean).join(' ')
}

/** The size a node renders at. */
export function measure(node: DiagramNode): Size {
  if (node.kind === 'group') return EMPTY_GROUP

  const rows = node.fields.map((f) => `${f.name}  ${fieldDetail(f)}`)
  const widest = Math.max(node.name.length + 6, ...rows.map((r) => r.length + 2), 0)
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(widest * CHAR) + 24))

  if (node.fields.length === 0) {
    return { width, height: node.kind === 'table' ? HEADER_HEIGHT + BODY_PADDING : PLAIN_HEIGHT }
  }
  return { width, height: HEADER_HEIGHT + node.fields.length * ROW_HEIGHT + BODY_PADDING }
}

/** The box a group needs to contain the members laid out inside it. */
export function groupBox(members: Array<{ position: { x: number; y: number }; size: Size }>): Size {
  if (members.length === 0) return EMPTY_GROUP
  const right = Math.max(...members.map((m) => m.position.x + m.size.width))
  const bottom = Math.max(...members.map((m) => m.position.y + m.size.height))
  return {
    width: Math.max(MIN_WIDTH, right + GROUP_PADDING.right),
    height: Math.max(EMPTY_GROUP.height, bottom + GROUP_PADDING.bottom)
  }
}

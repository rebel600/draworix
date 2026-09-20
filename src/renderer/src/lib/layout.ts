/**
 * Auto-layout: where a node goes when nobody has dragged it.
 *
 * ELK does the graph work in a web worker, so a big diagram cannot freeze
 * typing. Sizes are computed here rather than measured from the DOM: the node
 * components render at exactly these dimensions, which keeps what ELK planned
 * and what the canvas draws in agreement without a measure-then-relayout pass.
 *
 * Positions come back the way React Flow wants them — a child's position is
 * relative to its group.
 */
import ELK, { type ElkNode } from 'elkjs/lib/elk-api'
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker'
import type { Diagram, DiagramNode } from '@shared/dsl'
import type { Point } from '@shared/types'

export interface Size {
  width: number
  height: number
}

/** Width of one character in the 12px mono the node bodies render in. */
const CHAR = 7
const ROW_HEIGHT = 20
const HEADER_HEIGHT = 30
const BODY_PADDING = 8
const MIN_WIDTH = 150
const MAX_WIDTH = 340
const PLAIN_HEIGHT = 38
/** Room a group leaves around its members. ELK is told the same numbers. */
export const GROUP_PADDING = { top: 34, right: 16, bottom: 16, left: 16 }
const EMPTY_GROUP: Size = { width: MIN_WIDTH, height: 70 }

/** The size a node will render at, in pixels. */
export function measure(node: DiagramNode): Size {
  if (node.kind === 'group') return EMPTY_GROUP

  const rows = node.fields.map((f) => `${f.name}  ${[f.type, ...f.modifiers].filter(Boolean).join(' ')}`)
  const widest = Math.max(node.name.length + 6, ...rows.map((r) => r.length + 2), 0)
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(widest * CHAR) + 24))

  if (node.fields.length === 0) {
    return { width, height: node.kind === 'table' ? HEADER_HEIGHT + BODY_PADDING : PLAIN_HEIGHT }
  }
  return { width, height: HEADER_HEIGHT + node.fields.length * ROW_HEIGHT + BODY_PADDING }
}

/** The box a group needs to contain the members laid out inside it. */
export function groupBox(members: Array<{ position: Point; size: Size }>): Size {
  if (members.length === 0) return EMPTY_GROUP
  const right = Math.max(...members.map((m) => m.position.x + m.size.width))
  const bottom = Math.max(...members.map((m) => m.position.y + m.size.height))
  return {
    width: Math.max(MIN_WIDTH, right + GROUP_PADDING.right),
    height: Math.max(EMPTY_GROUP.height, bottom + GROUP_PADDING.bottom)
  }
}

/** One worker, started on the first layout and reused from then on. */
let elk: InstanceType<typeof ELK> | null = null

export async function autoLayout(diagram: Diagram): Promise<Record<string, Point>> {
  if (diagram.nodes.length === 0) return {}
  elk ??= new ELK({ workerFactory: () => new ElkWorker() })

  const members = new Map<string, DiagramNode[]>()
  for (const node of diagram.nodes) {
    if (!node.parentId) continue
    const list = members.get(node.parentId)
    if (list) list.push(node)
    else members.set(node.parentId, [node])
  }

  const toElk = (node: DiagramNode): ElkNode => {
    const children = members.get(node.id)
    if (node.kind === 'group' && children) {
      return {
        id: node.id,
        children: children.map(toElk),
        layoutOptions: {
          'elk.padding': `[top=${GROUP_PADDING.top},left=${GROUP_PADDING.left},bottom=${GROUP_PADDING.bottom},right=${GROUP_PADDING.right}]`
        }
      }
    }
    return { id: node.id, ...measure(node) }
  }

  const known = new Set(diagram.nodes.map((n) => n.id))
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': diagram.type === 'flow' ? 'DOWN' : 'RIGHT',
      // Edges are declared at the root even when they cross into a group.
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.spacing.edgeNode': '24',
      'elk.edgeRouting': 'ORTHOGONAL'
    },
    children: diagram.nodes.filter((n) => !n.parentId).map(toElk),
    edges: diagram.edges
      .filter((e) => known.has(e.from.node) && known.has(e.to.node))
      .map((edge) => ({ id: edge.id, sources: [edge.from.node], targets: [edge.to.node] }))
  }

  const positions: Record<string, Point> = {}
  const collect = (node: ElkNode): void => {
    if (node.id !== 'root') positions[node.id] = { x: node.x ?? 0, y: node.y ?? 0 }
    for (const child of node.children ?? []) collect(child)
  }
  collect(await elk.layout(graph))
  return positions
}

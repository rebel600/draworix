/**
 * Auto-layout: where a node goes when nobody has dragged it.
 *
 * ELK does the graph work in a web worker, so a big diagram cannot freeze
 * typing. Sizes come from @shared/geometry rather than the DOM: the node
 * components render at exactly those dimensions, which keeps what ELK planned
 * and what the canvas draws in agreement without a measure-then-relayout pass
 * — and lets the SVG export draw the same picture with no browser involved.
 *
 * Positions come back the way React Flow wants them — a child's position is
 * relative to its group.
 */
import ELK, { type ElkNode } from 'elkjs/lib/elk-api'
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker'
import type { Diagram, DiagramNode } from '@shared/dsl'
import { GROUP_PADDING, measure } from '@shared/geometry'
import type { Point } from '@shared/types'

export { GROUP_PADDING, groupBox, measure, type Size } from '@shared/geometry'

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

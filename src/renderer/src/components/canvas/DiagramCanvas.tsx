import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  useReactFlow,
  type Edge,
  type NodeChange
} from '@xyflow/react'
import { autoLayout, groupBox, measure, type Size } from '@/lib/layout'
import { useApp, type Tab } from '@/store/app-store'
import type { Diagram, EdgeKind } from '@shared/dsl'
import type { Point } from '@shared/types'
import { nodeTypes, type DiagramNodeType } from './nodes'

/** Long enough that a burst of keystrokes produces one layout, not twenty. */
const RELAYOUT_DEBOUNCE_MS = 250

const EDGE_STROKE = '#3d465a'
const MARKER = { type: MarkerType.ArrowClosed, width: 13, height: 13, color: EDGE_STROKE } as const

/** Which ends of a relationship get an arrow head. */
const ARROWS: Record<EdgeKind, { start: boolean; end: boolean }> = {
  'many-to-one': { start: false, end: true },
  'one-to-many': { start: true, end: false },
  'one-to-one': { start: false, end: false },
  'many-to-many': { start: true, end: true }
}

/**
 * The diagram surface.
 *
 * Positions come from two places and only two: whatever the author dragged,
 * kept in the document's `layout`, and ELK for everything else. The ELK half
 * lives in component state, never on disk — it is derived from the source and
 * recomputing it is cheap, so a file only ever records positions a person
 * actually chose.
 */
export default function DiagramCanvas({
  tab,
  diagram
}: {
  tab: Tab
  diagram: Diagram
}): React.JSX.Element {
  const moveNodes = useApp((s) => s.moveNodes)
  const clearLayout = useApp((s) => s.clearLayout)
  const { fitView } = useReactFlow()

  const [auto, setAuto] = useState<Record<string, Point>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const vertical = diagram.type === 'flow'

  // Everything that can change where a node belongs: its existence, its size,
  // its group, and the edges pulling on it.
  const shape = useMemo(
    () =>
      [
        diagram.nodes.map((n) => `${n.id}/${n.kind}/${n.fields.length}/${n.parentId ?? ''}`).join('|'),
        diagram.edges.map((e) => e.id).join('|')
      ].join('#'),
    [diagram]
  )

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      void autoLayout(diagram).then((positions) => {
        if (live) setAuto(positions)
      })
    }, RELAYOUT_DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // `diagram` is re-created on every keystroke; `shape` is what actually
    // changes the layout, and tab.path keeps two documents from sharing one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, tab.path])

  // Frame the diagram once per document, as soon as it has somewhere to be.
  // One frame late: fitView reads the positions React Flow has already taken
  // in, and this render is the one handing them over.
  const framed = useRef<string | null>(null)
  useEffect(() => {
    if (framed.current === tab.path || Object.keys(auto).length === 0) return
    framed.current = tab.path
    const frame = requestAnimationFrame(() => void fitView({ padding: 0.25, duration: 200 }))
    return () => cancelAnimationFrame(frame)
  }, [auto, tab.path, fitView])

  // Nothing is where it belongs until the first layout lands, so hold the
  // first paint back rather than flashing every node stacked at the origin.
  const positioned = diagram.nodes.every((n) => tab.doc.layout[n.id] || auto[n.id])
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (positioned) setRevealed(true)
  }, [positioned])

  const nodes = useMemo<DiagramNodeType[]>(() => {
    const saved = tab.doc.layout
    const at = (id: string): Point => saved[id] ?? auto[id] ?? { x: 0, y: 0 }

    const sizes = new Map<string, Size>()
    for (const node of diagram.nodes) sizes.set(node.id, measure(node))
    // A group is as big as the members inside it, wherever they ended up.
    for (const node of diagram.nodes) {
      if (node.kind !== 'group') continue
      const members = diagram.nodes
        .filter((n) => n.parentId === node.id)
        .map((n) => ({ position: at(n.id), size: sizes.get(n.id) as Size }))
      sizes.set(node.id, groupBox(members))
    }

    // React Flow needs a parent to appear before its children.
    const ordered = [
      ...diagram.nodes.filter((n) => !n.parentId),
      ...diagram.nodes.filter((n) => n.parentId)
    ]

    return ordered.map((node) => {
      const size = sizes.get(node.id) as Size
      const common = {
        id: node.id,
        position: at(node.id),
        selected: selected === node.id,
        style: { width: size.width, height: size.height },
        ...(node.parentId ? { parentId: node.parentId, extent: 'parent' as const } : {})
      }
      if (node.kind === 'group') {
        return { ...common, type: 'group' as const, data: { name: node.name, vertical } }
      }
      if (node.kind === 'table') {
        return {
          ...common,
          type: 'table' as const,
          data: { name: node.name, fields: node.fields, implicit: node.implicit, vertical }
        }
      }
      return {
        ...common,
        type: 'plain' as const,
        data: { name: node.name, implicit: node.implicit, vertical }
      }
    })
  }, [diagram, tab.doc.layout, auto, selected, vertical])

  const edges = useMemo<Edge[]>(
    () =>
      diagram.edges.map((edge) => {
        const arrows = ARROWS[edge.kind]
        return {
          id: edge.id,
          source: edge.from.node,
          target: edge.to.node,
          type: 'smoothstep',
          label: edge.label ?? (edge.from.field ? `${edge.from.field} → ${edge.to.field ?? ''}` : undefined),
          labelStyle: { fill: '#7b8598', fontSize: 10 },
          labelBgStyle: { fill: '#0b0d12' },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 3,
          style: { stroke: EDGE_STROKE, strokeWidth: 1.5 },
          markerEnd: arrows.end ? MARKER : undefined,
          markerStart: arrows.start ? MARKER : undefined
        }
      }),
    [diagram]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<DiagramNodeType>[]) => {
      const moved: Record<string, Point> = {}
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moved[change.id] = {
            x: Math.round(change.position.x),
            y: Math.round(change.position.y)
          }
        } else if (change.type === 'select') {
          setSelected((current) =>
            change.selected ? change.id : current === change.id ? null : current
          )
        }
      }
      if (Object.keys(moved).length > 0) moveNodes(tab.path, moved)
    },
    [moveNodes, tab.path]
  )

  const placed = Object.keys(tab.doc.layout).length

  return (
    <div
      className={`h-full w-full transition-opacity duration-200 ${revealed ? 'opacity-100' : 'opacity-0'}`}
    >
      <ReactFlow<DiagramNodeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        nodesDraggable
        deleteKeyCode={null}
        /* React Flow pans while Space is held, and it claims the key from the
           whole document. Monaco's EditContext element does not look like a
           text input to it, so this would eat every space typed in the code
           pane. */
        panActivationKeyCode={null}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className="bg-ink-900"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-ink-600)"
        />
        <Controls showInteractive={false} />
        {placed > 0 && (
          <Panel position="top-right">
            <button
              onClick={() => {
                clearLayout(tab.path)
                framed.current = null
              }}
              title={`${placed} node${placed === 1 ? '' : 's'} placed by hand`}
              className="rounded border border-ink-500 bg-ink-700 px-2 py-1 text-[11px] text-mist-200 hover:border-accent-500 hover:text-mist-100"
            >
              Auto layout
            </button>
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}

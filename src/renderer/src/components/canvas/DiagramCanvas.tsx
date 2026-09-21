import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange
} from '@xyflow/react'
import { autoLayout, groupBox, measure, type Size } from '@/lib/layout'
import { recordDrag, recordTextEdit, redo, undo, type Positions } from '@/lib/history'
import { applyTextEdits, revealRange } from '@/lib/monaco'
import { useApp, type Tab } from '@/store/app-store'
import {
  addEdge,
  applyEdits,
  removeEdge,
  removeNode,
  renameNode,
  type Diagram,
  type EdgeKind,
  type TextEdit
} from '@shared/dsl'
import type { Point } from '@shared/types'
import { nodeTypes, type DiagramNodeType } from './nodes'

/** Long enough that a burst of keystrokes produces one layout, not twenty. */
const RELAYOUT_DEBOUNCE_MS = 250

const EDGE_STROKE = '#3d465a'
const EDGE_SELECTED = '#5b8cff'

function marker(color: string): { type: MarkerType; width: number; height: number; color: string } {
  return { type: MarkerType.ArrowClosed, width: 13, height: 13, color }
}

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
 *
 * Everything else the canvas does — renaming, deleting, connecting — is a
 * change to the *source*, applied to the editor's model as a handful of
 * targeted replacements. The canvas never rewrites a document wholesale, and
 * because its edits go through the model they undo like anything you typed.
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
  const select = useApp((s) => s.setSelection)
  const selection = useApp((s) => s.selection)
  const { fitView } = useReactFlow()

  const [auto, setAuto] = useState<Record<string, Point>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
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
  const surface = useRef<HTMLDivElement>(null)
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

  // ------------------------------------------------------------------ editing

  /**
   * Push a canvas action into the document as text. The model is the target
   * rather than the store, so the change joins the editor's undo stack; the
   * store is the fallback for a document with no editor on screen.
   */
  const applyEdit = useCallback(
    (edits: TextEdit[]): void => {
      if (edits.length === 0) return
      const outcome = applyTextEdits(tab.path, edits, tab.doc.source)
      // Edits measured against text that has since changed are dropped, not
      // guessed at: applying them would land on the wrong spans.
      if (outcome === 'stale') return
      if (outcome === 'no-editor') {
        useApp.getState().editSource(tab.path, applyEdits(tab.doc.source, edits))
      }
      recordTextEdit(tab.path)
    },
    [tab.path, tab.doc.source]
  )

  const rename = useCallback(
    (id: string, name: string): void => {
      setRenaming(null)
      applyEdit(renameNode(tab.doc.source, diagram, id, name))
      // Names are ids here, so the selection follows the node to its new one.
      useApp.getState().setSelection({ kind: 'node', id: name })
    },
    [applyEdit, diagram, tab.doc.source]
  )

  const removeSelected = useCallback((): void => {
    const current = useApp.getState().selection
    if (!current) return
    applyEdit(
      current.kind === 'node'
        ? removeNode(tab.doc.source, diagram, current.id)
        : removeEdge(tab.doc.source, diagram, current.id)
    )
    useApp.getState().setSelection(null)
  }, [applyEdit, diagram, tab.doc.source])

  const connect = useCallback(
    (connection: Connection): void => {
      if (!connection.source || !connection.target) return
      applyEdit(addEdge(tab.doc.source, diagram, connection.source, connection.target))
    },
    [applyEdit, diagram, tab.doc.source]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeSelected()
        return
      }
      if (event.key === 'F2') {
        event.preventDefault()
        const current = useApp.getState().selection
        if (current?.kind === 'node') setRenaming(current.id)
        return
      }
      if (event.key === 'Escape') {
        setRenaming(null)
        select(null)
        return
      }
      if (!event.ctrlKey && !event.metaKey) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo(tab.path)
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault()
        redo(tab.path)
      }
    },
    [removeSelected, select, tab.path]
  )

  // ----------------------------------------------------------------- elements

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
        selected: selection?.kind === 'node' && selection.id === node.id,
        style: { width: size.width, height: size.height },
        ...(node.parentId ? { parentId: node.parentId, extent: 'parent' as const } : {})
      }
      const shared = {
        name: node.name,
        vertical,
        renaming: renaming === node.id,
        onRenameStart: () => setRenaming(node.id),
        onRename: (name: string) => rename(node.id, name),
        onRenameCancel: () => setRenaming(null)
      }
      if (node.kind === 'group') {
        return { ...common, type: 'group' as const, data: shared }
      }
      if (node.kind === 'table') {
        return {
          ...common,
          type: 'table' as const,
          data: { ...shared, fields: node.fields, implicit: node.implicit }
        }
      }
      return { ...common, type: 'plain' as const, data: { ...shared, implicit: node.implicit } }
    })
  }, [diagram, tab.doc.layout, auto, selection, vertical, rename, renaming])

  const edges = useMemo<Edge[]>(
    () =>
      diagram.edges.map((edge) => {
        const arrows = ARROWS[edge.kind]
        const active = selection?.kind === 'edge' && selection.id === edge.id
        const stroke = active ? EDGE_SELECTED : EDGE_STROKE
        return {
          id: edge.id,
          source: edge.from.node,
          target: edge.to.node,
          type: 'smoothstep',
          selected: active,
          label:
            edge.label ?? (edge.from.field ? `${edge.from.field} → ${edge.to.field ?? ''}` : undefined),
          labelStyle: { fill: active ? '#b9c1d0' : '#7b8598', fontSize: 10 },
          labelBgStyle: { fill: '#0b0d12' },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 3,
          style: { stroke, strokeWidth: active ? 2 : 1.5 },
          markerEnd: arrows.end ? marker(stroke) : undefined,
          markerStart: arrows.start ? marker(stroke) : undefined
        }
      }),
    [diagram, selection]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<DiagramNodeType>[]) => {
      const moved: Record<string, Point> = {}
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue
        moved[change.id] = { x: Math.round(change.position.x), y: Math.round(change.position.y) }
      }
      if (Object.keys(moved).length > 0) moveNodes(tab.path, moved)
    },
    [moveNodes, tab.path]
  )

  // A drag is one undo step, so positions are captured at either end of it
  // rather than on every mouse move.
  const dragFrom = useRef<Positions>({})

  const onNodeDragStart = useCallback(
    (_: unknown, node: DiagramNodeType, moving: DiagramNodeType[]) => {
      const layout = useApp.getState().tabs.find((t) => t.path === tab.path)?.doc.layout ?? {}
      dragFrom.current = Object.fromEntries(
        moved(node, moving).map((n) => [n.id, layout[n.id] ?? null])
      )
    },
    [tab.path]
  )

  const onNodeDragStop = useCallback(
    (_: unknown, node: DiagramNodeType, moving: DiagramNodeType[]) => {
      recordDrag(
        tab.path,
        dragFrom.current,
        Object.fromEntries(
          moved(node, moving).map((n) => [
            n.id,
            { x: Math.round(n.position.x), y: Math.round(n.position.y) }
          ])
        )
      )
    },
    [tab.path]
  )

  /**
   * Selecting on the canvas takes the editor there too. Only this direction
   * moves the caret: the editor moving its own caret is how *it* selects, and
   * echoing that back would drag the caret around while somebody is typing.
   */
  const reveal = useCallback(
    (next: NonNullable<ReturnType<typeof useApp.getState>['selection']>): void => {
      select(next)
      const range =
        next.kind === 'node'
          ? diagram.nodes.find((n) => n.id === next.id)?.nameRange
          : diagram.edges.find((e) => e.id === next.id)?.range
      if (range) revealRange(tab.path, range)
    },
    [diagram, select, tab.path]
  )

  const placed = Object.keys(tab.doc.layout).length

  return (
    <div
      ref={surface}
      // Focusable so Delete, F2 and Ctrl+Z reach the canvas after a click on
      // empty space, where there is no node to hold the focus.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`h-full w-full outline-none transition-opacity duration-200 ${
        revealed ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <ReactFlow<DiagramNodeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, node) => reveal({ kind: 'node', id: node.id })}
        onEdgeClick={(_, edge) => reveal({ kind: 'edge', id: edge.id })}
        onPaneClick={() => {
          setRenaming(null)
          select(null)
          surface.current?.focus()
        }}
        onConnect={connect}
        /* Loose mode lets a relationship be drawn from either end of either
           node, rather than only from the side ELK happened to point at. */
        connectionMode={ConnectionMode.Loose}
        nodesDraggable
        deleteKeyCode={null}
        /* React Flow's own keyboard support focuses a node's wrapper whenever
           it is selected, which pulls the caret out of the rename field the
           moment it opens. The canvas handles its own keys instead. */
        disableKeyboardA11y
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
                // Recorded like a drag, so handing the diagram to elk is as
                // undoable as placing a node was.
                const before: Positions = { ...tab.doc.layout }
                const after: Positions = Object.fromEntries(
                  Object.keys(before).map((id) => [id, null])
                )
                clearLayout(tab.path)
                recordDrag(tab.path, before, after)
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

/** React Flow reports one node plus the whole selection it came with. */
function moved(node: DiagramNodeType, nodes?: DiagramNodeType[]): DiagramNodeType[] {
  return nodes && nodes.length > 0 ? nodes : [node]
}

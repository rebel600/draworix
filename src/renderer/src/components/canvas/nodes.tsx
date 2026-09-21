import { memo, useEffect, useRef } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { Field } from '@shared/dsl'

/**
 * The three shapes the canvas draws. Each one renders at the size
 * `lib/layout.measure` predicted for it, which is what lets ELK place them
 * without a second measuring pass.
 *
 * An implicit node — one an edge invented, never declared — is drawn dashed,
 * so a typo in a name reads as a mistake rather than as part of the design.
 *
 * The pencil beside a name renames the node, which rewrites its declaration
 * and every reference to it in the source. Renaming is driven from the canvas
 * rather than held here, so F2 on a selected node opens the same field: React
 * Flow's drag handling swallows a node's second mousedown, which rules
 * double-click out as the way in.
 */

interface Common extends Record<string, unknown> {
  name: string
  /** Flow diagrams run top to bottom, so their ports move to top and bottom. */
  vertical: boolean
  renaming: boolean
  onRenameStart: () => void
  onRename: (name: string) => void
  onRenameCancel: () => void
}

export interface TableData extends Common {
  fields: Field[]
  implicit: boolean
}

export interface PlainData extends Common {
  implicit: boolean
}

export type GroupData = Common

export type TableNodeType = Node<TableData, 'table'>
export type PlainNodeType = Node<PlainData, 'plain'>
export type GroupNodeType = Node<GroupData, 'group'>
export type DiagramNodeType = TableNodeType | PlainNodeType | GroupNodeType

/**
 * Where edges attach, on the sides matching the direction ELK laid the graph
 * out in. They stay invisible until the pointer is over the node, so a diagram
 * at rest is boxes and lines rather than boxes, lines and dots.
 */
function Ports({ vertical }: { vertical: boolean }): React.JSX.Element {
  const dot =
    '!h-2 !w-2 !border-0 !bg-accent-500 !opacity-0 transition-opacity group-hover:!opacity-100'
  return (
    <>
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className={dot} />
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className={dot} />
    </>
  )
}

/** A name, and the field it becomes while it is being renamed. */
function Name({ data, className }: { data: Common; className: string }): React.JSX.Element {
  if (data.renaming) return <RenameField data={data} className={className} />

  return (
    <>
      <span className={`${className} truncate`}>{data.name}</span>
      <button
        aria-label={`Rename ${data.name}`}
        onClick={(e) => {
          // Not a click on the node: React Flow would take the focus back for
          // the node wrapper and the field would open unfocused.
          e.stopPropagation()
          data.onRenameStart()
        }}
        // nodrag/nopan: this is a button, not somewhere to grab the node by.
        className="nodrag nopan ml-auto shrink-0 rounded px-1 text-[10px] text-mist-400 opacity-0 transition-opacity hover:text-mist-100 group-hover:opacity-100"
      >
        ✎
      </button>
    </>
  )
}

/**
 * Its own component so the guard below is fresh for each rename.
 *
 * Committing removes the field, and removing a focused field fires blur — so
 * without the guard, Enter would rename once and then the blur would rename
 * again, the second time against a parse that no longer matches the text.
 */
function RenameField({ data, className }: { data: Common; className: string }): React.JSX.Element {
  const done = useRef(false)
  const field = useRef<HTMLInputElement>(null)

  // React Flow hides a node for a frame or two while it re-measures it, and a
  // hidden element cannot take focus, so the field waits for its own node to
  // come back before claiming the caret.
  useEffect(() => {
    let frame = 0
    let attempts = 0
    const focusWhenVisible = (): void => {
      const el = field.current
      if (!el) return
      if (getComputedStyle(el).visibility === 'hidden' && attempts++ < 30) {
        frame = requestAnimationFrame(focusWhenVisible)
        return
      }
      el.focus()
      el.select()
    }
    frame = requestAnimationFrame(focusWhenVisible)
    return () => cancelAnimationFrame(frame)
  }, [])

  const commit = (next: string): void => {
    if (done.current) return
    done.current = true
    const trimmed = next.trim()
    if (trimmed && trimmed !== data.name) data.onRename(trimmed)
    else data.onRenameCancel()
  }

  return (
    <input
      ref={field}
      defaultValue={data.name}
      data-testid="rename-field"
      className={`${className} nodrag nopan w-full rounded-sm border border-accent-500 bg-ink-900 px-1 outline-none`}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        // The canvas listens for Delete and Ctrl+Z; not while a name is typed.
        e.stopPropagation()
        if (e.key === 'Enter') commit(e.currentTarget.value)
        if (e.key === 'Escape') {
          done.current = true
          data.onRenameCancel()
        }
      }}
    />
  )
}

export const TableNode = memo(function TableNode({
  data,
  selected
}: NodeProps<TableNodeType>): React.JSX.Element {
  return (
    <div
      className={`group h-full w-full overflow-hidden rounded-md border bg-ink-800 shadow-lg transition-colors ${
        selected ? 'border-accent-500' : 'border-ink-500'
      }`}
    >
      <Ports vertical={data.vertical} />
      <div className="flex h-[30px] items-center border-b border-ink-600 bg-ink-700 px-2.5">
        <Name data={data} className="text-[12px] font-medium text-mist-100" />
      </div>
      <div className="py-1">
        {data.fields.map((field) => (
          <div
            key={field.name}
            className="flex h-5 items-center justify-between gap-3 px-2.5 font-mono text-[11px]"
          >
            <span className="truncate text-mist-200">{field.name}</span>
            <span className="shrink-0 text-mist-400">
              {field.type}
              {field.modifiers.length > 0 && (
                <span className="ml-1.5 text-accent-400">{field.modifiers.join(' ')}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
})

export const PlainNode = memo(function PlainNode({
  data,
  selected
}: NodeProps<PlainNodeType>): React.JSX.Element {
  return (
    <div
      className={`group flex h-full w-full items-center rounded-md border px-3 shadow-lg transition-colors ${
        selected ? 'border-accent-500' : 'border-ink-500'
      } ${data.implicit ? 'border-dashed bg-ink-800/70' : 'bg-ink-800'}`}
    >
      <Ports vertical={data.vertical} />
      <Name
        data={data}
        className={`text-[12px] ${data.implicit ? 'text-mist-300' : 'text-mist-100'}`}
      />
    </div>
  )
})

export const GroupNode = memo(function GroupNode({
  data,
  selected
}: NodeProps<GroupNodeType>): React.JSX.Element {
  return (
    <div
      className={`group h-full w-full rounded-lg border border-dashed bg-ink-800/40 transition-colors ${
        selected ? 'border-accent-500' : 'border-ink-500'
      }`}
    >
      <Ports vertical={data.vertical} />
      {/* React Flow centres node text by default; a group is a label on a box. */}
      <div className="flex px-3 py-2">
        <Name data={data} className="text-[10px] uppercase tracking-wider text-mist-400" />
      </div>
    </div>
  )
})

export const nodeTypes = {
  table: TableNode,
  plain: PlainNode,
  group: GroupNode
}

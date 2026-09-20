import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { Field } from '@shared/dsl'

/**
 * The three shapes the canvas draws. Each one renders at the size
 * `lib/layout.measure` predicted for it, which is what lets ELK place them
 * without a second measuring pass.
 *
 * An implicit node — one an edge invented, never declared — is drawn dashed,
 * so a typo in a name reads as a mistake rather than as part of the design.
 */

export interface TableData extends Record<string, unknown> {
  name: string
  fields: Field[]
  implicit: boolean
  /** Flow diagrams run top to bottom, so their ports move to top and bottom. */
  vertical: boolean
}

export interface PlainData extends Record<string, unknown> {
  name: string
  implicit: boolean
  vertical: boolean
}

export interface GroupData extends Record<string, unknown> {
  name: string
  vertical: boolean
}

export type TableNodeType = Node<TableData, 'table'>
export type PlainNodeType = Node<PlainData, 'plain'>
export type GroupNodeType = Node<GroupData, 'group'>
export type DiagramNodeType = TableNodeType | PlainNodeType | GroupNodeType

/**
 * Where edges attach. One port per direction, matching the direction ELK laid
 * the graph out in, so an edge leaves the side it is heading towards.
 */
function Ports({ vertical }: { vertical: boolean }): React.JSX.Element {
  // Connecting by hand is off, so a port is only an anchor for an edge.
  const dot = '!h-1.5 !w-1.5 !border-0 !bg-transparent'
  return (
    <>
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className={dot} />
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className={dot} />
    </>
  )
}

export const TableNode = memo(function TableNode({
  data,
  selected
}: NodeProps<TableNodeType>): React.JSX.Element {
  return (
    <div
      className={`h-full w-full overflow-hidden rounded-md border bg-ink-800 shadow-lg transition-colors ${
        selected ? 'border-accent-500' : 'border-ink-500'
      }`}
    >
      <Ports vertical={data.vertical} />
      <div className="flex h-[30px] items-center border-b border-ink-600 bg-ink-700 px-2.5 text-[12px] font-medium text-mist-100">
        <span className="truncate">{data.name}</span>
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
      className={`flex h-full w-full items-center justify-center rounded-md border px-3 text-[12px] shadow-lg transition-colors ${
        selected ? 'border-accent-500' : 'border-ink-500'
      } ${data.implicit ? 'border-dashed bg-ink-800/70 text-mist-300' : 'bg-ink-800 text-mist-100'}`}
    >
      <Ports vertical={data.vertical} />
      <span className="truncate">{data.name}</span>
    </div>
  )
})

export const GroupNode = memo(function GroupNode({
  data,
  selected
}: NodeProps<GroupNodeType>): React.JSX.Element {
  return (
    <div
      className={`h-full w-full rounded-lg border border-dashed bg-ink-800/40 transition-colors ${
        selected ? 'border-accent-500' : 'border-ink-500'
      }`}
    >
      <Ports vertical={data.vertical} />
      {/* React Flow centres node text by default; a group is a label on a box. */}
      <div className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-mist-400">
        {data.name}
      </div>
    </div>
  )
})

export const nodeTypes = {
  table: TableNode,
  plain: PlainNode,
  group: GroupNode
}

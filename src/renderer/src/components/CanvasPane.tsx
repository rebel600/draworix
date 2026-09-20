import { ReactFlowProvider } from '@xyflow/react'
import DiagramCanvas from './canvas/DiagramCanvas'
import type { Tab } from '@/store/app-store'
import type { ParseResult } from '@shared/dsl'

/**
 * The right-hand pane: a header with what the parser found, and the diagram.
 *
 * The canvas renders the same parse the editor marks up, so the two can never
 * disagree about what the source says.
 */
export default function CanvasPane({
  tab,
  parsed
}: {
  tab: Tab
  parsed: ParseResult
}): React.JSX.Element {
  const { diagram } = parsed
  const errors = parsed.diagnostics.filter((d) => d.severity === 'error').length

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-ink-600 px-3 text-[10px] uppercase tracking-wider text-mist-400">
        <span>Canvas</span>
        <span>
          {count(diagram.nodes.length, nodeWord(tab.doc.type))} ·{' '}
          {count(diagram.edges.length, 'link')}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {diagram.nodes.length === 0 ? (
          <Empty errors={errors} />
        ) : (
          // Keyed by document: each one gets its own viewport and selection.
          <ReactFlowProvider key={tab.path}>
            <DiagramCanvas tab={tab} diagram={diagram} />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  )
}

function Empty({ errors }: { errors: number }): React.JSX.Element {
  return (
    <div
      className="flex h-full items-center justify-center"
      style={{
        backgroundImage: 'radial-gradient(circle, var(--color-ink-600) 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }}
    >
      <div className="max-w-xs text-center">
        <p className="text-sm text-mist-200">
          {errors > 0 ? 'Nothing parsed yet' : 'Nothing to draw yet'}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-mist-400">
          {errors > 0
            ? 'Fix the underlined lines in the source and shapes will appear here.'
            : 'Declare a block on the left — the shapes it describes show up here.'}
        </p>
      </div>
    </div>
  )
}

function nodeWord(type: Tab['doc']['type']): string {
  return type === 'erd' ? 'table' : 'node'
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

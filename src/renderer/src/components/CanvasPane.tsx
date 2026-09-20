import type { Tab } from '@/store/app-store'
import { EDGE_OPERATORS, type Diagram, type DiagramNode } from '@shared/dsl'
import type { ParseResult } from '@shared/dsl'

/**
 * Stand-in for the diagram surface until M3 brings React Flow and ELK.
 *
 * It is no longer a mock: everything here comes from the same parse the editor
 * marks up, so it is the first honest answer to "what did my source actually
 * say?" — and it makes a parser regression visible without opening devtools.
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
  const roots = diagram.nodes.filter((n) => !n.parentId)

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-ink-600 px-3 text-[10px] uppercase tracking-wider text-mist-400">
        <span>Canvas</span>
        <span>
          {count(diagram.nodes.length, nodeWord(tab.doc.type))} ·{' '}
          {count(diagram.edges.length, 'link')}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--color-ink-600) 1px, transparent 1px)',
          backgroundSize: '20px 20px'
        }}
      >
        {diagram.nodes.length === 0 ? (
          <div className="flex h-full items-center justify-center">
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
        ) : (
          <div className="flex flex-wrap content-start gap-3 p-4">
            {roots.map((node) => (
              <NodeCard key={node.id} node={node} diagram={diagram} />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-ink-600 px-3 py-2 text-[11px] leading-relaxed text-mist-400">
        Laid out for real in M3 — React Flow nodes, ELK routing. Positions will save to{' '}
        <code className="text-mist-200">layout</code>, never into your source.
      </div>
    </div>
  )
}

function NodeCard({ node, diagram }: { node: DiagramNode; diagram: Diagram }): React.JSX.Element {
  const children = diagram.nodes.filter((n) => n.parentId === node.id)
  const links = diagram.edges.filter((e) => e.from.node === node.id || e.to.node === node.id)

  return (
    <div className="min-w-44 rounded border border-ink-500 bg-ink-800 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-ink-600 px-2.5 py-1.5">
        <span className={node.implicit ? 'text-mist-400 italic' : 'text-mist-100'}>
          {node.name}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-mist-400">{node.kind}</span>
      </div>

      {node.fields.length > 0 && (
        <div className="px-2.5 py-1.5">
          {node.fields.map((field) => (
            <div key={field.name} className="flex items-baseline justify-between gap-4 py-0.5">
              <span className="text-mist-200">{field.name}</span>
              <span className="text-[11px] text-mist-400">
                {field.type ?? '—'}
                {field.modifiers.length > 0 && (
                  <span className="ml-1.5 text-accent-400">{field.modifiers.join(' ')}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {children.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2.5 py-1.5">
          {children.map((child) => (
            <span key={child.id} className="rounded bg-ink-700 px-1.5 py-0.5 text-mist-200">
              {child.name}
            </span>
          ))}
        </div>
      )}

      {links.length > 0 && (
        <div className="border-t border-ink-600 px-2.5 py-1 text-[10px] text-mist-400">
          {links.map((edge) => (
            <div key={edge.id} className="truncate">
              {label(edge.from)} {EDGE_OPERATORS[edge.kind]} {label(edge.to)}
              {edge.label ? ` · ${edge.label}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function label(endpoint: { node: string; field: string | null }): string {
  return endpoint.field ? `${endpoint.node}.${endpoint.field}` : endpoint.node
}

function nodeWord(type: Tab['doc']['type']): string {
  return type === 'erd' ? 'table' : 'node'
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

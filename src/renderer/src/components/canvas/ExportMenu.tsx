import { useEffect, useRef, useState } from 'react'
import { targetsFor, type ExportFormat } from '@shared/export'
import { exportDiagram } from '@/lib/export'
import { autoLayout } from '@/lib/layout'
import { api, call } from '@/lib/api'
import { useApp, type Tab } from '@/store/app-store'
import type { Diagram } from '@shared/dsl'

/**
 * Export, from the canvas that is being exported.
 *
 * Files go into an `exports` folder beside the document rather than through a
 * save dialog: these are plain files in the workspace, like everything else
 * the app writes, and the toast says exactly where they went.
 */
export default function ExportMenu({
  tab,
  diagram
}: {
  tab: Tab
  diagram: Diagram
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)

  // Any click outside closes the menu, the way a menu should behave.
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const run = async (format: ExportFormat): Promise<void> => {
    setOpen(false)
    setBusy(true)
    try {
      // Lay the diagram out afresh rather than borrow the canvas's positions:
      // right after a tab switch the canvas is still waiting on elk, and an
      // export taken then would stack every node at the origin. Elk is
      // deterministic, so this is the same picture the canvas settles on.
      const auto = await autoLayout(diagram)
      const positions = Object.fromEntries(
        diagram.nodes.map((n) => [n.id, tab.doc.layout[n.id] ?? auto[n.id] ?? { x: 0, y: 0 }])
      )
      const path = await exportDiagram({
        docPath: tab.path,
        title: tab.title,
        fileName: baseName(tab.path),
        format,
        diagram,
        positions
      })
      setSaved(path)
    } catch (err) {
      useApp.getState().setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={wrapper} className="flex flex-col items-end gap-1.5">
      <button
        onClick={() => setOpen((was) => !was)}
        disabled={busy}
        className="rounded border border-ink-500 bg-ink-700 px-2 py-1 text-[11px] text-mist-200 hover:border-accent-500 hover:text-mist-100 disabled:opacity-50"
      >
        {busy ? 'Exporting…' : 'Export'}
      </button>

      {open && (
        <div className="w-36 overflow-hidden rounded border border-ink-500 bg-ink-700 shadow-xl">
          {targetsFor(diagram.type).map((target) => (
            <button
              key={target.id}
              data-testid={`export-${target.id}`}
              onClick={() => void run(target.id)}
              className="block w-full px-3 py-1.5 text-left text-[11px] text-mist-200 hover:bg-ink-600 hover:text-mist-100"
            >
              {target.label}
              <span className="ml-1.5 text-mist-400">.{target.extension}</span>
            </button>
          ))}
        </div>
      )}

      {saved && (
        <div className="flex max-w-64 items-center gap-2 rounded border border-ink-500 bg-ink-700 px-2 py-1 text-[11px] text-mist-300">
          <span className="truncate" title={saved}>
            Saved {shortPath(saved)}
          </span>
          <button
            onClick={() => void call(api.docs.revealFile(saved))}
            className="shrink-0 text-accent-400 hover:text-accent-500"
          >
            Show
          </button>
          <button onClick={() => setSaved(null)} className="shrink-0 text-mist-400 hover:text-mist-100">
            ×
          </button>
        </div>
      )}
    </div>
  )
}

/** `…/Billing-Schema.dgm` -> `Billing-Schema`. */
function baseName(docPath: string): string {
  const file = docPath.split(/[\\/]/).pop() ?? 'diagram'
  return file.replace(/\.dgm$/i, '')
}

/** Just the last two segments: enough to recognise, short enough to read. */
function shortPath(target: string): string {
  return target.split(/[\\/]/).slice(-2).join('/')
}

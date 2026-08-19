import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import TabBar from './components/TabBar'
import SourcePane from './components/SourcePane'
import CanvasPane from './components/CanvasPane'
import { useApp } from './store/app-store'

export default function App(): React.JSX.Element {
  const { bootstrap, tabs, activeTabPath, error, setError, loading } = useApp()
  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const [splitPct, setSplitPct] = useState(42)
  const dragging = useRef(false)
  const splitRef = useRef<HTMLDivElement>(null)

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !splitRef.current) return
    const rect = splitRef.current.getBoundingClientRect()
    const pct = ((e.clientX - rect.left) / rect.width) * 100
    setSplitPct(Math.min(75, Math.max(20, pct)))
  }, [])

  useEffect(() => {
    const stop = (): void => {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stop)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stop)
    }
  }, [onMouseMove])

  return (
    <div className="flex h-full w-full">
      <Sidebar />

      <main className="flex min-w-0 flex-1 flex-col">
        <TabBar />

        {error && (
          <div className="flex items-center justify-between border-b border-red-900/60 bg-red-950/60 px-3 py-2 text-xs text-red-200">
            <span className="truncate">{error}</span>
            <button onClick={() => setError(null)} className="ml-3 shrink-0 hover:text-white">
              ×
            </button>
          </div>
        )}

        {activeTab ? (
          <div ref={splitRef} className="flex min-h-0 flex-1">
            <div style={{ width: `${splitPct}%` }} className="min-w-0">
              <SourcePane tab={activeTab} />
            </div>
            <div
              onMouseDown={() => {
                dragging.current = true
                document.body.style.cursor = 'col-resize'
              }}
              className="w-px shrink-0 cursor-col-resize bg-ink-600 transition-colors hover:bg-accent-500"
            />
            <div style={{ width: `${100 - splitPct}%` }} className="min-w-0">
              <CanvasPane tab={activeTab} />
            </div>
          </div>
        ) : (
          <EmptyState loading={loading} />
        )}
      </main>
    </div>
  )
}

function EmptyState({ loading }: { loading: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center bg-ink-900">
      <div className="max-w-sm text-center">
        <p className="text-sm text-mist-200">
          {loading ? 'Loading…' : 'No diagram open'}
        </p>
        {!loading && (
          <p className="mt-2 text-xs leading-relaxed text-mist-400">
            Create a workspace, then a diagram, from the sidebar. Everything is stored as plain
            files on your disk.
          </p>
        )}
      </div>
    </div>
  )
}

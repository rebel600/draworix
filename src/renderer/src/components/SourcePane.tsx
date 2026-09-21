import { useEffect, useRef } from 'react'
import type * as monaco from 'monaco-editor/editor/editor.api'
import {
  THEME_ID,
  consumeProgrammaticCaret,
  disposeModelsExcept,
  getModel,
  pathOfModel,
  setEditor,
  setupMonaco,
  showDiagnostics
} from '@/lib/monaco'
import { useApp, type Selection, type Tab } from '@/store/app-store'
import type { ParseResult } from '@shared/dsl'

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: THEME_ID,
  automaticLayout: true,
  fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace",
  fontSize: 13,
  lineHeight: 21,
  tabSize: 2,
  insertSpaces: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderLineHighlight: 'line',
  lineNumbersMinChars: 3,
  glyphMargin: false,
  padding: { top: 10, bottom: 10 },
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  contextmenu: false,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
  // Our completions come from the parser; Monaco's word soup only gets in the way.
  wordBasedSuggestions: 'off',
  quickSuggestions: { other: true, comments: false, strings: false },
  // The pane is narrow: let popups escape it instead of being clipped.
  fixedOverflowWidgets: true
}

/**
 * The code pane: one Monaco editor, one model per open document.
 *
 * Models are keyed by document path and outlive tab switches, so undo history
 * follows a document around. Text flows one way — edits go to the store, the
 * store's source comes back only when it differs, which keeps autosave,
 * reopening and (later) canvas-driven edits from fighting the editor.
 */
export default function SourcePane({
  tab,
  parsed
}: {
  tab: Tab
  parsed: ParseResult
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  // The caret listener is registered once; this keeps it reading the latest
  // parse instead of the one that existed when the editor was created.
  const parsedRef = useRef(parsed)
  parsedRef.current = parsed
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  /** Set while we push the store's text into the model, to ignore the echo. */
  const applying = useRef(false)

  // A primitive, so the effect below only fires when the open set changes.
  const openPaths = useApp((s) => s.tabs.map((t) => t.path).join('\n'))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const m = setupMonaco()
    const editor = m.editor.create(host, EDITOR_OPTIONS)
    editorRef.current = editor

    const change = editor.onDidChangeModelContent(() => {
      if (applying.current) return
      const model = editor.getModel()
      if (!model) return
      // Attribute the edit to the model's own document, never to whatever tab
      // happens to be active by the time this fires.
      useApp.getState().editSource(pathOfModel(model), model.getValue())
    })

    // Moving the caret selects whatever it landed in, which is how the canvas
    // follows along as you move around the source.
    const caret = editor.onDidChangeCursorPosition((event) => {
      const model = editor.getModel()
      if (!model) return
      // Our own reveal put it there; the canvas already said what is selected.
      if (consumeProgrammaticCaret()) return
      useApp.getState().setSelection(selectionAt(parsedRef.current, model.getOffsetAt(event.position)))
    })

    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
      const model = editor.getModel()
      if (model) void useApp.getState().saveNow(pathOfModel(model))
    })

    setEditor(editor)

    return () => {
      change.dispose()
      caret.dispose()
      setEditor(null)
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  // Swap models when the active tab changes.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = getModel(tab.path, tab.doc.source, tab.doc.type)
    if (editor.getModel() !== model) {
      editor.setModel(model)
      editor.focus()
    }
  }, [tab.path, tab.doc.type, tab.doc.source])

  // Pull in changes that came from anywhere but this editor.
  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (!model || model.getValue() === tab.doc.source) return
    applying.current = true
    model.setValue(tab.doc.source)
    applying.current = false
  }, [tab.doc.source])

  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (model) showDiagnostics(model, parsed.diagnostics)
  }, [parsed])

  // Closing a tab should release its model. Runs last, so the active tab has
  // already been attached to the editor by the swap above.
  useEffect(() => {
    disposeModelsExcept(openPaths.split('\n'))
  }, [openPaths])

  const errors = parsed.diagnostics.filter((d) => d.severity === 'error').length
  const warnings = parsed.diagnostics.length - errors

  return (
    <div className="flex h-full flex-col bg-ink-800">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-ink-600 px-3 text-[10px] uppercase tracking-wider text-mist-400">
        <span>Source · {tab.doc.type}</span>
        <span className="flex items-center gap-3">
          {errors > 0 && (
            <span className="text-red-400">
              {errors} error{errors === 1 ? '' : 's'}
            </span>
          )}
          {warnings > 0 && (
            <span className="text-amber-400">
              {warnings} warning{warnings === 1 ? '' : 's'}
            </span>
          )}
          <span>{tab.saving ? 'Saving…' : tab.dirty ? 'Unsaved' : 'Saved'}</span>
        </span>
      </div>
      <div ref={hostRef} data-testid="source-editor" className="min-h-0 flex-1" />
    </div>
  )
}

/**
 * What the caret is sitting in. The innermost node wins, so a member inside a
 * group selects the member; failing that, a relationship statement.
 */
function selectionAt(parsed: ParseResult, offset: number): Selection {
  let node: { id: string; size: number } | null = null
  for (const candidate of parsed.diagram.nodes) {
    const { start, end } = candidate.range
    if (offset < start || offset > end) continue
    const size = end - start
    if (!node || size < node.size) node = { id: candidate.id, size }
  }
  if (node) return { kind: 'node', id: node.id }

  const edge = parsed.diagram.edges.find((e) => offset >= e.range.start && offset <= e.range.end)
  return edge ? { kind: 'edge', id: edge.id } : null
}

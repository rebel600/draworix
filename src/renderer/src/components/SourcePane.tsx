import { useApp, type Tab } from '@/store/app-store'

/**
 * M1 placeholder for the code pane. M2 replaces the textarea with Monaco plus
 * the DSL tokenizer, completions and diagnostics — the store contract
 * (editSource / autosave) stays identical.
 */
export default function SourcePane({ tab }: { tab: Tab }): React.JSX.Element {
  const editSource = useApp((s) => s.editSource)
  const saveNow = useApp((s) => s.saveNow)

  return (
    <div className="flex h-full flex-col bg-ink-800">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-ink-600 px-3 text-[10px] uppercase tracking-wider text-mist-400">
        <span>Source · {tab.doc.type}</span>
        <span>{tab.saving ? 'Saving…' : tab.dirty ? 'Unsaved' : 'Saved'}</span>
      </div>
      <textarea
        value={tab.doc.source}
        spellCheck={false}
        onChange={(e) => editSource(tab.path, e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            void saveNow(tab.path)
          }
        }}
        className="h-full w-full resize-none bg-ink-800 p-4 font-mono text-[12.5px] leading-relaxed text-mist-100 outline-none"
      />
    </div>
  )
}

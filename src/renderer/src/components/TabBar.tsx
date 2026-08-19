import { useApp } from '@/store/app-store'

export default function TabBar(): React.JSX.Element {
  const { tabs, activeTabPath, setActiveTab, closeTab } = useApp()

  if (tabs.length === 0) return <div className="h-9 border-b border-ink-600 bg-ink-800" />

  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-ink-600 bg-ink-800">
      {tabs.map((tab) => (
        <div
          key={tab.path}
          onClick={() => setActiveTab(tab.path)}
          className={`group flex cursor-pointer items-center gap-2 border-r border-ink-600 px-3 text-xs ${
            tab.path === activeTabPath
              ? 'bg-ink-700 text-mist-100'
              : 'text-mist-400 hover:bg-ink-700/60'
          }`}
        >
          <span className="max-w-40 truncate">{tab.title}</span>
          {/* Dot means unsaved-in-flight; autosave clears it within a second. */}
          {tab.dirty && <span className="size-1.5 rounded-full bg-accent-500" />}
          <button
            onClick={(e) => {
              e.stopPropagation()
              closeTab(tab.path)
            }}
            className="rounded px-1 leading-none text-mist-400 opacity-0 hover:bg-ink-500 hover:text-mist-100 group-hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

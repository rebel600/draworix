import { useState } from 'react'
import { useApp } from '@/store/app-store'
import TextPrompt from './TextPrompt'
import type { DocumentInfo } from '@shared/types'

const WORKSPACE_ICONS = ['📁', '🚀', '🧩', '🗄️', '⚙️', '🎯', '🧪', '💡']

type PromptKind =
  | { kind: 'workspace' }
  | { kind: 'rename-workspace'; id: string; current: string }
  | { kind: 'document' }
  | { kind: 'rename-document'; path: string; current: string }
  | null

export default function Sidebar(): React.JSX.Element {
  const {
    workspaces,
    activeWorkspaceId,
    documents,
    activeTabPath,
    settings,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    revealWorkspace,
    createDocument,
    openDocument,
    renameDocument,
    deleteDocument,
    changeDataRoot
  } = useApp()

  const [prompt, setPrompt] = useState<PromptKind>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null

  const handleConfirm = (value: string): void => {
    if (!prompt) return
    if (prompt.kind === 'workspace') {
      const icon = WORKSPACE_ICONS[workspaces.length % WORKSPACE_ICONS.length] ?? '📁'
      void createWorkspace(value, icon)
    } else if (prompt.kind === 'rename-workspace') {
      void renameWorkspace(prompt.id, value)
    } else if (prompt.kind === 'document') {
      void createDocument(value, 'erd')
    } else if (prompt.kind === 'rename-document') {
      void renameDocument(prompt.path, value)
    }
    setPrompt(null)
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-ink-600 bg-ink-800">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold tracking-tight text-mist-100">Drawrix</span>
        <button
          title="Change storage folder"
          onClick={() => void changeDataRoot()}
          className="rounded px-1.5 py-0.5 text-xs text-mist-400 hover:bg-ink-600 hover:text-mist-100"
        >
          ⚙
        </button>
      </div>

      <SectionHeader label="Workspaces" onAdd={() => setPrompt({ kind: 'workspace' })} />

      <div className="max-h-56 overflow-y-auto px-2">
        {workspaces.length === 0 && (
          <p className="px-2 py-3 text-xs leading-relaxed text-mist-400">
            No workspaces yet. Create one to group a project&apos;s diagrams.
          </p>
        )}
        {workspaces.map((ws) => (
          <div key={ws.id} className="group relative">
            <button
              onClick={() => void selectWorkspace(ws.id)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                ws.id === activeWorkspaceId
                  ? 'bg-ink-600 text-mist-100'
                  : 'text-mist-200 hover:bg-ink-700'
              }`}
            >
              <span>{ws.icon}</span>
              <span className="flex-1 truncate">{ws.name}</span>
              <span className="text-[10px] text-mist-400">{ws.documentCount}</span>
            </button>
            <button
              onClick={() => setMenuFor(menuFor === ws.id ? null : ws.id)}
              className="absolute right-1 top-1.5 hidden rounded px-1 text-mist-400 hover:text-mist-100 group-hover:block"
            >
              ⋯
            </button>
            {menuFor === ws.id && (
              <div className="absolute right-1 top-7 z-20 w-36 rounded border border-ink-500 bg-ink-700 py-1 shadow-xl">
                <MenuItem
                  label="Rename"
                  onClick={() => {
                    setMenuFor(null)
                    setPrompt({ kind: 'rename-workspace', id: ws.id, current: ws.name })
                  }}
                />
                <MenuItem
                  label="Show in Explorer"
                  onClick={() => {
                    setMenuFor(null)
                    void revealWorkspace(ws.id)
                  }}
                />
                <MenuItem
                  label="Move to Recycle Bin"
                  danger
                  onClick={() => {
                    setMenuFor(null)
                    void deleteWorkspace(ws.id)
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <SectionHeader
        label={activeWorkspace ? `Diagrams · ${activeWorkspace.name}` : 'Diagrams'}
        onAdd={activeWorkspace ? () => setPrompt({ kind: 'document' }) : undefined}
      />

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {activeWorkspace && documents.length === 0 && (
          <p className="px-2 py-3 text-xs leading-relaxed text-mist-400">
            No diagrams in this workspace yet.
          </p>
        )}
        {documents.map((doc: DocumentInfo) => (
          <div key={doc.path} className="group relative">
            <button
              onClick={() => void openDocument(doc)}
              onDoubleClick={() =>
                setPrompt({ kind: 'rename-document', path: doc.path, current: doc.title })
              }
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                doc.path === activeTabPath
                  ? 'bg-ink-600 text-mist-100'
                  : 'text-mist-200 hover:bg-ink-700'
              }`}
            >
              <span className="text-mist-400">{doc.type === 'erd' ? '▤' : '◇'}</span>
              <span className="flex-1 truncate">{doc.title}</span>
            </button>
            <button
              title="Move to Recycle Bin"
              onClick={() => void deleteDocument(doc.path)}
              className="absolute right-1 top-1.5 hidden rounded px-1 text-mist-400 hover:text-red-400 group-hover:block"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="truncate border-t border-ink-600 px-3 py-2 text-[10px] text-mist-400">
        {settings?.dataRoot ?? '…'}
      </div>

      <TextPrompt
        open={prompt !== null}
        title={
          prompt?.kind === 'workspace'
            ? 'New workspace'
            : prompt?.kind === 'document'
              ? 'New diagram'
              : 'Rename'
        }
        label={prompt?.kind === 'document' ? 'Diagram name' : 'Name'}
        initialValue={
          prompt && 'current' in prompt ? prompt.current : ''
        }
        confirmLabel={prompt && 'current' in prompt ? 'Rename' : 'Create'}
        onConfirm={handleConfirm}
        onCancel={() => setPrompt(null)}
      />
    </aside>
  )
}

function SectionHeader({
  label,
  onAdd
}: {
  label: string
  onAdd?: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between px-3 pb-1 pt-3">
      <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-mist-400">
        {label}
      </span>
      {onAdd && (
        <button
          onClick={onAdd}
          className="rounded px-1.5 text-sm leading-none text-mist-400 hover:bg-ink-600 hover:text-mist-100"
        >
          +
        </button>
      )}
    </div>
  )
}

function MenuItem({
  label,
  onClick,
  danger
}: {
  label: string
  onClick: () => void
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-ink-600 ${
        danger ? 'text-red-400' : 'text-mist-200'
      }`}
    >
      {label}
    </button>
  )
}

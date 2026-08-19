import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  title: string
  label: string
  initialValue?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

/**
 * In-app replacement for window.prompt — a native dialog would block the
 * renderer and freeze the whole app.
 */
export default function TextPrompt({
  open,
  title,
  label,
  initialValue = '',
  confirmLabel = 'Create',
  onConfirm,
  onCancel
}: Props): React.JSX.Element | null {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(initialValue)
      // Focus after paint so the field is ready to type into immediately.
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [open, initialValue])

  if (!open) return null

  const submit = (): void => {
    if (value.trim()) onConfirm(value.trim())
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onCancel}
    >
      <div
        className="w-96 rounded-lg border border-ink-500 bg-ink-700 p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold text-mist-100">{title}</h2>
        <label className="mb-1.5 block text-xs text-mist-400">{label}</label>
        <input
          ref={inputRef}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
          className="w-full rounded border border-ink-400 bg-ink-800 px-3 py-2 text-sm text-mist-100 outline-none focus:border-accent-500"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs text-mist-200 hover:bg-ink-600"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!value.trim()}
            className="rounded bg-accent-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-400 disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

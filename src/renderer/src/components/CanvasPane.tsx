import type { Tab } from '@/store/app-store'

/**
 * M1 stand-in for the diagram surface. M3 swaps this for React Flow + ELK;
 * until then it shows the parsed-shape count so the split layout is real.
 */
export default function CanvasPane({ tab }: { tab: Tab }): React.JSX.Element {
  // Crude count of top-level blocks — replaced by the real parser in M2.
  const blocks = tab.doc.source.match(/^\s*[\w.]+\s*\{/gm)?.length ?? 0

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-ink-600 px-3 text-[10px] uppercase tracking-wider text-mist-400">
        <span>Canvas</span>
        <span>{blocks} block{blocks === 1 ? '' : 's'}</span>
      </div>
      <div
        className="flex flex-1 items-center justify-center"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--color-ink-600) 1px, transparent 1px)',
          backgroundSize: '20px 20px'
        }}
      >
        <div className="max-w-xs text-center">
          <p className="text-sm text-mist-200">Canvas lands in M3</p>
          <p className="mt-2 text-xs leading-relaxed text-mist-400">
            React Flow nodes with ELK auto-layout render here. Positions save to{' '}
            <code className="text-mist-200">layout</code>, never into your source.
          </p>
        </div>
      </div>
    </div>
  )
}

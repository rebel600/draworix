/**
 * One undo story for a document, covering both halves of it.
 *
 * Everything that changes the *source* — typing, and every canvas action,
 * which is applied to the model rather than to the store — already shares
 * Monaco's undo stack. Dragging a node changes only `layout`, which Monaco
 * knows nothing about, so those steps are kept here.
 *
 * Interleaving the two without them drifting apart comes down to Monaco's
 * alternative version id: it changes with every edit to the text and returns
 * to an earlier value when that edit is undone. A drag records the version it
 * happened at, so `undo` can ask the only question that matters — has the text
 * changed since this drag? If not, the drag is the most recent thing that
 * happened to the document and is what should come back.
 */
import { redoText, textVersion, undoText } from './monaco'
import { useApp } from '@/store/app-store'
import type { Point } from '@shared/types'

/** `null` means the node had no saved position: undoing hands it back to elk. */
export type Positions = Record<string, Point | null>

interface DragStep {
  before: Positions
  after: Positions
  /** The text version the document was at when this drag happened. */
  version: number
}

const undoStacks = new Map<string, DragStep[]>()
const redoStacks = new Map<string, DragStep[]>()

const stack = (map: Map<string, DragStep[]>, path: string): DragStep[] => {
  const existing = map.get(path)
  if (existing) return existing
  const created: DragStep[] = []
  map.set(path, created)
  return created
}

/** Remember a completed drag. Called once per drag, not once per mouse move. */
export function recordDrag(path: string, before: Positions, after: Positions): void {
  if (Object.keys(after).length === 0) return
  stack(undoStacks, path).push({ before, after, version: textVersion(path) })
  redoStacks.delete(path)
}

/** A canvas action that rewrote the source invalidates the drag redo stack. */
export function recordTextEdit(path: string): void {
  redoStacks.delete(path)
}

export function undo(path: string): void {
  const steps = stack(undoStacks, path)
  const top = steps[steps.length - 1]

  // A drag is only the most recent change if no text edit landed after it.
  if (top && top.version === textVersion(path)) {
    steps.pop()
    stack(redoStacks, path).push(top)
    useApp.getState().setPositions(path, top.before)
    return
  }

  undoText(path)
}

export function redo(path: string): void {
  const steps = stack(redoStacks, path)
  const top = steps[steps.length - 1]

  if (top && top.version === textVersion(path)) {
    steps.pop()
    stack(undoStacks, path).push(top)
    useApp.getState().setPositions(path, top.after)
    return
  }

  redoText(path)
}

/** Closing a document drops its history with it. */
export function forgetHistory(path: string): void {
  undoStacks.delete(path)
  redoStacks.delete(path)
}

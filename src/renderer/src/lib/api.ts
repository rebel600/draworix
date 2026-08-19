import type { Result } from '@shared/types'

/** Unwrap the IPC Result envelope, turning a failed call into a throw. */
export async function call<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export const api = window.drawrix

/** Trailing-edge debounce keyed by an arbitrary string (one timer per document). */
export function keyedDebounce(delayMs: number): (key: string, fn: () => void) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  return (key, fn) => {
    const existing = timers.get(key)
    if (existing) clearTimeout(existing)
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        fn()
      }, delayMs)
    )
  }
}

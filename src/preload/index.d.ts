import type { DrawrixApi } from './index'

declare global {
  interface Window {
    drawrix: DrawrixApi
  }
}

export {}

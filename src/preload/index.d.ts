import type { VideoClassifierApi } from './index'

declare global {
  interface Window {
    api: VideoClassifierApi
  }
}

export {}

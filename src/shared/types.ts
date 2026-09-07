export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.webm',
  '.m4v',
  '.wmv',
  '.flv'
] as const

export interface VideoItem {
  path: string
  name: string
  basename: string
  ext: string
}

export interface CategoryItem {
  name: string
  path: string
}

export type ClassifyMode = 'single' | 'multi'

export interface ClassifyResult {
  ok: boolean
  error?: string
  destinations?: string[]
}

export interface PlayerBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PlayerState {
  ready: boolean
  path: string | null
  time: number
  duration: number
  paused: boolean
  eof: boolean
  volume: number
  muted: boolean
  error: string | null
  mpvAvailable: boolean
}

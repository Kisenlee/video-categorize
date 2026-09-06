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

import { contextBridge, ipcRenderer } from 'electron'
import type {
  VideoItem,
  CategoryItem,
  ClassifyResult,
  PlayerBounds,
  PlayerState
} from '../shared/types'

export type { PlayerBounds, PlayerState }

const api = {
  selectSourceFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectSourceFolder'),

  selectTargetFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectTargetFolder'),

  scanVideos: (dir: string): Promise<VideoItem[]> => ipcRenderer.invoke('videos:scan', dir),

  listCategories: (dir: string): Promise<CategoryItem[]> =>
    ipcRenderer.invoke('categories:list', dir),

  watchCategories: (dir: string): Promise<CategoryItem[]> =>
    ipcRenderer.invoke('categories:watch', dir),

  unwatchCategories: (): Promise<void> => ipcRenderer.invoke('categories:unwatch'),

  onCategoriesUpdated: (callback: (cats: CategoryItem[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, cats: CategoryItem[]): void => {
      callback(cats)
    }
    ipcRenderer.on('categories:updated', handler)
    return () => {
      ipcRenderer.removeListener('categories:updated', handler)
    }
  },

  classifySingle: (payload: {
    sourcePath: string
    newBasename: string
    categoryPath: string
  }): Promise<ClassifyResult> => ipcRenderer.invoke('classify:single', payload),

  classifyMulti: (payload: {
    sourcePath: string
    newBasename: string
    categoryPaths: string[]
  }): Promise<ClassifyResult> => ipcRenderer.invoke('classify:multi', payload),

  classifyRevert: (payload: {
    sourcePath: string
    destinations: string[]
  }): Promise<ClassifyResult> => ipcRenderer.invoke('classify:revert', payload),

  mediaToUrl: (filePath: string): Promise<string> => ipcRenderer.invoke('media:toUrl', filePath),

  setLocale: (locale: 'zh' | 'en'): Promise<void> => ipcRenderer.invoke('app:setLocale', locale),

  playerGetState: (): Promise<PlayerState | null> => ipcRenderer.invoke('player:getState'),
  playerSetBounds: (bounds: PlayerBounds): Promise<void> =>
    ipcRenderer.invoke('player:setBounds', bounds),
  playerLoad: (filePath: string): Promise<PlayerState | null> =>
    ipcRenderer.invoke('player:load', filePath),
  playerStop: (): Promise<void> => ipcRenderer.invoke('player:stop'),
  playerUnloadForClassify: (): Promise<void> => ipcRenderer.invoke('player:unloadForClassify'),
  playerPlay: (): Promise<void> => ipcRenderer.invoke('player:play'),
  playerPause: (): Promise<void> => ipcRenderer.invoke('player:pause'),
  playerTogglePause: (): Promise<void> => ipcRenderer.invoke('player:togglePause'),
  playerSeek: (seconds: number): Promise<void> => ipcRenderer.invoke('player:seek', seconds),
  playerSeekBy: (delta: number): Promise<void> => ipcRenderer.invoke('player:seekBy', delta),
  playerSetVolume: (volume01: number): Promise<void> =>
    ipcRenderer.invoke('player:setVolume', volume01),
  playerSetMuted: (muted: boolean): Promise<void> => ipcRenderer.invoke('player:setMuted', muted),
  playerSetVisible: (visible: boolean): Promise<void> =>
    ipcRenderer.invoke('player:setVisible', visible),
  playerSuspendForUi: (): Promise<void> => ipcRenderer.invoke('player:suspendForUi'),
  playerResumeAfterUi: (): Promise<void> => ipcRenderer.invoke('player:resumeAfterUi'),

  onPlayerState: (callback: (state: PlayerState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PlayerState): void => {
      callback(state)
    }
    ipcRenderer.on('player:state', handler)
    return () => {
      ipcRenderer.removeListener('player:state', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type VideoClassifierApi = typeof api

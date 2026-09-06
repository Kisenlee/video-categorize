import { contextBridge, ipcRenderer } from 'electron'
import type { VideoItem, CategoryItem, ClassifyResult } from '../shared/types'

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

  mediaToUrl: (filePath: string): Promise<string> => ipcRenderer.invoke('media:toUrl', filePath)
}

contextBridge.exposeInMainWorld('api', api)

export type VideoClassifierApi = typeof api

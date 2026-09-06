import { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu } from 'electron'
import { join, basename, extname, parse } from 'path'
import { pathToFileURL } from 'url'
import { readdir, rename, copyFile, unlink, access, constants } from 'fs/promises'
import { existsSync } from 'fs'
import chokidar, { type FSWatcher } from 'chokidar'
import { VIDEO_EXTENSIONS, type VideoItem, type CategoryItem, type ClassifyResult } from '../shared/types'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let categoryWatcher: FSWatcher | null = null
let watchedTargetDir: string | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: '视频分类助手',
    backgroundColor: '#12151a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  Menu.setApplicationMenu(null)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function isVideoFile(filename: string): boolean {
  const ext = extname(filename).toLowerCase()
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext)
}

async function scanVideos(dir: string): Promise<VideoItem[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const videos: VideoItem[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!isVideoFile(entry.name)) continue
    const fullPath = join(dir, entry.name)
    const parsed = parse(entry.name)
    videos.push({
      path: fullPath,
      name: entry.name,
      basename: parsed.name,
      ext: parsed.ext
    })
  }

  videos.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  return videos
}

async function listCategories(dir: string): Promise<CategoryItem[]> {
  if (!dir || !existsSync(dir)) return []
  const entries = await readdir(dir, { withFileTypes: true })
  const cats: CategoryItem[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    cats.push({
      name: entry.name,
      path: join(dir, entry.name)
    })
  }
  cats.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
  return cats
}

function emitCategories(dir: string): void {
  void listCategories(dir).then((cats) => {
    mainWindow?.webContents.send('categories:updated', cats)
  })
}

async function stopCategoryWatch(): Promise<void> {
  if (categoryWatcher) {
    await categoryWatcher.close()
    categoryWatcher = null
  }
  watchedTargetDir = null
}

function startCategoryWatch(dir: string): void {
  void stopCategoryWatch().then(() => {
    if (!dir || !existsSync(dir)) return
    watchedTargetDir = dir
    emitCategories(dir)

    categoryWatcher = chokidar.watch(dir, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      // Polling helps with some NAS mounts
      usePolling: process.env.VIDEO_CLASSIFIER_POLL === '1'
    })

    const refresh = (): void => {
      if (watchedTargetDir) emitCategories(watchedTargetDir)
    }

    categoryWatcher.on('addDir', refresh)
    categoryWatcher.on('unlinkDir', refresh)
    categoryWatcher.on('add', refresh)
    categoryWatcher.on('unlink', refresh)
    categoryWatcher.on('error', () => {
      // Keep last known list; user can re-select folder
    })
  })
}

async function uniqueTargetPath(dir: string, filename: string): Promise<string> {
  const parsed = parse(filename)
  let candidate = join(dir, filename)
  let i = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${parsed.name}_${i}${parsed.ext}`)
    i += 1
  }
  return candidate
}

function sanitizeBasename(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  return trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '')
}

async function ensureSourceExists(sourcePath: string): Promise<void> {
  await access(sourcePath, constants.R_OK)
}

async function classifySingle(
  sourcePath: string,
  newBasename: string,
  categoryPath: string
): Promise<ClassifyResult> {
  try {
    await ensureSourceExists(sourcePath)
    if (!existsSync(categoryPath)) {
      return { ok: false, error: '分类文件夹不存在' }
    }

    const ext = extname(sourcePath)
    const safeBase = sanitizeBasename(newBasename) || parse(sourcePath).name
    const desiredName = `${safeBase}${ext}`
    const dest = await uniqueTargetPath(categoryPath, desiredName)

    try {
      await rename(sourcePath, dest)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EXDEV') {
        await copyFile(sourcePath, dest)
        await unlink(sourcePath)
      } else {
        throw err
      }
    }

    return { ok: true, destinations: [dest] }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function classifyMulti(
  sourcePath: string,
  newBasename: string,
  categoryPaths: string[]
): Promise<ClassifyResult> {
  try {
    await ensureSourceExists(sourcePath)
    if (categoryPaths.length === 0) {
      return { ok: false, error: '请至少选择一个分类' }
    }

    for (const cat of categoryPaths) {
      if (!existsSync(cat)) {
        return { ok: false, error: `分类文件夹不存在: ${basename(cat)}` }
      }
    }

    const ext = extname(sourcePath)
    const safeBase = sanitizeBasename(newBasename) || parse(sourcePath).name
    const desiredName = `${safeBase}${ext}`
    const destinations: string[] = []

    for (const cat of categoryPaths) {
      const dest = await uniqueTargetPath(cat, desiredName)
      await copyFile(sourcePath, dest)
      destinations.push(dest)
    }

    await unlink(sourcePath)
    return { ok: true, destinations }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function registerIpc(): void {
  ipcMain.handle('dialog:selectSourceFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择待处理文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectTargetFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择目标文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('videos:scan', async (_e, dir: string) => {
    if (!dir || !existsSync(dir)) return []
    return scanVideos(dir)
  })

  ipcMain.handle('categories:list', async (_e, dir: string) => {
    return listCategories(dir)
  })

  ipcMain.handle('categories:watch', async (_e, dir: string) => {
    startCategoryWatch(dir)
    return listCategories(dir)
  })

  ipcMain.handle('categories:unwatch', async () => {
    await stopCategoryWatch()
  })

  ipcMain.handle(
    'classify:single',
    async (_e, payload: { sourcePath: string; newBasename: string; categoryPath: string }) => {
      return classifySingle(payload.sourcePath, payload.newBasename, payload.categoryPath)
    }
  )

  ipcMain.handle(
    'classify:multi',
    async (
      _e,
      payload: { sourcePath: string; newBasename: string; categoryPaths: string[] }
    ) => {
      return classifyMulti(payload.sourcePath, payload.newBasename, payload.categoryPaths)
    }
  )

  ipcMain.handle('media:toUrl', async (_e, filePath: string) => {
    const encoded = Buffer.from(filePath, 'utf8').toString('base64url')
    return `media://local/${encoded}`
  })
}

app.whenReady().then(() => {
  protocol.handle('media', (request) => {
    try {
      const url = new URL(request.url)
      const encoded = url.pathname.replace(/^\/+/, '')
      const filePath = Buffer.from(encoded, 'base64url').toString('utf8')
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void stopCategoryWatch()
  if (process.platform !== 'darwin') app.quit()
})

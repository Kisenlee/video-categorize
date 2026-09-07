import { app, BrowserWindow, dialog, ipcMain, protocol, Menu } from 'electron'
import { join, basename, extname, parse, isAbsolute } from 'path'
import { readdir, rename, copyFile, unlink, access, stat, constants } from 'fs/promises'
import { createReadStream, existsSync } from 'fs'
import { Readable } from 'stream'
import chokidar, { type FSWatcher } from 'chokidar'
import { VIDEO_EXTENSIONS, type VideoItem, type CategoryItem, type ClassifyResult } from '../shared/types'
import { MpvPlayer, type PlayerBounds } from './mpv-player'

type UiLocale = 'zh' | 'en'

const WINDOW_TITLE: Record<UiLocale, string> = {
  zh: '视频分类助手',
  en: 'Video Classifier'
}

let uiLocale: UiLocale = 'zh'

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
let mpvPlayer: MpvPlayer | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: WINDOW_TITLE[uiLocale],
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

  mpvPlayer = new MpvPlayer(mainWindow)
  mpvPlayer.onState = (state) => {
    mainWindow?.webContents.send('player:state', state)
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    void mpvPlayer?.destroy()
    mpvPlayer = null
    mainWindow = null
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
      return { ok: false, error: 'categoryMissing' }
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
      return { ok: false, error: 'noCategorySelected' }
    }

    for (const cat of categoryPaths) {
      if (!existsSync(cat)) {
        return { ok: false, error: `categoryMissing:${basename(cat)}` }
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
    await mpvPlayer?.suspendForUi()
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: uiLocale === 'zh' ? '选择待处理文件夹' : 'Select inbox folder',
      properties: ['openDirectory']
    })
    await mpvPlayer?.resumeAfterUi()
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:selectTargetFolder', async () => {
    await mpvPlayer?.suspendForUi()
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: uiLocale === 'zh' ? '选择目标文件夹' : 'Select target folder',
      properties: ['openDirectory']
    })
    await mpvPlayer?.resumeAfterUi()
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

  ipcMain.handle('app:setLocale', async (_e, locale: UiLocale) => {
    if (locale !== 'zh' && locale !== 'en') return
    uiLocale = locale
    mainWindow?.setTitle(WINDOW_TITLE[locale])
  })

  ipcMain.handle('player:getState', async () => mpvPlayer?.getState() ?? null)

  ipcMain.handle('player:setBounds', async (_e, bounds: PlayerBounds) => {
    mpvPlayer?.setBounds(bounds)
  })

  ipcMain.handle('player:load', async (_e, filePath: string) => {
    await mpvPlayer?.load(filePath)
    return mpvPlayer?.getState() ?? null
  })

  ipcMain.handle('player:stop', async () => {
    await mpvPlayer?.stop()
  })

  ipcMain.handle('player:unloadForClassify', async () => {
    await mpvPlayer?.unloadForClassify()
  })

  ipcMain.handle('player:play', async () => {
    await mpvPlayer?.play()
  })

  ipcMain.handle('player:pause', async () => {
    await mpvPlayer?.pause()
  })

  ipcMain.handle('player:togglePause', async () => {
    await mpvPlayer?.togglePause()
  })

  ipcMain.handle('player:seek', async (_e, seconds: number) => {
    await mpvPlayer?.seek(seconds)
  })

  ipcMain.handle('player:seekBy', async (_e, delta: number) => {
    await mpvPlayer?.seekBy(delta)
  })

  ipcMain.handle('player:setVolume', async (_e, volume01: number) => {
    await mpvPlayer?.setVolume(volume01)
  })

  ipcMain.handle('player:setMuted', async (_e, muted: boolean) => {
    await mpvPlayer?.setMuted(muted)
  })

  ipcMain.handle('player:setVisible', async (_e, visible: boolean) => {
    await mpvPlayer?.setVisible(visible)
  })
}

function mimeForExt(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mkv':
      return 'video/x-matroska'
    case '.mov':
      return 'video/quicktime'
    case '.avi':
      return 'video/x-msvideo'
    case '.wmv':
      return 'video/x-ms-wmv'
    case '.flv':
      return 'video/x-flv'
    default:
      return 'application/octet-stream'
  }
}

function parseByteRange(
  rangeHeader: string | null,
  size: number
): { start: number; end: number; partial: boolean } | { unsatisfiable: true } {
  if (!rangeHeader) {
    return { start: 0, end: Math.max(0, size - 1), partial: false }
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match) {
    return { start: 0, end: Math.max(0, size - 1), partial: false }
  }
  const startStr = match[1]
  const endStr = match[2]
  let start: number
  let end: number
  if (!startStr && endStr) {
    const suffix = Number(endStr)
    if (!Number.isFinite(suffix) || suffix <= 0) return { unsatisfiable: true }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = startStr ? Number(startStr) : 0
    end = endStr ? Number(endStr) : size - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || end < start) {
    return { unsatisfiable: true }
  }
  end = Math.min(end, size - 1)
  return { start, end, partial: true }
}

function decodeMediaPath(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl)
    const encoded = url.pathname.replace(/^\/+/, '')
    if (!encoded) return null
    const filePath = Buffer.from(encoded, 'base64url').toString('utf8')
    if (!filePath) return null
    if (!isAbsolute(filePath) && !filePath.startsWith('\\\\') && !filePath.startsWith('//')) {
      return null
    }
    return filePath
  } catch {
    return null
  }
}

async function handleMediaRequest(request: Request): Promise<Response> {
  const filePath = decodeMediaPath(request.url)
  if (!filePath) {
    return new Response('Not found', { status: 404 })
  }

  let fileStat: Awaited<ReturnType<typeof stat>>
  try {
    fileStat = await stat(filePath)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  if (!fileStat.isFile()) {
    return new Response('Not found', { status: 404 })
  }

  const size = fileStat.size
  const mime = mimeForExt(filePath)
  if (size === 0) {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': '0',
        'Accept-Ranges': 'bytes'
      }
    })
  }

  const range = parseByteRange(request.headers.get('Range'), size)
  if ('unsatisfiable' in range) {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${size}`,
        'Accept-Ranges': 'bytes'
      }
    })
  }

  const { start, end, partial } = range
  const chunkSize = end - start + 1
  const nodeStream = createReadStream(filePath, { start, end })
  const abort = (): void => {
    nodeStream.destroy()
  }
  request.signal.addEventListener('abort', abort)
  nodeStream.once('close', () => {
    request.signal.removeEventListener('abort', abort)
  })

  const body = Readable.toWeb(nodeStream) as never
  return new Response(body, {
    status: partial ? 206 : 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(chunkSize),
      'Accept-Ranges': 'bytes',
      ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
    }
  })
}

app.whenReady().then(() => {
  protocol.handle('media', (request) => handleMediaRequest(request))

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  void stopCategoryWatch()
  void mpvPlayer?.destroy()
  mpvPlayer = null
  if (process.platform !== 'darwin') app.quit()
})

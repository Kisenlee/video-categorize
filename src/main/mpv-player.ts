import { BrowserWindow, screen } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createConnection, type Socket } from 'net'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { randomBytes } from 'crypto'
import type { PlayerBounds, PlayerState } from '../shared/types'
import { MpvWindowController } from './mpv-window'
import { PlaybackHttpServer } from './playback-http'

export type { PlayerBounds, PlayerState }

type MpvResponse = {
  request_id?: number
  error?: string
  data?: unknown
  event?: string
  name?: string
  id?: number
  reason?: string
}

function resolveMpvPath(): string | null {
  const candidates: string[] = []
  if (process.env.MPV_PATH) candidates.push(process.env.MPV_PATH)
  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'mpv', 'mpv.exe'))
    candidates.push(join(dirname(process.execPath), 'resources', 'mpv', 'mpv.exe'))
    candidates.push(join(dirname(process.execPath), 'mpv', 'mpv.exe'))
  } else {
    candidates.push(join(process.cwd(), 'vendor', 'mpv', 'mpv.exe'))
    candidates.push(join(app.getAppPath(), 'vendor', 'mpv', 'mpv.exe'))
  }
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return null
}

function toMpvPath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

/** Try several spellings — UNC + spaces (e.g. \\ip\share\zzzz temp) are picky on Windows mpv. */
function mpvLoadPaths(filePath: string): string[] {
  const forward = toMpvPath(filePath)
  const out: string[] = []
  const add = (p: string): void => {
    if (p && !out.includes(p)) out.push(p)
  }

  // Native Windows UNC/local first (CreateFileW); then slash form.
  add(filePath)
  add(forward)

  if (filePath.startsWith('\\\\') || forward.startsWith('//')) {
    const body = forward.replace(/^\/\//, '')
    const parts = body.split('/')
    const host = parts.shift() ?? ''
    const encodedRest = parts.map((s) => encodeURIComponent(s)).join('/')
    if (host) {
      add(`file:////${host}/${encodedRest}`)
      add(`smb://${host}/${encodedRest}`)
    }
  }
  return out
}

export class MpvPlayer {
  private parent: BrowserWindow
  private proc: ChildProcess | null = null
  private ipc: Socket | null = null
  private ipcBuffer = ''
  private pipeName = ''
  private windowTitle = ''
  private win: MpvWindowController | null = null
  private requestId = 1
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private pollTimer: NodeJS.Timeout | null = null
  private starting: Promise<void> | null = null
  private destroyed = false
  private visible = false
  private suspended = false
  private ignoreEndFileErrors = false
  private lastBounds: PlayerBounds | null = null
  private framePad = { x: 0, y: 0 }
  private loadGeneration = 0
  private opChain: Promise<void> = Promise.resolve()
  private fileLoadedWaiter: {
    gen: number
    resolve: (ok: boolean) => void
  } | null = null
  private http = new PlaybackHttpServer()

  private state: PlayerState = {
    ready: false,
    path: null,
    time: 0,
    duration: 0,
    paused: true,
    eof: false,
    volume: 85,
    muted: false,
    error: null,
    mpvAvailable: Boolean(resolveMpvPath())
  }

  onState?: (state: PlayerState) => void

  constructor(parent: BrowserWindow) {
    this.parent = parent
    this.refreshFramePad()

    // Synchronous during drag — avoids the visible “chase” lag of async geometry IPC.
    parent.on('will-move', (_e, newBounds) => {
      if (this.suspended || !this.visible || !this.state.path || !this.lastBounds) return
      this.placeDipRect(
        {
          x: newBounds.x + this.framePad.x + this.lastBounds.x,
          y: newBounds.y + this.framePad.y + this.lastBounds.y,
          width: this.lastBounds.width,
          height: this.lastBounds.height
        },
        true
      )
    })
    parent.on('will-resize', (_e, newBounds) => {
      this.refreshFramePad(newBounds)
      if (this.suspended || !this.visible || !this.state.path || !this.lastBounds) return
      this.placeDipRect(
        {
          x: newBounds.x + this.framePad.x + this.lastBounds.x,
          y: newBounds.y + this.framePad.y + this.lastBounds.y,
          width: this.lastBounds.width,
          height: this.lastBounds.height
        },
        true
      )
    })
    parent.on('move', () => {
      this.refreshFramePad()
      this.syncOverlay(true)
    })
    parent.on('resize', () => {
      this.refreshFramePad()
      this.syncOverlay(true)
    })
    parent.on('maximize', () => {
      this.refreshFramePad()
      this.syncOverlay(true)
    })
    parent.on('unmaximize', () => {
      this.refreshFramePad()
      this.syncOverlay(true)
    })
    parent.on('minimize', () => {
      if (!this.suspended) void this.setVisible(false)
    })
    parent.on('restore', () => {
      this.refreshFramePad()
      if (!this.suspended && this.state.path) void this.setVisible(true)
    })
    parent.on('hide', () => {
      if (!this.suspended) void this.setVisible(false)
    })
    parent.on('show', () => {
      this.refreshFramePad()
      if (!this.suspended && this.state.path) void this.setVisible(true)
    })
    parent.on('focus', () => {
      if (!this.suspended && this.visible && this.state.path) {
        this.syncOverlay(true)
        this.win?.showAboveOwner()
      }
    })
    parent.on('blur', () => {
      // Clicks on the mpv surface can activate it and steal shortcuts; pull focus back.
      if (this.win?.isForeground()) {
        this.parent.focus()
        this.parent.webContents.focus()
      }
    })
  }

  getState(): PlayerState {
    return { ...this.state }
  }

  private emit(): void {
    this.onState?.({ ...this.state })
  }

  private setError(message: string | null): void {
    this.state.error = message
    this.emit()
  }

  private refreshFramePad(frameBounds?: Electron.Rectangle): void {
    const frame = frameBounds ?? this.parent.getBounds()
    const content = this.parent.getContentBounds()
    this.framePad = {
      x: content.x - frame.x,
      y: content.y - frame.y
    }
  }

  private placeDipRect(
    dip: { x: number; y: number; width: number; height: number },
    show: boolean
  ): void {
    // Renderer + Electron bounds are DIP; Win32 SetWindowPos needs physical pixels on scaled displays.
    const phys = screen.dipToScreenRect(this.parent, {
      x: Math.round(dip.x),
      y: Math.round(dip.y),
      width: Math.max(2, Math.round(dip.width)),
      height: Math.max(2, Math.round(dip.height))
    })
    this.win?.setBounds(phys.x, phys.y, phys.width, phys.height, { show })
  }

  private syncOverlay(show: boolean): void {
    if (!this.win || !this.lastBounds || !this.state.path) return
    if (this.suspended) return
    const content = this.parent.getContentBounds()
    this.placeDipRect(
      {
        x: content.x + this.lastBounds.x,
        y: content.y + this.lastBounds.y,
        width: this.lastBounds.width,
        height: this.lastBounds.height
      },
      show && this.visible
    )
  }

  private startingVo = false

  async ensureStarted(): Promise<void> {
    if (this.state.ready && this.proc && this.ipc) return
    if (this.starting) return this.starting
    this.starting = this.startWithVoFallback().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async startWithVoFallback(): Promise<void> {
    try {
      await this.start('gpu-next')
    } catch {
      this.killProcOnly()
      await this.start('gpu')
    }
  }

  private killProcOnly(): void {
    this.startingVo = true
    try {
      this.ipc?.destroy()
    } catch {
      // ignore
    }
    this.ipc = null
    const proc = this.proc
    this.proc = null
    this.win = null
    this.state.ready = false
    if (proc && !proc.killed) {
      try {
        proc.kill()
      } catch {
        // ignore
      }
      if (process.platform === 'win32' && proc.pid) {
        try {
          spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
          })
        } catch {
          // ignore
        }
      }
    }
    this.startingVo = false
  }

  private async start(vo: 'gpu-next' | 'gpu'): Promise<void> {
    const mpvPath = resolveMpvPath()
    this.state.mpvAvailable = Boolean(mpvPath)
    if (!mpvPath) {
      this.setError('mpvMissing')
      throw new Error('mpvMissing')
    }

    this.windowTitle = `VideoClassifierPlayer-${process.pid}-${randomBytes(3).toString('hex')}`
    this.pipeName = `\\\\.\\pipe\\vc-mpv-${process.pid}-${randomBytes(4).toString('hex')}`
    this.win = new MpvWindowController(this.windowTitle, this.parent)

    // Prefer gpu-next for HDR→SDR; fall back to gpu if VO init fails on this machine.
    // Keep window on-screen — offscreen geometry broke VO on some GPUs/portable extracts.
    this.proc = spawn(
      mpvPath,
      [
        `--input-ipc-server=${this.pipeName}`,
        `--title=${this.windowTitle}`,
        '--idle=yes',
        '--keep-open=yes',
        '--force-window=yes',
        '--no-border',
        '--no-osc',
        '--no-osd-bar',
        '--osc=no',
        '--input-default-bindings=no',
        '--input-vo-keyboard=no',
        '--focus-on=never',
        '--hwdec=auto-safe',
        `--vo=${vo}`,
        '--tone-mapping=auto',
        '--target-prim=bt.709',
        '--target-trc=srgb',
        '--target-peak=203',
        '--target-colorspace-hint=no',
        '--cursor-autohide=no',
        '--geometry=64x64+0+0',
        '--cache=yes',
        '--demuxer-readahead-secs=8',
        '--network-timeout=60',
        '--quiet',
        '--no-terminal'
      ],
      {
        cwd: dirname(mpvPath),
        windowsHide: false,
        stdio: ['ignore', 'ignore', 'ignore']
      }
    )

    const proc = this.proc
    proc.on('exit', () => {
      if (this.proc !== proc) return
      this.state.ready = false
      this.ipc?.destroy()
      this.ipc = null
      this.proc = null
      this.win = null
      this.resolveFileLoaded(false)
      if (!this.destroyed && !this.startingVo) this.setError('mpvExited')
    })

    try {
      await this.connectIpc(50, 100)
    } catch (err) {
      this.setError('mpvIpcFailed')
      throw err
    }

    if (!this.proc) {
      this.setError('mpvExited')
      throw new Error('mpvExited')
    }

    // Wait until the native window exists
    for (let i = 0; i < 40; i++) {
      if (this.win?.resolve()) break
      if (!this.proc) {
        this.setError('mpvExited')
        throw new Error('mpvExited')
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    this.win?.hide()

    await this.command(['observe_property', 1, 'time-pos'])
    await this.command(['observe_property', 2, 'duration'])
    await this.command(['observe_property', 3, 'pause'])
    await this.command(['observe_property', 4, 'eof-reached'])
    await this.command(['observe_property', 5, 'volume'])
    await this.command(['observe_property', 6, 'mute'])

    this.state.ready = true
    this.setError(null)
    this.startPolling()
  }

  private connectIpc(attempts: number, delayMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let left = attempts
      const tryConnect = (): void => {
        if (this.destroyed) {
          reject(new Error('destroyed'))
          return
        }
        const socket = createConnection(this.pipeName)
        socket.once('connect', () => {
          this.ipc = socket
          socket.setEncoding('utf8')
          socket.on('data', (chunk: string) => this.onIpcData(chunk))
          socket.on('error', () => undefined)
          resolve()
        })
        socket.once('error', () => {
          socket.destroy()
          left -= 1
          if (left <= 0) {
            reject(new Error('mpvIpcFailed'))
            return
          }
          setTimeout(tryConnect, delayMs)
        })
      }
      tryConnect()
    })
  }

  private onIpcData(chunk: string): void {
    this.ipcBuffer += chunk
    let idx = this.ipcBuffer.indexOf('\n')
    while (idx >= 0) {
      const line = this.ipcBuffer.slice(0, idx).trim()
      this.ipcBuffer = this.ipcBuffer.slice(idx + 1)
      if (line) this.handleIpcLine(line)
      idx = this.ipcBuffer.indexOf('\n')
    }
  }

  private handleIpcLine(line: string): void {
    let msg: MpvResponse
    try {
      msg = JSON.parse(line) as MpvResponse
    } catch {
      return
    }

    if (msg.request_id != null && this.pending.has(msg.request_id)) {
      const pending = this.pending.get(msg.request_id)!
      this.pending.delete(msg.request_id)
      if (msg.error && msg.error !== 'success') pending.reject(new Error(msg.error))
      else pending.resolve(msg.data)
      return
    }

    if (msg.event === 'property-change') {
      const name = msg.name
      const data = msg.data
      if (name === 'time-pos' && typeof data === 'number') {
        this.state.time = data
        this.emit()
      } else if (name === 'duration' && typeof data === 'number') {
        this.state.duration = data
        if (data > 0) this.resolveFileLoaded(true)
        this.emit()
      } else if (name === 'pause' && typeof data === 'boolean') {
        this.state.paused = data
        this.emit()
      } else if (name === 'eof-reached') {
        this.state.eof = Boolean(data)
        if (this.state.eof) {
          this.state.paused = true
          this.emit()
        }
      } else if (name === 'volume' && typeof data === 'number') {
        this.state.volume = data
        this.emit()
      } else if (name === 'mute' && typeof data === 'boolean') {
        this.state.muted = data
        this.emit()
      }
      return
    }

    if (msg.event === 'end-file' && msg.reason === 'error') {
      this.resolveFileLoaded(false)
      if (this.ignoreEndFileErrors || !this.state.path) return
      this.setError('playFailed')
      void this.setVisible(false)
      return
    }

    if (msg.event === 'file-loaded') {
      this.ignoreEndFileErrors = false
      this.setError(null)
      this.resolveFileLoaded(true)
      void this.refreshDuration()
      if (this.visible && !this.suspended) this.syncOverlay(true)
    }
  }

  private resolveFileLoaded(ok: boolean): void {
    const waiter = this.fileLoadedWaiter
    if (!waiter) return
    this.fileLoadedWaiter = null
    waiter.resolve(ok)
  }

  private waitForFileLoaded(gen: number, timeoutMs: number): Promise<boolean> {
    this.resolveFileLoaded(false)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.fileLoadedWaiter?.gen === gen) {
          this.fileLoadedWaiter = null
          resolve(false)
        }
      }, timeoutMs)
      this.fileLoadedWaiter = {
        gen,
        resolve: (ok) => {
          clearTimeout(timer)
          resolve(ok)
        }
      }
    })
  }

  /** Serialize load/stop/unload so unmount races cannot cancel a fresh load permanently. */
  private enqueue(op: () => Promise<void>): Promise<void> {
    const run = this.opChain.then(op, op)
    this.opChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private command(args: unknown[], timeoutMs = 10000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ipc) {
        reject(new Error('mpvNotReady'))
        return
      }
      const id = this.requestId++
      this.pending.set(id, { resolve, reject })
      this.ipc.write(JSON.stringify({ command: args, request_id: id }) + '\n', (err) => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('mpvTimeout'))
        }
      }, timeoutMs)
    })
  }

  private async commandIgnore(args: unknown[]): Promise<void> {
    try {
      await this.command(args)
    } catch {
      // ignore
    }
  }

  private async refreshDuration(): Promise<void> {
    try {
      const duration = await this.command(['get_property', 'duration'])
      if (typeof duration === 'number' && Number.isFinite(duration)) {
        this.state.duration = duration
        this.emit()
      }
    } catch {
      // ignore
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => {
      if (!this.state.ready || !this.ipc || !this.state.path) return
      void this.command(['get_property', 'time-pos'])
        .then((v) => {
          if (typeof v === 'number') {
            this.state.time = v
            this.emit()
          }
        })
        .catch(() => undefined)
      if (!(this.state.duration > 0)) void this.refreshDuration()
    }, 250)
  }

  setBounds(bounds: PlayerBounds): void {
    this.lastBounds = bounds
    this.refreshFramePad()
    if (this.visible && !this.suspended && this.state.path) this.syncOverlay(true)
  }

  async setVisible(visible: boolean): Promise<void> {
    this.visible = visible
    if (this.suspended) return
    if (visible && this.state.path) {
      this.syncOverlay(true)
      this.win?.showAboveOwner()
    } else {
      this.win?.hide()
    }
  }

  async suspendForUi(): Promise<void> {
    this.suspended = true
    this.visible = false
    if (!this.state.ready) return
    await this.pause()
    this.win?.hide()
  }

  async resumeAfterUi(): Promise<void> {
    this.suspended = false
    if (!this.state.ready || !this.state.path) return
    this.visible = true
    await this.pause()
    this.refreshFramePad()
    this.syncOverlay(true)
  }

  async load(filePath: string): Promise<void> {
    return this.enqueue(() => this.loadInternal(filePath))
  }

  private async loadInternal(filePath: string): Promise<void> {
    const gen = ++this.loadGeneration
    this.ignoreEndFileErrors = true
    try {
      await this.ensureStarted()
    } catch {
      return
    }
    if (gen !== this.loadGeneration) return

    this.state.path = filePath
    this.state.time = 0
    this.state.duration = 0
    this.state.eof = false
    this.state.paused = false
    this.setError(null)

    try {
      this.suspended = false
      this.visible = true
      this.refreshFramePad()
      this.syncOverlay(true)
      this.win?.resolve()

      const paths: string[] = []
      const isUnc = filePath.startsWith('\\\\') || filePath.startsWith('//')
      // NAS/UNC: prefer localhost Range proxy (Node can read; mpv often cannot open SMB directly).
      if (isUnc) {
        try {
          this.http.clearTokens()
          paths.push(await this.http.urlFor(filePath))
        } catch {
          // fall through to direct paths
        }
      }
      paths.push(...mpvLoadPaths(filePath))

      let loaded = false
      for (const candidate of paths) {
        if (gen !== this.loadGeneration) return
        const loadedPromise = this.waitForFileLoaded(gen, 45000)
        void this.command(['loadfile', candidate, 'replace'], 45000).catch((err: Error) => {
          if (err?.message !== 'mpvTimeout') this.resolveFileLoaded(false)
        })
        loaded = await loadedPromise
        if (gen !== this.loadGeneration) return
        if (loaded) break
      }

      if (!loaded) {
        this.ignoreEndFileErrors = false
        this.setError('playFailed')
        this.visible = false
        this.win?.hide()
        return
      }

      await this.commandIgnore(['set_property', 'pause', false])
      await this.commandIgnore(['set_property', 'volume', this.state.volume])
      await this.commandIgnore(['set_property', 'mute', this.state.muted])
      await this.commandIgnore(['seek', 0, 'absolute'])

      this.win?.resolve()
      this.syncOverlay(true)
      this.ignoreEndFileErrors = false
      await this.refreshDuration()
      if (!(this.state.duration > 0)) {
        await new Promise((r) => setTimeout(r, 800))
        await this.refreshDuration()
      }
      this.emit()
    } catch {
      if (gen !== this.loadGeneration) return
      this.ignoreEndFileErrors = false
      this.resolveFileLoaded(false)
      this.setError('playFailed')
      this.visible = false
      this.win?.hide()
    }
  }

  async unloadForClassify(): Promise<void> {
    return this.enqueue(() => this.stopInternal({ clearError: true }))
  }

  async stop(): Promise<void> {
    return this.enqueue(() => this.stopInternal({ clearError: false }))
  }

  private async stopInternal(opts: { clearError: boolean }): Promise<void> {
    this.loadGeneration += 1
    this.ignoreEndFileErrors = true
    this.resolveFileLoaded(false)
    this.http.clearTokens()
    this.state.path = null
    this.state.time = 0
    this.state.duration = 0
    this.state.paused = true
    this.state.eof = false
    this.visible = false
    if (opts.clearError) this.setError(null)
    this.win?.hide()
    if (!this.state.ready) {
      this.emit()
      return
    }
    await this.commandIgnore(['set_property', 'pause', true])
    await this.commandIgnore(['stop'])
    this.emit()
  }

  async play(): Promise<void> {
    if (!this.state.ready) return
    await this.commandIgnore(['set_property', 'pause', false])
    this.state.paused = false
    this.emit()
  }

  async pause(): Promise<void> {
    if (!this.state.ready) return
    await this.commandIgnore(['set_property', 'pause', true])
    this.state.paused = true
    this.emit()
  }

  async togglePause(): Promise<void> {
    if (this.state.paused) await this.play()
    else await this.pause()
  }

  async seek(seconds: number): Promise<void> {
    if (!this.state.ready) return
    const clamped = Math.max(0, Math.min(seconds, this.state.duration || seconds))
    await this.commandIgnore(['seek', clamped, 'absolute'])
    this.state.time = clamped
    this.emit()
  }

  async seekBy(delta: number): Promise<void> {
    if (!this.state.ready) return
    await this.commandIgnore(['seek', delta, 'relative'])
  }

  async setVolume(volume01: number): Promise<void> {
    const volume = Math.round(Math.max(0, Math.min(1, volume01)) * 100)
    this.state.volume = volume
    if (volume > 0) this.state.muted = false
    this.emit()
    if (!this.state.ready) return
    await this.commandIgnore(['set_property', 'volume', volume])
    if (volume > 0) await this.commandIgnore(['set_property', 'mute', false])
  }

  async setMuted(muted: boolean): Promise<void> {
    this.state.muted = muted
    this.emit()
    if (!this.state.ready) return
    await this.commandIgnore(['set_property', 'mute', muted])
  }

  /** Tear down mpv immediately. Must not await IPC — app exit races that and orphans mpv.exe. */
  destroy(): void {
    this.destroyed = true
    this.loadGeneration += 1
    this.visible = false
    this.suspended = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    for (const [, pending] of this.pending) {
      pending.reject(new Error('destroyed'))
    }
    this.pending.clear()
    this.resolveFileLoaded(false)
    this.http.close()

    // Best-effort soft quit, then hard-kill. Never wait.
    try {
      this.ipc?.write(JSON.stringify({ command: ['quit'] }) + '\n')
    } catch {
      // ignore
    }
    try {
      this.ipc?.destroy()
    } catch {
      // ignore
    }
    this.ipc = null

    const proc = this.proc
    this.proc = null
    this.win = null
    this.state.ready = false
    this.state.path = null

    if (proc && !proc.killed) {
      try {
        proc.kill()
      } catch {
        // ignore
      }
      // Windows: ensure the child is gone even if soft kill is ignored.
      if (process.platform === 'win32' && proc.pid) {
        try {
          spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
          })
        } catch {
          // ignore
        }
      }
    }
  }
}

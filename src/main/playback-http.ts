import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createReadStream, existsSync, statSync } from 'fs'
import { extname } from 'path'
import { randomBytes } from 'crypto'

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

/**
 * Localhost Range server so mpv can play NAS/UNC files that Node can read
 * but mpv cannot open directly (spaces, SMB quirks, etc.).
 */
export class PlaybackHttpServer {
  private server: Server | null = null
  private port = 0
  private tokenToPath = new Map<string, string>()

  async urlFor(filePath: string): Promise<string> {
    const port = await this.ensureListening()
    const token = randomBytes(16).toString('hex')
    this.tokenToPath.set(token, filePath)
    return `http://127.0.0.1:${port}/play/${token}`
  }

  clearTokens(): void {
    this.tokenToPath.clear()
  }

  close(): void {
    this.tokenToPath.clear()
    const server = this.server
    this.server = null
    this.port = 0
    server?.close()
  }

  private ensureListening(): Promise<number> {
    if (this.server && this.port) return Promise.resolve(this.port)
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res))
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (!addr || typeof addr === 'string') {
          reject(new Error('playbackHttpBindFailed'))
          return
        }
        this.server = server
        this.port = addr.port
        resolve(this.port)
      })
    })
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const match = /^\/play\/([a-f0-9]+)$/i.exec(url.pathname)
      if (!match || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404)
        res.end()
        return
      }
      const filePath = this.tokenToPath.get(match[1]!)
      if (!filePath || !existsSync(filePath)) {
        res.writeHead(404)
        res.end()
        return
      }
      const st = statSync(filePath)
      if (!st.isFile()) {
        res.writeHead(404)
        res.end()
        return
      }
      const size = st.size
      const mime = mimeForExt(filePath)
      const rangeHeader = req.headers.range
      let start = 0
      let end = Math.max(0, size - 1)
      let status = 200

      if (rangeHeader) {
        const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
        if (m) {
          if (m[1]) start = Number(m[1])
          if (m[2]) end = Number(m[2])
          else if (!m[1] && m[2]) {
            const suffix = Number(m[2])
            start = Math.max(0, size - suffix)
            end = size - 1
          }
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size) {
            res.writeHead(416, { 'Content-Range': `bytes */${size}` })
            res.end()
            return
          }
          end = Math.min(end, size - 1)
          if (end < start) {
            res.writeHead(416, { 'Content-Range': `bytes */${size}` })
            res.end()
            return
          }
          status = 206
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1)
      }
      if (status === 206) {
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      }

      if (req.method === 'HEAD') {
        res.writeHead(status, headers)
        res.end()
        return
      }

      res.writeHead(status, headers)
      const stream = createReadStream(filePath, { start, end })
      stream.on('error', () => {
        try {
          res.destroy()
        } catch {
          // ignore
        }
      })
      stream.pipe(res)
    } catch {
      try {
        res.writeHead(500)
        res.end()
      } catch {
        // ignore
      }
    }
  }
}

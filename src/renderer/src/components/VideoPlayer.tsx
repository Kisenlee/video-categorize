import { useEffect, useRef, useState, useCallback } from 'react'
import type { PlayerState } from '../../../shared/types'
import { useI18n } from '../i18n'

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${m}:${String(sec).padStart(2, '0')}`
}

function playErrorText(
  error: string | null,
  filePath: string | null,
  t: ReturnType<typeof useI18n>['t']
): string {
  if (error === 'mpvMissing') return t.mpvMissing
  if (error === 'mpvIpcFailed' || error === 'mpvExited') return t.mpvStartFailed
  if (filePath?.startsWith('\\\\') || filePath?.startsWith('//')) return t.playErrorNas
  return t.playError
}

interface VideoPlayerProps {
  filePath: string | null
  obscured?: boolean
  onDuration: (seconds: number | null) => void
  onPlayFailed: (failed: boolean, message?: string | null) => void
}

export default function VideoPlayer({
  filePath,
  obscured = false,
  onDuration,
  onPlayFailed
}: VideoPlayerProps): React.JSX.Element {
  const { t } = useI18n()
  const stageRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.85)
  const [muted, setMuted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const syncBounds = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    void window.api.playerSetBounds({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    })
  }, [])

  useEffect(() => {
    const off = window.api.onPlayerState((state: PlayerState) => {
      setCurrent(typeof state.time === 'number' ? state.time : 0)
      if (typeof state.duration === 'number' && state.duration > 0) {
        setDuration(state.duration)
        onDuration(state.duration)
        setLoading(false)
      }
      setPlaying(!state.paused && Boolean(state.path))
      setVolume(Math.max(0, Math.min(1, (state.volume ?? 0) / 100)))
      setMuted(Boolean(state.muted))
      const err = state.error
      setErrorKey(err)
      setFailed(Boolean(err))
      onPlayFailed(
        Boolean(err),
        err ? playErrorText(err, state.path ?? filePath, t) : null
      )
      if (err) setLoading(false)
    })
    return off
  }, [onDuration, onPlayFailed, filePath, t])

  useEffect(() => {
    syncBounds()
    const onResize = (): void => syncBounds()
    window.addEventListener('resize', onResize)
    const ro = new ResizeObserver(() => syncBounds())
    if (stageRef.current) ro.observe(stageRef.current)
    return () => {
      window.removeEventListener('resize', onResize)
      ro.disconnect()
    }
  }, [syncBounds])

  useEffect(() => {
    setCurrent(0)
    setDuration(0)
    setPlaying(false)
    setFailed(false)
    setErrorKey(null)
    onPlayFailed(false, null)
    onDuration(null)

    if (!filePath) {
      setLoading(false)
      void window.api.playerStop()
      return
    }

    setLoading(true)
    syncBounds()
    let cancelled = false
    const watchdog = window.setTimeout(() => {
      if (cancelled) return
      setLoading(false)
      setFailed(true)
      setErrorKey('playFailed')
      onPlayFailed(true, playErrorText('playFailed', filePath, t))
    }, 120000)

    void window.api.playerLoad(filePath).then((state) => {
      if (cancelled || !state) return
      if (state.error) {
        setErrorKey(state.error)
        setFailed(true)
        setLoading(false)
        onPlayFailed(true, playErrorText(state.error, filePath, t))
        window.clearTimeout(watchdog)
        return
      }
      if (state.duration > 0) {
        setDuration(state.duration)
        onDuration(state.duration)
        setLoading(false)
        window.clearTimeout(watchdog)
      }
      setPlaying(!state.paused)
    })

    return () => {
      cancelled = true
      window.clearTimeout(watchdog)
      // Do not playerStop() here — it races the next mount's playerLoad and leaves
      // duration stuck on "reading" with no error.
    }
  }, [filePath, onDuration, onPlayFailed, syncBounds, t])

  useEffect(() => {
    // While classifying, keep overlay hidden; after load of next file, load() repositions itself.
    if (obscured) {
      void window.api.playerSetVisible(false)
    }
  }, [obscured])

  const togglePlay = useCallback(() => {
    if (!filePath) return
    void window.api.playerTogglePause()
  }, [filePath])

  const seekBy = useCallback(
    (delta: number) => {
      if (!filePath) return
      void window.api.playerSeekBy(delta)
    },
    [filePath]
  )

  const onSeek = (value: number): void => {
    if (!filePath) return
    void window.api.playerSeek(value)
    setCurrent(value)
  }

  return (
    <>
      <div className="video-stage" ref={stageRef}>
        {!filePath ? (
          <div className="video-empty">{t.videoEmpty}</div>
        ) : failed ? (
          <div className="video-error">{playErrorText(errorKey, filePath, t)}</div>
        ) : loading && duration <= 0 ? (
          <div className="video-empty">{t.reading}</div>
        ) : (
          <div className="video-native-slot" aria-hidden />
        )}
      </div>

      <div className="controls">
        <div className="seek-row">
          <span className="time">{formatTime(current)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(current, duration || 0)}
            disabled={!filePath || !duration}
            onChange={(e) => onSeek(Number(e.target.value))}
          />
          <span className="time" style={{ textAlign: 'right' }}>
            {formatTime(duration)}
          </span>
        </div>

        <div className="btn-row">
          <button type="button" className="ctrl-btn" disabled={!filePath} onClick={() => seekBy(-10)}>
            −10s
          </button>
          <button type="button" className="ctrl-btn" disabled={!filePath} onClick={togglePlay}>
            {playing ? t.pause : t.play}
          </button>
          <button type="button" className="ctrl-btn" disabled={!filePath} onClick={() => seekBy(10)}>
            +10s
          </button>

          <div className="volume-wrap">
            <button
              type="button"
              className="ctrl-btn"
              disabled={!filePath}
              onClick={() => {
                const next = !muted
                setMuted(next)
                void window.api.playerSetMuted(next)
              }}
            >
              {muted || volume === 0 ? t.mute : t.volume}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              disabled={!filePath}
              onChange={(e) => {
                const next = Number(e.target.value)
                setVolume(next)
                setMuted(next === 0)
                void window.api.playerSetVolume(next)
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}

export { formatTime }

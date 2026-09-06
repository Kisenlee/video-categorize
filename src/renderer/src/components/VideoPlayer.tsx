import { useEffect, useRef, useState, useCallback } from 'react'

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

interface VideoPlayerProps {
  src: string | null
  onDuration: (seconds: number | null) => void
  onError: (message: string | null) => void
}

export default function VideoPlayer({ src, onDuration, onError }: VideoPlayerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.85)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
  }, [volume])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    setCurrent(0)
    setDuration(0)
    setPlaying(false)
    onDuration(null)

    if (!src) {
      video.removeAttribute('src')
      video.load()
      return
    }

    video.src = src
    video.currentTime = 0
    void video.play().then(
      () => setPlaying(true),
      () => setPlaying(false)
    )
  }, [src, onDuration])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video || !src) return
    if (video.paused) {
      void video.play().then(() => setPlaying(true))
    } else {
      video.pause()
      setPlaying(false)
    }
  }, [src])

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current
    if (!video || !src) return
    const next = Math.min(Math.max(0, video.currentTime + delta), video.duration || 0)
    video.currentTime = next
    setCurrent(next)
  }, [src])

  const onSeek = (value: number): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = value
    setCurrent(value)
  }

  return (
    <>
      <div className="video-stage">
        {src ? (
          <video
            ref={videoRef}
            onTimeUpdate={() => {
              const v = videoRef.current
              if (v) setCurrent(v.currentTime)
            }}
            onLoadedMetadata={() => {
              const v = videoRef.current
              if (!v) return
              setDuration(v.duration)
              onDuration(v.duration)
              v.currentTime = 0
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              onError('无法播放该视频格式（浏览器引擎不支持）。仍可重命名并分类。')
            }}
            onCanPlay={() => onError(null)}
          />
        ) : (
          <div className="video-empty">选择待处理文件夹后，将在此播放视频</div>
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
            disabled={!src || !duration}
            onChange={(e) => onSeek(Number(e.target.value))}
          />
          <span className="time" style={{ textAlign: 'right' }}>
            {formatTime(duration)}
          </span>
        </div>

        <div className="btn-row">
          <button type="button" className="ctrl-btn" disabled={!src} onClick={() => seekBy(-10)}>
            −10s
          </button>
          <button type="button" className="ctrl-btn" disabled={!src} onClick={togglePlay}>
            {playing ? '暂停' : '播放'}
          </button>
          <button type="button" className="ctrl-btn" disabled={!src} onClick={() => seekBy(10)}>
            +10s
          </button>

          <div className="volume-wrap">
            <button
              type="button"
              className="ctrl-btn"
              disabled={!src}
              onClick={() => {
                const v = videoRef.current
                if (!v) return
                v.muted = !v.muted
                setMuted(v.muted)
              }}
            >
              {muted || volume === 0 ? '静音' : '音量'}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              disabled={!src}
              onChange={(e) => {
                const next = Number(e.target.value)
                setVolume(next)
                setMuted(next === 0)
                const v = videoRef.current
                if (v) {
                  v.volume = next
                  v.muted = next === 0
                }
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}

export { formatTime }

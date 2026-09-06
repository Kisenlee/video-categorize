import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CategoryItem, ClassifyMode, VideoItem } from '../../shared/types'
import VideoPlayer, { formatTime } from './components/VideoPlayer'
import { formatClassifyError, interpolate, useI18n, type Messages } from './i18n'

type Status =
  | { type: 'idle'; key: 'statusStart' }
  | { type: 'idle'; key: 'statusSource'; dir: string }
  | { type: 'idle'; key: 'statusTarget'; dir: string }
  | { type: 'idle'; key: 'statusMoving'; name: string }
  | { type: 'idle'; key: 'statusCopying'; n: number }
  | { type: 'ok'; key: 'statusDone' }
  | { type: 'ok'; key: 'statusRemoved'; name: string }
  | { type: 'error'; key: 'classifyFailed' }
  | { type: 'error'; key: 'raw'; text: string }

function renderStatus(status: Status, t: Messages): string {
  switch (status.key) {
    case 'statusStart':
      return t.statusStart
    case 'statusSource':
      return interpolate(t.statusSource, { dir: status.dir })
    case 'statusTarget':
      return interpolate(t.statusTarget, { dir: status.dir })
    case 'statusMoving':
      return interpolate(t.statusMoving, { name: status.name })
    case 'statusCopying':
      return interpolate(t.statusCopying, { n: status.n })
    case 'statusDone':
      return t.statusDone
    case 'statusRemoved':
      return interpolate(t.statusRemoved, { name: status.name })
    case 'classifyFailed':
      return t.classifyFailed
    case 'raw':
      return status.text
  }
}

export default function App(): React.JSX.Element {
  const { locale, t, setLocale } = useI18n()
  const [sourceDir, setSourceDir] = useState<string | null>(null)
  const [targetDir, setTargetDir] = useState<string | null>(null)
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [index, setIndex] = useState(0)
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [mode, setMode] = useState<ClassifyMode>('single')
  const [selectedCats, setSelectedCats] = useState<string[]>([])
  const [editName, setEditName] = useState('')
  const [duration, setDuration] = useState<number | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ type: 'idle', key: 'statusStart' })
  const [busy, setBusy] = useState(false)
  const [playFailed, setPlayFailed] = useState(false)

  const current = videos[index] ?? null
  const total = videos.length

  const refreshVideos = useCallback(async (dir: string, preferPath?: string) => {
    const list = await window.api.scanVideos(dir)
    setVideos(list)
    if (list.length === 0) {
      setIndex(0)
      return
    }
    if (preferPath) {
      const found = list.findIndex((v) => v.path === preferPath)
      setIndex(found >= 0 ? found : 0)
    } else {
      setIndex(0)
    }
  }, [])

  const pickSource = async (): Promise<void> => {
    const dir = await window.api.selectSourceFolder()
    if (!dir) return
    setSourceDir(dir)
    setStatus({ type: 'idle', key: 'statusSource', dir })
    await refreshVideos(dir)
  }

  const pickTarget = async (): Promise<void> => {
    const dir = await window.api.selectTargetFolder()
    if (!dir) return
    setTargetDir(dir)
    const cats = await window.api.watchCategories(dir)
    setCategories(cats)
    setSelectedCats([])
    setStatus({ type: 'idle', key: 'statusTarget', dir })
  }

  useEffect(() => {
    const off = window.api.onCategoriesUpdated((cats) => {
      setCategories(cats)
      setSelectedCats((prev) => prev.filter((p) => cats.some((c) => c.path === p)))
    })
    return () => {
      off()
      void window.api.unwatchCategories()
    }
  }, [])

  useEffect(() => {
    if (!current) {
      setEditName('')
      setMediaUrl(null)
      setDuration(null)
      setPlayFailed(false)
      return
    }
    setEditName(current.basename)
    setDuration(null)
    setPlayFailed(false)
    setSelectedCats([])
    let cancelled = false
    void window.api.mediaToUrl(current.path).then((url) => {
      if (!cancelled) setMediaUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [current?.path])

  const advanceAfterClassify = useCallback(
    async (removedPath: string) => {
      if (!sourceDir) return
      const list = await window.api.scanVideos(sourceDir)
      setVideos(list)
      if (list.length === 0) {
        setIndex(0)
        setStatus({ type: 'ok', key: 'statusDone' })
        return
      }
      setIndex((prev) => Math.min(prev, list.length - 1))
      setStatus({
        type: 'ok',
        key: 'statusRemoved',
        name: removedPath.split(/[/\\]/).pop() ?? removedPath
      })
    },
    [sourceDir]
  )

  const runSingle = async (category: CategoryItem): Promise<void> => {
    if (!current || busy) return
    setBusy(true)
    setStatus({ type: 'idle', key: 'statusMoving', name: category.name })
    const result = await window.api.classifySingle({
      sourcePath: current.path,
      newBasename: editName,
      categoryPath: category.path
    })
    setBusy(false)
    if (!result.ok) {
      setStatus({
        type: 'error',
        key: 'raw',
        text: formatClassifyError(result.error || 'classifyFailed', t)
      })
      return
    }
    await advanceAfterClassify(current.path)
  }

  const runMulti = async (): Promise<void> => {
    if (!current || busy || selectedCats.length === 0) return
    setBusy(true)
    setStatus({ type: 'idle', key: 'statusCopying', n: selectedCats.length })
    const result = await window.api.classifyMulti({
      sourcePath: current.path,
      newBasename: editName,
      categoryPaths: selectedCats
    })
    setBusy(false)
    if (!result.ok) {
      setStatus({
        type: 'error',
        key: 'raw',
        text: formatClassifyError(result.error || 'classifyFailed', t)
      })
      return
    }
    await advanceAfterClassify(current.path)
  }

  const toggleMultiCat = (path: string): void => {
    setSelectedCats((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }

  const statusClass = useMemo(() => {
    if (status.type === 'error' || playFailed) return 'status-bar error'
    if (status.type === 'ok') return 'status-bar ok'
    return 'status-bar'
  }, [status.type, playFailed])

  const statusLine = renderStatus(status, t)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {t.brandPrefix}
          <span>{t.brandAccent}</span>
          {t.brandSuffix}
        </div>

        <div className="path-group">
          <button type="button" className="path-btn" onClick={() => void pickSource()}>
            {t.sourceFolder}
          </button>
          <span className="path-display" title={sourceDir ?? ''}>
            {sourceDir ?? t.notSelected}
          </span>
        </div>

        <div className="path-group">
          <button type="button" className="path-btn" onClick={() => void pickTarget()}>
            {t.targetFolder}
          </button>
          <span className="path-display" title={targetDir ?? ''}>
            {targetDir ?? t.notSelected}
          </span>
        </div>

        <div className="progress-chip">
          {total === 0 ? '0 / 0' : `${Math.min(index + 1, total)} / ${total}`}
        </div>

        <div className="segmented lang-switch" role="group" aria-label="Language">
          <button
            type="button"
            className={locale === 'zh' ? 'active' : ''}
            onClick={() => setLocale('zh')}
          >
            {t.langZh}
          </button>
          <button
            type="button"
            className={locale === 'en' ? 'active' : ''}
            onClick={() => setLocale('en')}
          >
            {t.langEn}
          </button>
        </div>
      </header>

      <div className="main">
        <aside className="panel panel-left">
          <h2 className="panel-title">{t.videoDetails}</h2>
          {current ? (
            <>
              <div className="field">
                <label htmlFor="rename">{t.filenameLabel}</label>
                <input
                  id="rename"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                />
              </div>
              <div className="meta">
                {t.extensionLabel}
                {current.ext || '—'}
              </div>
              <div className="meta" style={{ marginTop: 12 }}>
                {t.durationLabel}
                {duration == null ? t.reading : formatTime(duration)}
              </div>
              <div className="meta-muted" title={current.path}>
                {current.path}
              </div>
            </>
          ) : (
            <p className="empty-hint">{t.noVideos}</p>
          )}
        </aside>

        <section className="panel-center" style={{ position: 'relative' }}>
          <VideoPlayer src={mediaUrl} onDuration={setDuration} onPlayFailed={setPlayFailed} />
          {busy && <div className="busy-overlay">{t.processing}</div>}
        </section>

        <aside className="panel panel-right">
          <h2 className="panel-title">{t.categories}</h2>

          <div className="toggle-row">
            <span className="toggle-label">{t.mode}</span>
            <div className="segmented" role="group" aria-label={t.classifyModeAria}>
              <button
                type="button"
                className={mode === 'single' ? 'active' : ''}
                onClick={() => {
                  setMode('single')
                  setSelectedCats([])
                }}
              >
                {t.single}
              </button>
              <button
                type="button"
                className={mode === 'multi' ? 'active' : ''}
                onClick={() => setMode('multi')}
              >
                {t.multi}
              </button>
            </div>
          </div>

          {!targetDir ? (
            <p className="empty-hint">{t.pickTargetHint}</p>
          ) : categories.length === 0 ? (
            <p className="empty-hint">{t.emptyCategories}</p>
          ) : (
            <div className="category-list">
              {categories.map((cat) => {
                const selected = selectedCats.includes(cat.path)
                if (mode === 'single') {
                  return (
                    <button
                      key={cat.path}
                      type="button"
                      className="category-item"
                      disabled={!current || busy}
                      onClick={() => void runSingle(cat)}
                    >
                      {cat.name}
                    </button>
                  )
                }
                return (
                  <button
                    key={cat.path}
                    type="button"
                    className={`category-item${selected ? ' selected' : ''}`}
                    disabled={!current || busy}
                    onClick={() => toggleMultiCat(cat.path)}
                  >
                    <input type="checkbox" readOnly checked={selected} tabIndex={-1} />
                    {cat.name}
                  </button>
                )
              })}
            </div>
          )}

          {mode === 'multi' && (
            <button
              type="button"
              className="ctrl-btn primary"
              style={{ width: '100%' }}
              disabled={!current || busy || selectedCats.length === 0}
              onClick={() => void runMulti()}
            >
              {interpolate(t.confirmClassify, { n: selectedCats.length })}
            </button>
          )}

          {mode === 'single' && (
            <p className="empty-hint" style={{ marginTop: 8 }}>
              {t.singleHint}
            </p>
          )}
        </aside>
      </div>

      <footer className={statusClass}>
        {playFailed ? `${t.playError} · ${statusLine}` : statusLine}
      </footer>
    </div>
  )
}

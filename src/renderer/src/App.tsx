import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CategoryItem, ClassifyMode, VideoItem } from '../../shared/types'
import VideoPlayer, { formatTime } from './components/VideoPlayer'
import { formatClassifyError, interpolate, useI18n, type Messages } from './i18n'

const BINDABLE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'w', 's', 'z', 'x', 'c'] as const
type BindableKey = (typeof BINDABLE_KEYS)[number]

type Status =
  | { type: 'idle'; key: 'statusStart' }
  | { type: 'idle'; key: 'statusSource'; dir: string }
  | { type: 'idle'; key: 'statusTarget'; dir: string }
  | { type: 'idle'; key: 'statusMoving'; name: string }
  | { type: 'idle'; key: 'statusCopying'; n: number }
  | { type: 'ok'; key: 'statusDone' }
  | { type: 'ok'; key: 'statusRemoved'; name: string }
  | { type: 'ok'; key: 'revertOk' }
  | { type: 'error'; key: 'classifyFailed' }
  | { type: 'error'; key: 'revertEmpty' }
  | { type: 'error'; key: 'raw'; text: string }

type LastClassify = {
  sourcePath: string
  destinations: string[]
}

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
    case 'revertOk':
      return t.revertOk
    case 'classifyFailed':
      return t.classifyFailed
    case 'revertEmpty':
      return t.revertEmpty
    case 'raw':
      return status.text
  }
}

function isBindableKey(key: string): key is BindableKey {
  return (BINDABLE_KEYS as readonly string[]).includes(key)
}

function normalizeBindKey(event: KeyboardEvent): string {
  const k = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (k >= '0' && k <= '9') return k
  return k
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
  const [status, setStatus] = useState<Status>({ type: 'idle', key: 'statusStart' })
  const [busy, setBusy] = useState(false)
  const [playFailed, setPlayFailed] = useState(false)
  const [playbackKey, setPlaybackKey] = useState(0)
  const [keyBinds, setKeyBinds] = useState<Partial<Record<BindableKey, string>>>({})
  const [bindingTarget, setBindingTarget] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [lastClassify, setLastClassify] = useState<LastClassify | null>(null)

  const modeRef = useRef(mode)
  const busyRef = useRef(busy)
  const durationRef = useRef(duration)
  const categoriesRef = useRef(categories)
  const selectedCatsRef = useRef(selectedCats)
  const keyBindsRef = useRef(keyBinds)
  const bindingTargetRef = useRef(bindingTarget)
  const helpOpenRef = useRef(helpOpen)
  const lastClassifyRef = useRef(lastClassify)
  const currentRef = useRef(videos[index] ?? null)
  const editNameRef = useRef(editName)
  const sourceDirRef = useRef(sourceDir)

  modeRef.current = mode
  busyRef.current = busy
  durationRef.current = duration
  categoriesRef.current = categories
  selectedCatsRef.current = selectedCats
  keyBindsRef.current = keyBinds
  bindingTargetRef.current = bindingTarget
  helpOpenRef.current = helpOpen
  lastClassifyRef.current = lastClassify
  currentRef.current = videos[index] ?? null
  editNameRef.current = editName
  sourceDirRef.current = sourceDir

  const current = videos[index] ?? null
  const total = videos.length

  const bindLabelForCategory = useCallback(
    (catPath: string): string => {
      const entry = Object.entries(keyBinds).find(([, path]) => path === catPath)
      return entry ? entry[0].toUpperCase() : t.bindEmpty
    },
    [keyBinds, t.bindEmpty]
  )

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
    setKeyBinds({})
    setBindingTarget(null)
    setStatus({ type: 'idle', key: 'statusTarget', dir })
  }

  useEffect(() => {
    const off = window.api.onCategoriesUpdated((cats) => {
      setCategories(cats)
      setSelectedCats((prev) => prev.filter((p) => cats.some((c) => c.path === p)))
      setKeyBinds((prev) => {
        const next: Partial<Record<BindableKey, string>> = {}
        for (const [key, path] of Object.entries(prev) as [BindableKey, string][]) {
          if (cats.some((c) => c.path === path)) next[key] = path
        }
        return next
      })
    })
    return () => {
      off()
      void window.api.unwatchCategories()
    }
  }, [])

  useEffect(() => {
    if (!current) {
      setEditName('')
      setDuration(null)
      setPlayFailed(false)
      return
    }
    setEditName(current.basename)
    setDuration(null)
    setPlayFailed(false)
    setSelectedCats([])
  }, [current?.path])

  const advanceAfterClassify = useCallback(
    async (removedPath: string) => {
      if (!sourceDir) return
      const list = await window.api.scanVideos(sourceDir)
      setVideos(list)
      if (list.length === 0) {
        setIndex(0)
        setPlaybackKey((k) => k + 1)
        setStatus({ type: 'ok', key: 'statusDone' })
        return
      }
      setIndex((prev) => Math.min(prev, list.length - 1))
      setPlaybackKey((k) => k + 1)
      setStatus({
        type: 'ok',
        key: 'statusRemoved',
        name: removedPath.split(/[/\\]/).pop() ?? removedPath
      })
    },
    [sourceDir]
  )

  const runSingle = useCallback(
    async (category: CategoryItem): Promise<void> => {
      const cur = currentRef.current
      if (!cur || busyRef.current) return
      const sourcePath = cur.path
      setBusy(true)
      setStatus({ type: 'idle', key: 'statusMoving', name: category.name })
      await window.api.playerUnloadForClassify()
      const result = await window.api.classifySingle({
        sourcePath,
        newBasename: editNameRef.current,
        categoryPath: category.path
      })
      setBusy(false)
      if (!result.ok) {
        setStatus({
          type: 'error',
          key: 'raw',
          text: formatClassifyError(result.error || 'classifyFailed', t)
        })
        await window.api.playerLoad(sourcePath)
        return
      }
      setLastClassify({
        sourcePath,
        destinations: result.destinations ?? []
      })
      await advanceAfterClassify(sourcePath)
    },
    [advanceAfterClassify, t]
  )

  const runMulti = useCallback(async (): Promise<void> => {
    const cur = currentRef.current
    const selected = selectedCatsRef.current
    if (!cur || busyRef.current || selected.length === 0) return
    const sourcePath = cur.path
    setBusy(true)
    setStatus({ type: 'idle', key: 'statusCopying', n: selected.length })
    await window.api.playerUnloadForClassify()
    const result = await window.api.classifyMulti({
      sourcePath,
      newBasename: editNameRef.current,
      categoryPaths: selected
    })
    setBusy(false)
    if (!result.ok) {
      setStatus({
        type: 'error',
        key: 'raw',
        text: formatClassifyError(result.error || 'classifyFailed', t)
      })
      await window.api.playerLoad(sourcePath)
      return
    }
    setLastClassify({
      sourcePath,
      destinations: result.destinations ?? []
    })
    await advanceAfterClassify(sourcePath)
  }, [advanceAfterClassify, t])

  const runRevert = useCallback(async (): Promise<void> => {
    const last = lastClassifyRef.current
    const dir = sourceDirRef.current
    if (!last || busyRef.current) {
      setStatus({ type: 'error', key: 'revertEmpty' })
      return
    }
    setBusy(true)
    await window.api.playerUnloadForClassify()
    const result = await window.api.classifyRevert({
      sourcePath: last.sourcePath,
      destinations: last.destinations
    })
    setBusy(false)
    if (!result.ok) {
      setStatus({
        type: 'error',
        key: 'raw',
        text: formatClassifyError(result.error || 'revertFailed', t)
      })
      return
    }
    setLastClassify(null)
    setStatus({ type: 'ok', key: 'revertOk' })
    if (dir) {
      await refreshVideos(dir, last.sourcePath)
      setPlaybackKey((k) => k + 1)
    }
  }, [refreshVideos, t])

  const toggleMultiCat = (path: string): void => {
    setSelectedCats((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    )
  }

  const activateBoundCategory = useCallback(
    (catPath: string): void => {
      const cat = categoriesRef.current.find((c) => c.path === catPath)
      if (!cat) return
      if (modeRef.current === 'single') {
        void runSingle(cat)
      } else {
        toggleMultiCat(catPath)
      }
    },
    [runSingle]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }

      if (helpOpenRef.current) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setHelpOpen(false)
          void window.api.playerSetVisible(true)
        }
        return
      }

      const key = normalizeBindKey(event)

      if (bindingTargetRef.current) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setBindingTarget(null)
          return
        }
        if (isBindableKey(key)) {
          event.preventDefault()
          const catPath = bindingTargetRef.current
          setKeyBinds((prev) => {
            const next: Partial<Record<BindableKey, string>> = { ...prev }
            for (const [k, path] of Object.entries(next) as [BindableKey, string][]) {
              if (path === catPath || k === key) delete next[k]
            }
            next[key] = catPath
            return next
          })
          setBindingTarget(null)
          return
        }
        // Any other shortcut key cancels bind mode, then continues to normal handling.
        setBindingTarget(null)
      }

      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault()
        void window.api.playerTogglePause()
        return
      }

      if (key === 'a') {
        event.preventDefault()
        const dur = durationRef.current
        if (dur && dur > 0) void window.api.playerSeekBy(-(dur / 10))
        return
      }
      if (key === 'd') {
        event.preventDefault()
        const dur = durationRef.current
        if (dur && dur > 0) void window.api.playerSeekBy(dur / 10)
        return
      }
      if (key === 'q') {
        event.preventDefault()
        setMode('single')
        setSelectedCats([])
        return
      }
      if (key === 'e') {
        event.preventDefault()
        setMode('multi')
        return
      }
      if (key === 'f') {
        event.preventDefault()
        if (modeRef.current === 'multi') void runMulti()
        return
      }
      if (key === 'r') {
        event.preventDefault()
        void runRevert()
        return
      }

      if (isBindableKey(key)) {
        const catPath = keyBindsRef.current[key]
        if (catPath) {
          event.preventDefault()
          activateBoundCategory(catPath)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activateBoundCategory, runMulti, runRevert])

  const statusClass = useMemo(() => {
    if (status.type === 'error' || playFailed) return 'status-bar error'
    if (status.type === 'ok') return 'status-bar ok'
    return 'status-bar'
  }, [status.type, playFailed])

  const statusLine = renderStatus(status, t)

  const onBindClick = (catPath: string): void => {
    if (bindingTarget === catPath) {
      setBindingTarget(null)
      return
    }
    const existing = (Object.entries(keyBinds) as [BindableKey, string][]).find(
      ([, path]) => path === catPath
    )
    if (existing && bindingTarget === null) {
      // Clear existing bind on second intentional click when not waiting
      setKeyBinds((prev) => {
        const next = { ...prev }
        delete next[existing[0]]
        return next
      })
      return
    }
    setBindingTarget(catPath)
  }

  const openHelp = (): void => {
    setHelpOpen(true)
    void window.api.playerSetVisible(false)
  }

  const closeHelp = (): void => {
    setHelpOpen(false)
    void window.api.playerSetVisible(true)
  }

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

        <button
          type="button"
          className="path-btn help-btn"
          title={t.shortcutsHelp}
          onClick={openHelp}
        >
          ?
        </button>
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
          <VideoPlayer
            key={playbackKey}
            filePath={current?.path ?? null}
            obscured={busy}
            onDuration={setDuration}
            onPlayFailed={setPlayFailed}
          />
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
            <>
              <p className="bind-hint">{t.bindHint}</p>
              <div className="category-list">
                {categories.map((cat) => {
                  const selected = selectedCats.includes(cat.path)
                  const waiting = bindingTarget === cat.path
                  const bindLabel = waiting ? t.bindWaiting : bindLabelForCategory(cat.path)
                  return (
                    <div key={cat.path} className="category-row">
                      {mode === 'single' ? (
                        <button
                          type="button"
                          className="category-item"
                          disabled={!current || busy}
                          onClick={() => void runSingle(cat)}
                        >
                          {cat.name}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`category-item${selected ? ' selected' : ''}`}
                          disabled={!current || busy}
                          onClick={() => toggleMultiCat(cat.path)}
                        >
                          <input type="checkbox" readOnly checked={selected} tabIndex={-1} />
                          {cat.name}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`bind-btn${waiting ? ' waiting' : ''}${
                          bindLabel !== t.bindEmpty && !waiting ? ' bound' : ''
                        }`}
                        title={t.bindKey}
                        disabled={busy}
                        onClick={() => onBindClick(cat.path)}
                      >
                        {bindLabel}
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
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

      {helpOpen && (
        <div className="modal-backdrop" onClick={closeHelp}>
          <div
            className="modal-card"
            role="dialog"
            aria-labelledby="shortcuts-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="shortcuts-title">{t.shortcutsTitle}</h2>
            <ul className="shortcut-list">
              <li>{t.shortcutSpace}</li>
              <li>{t.shortcutA}</li>
              <li>{t.shortcutD}</li>
              <li>{t.shortcutQ}</li>
              <li>{t.shortcutE}</li>
              <li>{t.shortcutF}</li>
              <li>{t.shortcutR}</li>
              <li>{t.shortcutBinds}</li>
            </ul>
            <button type="button" className="ctrl-btn primary" onClick={closeHelp}>
              {t.shortcutsClose}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

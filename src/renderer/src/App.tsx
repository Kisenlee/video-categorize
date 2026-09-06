import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CategoryItem, ClassifyMode, VideoItem } from '../../shared/types'
import VideoPlayer, { formatTime } from './components/VideoPlayer'

export default function App(): React.JSX.Element {
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
  const [status, setStatus] = useState<{ type: 'idle' | 'ok' | 'error'; text: string }>({
    type: 'idle',
    text: '选择待处理文件夹与目标文件夹开始分类'
  })
  const [busy, setBusy] = useState(false)
  const [playError, setPlayError] = useState<string | null>(null)

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
    setStatus({ type: 'idle', text: `已选择待处理: ${dir}` })
    await refreshVideos(dir)
  }

  const pickTarget = async (): Promise<void> => {
    const dir = await window.api.selectTargetFolder()
    if (!dir) return
    setTargetDir(dir)
    const cats = await window.api.watchCategories(dir)
    setCategories(cats)
    setSelectedCats([])
    setStatus({ type: 'idle', text: `已选择目标: ${dir}（子文件夹将实时刷新）` })
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
      setPlayError(null)
      return
    }
    setEditName(current.basename)
    setDuration(null)
    setPlayError(null)
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
        setStatus({ type: 'ok', text: '全部处理完毕' })
        return
      }
      // Stay at same index (next item slid into place); clamp if at end
      setIndex((prev) => Math.min(prev, list.length - 1))
      setStatus({ type: 'ok', text: `已分类并移除: ${removedPath.split(/[/\\]/).pop()}` })
    },
    [sourceDir]
  )

  const runSingle = async (category: CategoryItem): Promise<void> => {
    if (!current || busy) return
    setBusy(true)
    setStatus({ type: 'idle', text: `正在移动到「${category.name}」…` })
    const result = await window.api.classifySingle({
      sourcePath: current.path,
      newBasename: editName,
      categoryPath: category.path
    })
    setBusy(false)
    if (!result.ok) {
      setStatus({ type: 'error', text: result.error || '分类失败' })
      return
    }
    await advanceAfterClassify(current.path)
  }

  const runMulti = async (): Promise<void> => {
    if (!current || busy || selectedCats.length === 0) return
    setBusy(true)
    setStatus({ type: 'idle', text: `正在复制到 ${selectedCats.length} 个分类…` })
    const result = await window.api.classifyMulti({
      sourcePath: current.path,
      newBasename: editName,
      categoryPaths: selectedCats
    })
    setBusy(false)
    if (!result.ok) {
      setStatus({ type: 'error', text: result.error || '分类失败' })
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
    if (status.type === 'error') return 'status-bar error'
    if (status.type === 'ok') return 'status-bar ok'
    return 'status-bar'
  }, [status.type])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          视频<span>分类</span>助手
        </div>

        <div className="path-group">
          <button type="button" className="path-btn" onClick={() => void pickSource()}>
            待处理文件夹
          </button>
          <span className="path-display" title={sourceDir ?? ''}>
            {sourceDir ?? '未选择'}
          </span>
        </div>

        <div className="path-group">
          <button type="button" className="path-btn" onClick={() => void pickTarget()}>
            目标文件夹
          </button>
          <span className="path-display" title={targetDir ?? ''}>
            {targetDir ?? '未选择'}
          </span>
        </div>

        <div className="progress-chip">
          {total === 0 ? '0 / 0' : `${Math.min(index + 1, total)} / ${total}`}
        </div>
      </header>

      <div className="main">
        <aside className="panel panel-left">
          <h2 className="panel-title">视频详情</h2>
          {current ? (
            <>
              <div className="field">
                <label htmlFor="rename">文件名（不含扩展名）</label>
                <input
                  id="rename"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                />
              </div>
              <div className="meta">
                扩展名：{current.ext || '—'}
              </div>
              <div className="meta" style={{ marginTop: 12 }}>
                时长：{duration == null ? '读取中…' : formatTime(duration)}
              </div>
              <div className="meta-muted" title={current.path}>
                {current.path}
              </div>
            </>
          ) : (
            <p className="empty-hint">暂无待处理视频。请选择包含视频文件的文件夹。</p>
          )}
        </aside>

        <section className="panel-center" style={{ position: 'relative' }}>
          <VideoPlayer
            src={mediaUrl}
            onDuration={setDuration}
            onError={setPlayError}
          />
          {busy && <div className="busy-overlay">处理中…</div>}
        </section>

        <aside className="panel panel-right">
          <h2 className="panel-title">分类</h2>

          <div className="toggle-row">
            <span className="toggle-label">模式</span>
            <div className="segmented" role="group" aria-label="分类模式">
              <button
                type="button"
                className={mode === 'single' ? 'active' : ''}
                onClick={() => {
                  setMode('single')
                  setSelectedCats([])
                }}
              >
                单类
              </button>
              <button
                type="button"
                className={mode === 'multi' ? 'active' : ''}
                onClick={() => setMode('multi')}
              >
                复类
              </button>
            </div>
          </div>

          {!targetDir ? (
            <p className="empty-hint">请先选择目标文件夹。其子目录将作为分类，并实时刷新。</p>
          ) : categories.length === 0 ? (
            <p className="empty-hint">
              目标文件夹下还没有子目录。在资源管理器中新建文件夹后，这里会自动出现。
            </p>
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
              确认分类（{selectedCats.length}）
            </button>
          )}

          {mode === 'single' && (
            <p className="empty-hint" style={{ marginTop: 8 }}>
              单类模式：点击分类即重命名并移动文件。
            </p>
          )}
        </aside>
      </div>

      <footer className={statusClass}>
        {playError ? `${playError} · ${status.text}` : status.text}
      </footer>
    </div>
  )
}

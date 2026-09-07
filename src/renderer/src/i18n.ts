import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

export type Locale = 'zh' | 'en'

const STORAGE_KEY = 'video-classifier.locale'

const zh = {
  appTitle: '视频分类助手',
  brandPrefix: '视频',
  brandAccent: '分类',
  brandSuffix: '助手',
  sourceFolder: '待处理文件夹',
  targetFolder: '目标文件夹',
  notSelected: '未选择',
  videoDetails: '视频详情',
  filenameLabel: '文件名（不含扩展名）',
  extensionLabel: '扩展名：',
  durationLabel: '时长：',
  reading: '读取中…',
  noVideos: '暂无待处理视频。请选择包含视频文件的文件夹。',
  processing: '处理中…',
  categories: '分类',
  mode: '模式',
  classifyModeAria: '分类模式',
  single: '单类',
  multi: '复类',
  pickTargetHint: '请先选择目标文件夹。其子目录将作为分类，并实时刷新。',
  emptyCategories: '目标文件夹下还没有子目录。在资源管理器中新建文件夹后，这里会自动出现。',
  confirmClassify: '确认分类（{n}）',
  singleHint: '单类模式：点击分类即重命名并移动文件。',
  statusStart: '选择待处理文件夹与目标文件夹开始分类',
  statusSource: '已选择待处理: {dir}',
  statusTarget: '已选择目标: {dir}（子文件夹将实时刷新）',
  statusDone: '全部处理完毕',
  statusRemoved: '已分类并移除: {name}',
  statusMoving: '正在移动到「{name}」…',
  statusCopying: '正在复制到 {n} 个分类…',
  classifyFailed: '分类失败',
  playError: '无法播放该视频。仍可在左侧改名并在右侧分类。',
  mpvMissing: '未找到 mpv 播放器。请运行 npm run fetch:mpv，或设置 MPV_PATH 指向 mpv.exe。仍可改名并分类。',
  mpvStartFailed: 'mpv 启动失败。请确认已打包/下载 mpv 运行时。仍可改名并分类。',
  videoEmpty: '选择待处理文件夹后，将在此播放视频',
  pause: '暂停',
  play: '播放',
  mute: '静音',
  volume: '音量',
  categoryMissing: '分类文件夹不存在',
  categoryMissingNamed: '分类文件夹不存在: {name}',
  noCategorySelected: '请至少选择一个分类',
  revertMissing: '无法撤销：找不到已分类的文件',
  revertSourceExists: '无法撤销：源位置已有文件',
  revertOk: '已撤销上一次分类',
  revertEmpty: '没有可撤销的操作',
  revertFailed: '撤销失败',
  shortcutsHelp: '快捷键',
  shortcutsTitle: '快捷键说明',
  shortcutsClose: '关闭',
  bindKey: '绑定',
  bindEmpty: '—',
  bindWaiting: '…',
  bindHint: '点击后按 1–0 / W S Z X C 绑定；再点清除',
  shortcutSpace: '空格 — 播放 / 暂停',
  shortcutA: 'A — 快退 1/10 时长',
  shortcutD: 'D — 快进 1/10 时长',
  shortcutQ: 'Q — 单类模式',
  shortcutE: 'E — 复类模式',
  shortcutF: 'F — 复类确认',
  shortcutR: 'R — 撤销上一次分类（仅保留一条）',
  shortcutBinds: '1–0、W、S、Z、X、C — 触发已绑定分类（单类：直接分类；复类：勾选/取消）',
  langZh: '中文',
  langEn: 'EN'
}

export type Messages = typeof zh

const en: Messages = {
  appTitle: 'Video Classifier',
  brandPrefix: 'Video ',
  brandAccent: 'Classifier',
  brandSuffix: '',
  sourceFolder: 'Inbox folder',
  targetFolder: 'Target folder',
  notSelected: 'Not selected',
  videoDetails: 'Video details',
  filenameLabel: 'Filename (without extension)',
  extensionLabel: 'Extension: ',
  durationLabel: 'Duration: ',
  reading: 'Reading…',
  noVideos: 'No videos to process. Select a folder that contains video files.',
  processing: 'Working…',
  categories: 'Categories',
  mode: 'Mode',
  classifyModeAria: 'Classify mode',
  single: 'Single',
  multi: 'Multi',
  pickTargetHint: 'Select a target folder first. Its first-level subfolders are categories and refresh live.',
  emptyCategories:
    'No subfolders yet. Create a folder in File Explorer and it will appear here automatically.',
  confirmClassify: 'Confirm classify ({n})',
  singleHint: 'Single mode: click a category to rename (if needed) and move the file.',
  statusStart: 'Select an inbox folder and a target folder to start classifying',
  statusSource: 'Inbox: {dir}',
  statusTarget: 'Target: {dir} (subfolders refresh live)',
  statusDone: 'All videos processed',
  statusRemoved: 'Classified and removed: {name}',
  statusMoving: 'Moving to “{name}”…',
  statusCopying: 'Copying to {n} categories…',
  classifyFailed: 'Classify failed',
  playError: 'Cannot play this video. You can still rename it on the left and classify on the right.',
  mpvMissing:
    'mpv player not found. Run npm run fetch:mpv, or set MPV_PATH to mpv.exe. You can still rename and classify.',
  mpvStartFailed:
    'Failed to start mpv. Make sure the mpv runtime is downloaded/bundled. You can still rename and classify.',
  videoEmpty: 'Select an inbox folder to play videos here',
  pause: 'Pause',
  play: 'Play',
  mute: 'Mute',
  volume: 'Volume',
  categoryMissing: 'Category folder not found',
  categoryMissingNamed: 'Category folder not found: {name}',
  noCategorySelected: 'Select at least one category',
  revertMissing: 'Cannot revert: classified file not found',
  revertSourceExists: 'Cannot revert: source path already exists',
  revertOk: 'Reverted last classify',
  revertEmpty: 'Nothing to revert',
  revertFailed: 'Revert failed',
  shortcutsHelp: 'Shortcuts',
  shortcutsTitle: 'Keyboard shortcuts',
  shortcutsClose: 'Close',
  bindKey: 'Bind',
  bindEmpty: '—',
  bindWaiting: '…',
  bindHint: 'Click, then press 1–0 / W S Z X C to bind; click again to clear',
  shortcutSpace: 'Space — Play / Pause',
  shortcutA: 'A — Seek back 1/10 duration',
  shortcutD: 'D — Seek forward 1/10 duration',
  shortcutQ: 'Q — Single mode',
  shortcutE: 'E — Multi mode',
  shortcutF: 'F — Confirm multi classify',
  shortcutR: 'R — Revert last classify (one record only)',
  shortcutBinds: '1–0, W, S, Z, X, C — Bound category (single: classify; multi: toggle)',
  langZh: '中文',
  langEn: 'EN'
}

export const messages: Record<Locale, Messages> = { zh, en }

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    // ignore
  }
  return 'zh'
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // ignore
  }
}

export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''))
}

export function formatClassifyError(error: string, t: Messages): string {
  if (error === 'classifyFailed') return t.classifyFailed
  if (error === 'categoryMissing') return t.categoryMissing
  if (error === 'noCategorySelected') return t.noCategorySelected
  if (error === 'revertMissing') return t.revertMissing
  if (error === 'revertSourceExists') return t.revertSourceExists
  if (error.startsWith('categoryMissing:')) {
    return interpolate(t.categoryMissingNamed, { name: error.slice('categoryMissing:'.length) })
  }
  return error
}

type I18nValue = {
  locale: Locale
  t: Messages
  setLocale: (next: Locale) => void
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  const applyLocale = useCallback((next: Locale) => {
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
    document.title = messages[next].appTitle
    void window.api.setLocale(next)
  }, [])

  const setLocale = useCallback(
    (next: Locale) => {
      persistLocale(next)
      setLocaleState(next)
      applyLocale(next)
    },
    [applyLocale]
  )

  useEffect(() => {
    applyLocale(locale)
  }, [applyLocale, locale])

  const value = useMemo<I18nValue>(
    () => ({ locale, t: messages[locale], setLocale }),
    [locale, setLocale]
  )

  return createElement(I18nContext.Provider, { value }, children)
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return ctx
}

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
  playError:
    '无法播放该视频（常见原因：HEVC/H.265 未安装扩展，或 NAS/UNC 路径读取失败）。仍可在左侧改名并在右侧分类。Windows 可在 Microsoft Store 安装「HEVC 视频扩展」。',
  videoEmpty: '选择待处理文件夹后，将在此播放视频',
  pause: '暂停',
  play: '播放',
  mute: '静音',
  volume: '音量',
  categoryMissing: '分类文件夹不存在',
  categoryMissingNamed: '分类文件夹不存在: {name}',
  noCategorySelected: '请至少选择一个分类',
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
  playError:
    'Cannot play this video (often HEVC/H.265 without the codec pack, or a NAS/UNC path read failure). You can still rename it on the left and classify on the right. On Windows, install “HEVC Video Extensions” from the Microsoft Store.',
  videoEmpty: 'Select an inbox folder to play videos here',
  pause: 'Pause',
  play: 'Play',
  mute: 'Mute',
  volume: 'Volume',
  categoryMissing: 'Category folder not found',
  categoryMissingNamed: 'Category folder not found: {name}',
  noCategorySelected: 'Select at least one category',
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

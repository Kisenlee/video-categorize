# 视频分类助手 / Video Classifier

Windows 本地 / NAS 视频分类桌面工具。选择待处理文件夹逐个播放，按目标文件夹子目录分类移动或复制。

Windows desktop helper for classifying local / NAS videos. Play files from an inbox folder one by one, then move or copy them into category subfolders.

## 下载使用 / Download (recommended)

打包命令会生成 / Build artifacts:

- `release/VideoClassifier-1.0.0-portable.exe` — 便携版，双击即可运行 / portable, double-click to run
- `release/VideoClassifier-1.0.0-win-x64.zip` — 解压后运行 `VideoClassifier.exe` / unzip and run `VideoClassifier.exe`

在 Windows 上双击即可；若被 SmartScreen 拦截，选择「仍要运行」。

On Windows, double-click to launch. If SmartScreen blocks it, choose **Run anyway**.

## 功能 / Features

- 选择待处理文件夹，按文件名顺序播放视频 / Select an inbox folder; videos play in filename order
- 选择目标文件夹；一级子目录即为分类，并实时刷新（资源管理器新建文件夹即可） / Target folder first-level subfolders are categories and refresh live
- 三栏布局：左详情（可改名）/ 中播放器 / 右分类 / Three columns: details (rename) / player / categories
- **单类 / Single**：点分类 → 重命名（如有修改）→ 移动到该分类 → 自动下一则
- **复类 / Multi**：勾选多个分类 → 确认 → 复制到各分类并删除源文件 → 自动下一则
- 单/复类模式在视频间保持 / Single/Multi mode persists across videos
- 同名冲突自动追加 `_1`、`_2`… / Name conflicts append `_1`, `_2`, …
- 顶栏 **中文 / EN** 切换全部界面，语言保存在 `localStorage` / Top-bar language switch; saved in `localStorage`
- NAS / UNC 路径用 `media` 协议 Range 流式读取；Windows 启用 HEVC 硬件解码 / NAS/UNC playback uses Range streaming; Windows HEVC hardware decode is enabled
- 无法播放时仍可改名并分类 / If playback fails, you can still rename and classify

## 开发运行 / Develop

需要 Node.js 18+。 / Requires Node.js 18+.

```bash
npm install
npm run dev
```

打包 Windows 可执行文件 / Build a Windows executable:

```bash
npm run dist:win
```

产物在 `release/`。成功后应看到类似：

After a successful build you should see:

- `release/VideoClassifier-1.0.0-portable.exe`

类型检查 / Typecheck:

```bash
npm run typecheck
```

### NAS 目录监听 / NAS folder watching

部分 NAS / 网络盘可能收不到目录变更事件，可设置环境变量强制轮询：

Some NAS / network drives do not emit folder-change events. Force polling with:

```bat
set VIDEO_CLASSIFIER_POLL=1
VideoClassifier-1.0.0-portable.exe
```

### 播放提示 / Playback notes

播放依赖 Chromium 编解码能力。HEVC/H.265 在 Windows 上通常需要 Microsoft Store 的「HEVC 视频扩展」。无法播放时仍可改名并分类。

Playback uses Chromium codecs. HEVC/H.265 on Windows usually needs **HEVC Video Extensions** from the Microsoft Store. If a file cannot play, you can still rename and classify it.

## 支持的视频扩展名 / Supported extensions

`mp4` `mkv` `avi` `mov` `webm` `m4v` `wmv` `flv`

# 视频分类助手 / Video Classifier

Windows 本地 / NAS 视频分类桌面工具。选择待处理文件夹逐个播放，按目标文件夹子目录分类移动或复制。

Windows desktop helper for classifying local / NAS videos. Play files from an inbox folder one by one, then move or copy them into category subfolders.

## 下载使用 / Download (recommended)

从 GitHub Releases 下载已打包文件（推荐）：

Download prebuilt binaries from GitHub Releases:

**https://github.com/Kisenlee/video-categorize/releases**

每个版本通常包含 / Each release typically includes:

- `VideoClassifier-x.y.z-portable.exe` — 便携版，双击即可运行 / portable, double-click to run
- `VideoClassifier-x.y.z-win-x64.zip` — 解压后运行 `VideoClassifier.exe` / unzip and run `VideoClassifier.exe`

在 Windows 上双击即可；若被 SmartScreen 拦截，选择「仍要运行」。

On Windows, double-click to launch. If SmartScreen blocks it, choose **Run anyway**.

打 `v*` 标签并推送后，GitHub Actions 会自动构建并发布上述文件。

Pushing a `v*` tag triggers GitHub Actions to build and publish those assets automatically.

## 功能 / Features

- 选择待处理文件夹，按文件名顺序播放视频 / Select an inbox folder; videos play in filename order
- 选择目标文件夹；一级子目录即为分类，并实时刷新（资源管理器新建文件夹即可） / Target folder first-level subfolders are categories and refresh live
- 三栏布局：左详情（可改名）/ 中播放器 / 右分类 / Three columns: details (rename) / player / categories
- **单类 / Single**：点分类 → 重命名（如有修改）→ 移动到该分类 → 自动下一则
- **复类 / Multi**：勾选多个分类 → 确认 → 复制到各分类并删除源文件 → 自动下一则
- 单/复类模式在视频间保持 / Single/Multi mode persists across videos
- 同名冲突自动追加 `_1`、`_2`… / Name conflicts append `_1`, `_2`, …
- 顶栏 **中文 / EN** 切换全部界面，语言保存在 `localStorage` / Top-bar language switch; saved in `localStorage`
- **内置 mpv 播放引擎**（自带 HEVC/H.265 等编解码，不依赖浏览器扩展） / Bundled **mpv** engine (HEVC/H.265 without browser codec packs)
- 无法播放时仍可改名并分类 / If playback fails, you can still rename and classify

## 开发运行 / Develop

需要 Node.js 18+。 / Requires Node.js 18+.

首次（或打包前）下载 Windows mpv 运行时到 `vendor/mpv/`：

First time (and before packaging), download the Windows mpv runtime into `vendor/mpv/`:

```bash
npm install
npm run fetch:mpv
npm run dev
```

也可手动安装 mpv，并设置环境变量 `MPV_PATH` 指向 `mpv.exe`。

You can also install mpv yourself and set `MPV_PATH` to `mpv.exe`.

打包 Windows 可执行文件（会自动 `fetch:mpv`） / Build a Windows executable (auto-runs `fetch:mpv`):

```bash
npm run dist:win
```

产物在 `release/`。成功后应看到：

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

### 播放说明 / Playback notes

播放由 **mpv** 完成（`--hwdec=auto`），可直接播 HEVC/H.265、常见容器与 NAS/UNC 路径，无需 Microsoft Store 的 HEVC 扩展。

Playback uses **mpv** (`--hwdec=auto`), so HEVC/H.265 and common containers (including NAS/UNC paths) work without Microsoft Store HEVC extensions.

## 支持的视频扩展名 / Supported extensions

`mp4` `mkv` `avi` `mov` `webm` `m4v` `wmv` `flv`

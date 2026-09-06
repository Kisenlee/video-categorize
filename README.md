# 视频分类助手

Windows 本地 / NAS 视频分类桌面工具。选择待处理文件夹逐个播放，按目标文件夹子目录分类移动或复制。

## 下载使用（推荐）

打包命令会生成：

- `release/VideoClassifier-1.0.0-portable.exe` — 便携版，双击即可运行
- `release/VideoClassifier-1.0.0-win-x64.zip` — 解压后运行 `VideoClassifier.exe`

在 Windows 上双击即可；若被 SmartScreen 拦截，选择「仍要运行」。

## 功能

- 选择待处理文件夹，按文件名顺序播放视频
- 选择目标文件夹；一级子目录即为分类，并实时刷新（资源管理器新建文件夹即可）
- 三栏布局：左详情（可改名）/ 中播放器 / 右分类
- **单类**：点分类 → 重命名（如有修改）→ 移动到该分类 → 自动下一则
- **复类**：勾选多个分类 → 确认 → 复制到各分类并删除源文件 → 自动下一则
- 单/复类模式在视频间保持
- 同名冲突自动追加 `_1`、`_2`…

## 开发运行

需要 Node.js 18+。

```bash
npm install
npm run dev
```

打包 Windows 可执行文件：

```bash
npm run dist:win
```

产物在 `release/`。

### NAS 目录监听

部分 NAS / 网络盘可能收不到目录变更事件，可设置环境变量强制轮询：

```bat
set VIDEO_CLASSIFIER_POLL=1
VideoClassifier-1.0.0-portable.exe
```

## 支持的视频扩展名

`mp4` `mkv` `avi` `mov` `webm` `m4v` `wmv` `flv`

播放依赖 Chromium 编解码能力；无法播放时仍可改名并分类。

# Video Classifier

Windows desktop helper for classifying local / NAS videos. Play files from an inbox folder one by one, then move or copy them into category subfolders.

The UI supports **Chinese and English** (switch in the top bar; preference is saved in `localStorage`).

## Download

Prebuilt binaries: **https://github.com/Kisenlee/video-categorize/releases**

Each release typically includes:

- `VideoClassifier-x.y.z-portable.exe` — portable build; double-click to run
- `VideoClassifier-x.y.z-win-x64.zip` — unzip and run `VideoClassifier.exe`

If Windows SmartScreen blocks the app, choose **Run anyway**.

Pushing a `v*` tag triggers GitHub Actions to build and publish these assets automatically.

## Features

- Select an inbox folder; videos play in filename order
- Select a target folder; its first-level subfolders are categories and refresh live (create folders in File Explorer)
- Three columns: details (rename) / player / categories
- **Single**: click a category → rename if needed → move → auto-advance
- **Multi**: select categories → confirm → copy to each and delete the source → auto-advance
- Single/Multi mode persists across videos
- Name conflicts append `_1`, `_2`, …
- Bundled **mpv** engine (HEVC/H.265 and common codecs; no browser codec pack required)
- If playback fails, you can still rename and classify

## Develop

Requires Node.js 18+.

```bash
npm install
npm run fetch:mpv
npm run dev
```

You can also install mpv yourself and set `MPV_PATH` to `mpv.exe`.

Build Windows artifacts (runs `fetch:mpv` automatically):

```bash
npm run dist:win
```

Output is under `release/`, e.g. `VideoClassifier-1.0.0-portable.exe`.

Typecheck:

```bash
npm run typecheck
```

### NAS folder watching

Some NAS / network drives do not emit folder-change events. Force polling with:

```bat
set VIDEO_CLASSIFIER_POLL=1
VideoClassifier-1.0.0-portable.exe
```

### Playback

Playback uses **mpv** (`--hwdec=auto`), so HEVC/H.265 and common containers (including NAS/UNC paths) work without Microsoft Store HEVC extensions.

## Supported extensions

`mp4` `mkv` `avi` `mov` `webm` `m4v` `wmv` `flv`

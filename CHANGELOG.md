# Changelog

All notable changes to this project are documented in this file.

## [1.0.3] - 2026-09-07

### Fixed

- Playback stuck on “reading” / silent failures: serialize load/stop, wait for `file-loaded`, and surface errors in the UI.
- Orphaned `mpv.exe` after quit: tear down the player synchronously on window close / app exit.
- NAS/UNC playback (including paths with spaces): prefer a localhost Range HTTP proxy so Node reads SMB and mpv plays from `127.0.0.1`.
- mpv startup on some GPUs: try `gpu-next` first, fall back to `gpu`; keep on-screen geometry (offscreen VO init was unreliable).
- HDR→SDR brightness: restore tone-mapping targets (`bt.709` / `srgb` / peak 203) with `gpu-next` when available.
- Stale inbox after deleting the source folder outside the app: refresh on window focus.

## [1.0.2] - 2026-09-07

### Added

- Keyboard shortcuts: Space play/pause; A/D seek ±1/10 of duration; Q/E single/multi mode; F confirm multi-classify; R revert last classify.
- Per-category key binds (`1–0`, `W`, `S`, `Z`, `X`, `C`) for the current session (not persisted).
- Shortcuts help (`?` in the top-right).
- Undo the last classify action (one record): restore files to the inbox source path.
- Keep the mouse cursor visible over the mpv video surface.

### Fixed

- Shortcuts stop working after clicking the video a few times: mpv no longer steals keyboard focus (`WS_EX_NOACTIVATE`), and focus is pulled back to the main window if it does.
- Help modal covered by the video overlay: hide the player while help is open.

## [1.0.1] - 2026-09-07

### Fixed

- Player no longer appears as a second taskbar / Alt+Tab entry (`VideoClassifierPlayer`); the mpv window is owned by the main app and hidden from the taskbar.
- Player z-order: stopped using always-on-top, so the video no longer covers other applications; it stays above the main window only while that window is in the foreground, and is no longer stuck underneath the UI.
- High-DPI / 4K positioning: convert DIP coordinates with `screen.dipToScreenRect` so the overlay aligns with the video stage on scaled displays.
- Black screen after classifying a video: unload the current file before move/copy, then force a fresh player load for the next item.
- Opening a folder dialog while playing: pause playback and park the overlay instead of minimizing (avoids multi-monitor jumping).
- Over-bright picture on some HDR/SDR setups: force SDR-oriented tone mapping targets for more natural brightness.
- README is English-only (notes that the UI also supports Chinese).

## [1.0.0] - 2026-09-07

### Added

- Windows desktop video classifier with inbox / target folders.
- Single- and multi-category classify flows with rename and conflict suffixes (`_1`, `_2`, …).
- Live category list from first-level subfolders.
- Chinese / English UI switch.
- Bundled mpv playback (HEVC and common formats, including NAS/UNC paths).
- GitHub Actions release workflow for portable `.exe` and `.zip` on `v*` tags.

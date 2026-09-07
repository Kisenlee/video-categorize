import koffi from 'koffi'
import type { BrowserWindow } from 'electron'

const user32 = koffi.load('user32.dll')

const FindWindowW = user32.func('FindWindowW', 'uintptr', ['uintptr', 'str16'])
const SetWindowPos = user32.func('SetWindowPos', 'bool', [
  'uintptr',
  'uintptr',
  'int',
  'int',
  'int',
  'int',
  'uint32'
])
const ShowWindow = user32.func('ShowWindow', 'bool', ['uintptr', 'int'])
const IsWindow = user32.func('IsWindow', 'bool', ['uintptr'])
const GetWindowLongPtrW = user32.func('GetWindowLongPtrW', 'int64', ['uintptr', 'int'])
const SetWindowLongPtrW = user32.func('SetWindowLongPtrW', 'int64', ['uintptr', 'int', 'int64'])
const GetForegroundWindow = user32.func('GetForegroundWindow', 'uintptr', [])

const HWND_TOP = 0n
const HWND_NOTOPMOST = -2n

const SWP_NOACTIVATE = 0x0010
const SWP_SHOWWINDOW = 0x0040
const SWP_HIDEWINDOW = 0x0080
const SWP_NOMOVE = 0x0002
const SWP_NOSIZE = 0x0001
const SWP_NOZORDER = 0x0004
const SWP_FRAMECHANGED = 0x0020

const SW_HIDE = 0
const SW_SHOWNA = 8

const GWL_EXSTYLE = -20
const GWLP_HWNDPARENT = -8

const WS_EX_APPWINDOW = 0x00040000
const WS_EX_TOOLWINDOW = 0x00000080
const WS_EX_NOACTIVATE = 0x08000000

function asHwnd(v: bigint | number): bigint {
  return typeof v === 'bigint' ? v : BigInt(v as number)
}

function readOwnerHwnd(win: BrowserWindow): bigint {
  const buf = win.getNativeWindowHandle()
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))
}

/**
 * Controls the standalone mpv HWND: owned by the Electron window (no extra
 * taskbar/Alt-Tab entry), never HWND_TOPMOST, and never takes keyboard focus.
 */
export class MpvWindowController {
  private title: string
  private owner: BrowserWindow
  private hwnd = 0n
  private attached = false

  constructor(title: string, owner: BrowserWindow) {
    this.title = title
    this.owner = owner
  }

  get handle(): bigint {
    return this.hwnd
  }

  resolve(): boolean {
    if (this.hwnd !== 0n && IsWindow(this.hwnd)) {
      this.ensureAttached()
      return true
    }
    this.hwnd = asHwnd(FindWindowW(0, this.title) as bigint | number)
    if (this.hwnd === 0n || !IsWindow(this.hwnd)) return false
    this.attached = false
    this.ensureAttached()
    return true
  }

  isForeground(): boolean {
    if (!this.resolve()) return false
    return asHwnd(GetForegroundWindow() as bigint | number) === this.hwnd
  }

  private applyExStyle(): void {
    if (this.hwnd === 0n) return
    let ex = Number(GetWindowLongPtrW(this.hwnd, GWL_EXSTYLE))
    ex = (ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
    SetWindowLongPtrW(this.hwnd, GWL_EXSTYLE, BigInt(ex))
  }

  private ensureAttached(): void {
    if (this.attached || this.hwnd === 0n) return
    const ownerHwnd = readOwnerHwnd(this.owner)

    // Owned window: stays above the owner, hides with it, no separate taskbar button.
    SetWindowLongPtrW(this.hwnd, GWLP_HWNDPARENT, ownerHwnd)
    this.applyExStyle()

    // Drop any residual topmost flag from earlier runs / mpv defaults.
    SetWindowPos(
      this.hwnd,
      HWND_NOTOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED
    )
    this.attached = true
  }

  setBounds(x: number, y: number, width: number, height: number, opts?: { show?: boolean }): void {
    if (!this.resolve()) return
    this.applyExStyle()
    const show = opts?.show !== false
    SetWindowPos(
      this.hwnd,
      HWND_TOP,
      Math.round(x),
      Math.round(y),
      Math.max(2, Math.round(width)),
      Math.max(2, Math.round(height)),
      SWP_NOACTIVATE | (show ? SWP_SHOWWINDOW : 0)
    )
    if (show) ShowWindow(this.hwnd, SW_SHOWNA)
  }

  hide(): void {
    if (!this.resolve()) return
    ShowWindow(this.hwnd, SW_HIDE)
    SetWindowPos(
      this.hwnd,
      HWND_TOP,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_HIDEWINDOW | SWP_NOZORDER
    )
  }

  showAboveOwner(): void {
    if (!this.resolve()) return
    this.applyExStyle()
    ShowWindow(this.hwnd, SW_SHOWNA)
    SetWindowPos(
      this.hwnd,
      HWND_TOP,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    )
  }
}

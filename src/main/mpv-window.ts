import koffi from 'koffi'

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

const HWND_TOPMOST = -1n
const HWND_NOTOPMOST = -2n

const SWP_NOACTIVATE = 0x0010
const SWP_SHOWWINDOW = 0x0040
const SWP_HIDEWINDOW = 0x0080
const SWP_NOMOVE = 0x0002
const SWP_NOSIZE = 0x0001
const SWP_NOZORDER = 0x0004

const SW_HIDE = 0
const SW_SHOWNA = 8

function asHwnd(v: bigint | number): bigint {
  return typeof v === 'bigint' ? v : BigInt(v as number)
}

export class MpvWindowController {
  private title: string
  private hwnd = 0n

  constructor(title: string) {
    this.title = title
  }

  resolve(): boolean {
    if (this.hwnd !== 0n && IsWindow(this.hwnd)) return true
    this.hwnd = asHwnd(FindWindowW(0, this.title) as bigint | number)
    return this.hwnd !== 0n && IsWindow(this.hwnd)
  }

  setBounds(
    x: number,
    y: number,
    width: number,
    height: number,
    opts?: { topmost?: boolean; show?: boolean }
  ): void {
    if (!this.resolve()) return
    const topmost = opts?.topmost !== false
    const show = opts?.show !== false
    SetWindowPos(
      this.hwnd,
      topmost ? HWND_TOPMOST : HWND_NOTOPMOST,
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
      HWND_NOTOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_HIDEWINDOW | SWP_NOZORDER
    )
  }

  showTopmost(): void {
    if (!this.resolve()) return
    ShowWindow(this.hwnd, SW_SHOWNA)
    SetWindowPos(
      this.hwnd,
      HWND_TOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    )
  }
}

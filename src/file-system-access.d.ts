/**
 * File System Access API の型定義。
 *
 * lib.dom.d.ts には FileSystemFileHandle 等のインターフェースはあるが、
 * それを取得する入口の showOpenFilePicker / showSaveFilePicker が無いため、
 * ここで補う。対応ブラウザ（Chrome/Edge 系）でだけ window に生えるので、
 * Window 側はオプショナルにして未対応ブラウザでの機能検出をそのまま書けるようにする。
 */

export {}

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string | string[]>
}

interface FilePickerOptionsBase {
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
}

interface OpenFilePickerOptions extends FilePickerOptionsBase {
  multiple?: boolean
}

interface SaveFilePickerOptions extends FilePickerOptionsBase {
  suggestedName?: string
}

declare global {
  interface Window {
    showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
    showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
  }
}

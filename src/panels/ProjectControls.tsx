import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.tsx'
import { graphFromJson, graphToJson } from '../library/storage.ts'
import { downloadBlob } from '../export/xlsx.ts'
import { EXAMPLES } from '../library/presets.ts'

const FILE_TYPES = [{ description: 'node-calc グラフ', accept: { 'application/json': ['.json'] } }]

/** File System Access API が使えるブラウザかどうか。Chrome/Edge 系のみ。 */
const supportsFileSystemAccess = typeof window !== 'undefined' && !!window.showOpenFilePicker && !!window.showSaveFilePicker

function withJsonExt(name: string): string {
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/**
 * 名前付きプロジェクトの新規作成・保存・読込。
 *
 * PC 上の実ファイルへ直接読み書きする（LTspice Studio と同じ感覚）。
 * File System Access API が使えるブラウザでは、一度開いた／保存したファイルへ
 * Ctrl(Cmd)+S でそのまま上書きできる。使えないブラウザでは、開くは通常のファイル
 * 選択、保存はダウンロードにフォールバックする（同じファイルへの上書きはできない）。
 */
export function ProjectControls() {
  const { graph, setGraph } = useStore()
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null)
  const [fileName, setFileName] = useState('新規プロジェクト')
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
  const [samplesOpen, setSamplesOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // マウント直後と、保存・読込の直後に来る graph の更新は「編集」ではないので、
  // 次の 1 回だけ dirty マークを飛ばす。
  const skipNextDirty = useRef(true)

  useEffect(() => {
    if (skipNextDirty.current) {
      skipNextDirty.current = false
      return
    }
    setDirty(true)
  }, [graph])

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${fileName} — node-calc`
  }, [dirty, fileName])

  const markClean = () => {
    skipNextDirty.current = true
    setDirty(false)
  }

  const confirmDiscard = () => !dirty || confirm('保存されていない変更があります。破棄してよろしいですか？')

  const create = () => {
    if (!confirmDiscard()) return
    setGraph({ nodes: [], edges: [], nextId: 1 })
    setFileHandle(null)
    setFileName('新規プロジェクト')
    markClean()
    setMessage('新しいプロジェクトを作りました')
  }

  const applyOpened = (handle: FileSystemFileHandle | null, name: string, text: string) => {
    setGraph(graphFromJson(text))
    setFileHandle(handle)
    setFileName(name)
    markClean()
    setMessage(`「${name}」を開きました`)
  }

  const open = async () => {
    if (!confirmDiscard()) return
    if (!supportsFileSystemAccess) {
      fileRef.current?.click()
      return
    }
    try {
      const [handle] = await window.showOpenFilePicker!({ types: FILE_TYPES })
      const file = await handle.getFile()
      applyOpened(handle, file.name, await file.text())
    } catch (e) {
      if (isAbort(e)) return
      setMessage(`開けませんでした: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const openFallbackFile = async (file: File) => {
    try {
      applyOpened(null, file.name, await file.text())
    } catch (e) {
      setMessage(`開けませんでした: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const save = async (saveAs: boolean) => {
    if (!supportsFileSystemAccess) {
      // フォールバック: ブラウザのダウンロードとして保存。同じファイルへの上書きはできない。
      downloadBlob(graphToJson(graph), withJsonExt(fileName), 'application/json')
      markClean()
      setMessage('ダウンロードとして保存しました（このブラウザでは同じファイルへの上書き保存ができません）')
      return
    }
    try {
      let handle = fileHandle
      if (saveAs || !handle) {
        handle = await window.showSaveFilePicker!({ suggestedName: withJsonExt(fileName), types: FILE_TYPES })
      }
      const writable = await handle.createWritable()
      await writable.write(graphToJson(graph))
      await writable.close()
      setFileHandle(handle)
      setFileName(handle.name)
      markClean()
      setMessage('保存しました')
    } catch (e) {
      if (isAbort(e)) return
      setMessage(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const openExample = (key: string) => {
    const example = EXAMPLES.find((e) => e.key === key)
    if (!example) return
    if (!confirmDiscard()) return
    setGraph(example.build())
    setFileHandle(null)
    setFileName(example.title)
    markClean()
    setSamplesOpen(false)
    setMessage('サンプルを開きました')
  }

  // Ctrl(Cmd)+S で保存、+Shift で名前を付けて保存。Ctrl(Cmd)+O で開く。
  // 入力欄にフォーカス中は横取りしない。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || isTextEntry(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void save(event.shiftKey)
      } else if (key === 'o') {
        event.preventDefault()
        void open()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return <>
    <span className={`nc-project-name${dirty ? ' is-dirty' : ''}`} title={fileHandle ? `${fileName}（保存するとこのファイルへ上書きします）` : fileName}>
      {dirty && '● '}{fileName}
    </span>
    <div className="nc-project-actions">
      <button className="nc-btn nc-btn-ghost" onClick={create}>新規</button>
      <button className="nc-btn nc-btn-ghost" onClick={() => void open()}>開く</button>
      <button className="nc-btn nc-btn-primary" onClick={() => void save(false)} title="Ctrl/Cmd+S">保存</button>
      <button className="nc-btn nc-btn-ghost" onClick={() => setSamplesOpen(true)}>サンプル</button>
    </div>
    {message && <span className="nc-project-message">{message}</span>}

    {/* File System Access 非対応ブラウザ向けフォールバック。 */}
    <input
      ref={fileRef}
      type="file"
      accept=".json,application/json"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) void openFallbackFile(file)
      }}
    />

    {samplesOpen && <div className="nc-modal-backdrop" onMouseDown={() => setSamplesOpen(false)}>
      <section className="nc-project-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="nc-modal-head"><h2>サンプルを開く</h2><button className="nc-x" onClick={() => setSamplesOpen(false)}>×</button></header>
        <div className="nc-project-list">
          {EXAMPLES.map((example) => (
            <div className="nc-project-row" key={example.key}>
              <button className="nc-project-open" onClick={() => openExample(example.key)}>
                <strong>{example.title}</strong>
                <small>{example.note}</small>
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>}
  </>
}

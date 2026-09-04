import { useCallback, useEffect, useRef, useState } from 'react'
import { ImeInput } from '../components/ImeField.tsx'
import { EXAMPLES } from '../library/presets.ts'
import { deleteServerFile, listServerFiles, readServerFile, renameServerFile, type ServerFileInfo } from '../library/serverFiles.ts'
import { FileBrowserModal } from './FileBrowserModal.tsx'
import { useProject } from './ProjectControls.tsx'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 右タブのファイルパネル。自作のファイルエクスプローラー。
 *
 * ファイルは開発サーバー側のフォルダに置いてあるので、Tailscale 越しの iPad など
 * どの端末から開いても同じ一覧・内容を参照できる。サンプルもここから開く。
 */
export function FilesPanel() {
  const { fileName, openFile, openExample, saveTo } = useProject()
  const [files, setFiles] = useState<ServerFileInfo[]>([])
  const [name, setName] = useState(fileName === '新規プロジェクト' ? '' : fileName)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [browsing, setBrowsing] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setFiles(await listServerFiles())
    } catch (error) {
      setMessage(`一覧を取得できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const save = async () => {
    if (busy) return
    // ImeInput は打鍵が止まってから値を渡すので、打った直後に Enter やボタンで
    // 保存されたときは DOM 側の値を直接読む。
    const target = (nameRef.current?.value ?? name).trim()
    if (!target) {
      setMessage('ファイル名を入力してください')
      return
    }
    setBusy(true)
    try {
      const saved = await saveTo(target)
      setName(saved)
      setMessage('')
      await refresh()
    } catch (error) {
      setMessage(`保存できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const open = async (file: ServerFileInfo) => {
    try {
      openFile(file.name, await readServerFile(file.name))
    } catch (error) {
      setMessage(`開けませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const rename = async (file: ServerFileInfo) => {
    const nextName = prompt('新しいファイル名', file.name)
    if (nextName === null) return
    const target = nextName.trim()
    if (!target || target === file.name) return
    try {
      await renameServerFile(file.name, target)
      await refresh()
    } catch (error) {
      setMessage(`名前を変更できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const remove = async (file: ServerFileInfo) => {
    if (!confirm(`「${file.name}」を削除しますか？`)) return
    try {
      await deleteServerFile(file.name)
      await refresh()
    } catch (error) {
      setMessage(`削除できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div className="nc-panel-body">
      <h4 className="nc-sub">ファイルに保存</h4>
      <div className="nc-file-toolbar">
        <ImeInput
          ref={nameRef}
          className="nc-project-name-input"
          value={name}
          onCommit={setName}
          placeholder="ファイル名（例: 電池計算.json）"
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) void save() }}
        />
        <button className="nc-btn nc-btn-primary" onClick={() => void save()} disabled={busy}>保存</button>
      </div>

      <div className="nc-file-toolbar">
        <button className="nc-btn nc-btn-ghost" onClick={() => setBrowsing(true)}>📂 PCから開く…</button>
      </div>
      {browsing && <FileBrowserModal onClose={() => setBrowsing(false)} />}

      <h4 className="nc-sub">ファイル</h4>
      {files.length === 0
        ? <p className="nc-project-empty">ファイルがありません。名前を入れて「保存」すると作れます。</p>
        : <div className="nc-project-list">
          {files.map((file) => (
            <div className="nc-project-row" key={file.name}>
              <button className="nc-project-open" onClick={() => void open(file)}>
                <strong>{file.name}</strong>
                <small>{formatSize(file.size)} · {new Date(file.modified).toLocaleString()}</small>
              </button>
              <button className="nc-btn nc-btn-ghost" onClick={() => void rename(file)}>名前変更</button>
              <button className="nc-btn nc-btn-ghost" onClick={() => void remove(file)}>削除</button>
            </div>
          ))}
        </div>}

      <h4 className="nc-sub">サンプル</h4>
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

      {message && <span className="nc-project-message">{message}</span>}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { browseDirectory, readBrowsedFile, type BrowseEntry } from '../library/fsBrowser.ts'
import { useProject } from './ProjectControls.tsx'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 表示用のパンくず。空文字（ホーム自身）は「ホーム」の1個だけになる。 */
function crumbsOf(dir: string): Array<{ label: string; path: string }> {
  const parts = dir ? dir.split('/') : []
  const crumbs = [{ label: 'ホーム', path: '' }]
  let path = ''
  for (const part of parts) {
    path = path ? `${path}/${part}` : part
    crumbs.push({ label: part, path })
  }
  return crumbs
}

/**
 * ホームディレクトリ配下を辿って .json プロジェクトファイルを開く、自作のファイルエクスプローラー。
 * projects フォルダに保存したファイル（FilesPanel の一覧）とは別に、PC上の好きな場所にある
 * プロジェクトも開けるようにする。読み取り専用（このモーダルからは保存・削除はしない）。
 */
export function FileBrowserModal({ onClose }: { onClose(): void }) {
  const { openFile } = useProject()
  const [dir, setDir] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<BrowseEntry[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    browseDirectory(dir)
      .then((result) => {
        if (cancelled) return
        setDir(result.dir)
        setParent(result.parent)
        setEntries(result.entries)
        setMessage('')
      })
      .catch((error) => {
        if (cancelled) return
        setMessage(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dir])

  const open = async (entry: BrowseEntry) => {
    const path = dir ? `${dir}/${entry.name}` : entry.name
    try {
      const content = await readBrowsedFile(path)
      if (openFile(entry.name, content)) onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const folders = entries.filter((entry) => entry.type === 'dir')
  const files = entries.filter((entry) => entry.type === 'file')

  return (
    <div className="nc-modal-backdrop" onMouseDown={onClose}>
      <section className="nc-browser-modal nodrag" role="dialog" aria-modal="true" aria-label="PCからプロジェクトを開く" onMouseDown={(event) => event.stopPropagation()}>
        <header className="nc-modal-head">
          <p>PCから開く</p>
          <button className="nc-x" onClick={onClose} title="閉じる">×</button>
        </header>

        <nav className="nc-browser-crumbs">
          {crumbsOf(dir).map((crumb, index, all) => (
            <span key={crumb.path}>
              <button className="nc-browser-crumb" disabled={index === all.length - 1} onClick={() => setDir(crumb.path)}>{crumb.label}</button>
              {index < all.length - 1 && <span className="nc-browser-sep">/</span>}
            </span>
          ))}
        </nav>

        <div className="nc-browser-list">
          {loading && <p className="nc-browser-empty">読み込み中…</p>}
          {!loading && parent !== null && (
            <button className="nc-browser-row nc-browser-up" onClick={() => setDir(parent)}>📁 ..（上のフォルダ）</button>
          )}
          {!loading && folders.map((entry) => (
            <button
              key={entry.name}
              className="nc-browser-row"
              onClick={() => setDir(dir ? `${dir}/${entry.name}` : entry.name)}
            >
              📁 {entry.name}
            </button>
          ))}
          {!loading && files.map((entry) => (
            <button key={entry.name} className="nc-browser-row nc-browser-file" onClick={() => void open(entry)}>
              <span>📄 {entry.name}</span>
              <small>{formatSize(entry.size)} · {new Date(entry.modified).toLocaleDateString()}</small>
            </button>
          ))}
          {!loading && !folders.length && !files.length && (
            <p className="nc-browser-empty">このフォルダには何もありません</p>
          )}
        </div>

        {message && <span className="nc-project-message">{message}</span>}
      </section>
    </div>
  )
}

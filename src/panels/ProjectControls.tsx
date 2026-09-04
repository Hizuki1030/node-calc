import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../store.tsx'
import { graphFromJson, graphToJson } from '../library/storage.ts'
import { writeServerFile } from '../library/serverFiles.ts'
import { EXAMPLES } from '../library/presets.ts'

function withJsonExt(name: string): string {
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`
}

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

interface ProjectContextValue {
  fileName: string
  dirty: boolean
  message: string
  create(): void
  /** 一覧から開く。未保存の変更は確認し、破棄しない場合は false。 */
  openFile(name: string, text: string): boolean
  openExample(key: string): void
  saveTo(name: string): Promise<string>
  save(saveAs: boolean): Promise<void>
  browseFiles(): void
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext)
  if (!value) throw new Error('ProjectProvider の外で useProject を使っています')
  return value
}

/**
 * 名前付きプロジェクトの状態をまとめて持つ。
 * トップバーのボタン類（ProjectControls）と右タブのファイルパネル（FilesPanel）の
 * 両方から使うので、ここで共有する。
 *
 * ファイルは開発サーバー（このマシン）側の projects フォルダに置き、自作の
 * ファイルエクスプローラーで管理する。Tailscale 越しの iPad など、どの端末から
 * 開いても同じ一覧と内容を参照できる。ブラウザのファイル選択や File System Access
 * API には頼らない（iPad の Safari でも動く）。
 */
export function ProjectProvider({ browseFiles, children }: { browseFiles(): void; children: ReactNode }) {
  const { graph, setGraph } = useStore()
  const [fileName, setFileName] = useState('新規プロジェクト')
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState('')
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
    setFileName('新規プロジェクト')
    markClean()
    setMessage('新しいプロジェクトを作りました')
  }

  const openFile = (name: string, text: string): boolean => {
    if (!confirmDiscard()) return false
    setGraph(graphFromJson(text))
    setFileName(name)
    markClean()
    setMessage(`「${name}」を開きました`)
    return true
  }

  const openExample = (key: string) => {
    const example = EXAMPLES.find((e) => e.key === key)
    if (!example) return
    if (!confirmDiscard()) return
    setGraph(example.build())
    setFileName(example.title)
    markClean()
    setMessage('サンプルを開きました')
  }

  const saveTo = async (name: string): Promise<string> => {
    const target = withJsonExt(name.trim())
    if (!target || target === '.json') throw new Error('ファイル名が空です')
    await writeServerFile(target, graphToJson(graph))
    setFileName(target)
    markClean()
    setMessage(`「${target}」に保存しました`)
    return target
  }

  const save = async (saveAs: boolean) => {
    // 名前が決まっていないときや名前を付けて保存は、ファイルタブを開いて名前を入れる。
    if (saveAs || fileName === '新規プロジェクト') {
      browseFiles()
      return
    }
    try {
      await saveTo(fileName)
    } catch (error) {
      setMessage(`保存できませんでした: ${error instanceof Error ? error.message : String(error)}`)
    }
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
        browseFiles()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <ProjectContext.Provider value={{ fileName, dirty, message, create, openFile, openExample, saveTo, save, browseFiles }}>
      {children}
    </ProjectContext.Provider>
  )
}

/** トップバーに出るプロジェクト操作。状態は ProjectProvider が持ち、ファイルパネルと共有する。 */
export function ProjectControls() {
  const { fileName, dirty, message, create, save, browseFiles } = useProject()
  return (
    <>
      <span className={`nc-project-name${dirty ? ' is-dirty' : ''}`} title={fileName !== '新規プロジェクト' ? `${fileName}（保存するとこのファイルへ上書きします）` : fileName}>
        {dirty && '● '}{fileName}
      </span>
      <div className="nc-project-actions">
        <button className="nc-btn nc-btn-ghost" onClick={create}>新規</button>
        <button className="nc-btn nc-btn-ghost" onClick={browseFiles}>開く</button>
        <button className="nc-btn nc-btn-primary" onClick={() => void save(false)} title="Ctrl/Cmd+S">保存</button>
        <button className="nc-btn nc-btn-ghost" onClick={browseFiles}>サンプル</button>
      </div>
      {message && <span className="nc-project-message">{message}</span>}
    </>
  )
}

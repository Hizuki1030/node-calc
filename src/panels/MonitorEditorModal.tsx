import { useActions, useNode } from '../store.tsx'
import { isMonitor } from '../types.ts'
import { MonitorSettings } from './MonitorSettings.tsx'

/**
 * モニターの設定をキャンバス上で編集するポップアップ。
 * 中身は右パネルと同じ入力を使い回すので、どちらで直しても同じ結果になる。
 */
export function MonitorEditorModal({ id, onClose }: { id: string; onClose(): void }) {
  const found = useNode(id)
  const { removeNode } = useActions()
  const node = found && isMonitor(found) ? found : null
  if (!node) return null

  return (
    <div className="nc-modal-backdrop" onMouseDown={onClose}>
      <section
        className="nc-monitor-modal nodrag"
        role="dialog"
        aria-modal="true"
        aria-label="モニターを編集"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="nc-modal-head">
          <div>
            <p>モニターを編集</p>
          </div>
          <button className="nc-x" onClick={onClose} title="閉じる">×</button>
        </header>
        <MonitorSettings node={node} />
        <footer className="nc-modal-actions">
          <button className="nc-btn nc-btn-danger" onClick={() => { removeNode(node.id); onClose() }}>削除</button>
          <button className="nc-btn nc-btn-primary" onClick={onClose}>完了</button>
        </footer>
      </section>
    </div>
  )
}

import { SolvePanel } from './SolvePanel.tsx'

/** 逆算パネルをキャンバス上のポップアップとして開く。中身は SolvePanel そのまま。 */
export function SolveModal({ onClose }: { onClose(): void }) {
  return (
    <div className="nc-modal-backdrop" onMouseDown={onClose}>
      <section
        className="nc-solve-modal"
        role="dialog"
        aria-modal="true"
        aria-label="逆算"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="nc-modal-head">
          <div>
            <p>目標値から逆算</p>
          </div>
          <button className="nc-x" onClick={onClose} title="閉じる">×</button>
        </header>
        <SolvePanel />
      </section>
    </div>
  )
}

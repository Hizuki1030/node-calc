import { useRef, useState } from 'react'
import { type BlockDraft } from '../store.tsx'
import { MathFormula } from '../nodes/MathFormula.tsx'
import { checkGraphUnits } from '../engine/units.ts'

function isDraft(value: unknown): value is BlockDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as BlockDraft
  return typeof draft.title === 'string'
    && Array.isArray(draft.inputs)
    && draft.inputs.every((item) => typeof item?.name === 'string' && typeof item?.unit === 'string')
    && Array.isArray(draft.calcs)
    && draft.calcs.length > 0
    && draft.calcs.every((item) => typeof item?.name === 'string' && typeof item?.expr === 'string'
      && typeof item?.unit === 'string' && typeof item?.exposed === 'boolean')
}

/**
 * AI に計算ブロックを設計してもらう欄。呼び先は Claude 固定ではなく、LiteLLM 経由で
 * 他ベンダーへ振り分けている場合もあるので、文言は一貫して「AI」とだけ呼ぶ。
 * 依頼文の状態をこのコンポーネントに閉じ込めることで、1文字打つたびに
 * 編集モーダル全体（入力欄・単位ピッカー・数式プレビュー）が再描画されるのを防ぐ。
 */
export function AiBlockDesigner({ current, onApply }: { current: () => BlockDraft; onApply: (draft: BlockDraft) => void }) {
  // 依頼文は非制御で持つ。value を React が握ると、日本語の変換中に
  // 未確定文字列を書き戻してしまい、IME が一文字ごとに引っかかる。
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [hasPrompt, setHasPrompt] = useState(false)
  const [draft, setDraft] = useState<BlockDraft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const askAi = async () => {
    const prompt = promptRef.current?.value ?? ''
    if (!prompt.trim()) return
    setBusy(true)
    setError('')
    setDraft(null)
    try {
      const response = await fetch('/api/ai/block', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: prompt, current: current() }),
      })
      const body = await response.json() as { draft?: unknown; error?: string }
      if (!response.ok) throw new Error(body.error || 'AIへの接続に失敗しました')
      if (!isDraft(body.draft)) throw new Error('AIから正しいブロック定義が返りませんでした')
      const proposed = body.draft
      const proposalReport = checkGraphUnits({ nextId: 2, edges: [], nodes: [{
        id: 'proposal', kind: 'block', x: 0, y: 0,
        data: {
          title: proposed.title,
          note: proposed.note,
          inputs: proposed.inputs.map((item, index) => ({ id: `p${index}`, ...item })),
          calcs: proposed.calcs.map((item, index) => ({ id: `c${index}`, ...item })),
        },
      }] })
      if (!proposalReport.ok) throw new Error(`AIの提案を単位検査で止めました: ${proposalReport.issues.map((item) => item.message).join(' / ')}`)
      setDraft(proposed)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="nc-ai-designer">
      <div className="nc-ai-head"><strong>AIで計算ブロックを設計</strong><span>入力・式・出力・単位をまとめて提案</span></div>
      <textarea
        ref={promptRef}
        className="nc-textarea"
        rows={3}
        // 送信ボタンの有効・無効に必要な「空かどうか」だけを見る。
        // 同じ真偽値なら React は再描画しないので、打鍵ごとの再描画は起きない。
        // 変換中は状態を触らず、IME に一切割り込まない。
        onChange={(e) => {
          if ((e.nativeEvent as InputEvent).isComposing) return
          setHasPrompt(e.target.value.trim().length > 0)
        }}
        onCompositionEnd={(e) => setHasPrompt(e.currentTarget.value.trim().length > 0)}
        placeholder="例：幅と高さから面積と周長を計算したい。長さはmm、面積はmm^2にする"
      />
      <button className="nc-btn nc-btn-ai" disabled={busy || !hasPrompt} onClick={askAi}>
        {busy ? '考えています…' : 'AIに設計してもらう'}
      </button>
      {error && <p className="nc-warn">{error}</p>}
      {draft && <div className="nc-ai-proposal">
        <strong>提案：{draft.title}</strong>
        <div>
          {draft.inputs.map((item) => `${item.name} [${item.unit}]`).join('、')}
          {' → '}
          {draft.calcs.filter((item) => item.exposed).map((item) => `${item.name} [${item.unit}]`).join('、')}
        </div>
        {draft.calcs.map((row) => <MathFormula key={row.name} name={row.name} expr={row.expr} />)}
        <div className="nc-ai-actions">
          <button className="nc-btn nc-btn-ghost" onClick={() => setDraft(null)}>取消</button>
          <button className="nc-btn nc-btn-primary" onClick={() => { onApply(draft); setDraft(null) }}>この提案を適用</button>
        </div>
      </div>}
    </section>
  )
}

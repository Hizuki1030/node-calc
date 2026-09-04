import { useCallback, useMemo } from 'react'
import { useActions, useNode, useSelected, useStoreSelector } from '../store.tsx'
import { isTable, isVariable, type VariableData } from '../types.ts'
import { clamp, snap } from '../format.ts'
import { UnitPicker } from '../components/UnitPicker.tsx'
import { useSliderCommit } from '../components/ValueSlider.tsx'
import { ImeInput, ImeTextarea } from '../components/ImeField.tsx'

const MODES = [
  { key: 'constant', label: '定数', note: '値は固定' },
  { key: 'select', label: 'リスト', note: '候補から選ぶ' },
  { key: 'slider', label: 'スライダー', note: '範囲で動かす' },
  { key: 'text', label: 'テキスト', note: '文字列（テーブル検索用）' },
] as const

/**
 * この変数の出力がテキスト種別のテーブル入力へつながっていれば、その CSV に実際にある
 * 値の一覧を返す。自由入力のまま、打ち間違いで「一致する行がありません」になるのを防ぐ
 * 入力補助（datalist）用。複数のテーブルへつないでいれば候補をまとめる。
 */
function useTextCandidates(nodeId: string): string[] {
  const packed = useStoreSelector(useCallback((store) => {
    if (!nodeId) return ''
    const graph = store.getGraph()
    const candidates = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.source !== nodeId) continue
      const target = graph.nodes.find((n) => n.id === edge.target)
      if (!target || !isTable(target)) continue
      const input = target.data.inputs.find((i) => i.id === edge.targetPort)
      if (!input || input.kind !== 'text') continue
      for (const row of target.data.rows) {
        const cell = row[input.column]
        if (typeof cell === 'string' && cell) candidates.add(cell)
      }
    }
    return [...candidates].sort((a, b) => a.localeCompare(b, 'ja')).join('\n')
  }, [nodeId]))
  return useMemo(() => packed ? packed.split('\n') : [], [packed])
}

export function VariableEditorModal() {
  const selected = useSelected()
  const found = useNode(selected ?? '')
  const { select, patchVariable, removeNode } = useActions()
  const node = found && isVariable(found) ? found : null
  const choices = node?.data.choices
  const choicesText = useMemo(() => (choices ?? []).join(', '), [choices])
  const nodeId = node?.id ?? ''
  const setValue = useCallback((value: number) => {
    if (nodeId) patchVariable(nodeId, { value })
  }, [patchVariable, nodeId])
  const { dragging, change, settle } = useSliderCommit(setValue)
  const textCandidates = useTextCandidates(nodeId)
  if (!node) return null
  const d = node.data as VariableData
  const mode = d.mode ?? 'slider'
  const datalistId = `${node.id}-text-candidates`
  const updateChoices = (text: string) => {
    const choices = text.split(/[、,\n]/).map((v) => Number(v.trim())).filter(Number.isFinite)
    patchVariable(node.id, { choices, value: choices.includes(d.value) ? d.value : (choices[0] ?? 0) })
  }

  return (
    <div className="nc-modal-backdrop" onMouseDown={() => select(null)}>
      <section className="nc-variable-modal nodrag" role="dialog" aria-modal="true" aria-label="入力変数を編集" onMouseDown={(e) => e.stopPropagation()}>
        <header className="nc-modal-head">
          <div>
            <p>入力変数を編集</p>
            <ImeInput className="nc-modal-title" value={d.title} onCommit={(next) => patchVariable(node.id, { title: next })} aria-label="変数名" />
          </div>
          <button className="nc-x" onClick={() => select(null)} title="閉じる">×</button>
        </header>
        <div className="nc-mode-choice">
          {MODES.map((item) => (
            <button key={item.key} className={mode === item.key ? 'is-active' : ''} onClick={() => patchVariable(node.id, { mode: item.key })}>
              <strong>{item.label}</strong><small>{item.note}</small>
            </button>
          ))}
        </div>
        <div className="nc-variable-config">
          <label>現在値</label>
          {mode === 'text' ? (
            <>
              <ImeInput
                className="nc-text"
                value={d.text ?? ''}
                placeholder="例: 東京"
                list={textCandidates.length ? datalistId : undefined}
                onCommit={(next) => patchVariable(node.id, { text: next })}
                aria-label="変数の値"
              />
              {textCandidates.length > 0 && (
                <datalist id={datalistId}>
                  {textCandidates.map((value) => <option key={value} value={value} />)}
                </datalist>
              )}
            </>
          ) : mode === 'select' ? (
            <select className="nc-select" value={d.value} onChange={(e) => setValue(Number(e.target.value))}>
              {(d.choices ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : (
            <input className="nc-num" type="number" value={d.value} onChange={(e) => setValue(Number(e.target.value))} />
          )}
          {mode === 'slider' && <>
            <label>範囲</label>
            <div className="nc-var-range">
              <input className="nc-num" type="number" value={d.min} onChange={(e) => patchVariable(node.id, { min: Number(e.target.value) })} />
              <span>〜</span>
              <input className="nc-num" type="number" value={d.max} onChange={(e) => patchVariable(node.id, { max: Number(e.target.value) })} />
            </div>
            <label>刻み</label>
            <input className="nc-num" type="number" value={d.step} onChange={(e) => patchVariable(node.id, { step: Number(e.target.value) })} />
            <input
              className="nc-slider"
              type="range"
              min={d.min}
              max={d.max}
              step={d.step || 'any'}
              value={dragging ?? clamp(d.value, d.min, d.max)}
              onChange={(e) => change(clamp(snap(Number(e.target.value), d.step), d.min, d.max))}
              onPointerUp={settle}
              onBlur={settle}
            />
          </>}
          {mode === 'select' && <>
            <label>候補</label>
            <ImeTextarea className="nc-textarea" rows={3} value={choicesText} placeholder="例: 10, 20, 50" onCommit={updateChoices} />
          </>}
          {mode !== 'text' && <>
            <label>単位 *</label>
            <UnitPicker value={d.unit ?? ''} onChange={(unit) => patchVariable(node.id, { unit })} ariaLabel={`${d.title}の単位`} />
          </>}
          {mode === 'text' && (
            <p className="nc-hint">
              {textCandidates.length
                ? `テキストは数式には使えません。つないだテーブルの実データから ${textCandidates.length} 件を候補に出しています（完全一致で検索）。`
                : 'テキストは数式には使えません。CSVテーブル変換のテキスト入力（完全一致検索）につなぐと、実データを候補に出せます。'}
            </p>
          )}
        </div>
        <footer className="nc-modal-actions">
          <button className="nc-btn nc-btn-danger" onClick={() => removeNode(node.id)}>削除</button>
          <button
            className="nc-btn nc-btn-primary"
            disabled={mode !== 'text' && !d.unit?.trim()}
            title={mode !== 'text' && !d.unit?.trim() ? '単位を入力してください' : undefined}
            onClick={() => select(null)}
          >完了</button>
        </footer>
      </section>
    </div>
  )
}

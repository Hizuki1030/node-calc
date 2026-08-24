import { useCallback, useMemo } from 'react'
import { useActions, useNode, useSelected } from '../store.tsx'
import { isVariable, type VariableData } from '../types.ts'
import { clamp, snap } from '../format.ts'
import { UnitPicker } from '../components/UnitPicker.tsx'
import { useSliderCommit } from '../components/ValueSlider.tsx'
import { ImeInput, ImeTextarea } from '../components/ImeField.tsx'

const MODES = [
  { key: 'constant', label: '定数', note: '値は固定' },
  { key: 'select', label: 'リスト', note: '候補から選ぶ' },
  { key: 'slider', label: 'スライダー', note: '範囲で動かす' },
] as const

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
  if (!node) return null
  const d = node.data as VariableData
  const mode = d.mode ?? 'slider'
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
          {mode === 'select' ? (
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
          <label>単位 *</label>
          <UnitPicker value={d.unit ?? ''} onChange={(unit) => patchVariable(node.id, { unit })} ariaLabel={`${d.title}の単位`} />
        </div>
        <footer className="nc-modal-actions">
          <button className="nc-btn nc-btn-danger" onClick={() => removeNode(node.id)}>削除</button>
          <button className="nc-btn nc-btn-primary" disabled={!d.unit?.trim()} title={!d.unit?.trim() ? '単位を入力してください' : undefined} onClick={() => select(null)}>完了</button>
        </footer>
      </section>
    </div>
  )
}

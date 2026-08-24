import { memo } from 'react'
import { useActions, useIncomingPorts } from '../store.tsx'
import type { CalcNode, MonitorData } from '../types.ts'
import { clamp } from '../format.ts'
import { ImeInput } from '../components/ImeField.tsx'

const DEFAULT_MONITOR_INPUTS = [{ id: 'in', name: '入力1', unit: '' }]

/** モニターの表示設定と、円グラフの入力一覧。 */
export const MonitorSettings = memo(function MonitorSettings({ node }: { node: CalcNode & { data: MonitorData } }) {
  const { patchMonitor, addMonitorInput, removeMonitorInput, renameMonitorInput } = useActions()
  const d = node.data
  const inputs = d.inputs?.length ? d.inputs : DEFAULT_MONITOR_INPUTS
  const sources = useIncomingPorts(node.id, inputs.map((input) => input.id))
  const mode = d.mode ?? 'value'

  return (
    <>
      <h4 className="nc-sub">{d.title} の設定</h4>
      <div className="nc-field-row">
        <label>名前</label>
        <ImeInput className="nc-text" value={d.title} onCommit={(next) => patchMonitor(node.id, { title: next })} />
      </div>
      <div className="nc-field-row">
        <label>表示</label>
        <select className="nc-select" value={mode} onChange={(event) => {
          const next = event.target.value as 'value' | 'pie'
          patchMonitor(node.id, { mode: next })
          if (next === 'pie' && inputs.length < 2) addMonitorInput(node.id)
        }}>
          <option value="value">単一値</option>
          <option value="pie">円グラフ</option>
        </select>
      </div>
      <div className="nc-field-row">
        <label>小数桁</label>
        <input className="nc-num" type="number" min={0} max={8} value={d.digits} onChange={(e) => patchMonitor(node.id, { digits: clamp(Number(e.target.value), 0, 8) })} />
      </div>
      {mode === 'value' ? <div className="nc-field-row">
        <label>単位</label>
        <span className="nc-unit">{sources[0]?.unit || '—（接続元から自動取得）'}</span>
      </div> : <>
        <p className="nc-note">円グラフは、すべての入力が同じ単位の場合だけ表示します。</p>
        <div className="nc-monitor-input-settings">
          {inputs.map((input, index) => <div key={input.id}>
            <ImeInput className="nc-text" value={input.name} onCommit={(next) => renameMonitorInput(node.id, input.id, next)} aria-label="円グラフ入力名" />
            <span>{sources[index]?.unit || (sources[index]?.connected ? '' : '未接続')}</span>
            <button className="nc-x" disabled={inputs.length <= 1} onClick={() => removeMonitorInput(node.id, input.id)} title="入力を削除">×</button>
          </div>)}
          <button className="nc-btn nc-btn-ghost" onClick={() => addMonitorInput(node.id)}>＋ 入力を追加</button>
        </div>
      </>}
    </>
  )
})

import { memo, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useActions, useIncomingColor, useIncomingLabel, useIncomingUnit, useNode, useNodeResult } from '../store.tsx'
import { isResult } from '../types.ts'
import { fmtNum } from '../format.ts'
import { useHandleSync } from './useHandleSync.ts'
import { ImeInput } from '../components/ImeField.tsx'
import { NodeIcon } from '../components/NodeIcon.tsx'

/** 結果ノード。目標値を入れると逆算のターゲットになる。 */
export const ResultNode = memo(function ResultNode({ id, selected }: NodeProps) {
  const node = useNode(id)
  const res = useNodeResult(id)
  const unit = useIncomingUnit(id)
  const netLabel = useIncomingLabel(id, 'in')
  const color = useIncomingColor(id, 'in')
  const { patchResult, removeNode } = useActions()
  const handleSync = useHandleSync(id, 'in')
  if (!node || !isResult(node)) return null
  const d = node.data
  const value = res?.outputs.in

  const gap = d.target !== null && value !== undefined ? value - d.target : null

  return (
    <div
      ref={handleSync}
      className={`nc-node nc-result${selected ? ' is-selected' : ''}`}
      style={{ '--nc-port': color } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} id="in" className="nc-handle nc-handle-result" />
      {netLabel && <span className="nc-net-label nc-net-label-in">{netLabel}</span>}
      <header className="nc-head">
        <NodeIcon kind="result" />
        <ImeInput
          className="nc-title nodrag"
          value={d.title}
          onCommit={(next) => patchResult(id, { title: next })}
          aria-label="結果名"
        />
        <button className="nc-x nodrag" onClick={() => removeNode(id)} title="削除">
          ×
        </button>
      </header>

      {res?.error ? (
        <div className="nc-node-error">{res.error}</div>
      ) : (
        <div className="nc-result-value">
          {fmtNum(value, d.digits)}
          {unit && <em className="nc-unit">{unit}</em>}
        </div>
      )}

      <div className="nc-target">
        <label>目標</label>
        <input
          className="nc-num nodrag"
          type="number"
          value={d.target ?? ''}
          placeholder="—"
          onChange={(e) =>
            patchResult(id, { target: e.target.value === '' ? null : Number(e.target.value) })
          }
          aria-label="目標値"
        />
      </div>

      {gap !== null && (
        <div className={`nc-gap${Math.abs(gap) < 1e-9 ? ' is-hit' : ''}`}>
          {Math.abs(gap) < 1e-9 ? '目標に一致' : `目標との差 ${gap > 0 ? '+' : ''}${fmtNum(gap, d.digits)}`}
        </div>
      )}
    </div>
  )
})

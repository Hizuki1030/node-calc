import { memo, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useNode, useOutgoingLabel, useOutputColor } from '../store.tsx'
import { isVariable } from '../types.ts'
import { fmtStepNum } from '../format.ts'
import { useHandleSync } from './useHandleSync.ts'
import { NodeIcon } from '../components/NodeIcon.tsx'

const MODE_LABEL = { constant: '定数', select: 'リスト', slider: 'スライダー', text: 'テキスト' }

/** キャンバス上の変数は現在値だけを表示し、設定はクリック後のポップアップで行う。 */
export const VariableNode = memo(function VariableNode({ id, selected }: NodeProps) {
  const node = useNode(id)
  const label = useOutgoingLabel(id, 'out')
  const color = useOutputColor(id, 'out')
  const handleSync = useHandleSync(id, 'out')
  if (!node || !isVariable(node)) return null
  const d = node.data
  const mode = d.mode ?? 'slider'

  return (
    <div
      ref={handleSync}
      className={`nc-node nc-var nc-var-compact${selected ? ' is-selected' : ''}`}
      style={{ '--nc-port': color } as CSSProperties}
    >
      <div className="nc-compact-title"><NodeIcon kind="variable" />{d.title || '変数'}</div>
      {mode === 'text'
        ? <div className="nc-var-compact-value nc-mono">{d.text || '（未入力）'}</div>
        : <div className="nc-var-compact-value nc-mono">{fmtStepNum(d.value, d.step)}<em>{d.unit}</em></div>}
      <span className="nc-var-mode">{MODE_LABEL[mode]}</span>
      {label && <span className="nc-net-label nc-net-label-out">{label}</span>}
      <Handle type="source" position={Position.Right} id="out" className="nc-handle nc-handle-var" title="この値からつなぐ" />
    </div>
  )
})

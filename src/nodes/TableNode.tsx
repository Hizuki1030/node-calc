import { memo, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useIncomingColor, useIncomingLabel, useNode, useNodeResult, useOutgoingLabel, useOutputColor } from '../store.tsx'
import { isTable, type PortDef } from '../types.ts'
import { fmtNum } from '../format.ts'
import { useHandleSync } from './useHandleSync.ts'
import { NodeIcon } from '../components/NodeIcon.tsx'

/** 入力ポート 1 行。ネット名だけを個別に購読する。 */
const TablePort = memo(function TablePort({ nodeId, port }: { nodeId: string; port: PortDef }) {
  const label = useIncomingLabel(nodeId, port.id)
  const color = useIncomingColor(nodeId, port.id)
  return (
    <div className="nc-table-port" style={{ '--nc-port': color } as CSSProperties}>
      <Handle type="target" position={Position.Left} id={port.id} className="nc-handle nc-handle-table" />
      <span>{port.name}</span>
      {port.unit && <small>[{port.unit}]</small>}
      {label && <b className="nc-net-label nc-net-label-in">{label}</b>}
    </div>
  )
})

/** CSVの数値表を複数入力から検索・補間するノード。 */
export const TableNode = memo(function TableNode({ id, selected }: NodeProps) {
  const found = useNode(id)
  const result = useNodeResult(id)
  const node = found && isTable(found) ? found : null
  const outputId = node?.data.output.id ?? ''
  const label = useOutgoingLabel(id, outputId)
  const color = useOutputColor(id, outputId)
  const handleSync = useHandleSync(id, node
    ? `${node.data.inputs.map((input) => input.id).join(',')}|${outputId}`
    : '')
  if (!node) return null
  const data = node.data

  return <div ref={handleSync} className={`nc-node nc-table${selected ? ' is-selected' : ''}`}>
    <div className="nc-compact-title"><NodeIcon kind="table" />{data.title || 'CSVテーブル変換'}</div>
    <div className="nc-table-meta">
      <span>{data.sourceName || 'CSV未読込'}</span>
      <b>{data.rows.length}行</b>
      <em>{data.mode === 'nearest' ? '最近傍' : '連続補間'}</em>
    </div>
    <div className="nc-table-inputs">
      {data.inputs.map((input) => <TablePort key={input.id} nodeId={id} port={input} />)}
    </div>
    <div className="nc-table-output" style={{ '--nc-port': color } as CSSProperties}>
      <div><span>{data.output.name}</span>{data.output.unit && <small>[{data.output.unit}]</small>}</div>
      <strong className="nc-mono">{result?.error ? '—' : fmtNum(result?.outputs[data.output.id], data.digits)}</strong>
      {label && <span className="nc-net-label nc-net-label-out">{label}</span>}
      <Handle type="source" position={Position.Right} id={data.output.id} className="nc-handle nc-handle-table-out" />
    </div>
    {result?.error && <div className="nc-node-error">{result.error}</div>}
  </div>
})

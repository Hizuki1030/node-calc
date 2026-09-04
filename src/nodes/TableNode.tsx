import { memo, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useIncomingColor, useIncomingLabel, useNode, useNodeResult, useOutgoingLabel, useOutputColor } from '../store.tsx'
import { isTable, type TableInputDef, type TableOutputDef } from '../types.ts'
import { fmtNum } from '../format.ts'
import { useHandleSync } from './useHandleSync.ts'
import { NodeIcon } from '../components/NodeIcon.tsx'

/** 入力ポート 1 行。ネット名だけを個別に購読する。テキスト入力は数値と見分けがつくよう印を出す。 */
const TablePort = memo(function TablePort({ nodeId, port, currentText }: {
  nodeId: string; port: TableInputDef; currentText?: string
}) {
  const label = useIncomingLabel(nodeId, port.id)
  const color = useIncomingColor(nodeId, port.id)
  const isText = port.kind === 'text'
  return (
    <div className={`nc-table-port${isText ? ' is-text' : ''}`} style={{ '--nc-port': color } as CSSProperties}>
      <Handle type="target" position={Position.Left} id={port.id} className="nc-handle nc-handle-table" />
      <span>{port.name}</span>
      {isText
        ? <small className="nc-table-port-kind" title="テキスト入力（完全一致で検索）">Aa</small>
        : port.unit && <small>[{port.unit}]</small>}
      {isText && currentText && <em className="nc-table-port-value">"{currentText}"</em>}
      {label && <b className="nc-net-label nc-net-label-in">{label}</b>}
    </div>
  )
})

/** 出力ポート 1 行。複数の出力を持てる。 */
const TableOutputPort = memo(function TableOutputPort({ nodeId, port, digits, value, hasError }: {
  nodeId: string; port: TableOutputDef; digits: number; value: number | undefined; hasError: boolean
}) {
  const label = useOutgoingLabel(nodeId, port.id)
  const color = useOutputColor(nodeId, port.id)
  return (
    <div className="nc-table-output" style={{ '--nc-port': color } as CSSProperties}>
      <div><span>{port.name}</span>{port.unit && <small>[{port.unit}]</small>}</div>
      <strong className="nc-mono">{hasError ? '—' : fmtNum(value, digits)}</strong>
      {label && <span className="nc-net-label nc-net-label-out">{label}</span>}
      <Handle type="source" position={Position.Right} id={port.id} className="nc-handle nc-handle-table-out" />
    </div>
  )
})

/** CSVの数値表を複数入力から検索・補間するノード。出力は複数持てる。 */
export const TableNode = memo(function TableNode({ id, selected }: NodeProps) {
  const found = useNode(id)
  const result = useNodeResult(id)
  const node = found && isTable(found) ? found : null
  const handleSync = useHandleSync(id, node
    ? `${node.data.inputs.map((input) => input.id).join(',')}|${node.data.outputs.map((output) => output.id).join(',')}`
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
      {data.inputs.map((input) => (
        <TablePort key={input.id} nodeId={id} port={input} currentText={result?.texts[input.id]} />
      ))}
    </div>
    {data.outputs.map((output) => (
      <TableOutputPort
        key={output.id}
        nodeId={id}
        port={output}
        digits={data.digits}
        value={result?.outputs[output.id]}
        hasError={!!result?.error}
      />
    ))}
    {result?.error && <div className="nc-node-error">{result.error}</div>}
  </div>
})

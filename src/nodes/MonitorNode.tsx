import { memo, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { PORT_IDLE, useActions, useIncomingPorts, useNode, useNodeResult } from '../store.tsx'
import { inputPorts, isMonitor } from '../types.ts'
import { fmtNum } from '../format.ts'
import { useHandleSync } from './useHandleSync.ts'
import { NodeIcon } from '../components/NodeIcon.tsx'

const PIE_COLORS = ['#4cc9a7', '#8ab4ff', '#f0a35e', '#e05c6e', '#b79cff', '#5ed3e7', '#d6cb62', '#ef8fc5']

const EMPTY_PORTS: string[] = []

/** 単一値表示と、同じ単位の複数入力を比較する円グラフ。 */
export const MonitorNode = memo(function MonitorNode({ id, selected }: NodeProps) {
  const found = useNode(id)
  const result = useNodeResult(id)
  const { removeNode } = useActions()
  const node = found && isMonitor(found) ? found : null
  const ports = node ? inputPorts(node) : []
  const sources = useIncomingPorts(id, node ? ports.map((port) => port.id) : EMPTY_PORTS)
  const handleSync = useHandleSync(id, ports.map((port) => port.id).join(','))
  if (!node) return null
  const data = node.data
  const entries = ports.map((port, index) => {
    const source = sources[index]
    return {
      port,
      source,
      name: source.name || port.name,
      unit: source.unit,
      value: result?.inputs[port.id],
      // 円グラフの色も配線の色に合わせる。凡例と線をひと目で結び付けられる。
      color: source.connected ? source.color : PIE_COLORS[index % PIE_COLORS.length],
    }
  })
  const mode = data.mode ?? 'value'

  if (mode === 'value') {
    const entry = entries[0]
    return <div
      ref={handleSync}
      className={`nc-node nc-monitor${selected ? ' is-selected' : ''}`}
      style={{ '--nc-port': entry?.source.color ?? PORT_IDLE } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} id={entry?.port.id ?? 'in'} className="nc-handle nc-handle-monitor" />
      {entry?.source.label && <span className="nc-net-label nc-net-label-in">{entry.source.label}</span>}
      <div className="nc-monitor-head">
        <span className="nc-head-label"><NodeIcon kind="monitor" />{data.title}</span>
        <button className="nc-x nodrag" onClick={() => removeNode(id)} title="削除">×</button>
      </div>
      <div className="nc-monitor-value nc-mono">
        {result?.error ? '—' : fmtNum(entry?.value, data.digits)}
        {entry?.unit && <em>{entry.unit}</em>}
      </div>
    </div>
  }

  const connected = entries.filter((entry) => entry.source.connected)
  const units = [...new Set(connected.map((entry) => entry.unit))]
  const unitMismatch = units.length > 1
  const invalidValue = connected.some((entry) => !Number.isFinite(entry.value) || (entry.value ?? 0) < 0)
  const total = connected.reduce((sum, entry) => sum + Math.max(0, entry.value ?? 0), 0)
  let cursor = 0
  const stops = connected.map((entry) => {
    const start = cursor
    cursor += total > 0 ? ((entry.value ?? 0) / total) * 100 : 0
    return `${entry.color} ${start}% ${cursor}%`
  })
  const chartReady = !result?.error && !unitMismatch && !invalidValue && connected.length >= 2 && total > 0

  return <div ref={handleSync} className={`nc-node nc-monitor nc-monitor-pie${selected ? ' is-selected' : ''}`}>
    <div className="nc-monitor-head">
      <span className="nc-head-label"><NodeIcon kind="monitor" />{data.title}</span>
      <button className="nc-x nodrag" onClick={() => removeNode(id)} title="削除">×</button>
    </div>
    <div className="nc-monitor-port-list">
      {entries.map((entry) => <div className="nc-monitor-port" key={entry.port.id} style={{ '--nc-port': entry.source.color } as CSSProperties}>
        <Handle type="target" position={Position.Left} id={entry.port.id} className="nc-handle nc-handle-monitor" />
        <span>{entry.port.name}</span>
        {entry.source.label && <b className="nc-net-label nc-net-label-in">{entry.source.label}</b>}
      </div>)}
    </div>
    {unitMismatch && <div className="nc-monitor-warning">単位が一致しないため比較できません（{units.join(' / ')}）</div>}
    {!unitMismatch && invalidValue && <div className="nc-monitor-warning">円グラフには0以上の値だけを使用できます。</div>}
    {!unitMismatch && !invalidValue && result?.error && <div className="nc-monitor-warning">{result.error}</div>}
    {!result?.error && !unitMismatch && !invalidValue && total === 0 && <div className="nc-monitor-warning">合計が0のため円グラフを作れません。</div>}
    {chartReady && <div className="nc-pie-body">
      <div className="nc-pie-chart" style={{ background: `conic-gradient(from -90deg, ${stops.join(', ')})` }} role="img" aria-label={`${data.title}の円グラフ`}>
        <span><strong className="nc-mono">{fmtNum(total, data.digits)}</strong><small>{units[0] || '合計'}</small></span>
      </div>
      <div className="nc-pie-legend">
        {connected.map((entry) => <div key={entry.port.id}>
          <i style={{ background: entry.color }} />
          <span title={entry.name}>{entry.name}</span>
          <strong className="nc-mono">{fmtNum(entry.value, data.digits)}</strong>
        </div>)}
      </div>
    </div>}
  </div>
})

import { memo, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useIncomingColor, useIncomingLabel, useNameColors, useNameValues, useNode, useNodeResult, useOutgoingLabel, useOutputColor } from '../store.tsx'
import { isBlock, type CalcRow, type PortDef } from '../types.ts'
import { MathFormula } from './MathFormula.tsx'
import { useHandleSync } from './useHandleSync.ts'
import { NodeIcon } from '../components/NodeIcon.tsx'

/** 入力ポート 1 行。ネット名だけを個別に購読し、他の行の変化では描き直さない。 */
const InputRow = memo(function InputRow({ nodeId, port, hoverValue }: { nodeId: string; port: PortDef; hoverValue?: string }) {
  const label = useIncomingLabel(nodeId, port.id)
  const color = useIncomingColor(nodeId, port.id)
  return (
    <div className="nc-compact-port" style={{ '--nc-port': color } as CSSProperties} title={hoverValue}>
      <Handle type="target" position={Position.Left} id={port.id} className="nc-handle nc-handle-in" title={`${port.name} へ接続`} />
      <span className="nc-mono">{port.name}</span>{port.unit && <span className="nc-input-unit">[{port.unit}]</span>}
      {label && <span className="nc-net-label nc-net-label-in">{label}</span>}
    </div>
  )
})

/** 計算行 1 行。数式の組版は重いので、その行の式が変わったときだけ描き直す。 */
const CalcRowView = memo(function CalcRowView({ nodeId, calc, hasError, colors, values }: { nodeId: string; calc: CalcRow; hasError: boolean; colors: Record<string, string>; values: Record<string, string> }) {
  const label = useOutgoingLabel(nodeId, calc.id)
  const color = useOutputColor(nodeId, calc.id)
  return (
    <div
      style={{ '--nc-port': color } as CSSProperties}
      className={`nc-compact-formula${calc.expr.includes('/') ? ' has-fraction' : ''}${calc.expr.includes('^') ? ' has-power' : ''}${hasError ? ' has-error' : ''}`}
      title={`${calc.name} = ${calc.expr}`}
    >
      <MathFormula name={calc.name} expr={calc.expr} colors={colors} values={values} fit />
      {calc.unit && <span className="nc-compact-calc-unit">[{calc.unit}]</span>}
      {label && <span className="nc-net-label nc-net-label-out">{label}</span>}
      {calc.exposed && <Handle
        type="source"
        position={Position.Right}
        id={calc.id}
        className="nc-handle nc-handle-out"
        title={`${calc.name} からつなぐ（複数の結果へ分岐できます）`}
      />}
    </div>
  )
})

/** 計算ブロック。内部変数ごとの入力ポートを表示し、線が値の割り当てを表す。 */
export const BlockNode = memo(function BlockNode({ id, selected }: NodeProps) {
  const found = useNode(id)
  const res = useNodeResult(id)
  const node = found && isBlock(found) ? found : null
  const handleSync = useHandleSync(id, node
    ? `${node.data.inputs.map((item) => item.id).join(',')}|${node.data.calcs.filter((item) => item.exposed).map((item) => item.id).join(',')}`
    : '')
  // 式の中の変数を配線と同じ色で見せるための名前 → 色。フックなので条件分岐より前で呼ぶ。
  const nameColors = useNameColors(id, node?.data.inputs ?? [], node?.data.calcs ?? [])
  // 変数にカーソルを乗せたときに今の値を出すための名前 → 表示文字列。同じ理由で早期 return より前。
  const hoverValues = useNameValues(id, node?.data.inputs ?? [], node?.data.calcs ?? [])
  // プロジェクト切替直後は React Flow の旧 node type が1描画だけ残ることがある。
  // 同じ id の新ノードが別種類なら、同期が済むまで描画しない。
  if (!node) return null
  const d = node.data
  const longestFormula = d.calcs.reduce((longest, calc) => Math.max(longest, calc.name.length + calc.expr.length), 0)
  const longestInput = d.inputs.reduce((longest, input) => Math.max(longest, input.name.length + input.unit.length), 0)
  // タイトル・入力行・数式行、それぞれが必要とする最小幅の一番大きいものに合わせる。
  // 短い式のブロック（a+b くらい）まで一律に大きくしないよう、下限は低めに取る。
  const titleWidth = 56 + d.title.length * 9
  const formulaWidth = 210 + longestFormula * 4.5
  const inputWidth = d.inputs.length > 0 ? 170 + longestInput * 7 : 0
  const blockWidth = Math.min(820, Math.max(200, titleWidth, formulaWidth, inputWidth))
  const formulaSize = longestFormula > 150 ? 9.5 : longestFormula > 105 ? 10.5 : longestFormula > 70 ? 11.5 : 13
  const blockStyle = {
    '--nc-block-width': `${Math.round(blockWidth)}px`,
    '--nc-formula-size': `${formulaSize}px`,
  } as CSSProperties

  return (
    <div ref={handleSync} className={`nc-node nc-block nc-block-compact${selected ? ' is-selected' : ''}`} style={blockStyle}>
      <div className="nc-compact-title"><NodeIcon kind="block" />{d.title || '名称未設定'}</div>
      {d.inputs.length > 0 && <div className="nc-compact-inputs">
        {d.inputs.map((input) => <InputRow key={input.id} nodeId={id} port={input} hoverValue={hoverValues[input.name]} />)}
      </div>}
      <div className="nc-compact-formulas">
        {d.calcs.map((calc) => (
          <CalcRowView key={calc.id} nodeId={id} calc={calc} hasError={res?.rows[calc.id]?.error !== undefined} colors={nameColors} values={hoverValues} />
        ))}
      </div>
    </div>
  )
})

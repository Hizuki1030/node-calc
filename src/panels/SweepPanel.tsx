import { useCallback, useMemo, useState } from 'react'
import { shallowEqualArray, useStoreApi, useStoreSelector } from '../store.tsx'
import { isResult, isVariable, type CalcNode, type VariableData } from '../types.ts'
import { sweep } from '../engine/solve.ts'
import { SweepChart } from './SweepChart.tsx'
import { ValueSlider, type VariableNodeRef } from '../components/ValueSlider.tsx'
import { clamp, fmtNum } from '../format.ts'

/** 振っている変数について、曲線の形に効くのは現在値ではなく範囲だけ。 */
function rangeOf(node: CalcNode): string {
  const d = node.data as VariableData
  return `${d.min}/${d.max}/${d.step}`
}

/** スイープ: 1 つの変数を範囲いっぱいに振って、結果がどう動くかを見る。 */
export function SweepPanel() {
  const api = useStoreApi()
  const nodes = useStoreSelector(useCallback((store) => store.getGraph().nodes, []))
  const variables = nodes.filter((n): n is VariableNodeRef => isVariable(n) && n.data.sweep)
  const outputs = nodes.filter(isResult)

  const [xId, setXId] = useState('')
  const [yId, setYId] = useState('')
  const [steps, setSteps] = useState(200)

  const x = variables.find((n) => n.id === xId) ?? variables[0]
  const y = outputs.find((n) => n.id === yId) ?? outputs[0]

  // 振る変数の現在値は曲線の形を変えない。ここを依存に含めると、
  // 下のスライダーを 1 目盛り動かすたびに全点の再計算が走ってしまう。
  const curveInputs = useStoreSelector(
    useCallback((store) => {
      const graph = store.getGraph()
      const parts: unknown[] = [graph.edges]
      for (const node of graph.nodes) parts.push(node.id === x?.id ? rangeOf(node) : node.data)
      return parts
    }, [x?.id]),
    shallowEqualArray,
  )

  const samples = useMemo(
    () => (x && y ? sweep(api.getGraph(), x.id, y.id, x.data.min, x.data.max, steps) : []),
    // curveInputs は依存の中身そのもの。x/y/steps と合わせて曲線を決める。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, curveInputs, x?.id, y?.id, steps],
  )

  if (!variables.length) {
    return (
      <p className="nc-hint">
        スイープできる変数がありません。変数ノードの <code>sweep</code> を押して対象にしてください。
      </p>
    )
  }
  if (!outputs.length) {
    return <p className="nc-hint">結果ノードを 1 つ置いて、見たい値をつないでください。</p>
  }

  const d = x.data as VariableData

  return (
    <div className="nc-panel-body">
      <div className="nc-field-row">
        <label>振る変数</label>
        <select className="nc-select" value={x.id} onChange={(e) => setXId(e.target.value)}>
          {variables.map((n) => (
            <option key={n.id} value={n.id}>
              {n.data.title}
            </option>
          ))}
        </select>
      </div>
      <div className="nc-field-row">
        <label>見る結果</label>
        <select className="nc-select" value={y.id} onChange={(e) => setYId(e.target.value)}>
          {outputs.map((n) => (
            <option key={n.id} value={n.id}>
              {n.data.title}
            </option>
          ))}
        </select>
      </div>
      <div className="nc-field-row">
        <label>分割数</label>
        <input
          className="nc-num"
          type="number"
          min={10}
          max={2000}
          value={steps}
          onChange={(e) => setSteps(clamp(Number(e.target.value) || 10, 10, 2000))}
        />
      </div>

      <SweepChart
        samples={samples}
        target={y.data.target}
        current={d.value}
        xLabel={d.title}
        yLabel={y.data.title}
      />
      <p className="nc-legend">
        <span className="k-line" /> {y.data.title}
        {y.data.target !== null && (
          <>
            <span className="k-target" /> 目標 {fmtNum(y.data.target)}
          </>
        )}
        <span className="k-current" /> 現在値
      </p>

      <ValueSlider node={x} showEnds ariaLabel={`${d.title} を振る`} />
    </div>
  )
}

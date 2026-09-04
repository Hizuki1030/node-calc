import { memo, useCallback } from 'react'
import {
  shallowEqualArray,
  useActions,
  useIncomingUnit,
  useNode,
  useSelected,
  useStoreSelector,
} from '../store.tsx'
import { isBlock, isMonitor, isResult, isVariable, type BlockData, type CalcNode, type ResultData } from '../types.ts'
import { FUNCTION_HELP } from '../engine/functions.ts'
import { checkGraphUnits } from '../engine/units.ts'
import { clamp } from '../format.ts'
import { UnitPicker } from '../components/UnitPicker.tsx'
import { ValueSlider, type VariableNodeRef } from '../components/ValueSlider.tsx'
import { MonitorSettings } from './MonitorSettings.tsx'

/** 変数の範囲設定。 */
const VariableSettings = memo(function VariableSettings({ node }: { node: VariableNodeRef }) {
  const { patchVariable } = useActions()
  const d = node.data
  return (
    <>
      <h4 className="nc-sub">{d.title} の設定</h4>
      <div className="nc-field-row">
        <label>最小</label>
        <input
          className="nc-num"
          type="number"
          value={d.min}
          onChange={(e) => patchVariable(node.id, { min: Number(e.target.value) })}
        />
      </div>
      <div className="nc-field-row">
        <label>最大</label>
        <input
          className="nc-num"
          type="number"
          value={d.max}
          onChange={(e) => patchVariable(node.id, { max: Number(e.target.value) })}
        />
      </div>
      <div className="nc-field-row">
        <label>刻み</label>
        <input
          className="nc-num"
          type="number"
          value={d.step}
          onChange={(e) => patchVariable(node.id, { step: Number(e.target.value) })}
        />
      </div>
      <div className="nc-field-row">
        <label>単位 *</label>
        <UnitPicker value={d.unit ?? ''} onChange={(unit) => patchVariable(node.id, { unit })} ariaLabel={`${d.title}の単位`} />
      </div>
    </>
  )
})

/** 結果ノードの表示設定。単位は接続元から自動で取る。 */
const ResultSettings = memo(function ResultSettings({ node }: { node: CalcNode & { data: ResultData } }) {
  const { patchResult } = useActions()
  const unit = useIncomingUnit(node.id)
  const d = node.data
  return (
    <>
      <h4 className="nc-sub">{d.title} の設定</h4>
      <div className="nc-field-row">
        <label>単位</label>
        <span className="nc-unit">{unit || '—（接続元から自動取得）'}</span>
      </div>
      <div className="nc-field-row">
        <label>小数桁</label>
        <input
          className="nc-num"
          type="number"
          min={0}
          max={8}
          value={d.digits}
          onChange={(e) => patchResult(node.id, { digits: clamp(Number(e.target.value), 0, 8) })}
        />
      </div>
    </>
  )
})

/** 式の書き方の案内。内容は固定なので描き直さない。 */
const FormulaHelp = memo(function FormulaHelp() {
  return (
    <>
      <h4 className="nc-sub">式に使える関数</h4>
      <dl className="nc-fnlist">
        {FUNCTION_HELP.map((f) => (
          <div key={f.sig}>
            <dt className="nc-mono">{f.sig}</dt>
            <dd>{f.help}</dd>
          </div>
        ))}
      </dl>
      <p className="nc-hint">
        演算子は <code>+ - * / ^ %</code> と括弧。入力ポート名と、同じブロックの上の行の名前を
        <code>{'{変数名}'}</code> の形で書けます。
      </p>
    </>
  )
})

/** 選んだ計算ブロックのパラメーター。編集ポップアップと同じ項目を確認専用で並べる。 */
const BlockSettings = memo(function BlockSettings({ node }: { node: CalcNode & { data: BlockData } }) {
  const d = node.data
  // 単位チェックはグラフ全体で走る。ポップアップと同じ結果を出しつつ、
  // このノードの指摘が変わったときだけ描き直すよう、メッセージを畳んで購読する。
  const packedIssues = useStoreSelector(
    useCallback((store) => checkGraphUnits(store.getGraph()).issues
      .filter((issue) => issue.nodeId === node.id)
      .map((issue) => issue.message)
      .join('\n'), [node.id]),
  )
  const unitIssues = packedIssues ? packedIssues.split('\n') : []
  // 入力なし・計算1行のシンプルなブロックは、見出しを並べるより式を直接見せる。
  const simple = d.inputs.length === 0 && d.calcs.length === 1
  return (
    <>
      <h4 className="nc-sub">{d.title} のパラメーター</h4>
      {d.note && <p className="nc-hint">{d.note}</p>}
      {d.inputs.length > 0 && <section className="nc-block-params">
        <h5 className="nc-params-title">入力</h5>
        <div className="nc-param-list">
          {d.inputs.map((input) => (
            <div className="nc-param-row" key={input.id}>
              <span className="nc-param-main">
                <code className="nc-mono">{input.name}</code>
                {input.unit && <span className="nc-param-unit">[{input.unit}]</span>}
              </span>
            </div>
          ))}
        </div>
      </section>}
      {d.calcs.length > 0 && <section className="nc-block-params">
        {!simple && <h5 className="nc-params-title">計算</h5>}
        <div className="nc-param-list">
          {d.calcs.map((calc) => (
            <div className="nc-param-row" key={calc.id} title={`${calc.name} = ${calc.expr}`}>
              <span className="nc-param-main">
                <code className="nc-mono">{`{${calc.name}}`}</code>
                <span className="nc-param-eq">=</span>
                <code className="nc-param-expr nc-mono">{calc.expr}</code>
                {calc.unit && <span className="nc-param-unit">[{calc.unit}]</span>}
              </span>
              <span className={`nc-param-note${calc.exposed ? '' : ' is-off'}`}>{calc.exposed ? '● 外部へ出力' : '○ 内部計算'}</span>
            </div>
          ))}
        </div>
      </section>}
      {unitIssues.length > 0 && <section className="nc-unit-errors">
        <strong>単位チェック</strong>
        {unitIssues.map((message, index) => <p key={index}>{message}</p>)}
      </section>}
    </>
  )
})

/** 選んだノードの詳細と、全スイープ変数のスライダーをまとめた操作卓。 */
export function InspectorPanel() {
  const selected = useSelected()
  const node = useNode(selected ?? '')
  // スライダーの一覧は、変数の値が動いても顔ぶれが変わらない限り同じ配列を返す。
  const sliders = useStoreSelector(
    useCallback((store) => store.getGraph().nodes.filter(
      (n): n is VariableNodeRef => isVariable(n) && n.data.sweep && (n.data.mode ?? 'slider') === 'slider',
    ), []),
    shallowEqualArray,
  )

  return (
    <div className="nc-panel-body">
      {sliders.length > 0 && (
        <>
          <h4 className="nc-sub">変数</h4>
          {sliders.map((n) => <ValueSlider key={n.id} node={n} />)}
        </>
      )}

      {node && isVariable(node) && <VariableSettings node={node} />}
      {node && isResult(node) && <ResultSettings node={node} />}
      {node && isMonitor(node) && <MonitorSettings node={node} />}
      {node && isBlock(node) && <BlockSettings node={node} />}

      <FormulaHelp />
    </div>
  )
}

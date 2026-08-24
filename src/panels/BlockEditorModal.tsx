import { useEffect, useMemo, useState } from 'react'
import { useNameColors, useNameValues, useStore } from '../store.tsx'
import { isBlock, type BlockData } from '../types.ts'
import { FormulaEditor } from '../nodes/FormulaEditor.tsx'
import { checkGraphUnits } from '../engine/units.ts'
import { UnitPicker } from '../components/UnitPicker.tsx'
import { formatCalcProgram, parseCalcProgram } from '../engine/program.ts'
import { AiBlockDesigner } from './AiBlockDesigner.tsx'
import { ImeInput, ImeTextarea } from '../components/ImeField.tsx'

/** 選択中の計算ブロックだけを編集するポップアップ。 */
export function BlockEditorModal() {
  const {
    graph, selected, select, patchBlock, addInput, removeInput, renameInput,
    patchCalc, replaceCalculations, replaceBlockDefinition,
    saveBlockToLibrary, removeNode,
  } = useStore()
  const [calcProgram, setCalcProgram] = useState('')
  const [calcProgramError, setCalcProgramError] = useState('')
  const node = graph.nodes.find((n) => n.id === selected)
  const block = node && isBlock(node) ? node : null
  useEffect(() => {
    if (!block) return
    setCalcProgram(formatCalcProgram(block.data.inputs, block.data.calcs))
    setCalcProgramError('')
  }, [block?.id])
  const unitIssues = useMemo(() => selected
    ? checkGraphUnits(graph).issues.filter((issue) => issue.nodeId === selected)
    : [], [graph, selected])
  // 式の中の変数を配線と同じ色で見せるための名前 → 色。フックなので早期 return より前で呼ぶ。
  const nameColors = useNameColors(selected ?? '', block?.data.inputs ?? [], block?.data.calcs ?? [])
  // カーソルを乗せたときに今の値を出すための名前 → 表示文字列。同じ理由で早期 return より前。
  const nameValues = useNameValues(selected ?? '', block?.data.inputs ?? [], block?.data.calcs ?? [])
  if (!node || !isBlock(node)) return null
  const d = node.data as BlockData
  const requiredMissing = d.inputs.some((item) => !item.name.trim() || !item.unit?.trim())
    || d.calcs.some((item) => !item.name.trim() || !item.expr.trim() || !item.unit?.trim())
    || Boolean(calcProgramError)

  const updateInputUnit = (portId: string, unit: string) => patchBlock(node.id, {
    inputs: d.inputs.map((input) => input.id === portId ? { ...input, unit } : input),
  })

  const updateInputName = (portId: string, before: string, name: string) => {
    renameInput(node.id, portId, name)
    if (!before || before === name) return
    setCalcProgram((source) => source.split(`{${before}}`).join(`{${name}}`))
  }

  // FormulaEditor が打鍵の止まったところでまとめて渡してくるので、ここでは素直に反映する。
  const updateCalcProgram = (source: string) => {
    setCalcProgram(source)
    const parsed = parseCalcProgram(source)
    setCalcProgramError(parsed.error ?? '')
    if (!parsed.error) replaceCalculations(node.id, parsed.definitions)
  }

  return (
    <div className="nc-modal-backdrop" onMouseDown={() => select(null)}>
      <section className="nc-block-modal nodrag" role="dialog" aria-modal="true" aria-label="計算ブロックを編集" onMouseDown={(e) => e.stopPropagation()}>
        <header className="nc-modal-head">
          <div>
            <p>計算ブロックを編集</p>
            <ImeInput className="nc-modal-title" value={d.title} onCommit={(next) => patchBlock(node.id, { title: next })} aria-label="ブロック名" />
          </div>
          <button className="nc-x" onClick={() => select(null)} title="閉じる">×</button>
        </header>

        <ImeTextarea className="nc-textarea" rows={2} value={d.note ?? ''} placeholder="この計算の目的や前提（任意）" onCommit={(next) => patchBlock(node.id, { note: next })} />

        <AiBlockDesigner
          current={() => ({
            title: d.title,
            note: d.note,
            inputs: d.inputs.map(({ name, unit }) => ({ name, unit: unit ?? '' })),
            calcs: d.calcs.map(({ name, expr, unit, exposed }) => ({ name, expr, unit: unit ?? '', exposed })),
          })}
          onApply={(draft) => {
            replaceBlockDefinition(node.id, draft)
            setCalcProgram(formatCalcProgram(
              draft.inputs.map((input, index) => ({ id: `p${index}`, ...input })),
              draft.calcs.map((calc, index) => ({ id: `c${index}`, ...calc })),
            ))
            setCalcProgramError('')
          }}
        />

        <div className="nc-modal-columns">
          <section>
            <h4 className="nc-sub">入力 <small>名前と単位は必須</small></h4>
            <div className="nc-modal-stack">
              {d.inputs.map((p) => (
                <div className="nc-port-setting" key={p.id}>
                  <ImeInput className={`nc-text${!p.name.trim() ? ' is-required' : ''}`} value={p.name} placeholder="入力名 *" onCommit={(next) => updateInputName(p.id, p.name, next)} aria-label="内部変数名" required />
                  <UnitPicker value={p.unit ?? ''} onChange={(unit) => updateInputUnit(p.id, unit)} ariaLabel={`${p.name}の単位`} />
                  <button className="nc-x" onClick={() => removeInput(node.id, p.id)} title="入力ポートを削除">×</button>
                </div>
              ))}
              <button className="nc-btn nc-btn-ghost" onClick={() => addInput(node.id)}>＋ 入力を追加</button>
              <p className="nc-hint">入力ごとに左側の接続ポートができます。線をつなぐ値と単位を一致させてください。</p>
            </div>
          </section>

          <section>
            <h4 className="nc-sub">計算 <small>1行につき {'{結果名}'} = 数式</small></h4>
            <div className="nc-calc-stack">
              <FormulaEditor
                value={calcProgram}
                onChange={updateCalcProgram}
                references={[...d.inputs.map((input) => input.name), ...d.calcs.map((calc) => calc.name)].filter(Boolean)}
                colors={nameColors}
                values={nameValues}
                program
              />
              {calcProgramError && <p className="nc-program-error">{calcProgramError}</p>}
              <div className="nc-calc-settings">
                {d.calcs.map((calc) => <div className="nc-calc-setting-row" key={calc.id}>
                  <code>{`{${calc.name}}`}</code>
                  <UnitPicker value={calc.unit ?? ''} onChange={(unit) => patchCalc(node.id, calc.id, { unit })} ariaLabel={`${calc.name}の単位`} />
                  <button className={`nc-expose${calc.exposed ? ' is-on' : ''}`} onClick={() => patchCalc(node.id, calc.id, { exposed: !calc.exposed })}>{calc.exposed ? '● 外部へ出力' : '○ 内部計算'}</button>
                </div>)}
              </div>
              <p className="nc-hint">改行すると計算を追加できます。入力や上の行の結果は <code>{'{変数名}'}</code> で参照します。行を並べ替えると計算順も変わります。</p>
            </div>
          </section>
        </div>

        {unitIssues.length > 0 && <section className="nc-unit-errors">
          <strong>単位チェック</strong>
          {unitIssues.map((issue) => <p key={issue.key}>{issue.message}</p>)}
        </section>}

        <footer className="nc-modal-actions">
          <button className="nc-btn nc-btn-ghost" disabled={requiredMissing} onClick={() => saveBlockToLibrary(node.id)}>ライブラリへ保存</button>
          <button className="nc-btn nc-btn-danger" onClick={() => removeNode(node.id)}>削除</button>
          <button className="nc-btn nc-btn-primary" disabled={requiredMissing} title={requiredMissing ? '名前・式・単位の必須項目を入力してください' : undefined} onClick={() => select(null)}>完了</button>
        </footer>
      </section>
    </div>
  )
}

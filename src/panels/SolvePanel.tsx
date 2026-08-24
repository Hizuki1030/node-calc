import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.tsx'
import { connectedInputUnit, isResult, isVariable } from '../types.ts'
import { goalSeekAsync, solveCandidateCount, type SolveProgress, type SolveReport } from '../engine/solve.ts'
import { clamp, fmtNum, fmtStepNum } from '../format.ts'

/** 結果の目標値から、選んだパラメーターを自動で求める。 */
export function SolvePanel() {
  const { graph, patchVariable, patchResult } = useStore()
  const variables = graph.nodes.filter(isVariable).filter((node) => (node.data.mode ?? 'slider') === 'slider')
  const outputs = graph.nodes.filter(isResult)
  const [resultId, setResultId] = useState('')
  const [variableId, setVariableId] = useState('')
  const [report, setReport] = useState<SolveReport | null>(null)
  const [progress, setProgress] = useState<SolveProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const result = outputs.find((node) => node.id === resultId) ?? outputs[0]
  const variable = variables.find((node) => node.id === variableId) ?? variables[0]

  useEffect(() => {
    // 結果ノード側で目標値を変えた場合や、式・入力値・探索範囲が変わった場合に
    // 前回条件の答えを残さない。実行中ならその探索も止める。
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
    setProgress(null)
    setReport(null)
    return () => controllerRef.current?.abort()
  }, [graph])

  if (!result) return <div className="nc-panel-body"><p className="nc-hint">まず結果ノードを置いてください。</p></div>
  if (!variables.length) return <div className="nc-panel-body"><p className="nc-hint">逆算するパラメーターとして、スライダー形式の入力変数を1つ置いてください。</p></div>

  const cancelRun = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
    setProgress(null)
  }
  const resetRun = () => {
    cancelRun()
    setReport(null)
  }
  const run = async () => {
    if (result.data.target === null) return
    cancelRun()
    const controller = new AbortController()
    controllerRef.current = controller
    const total = solveCandidateCount(variable.data.min, variable.data.max, variable.data.step)
    const showProgress = total >= 500
    setReport(null)
    setBusy(true)
    setProgress(showProgress ? { completed: 0, total } : null)
    try {
      const next = await goalSeekAsync(graph, variable.id, result.id, result.data.target, variable.data.min, variable.data.max, {
        step: variable.data.step,
        prefer: variable.data.value,
        chunkSize: 500,
        signal: controller.signal,
        onProgress: showProgress ? setProgress : undefined,
      })
      if (!controller.signal.aborted) setReport(next)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setBusy(false)
        setProgress(null)
      }
    }
  }
  const apply = (value: number) => patchVariable(variable.id, {
    value: clamp(value, variable.data.min, variable.data.max),
  })
  const best = report?.best ?? null
  const exact = best && result.data.target !== null
    ? best.residual <= Math.max(1e-9, Math.abs(result.data.target) * 1e-9)
    : false

  return <div className="nc-panel-body">
    <p className="nc-note">パラメーターを設定済みの刻みで変化させ、結果が目標値に最も近くなる値を計算します。</p>
    <div className="nc-field-row">
      <label>結果</label>
      <select className="nc-select" value={result.id} onChange={(e) => { setResultId(e.target.value); resetRun() }}>
        {outputs.map((node) => <option key={node.id} value={node.id}>{node.data.title}</option>)}
      </select>
    </div>
    <div className="nc-field-row">
      <label>目標値</label>
      <input className="nc-num" type="number" value={result.data.target ?? ''} placeholder="例: 12000" onChange={(e) => { patchResult(result.id, { target: e.target.value === '' ? null : Number(e.target.value) }); resetRun() }} />
      <span className="nc-unit">{connectedInputUnit(graph, result.id)}</span>
    </div>
    <div className="nc-field-row">
      <label>求める値</label>
      <select className="nc-select" value={variable.id} onChange={(e) => { setVariableId(e.target.value); resetRun() }}>
        {variables.map((node) => <option key={node.id} value={node.id}>{node.data.title}</option>)}
      </select>
    </div>
    <div className="nc-field-row">
      <label>刻み幅</label>
      <input
        className="nc-num"
        type="number"
        min="0"
        step="any"
        value={variable.data.step}
        onChange={(e) => {
          patchVariable(variable.id, { step: Number(e.target.value) })
          resetRun()
        }}
        aria-label={`${variable.data.title}の逆算刻み幅`}
      />
      <span className="nc-unit">{variable.data.unit}</span>
    </div>
    <p className="nc-range-note">探索範囲: {fmtStepNum(variable.data.min, variable.data.step)} 〜 {fmtStepNum(variable.data.max, variable.data.step)}</p>
    <div className="nc-solve-actions">
      <button className="nc-btn nc-btn-solve" onClick={run} disabled={busy || result.data.target === null || variable.data.step <= 0}>{busy ? '計算中…' : '最も近い値を計算'}</button>
      {busy && <button className="nc-btn nc-btn-ghost" onClick={cancelRun}>中止</button>}
    </div>
    {progress && <div className="nc-solve-progress" role="status" aria-live="polite">
      <div><span>候補を計算中</span><strong>{Math.floor((progress.completed / progress.total) * 100)}%</strong></div>
      <progress value={progress.completed} max={progress.total} />
      <small>{progress.completed.toLocaleString('ja-JP')} / {progress.total.toLocaleString('ja-JP')} 件</small>
    </div>}
    {variable.data.step <= 0 && <p className="nc-warn">逆算する変数の「刻み」を 0 より大きく設定してください。</p>}
    {best && <section className="nc-inverse-answer">
      <strong className="nc-mono">{variable.data.title} = {fmtStepNum(best.x, variable.data.step)} {variable.data.unit}</strong>
      <p className={exact ? 'nc-hit' : 'nc-range-note'}>
        結果: {fmtNum(best.y, result.data.digits)} {connectedInputUnit(graph, result.id)}
        {exact ? '（目標に一致）' : `（差 ${best.y - result.data.target! > 0 ? '+' : ''}${fmtNum(best.y - result.data.target!, result.data.digits)}）`}
      </p>
      {report && report.equallyBestCount > 1 && <p className="nc-range-note">同じ近さの候補が {report.equallyBestCount.toLocaleString('ja-JP')} 個あるため、現在値に最も近い候補を表示しています。</p>}
      <button className="nc-btn nc-btn-primary" onClick={() => apply(best.x)}>この値を使う</button>
    </section>}
    {report && report.warnings.length > 0 && <section className={best ? '' : 'nc-inverse-answer'}>
      {report.warnings.map((warning) => <p className="nc-warn" key={warning}>{warning}</p>)}
    </section>}
  </div>
}

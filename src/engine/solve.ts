/** スイープと逆算。逆算はパラメーターの刻みに乗る候補だけを比較する。 */

import type { Graph } from '../types.ts'
import { evaluateGraph, resultValue } from './evaluate.ts'

export interface Sample {
  x: number
  y: number
}

/** 未知数を x に差し替えて結果ノードの値を返す関数を作る。 */
export function makeProbe(graph: Graph, unknownId: string, resultId: string): (x: number) => number {
  const overrides = new Map<string, number>()
  return (x: number) => {
    overrides.set(unknownId, x)
    return resultValue(evaluateGraph(graph, overrides), resultId)
  }
}

export function sweep(
  graph: Graph,
  unknownId: string,
  resultId: string,
  lo: number,
  hi: number,
  steps: number,
): Sample[] {
  const probe = makeProbe(graph, unknownId, resultId)
  const out: Sample[] = []
  const n = Math.max(2, Math.min(4000, Math.floor(steps)))
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n
    out.push({ x, y: probe(x) })
  }
  return out
}

export interface PointSolution {
  kind: 'point'
  x: number
  /** x を使ったときの結果 */
  y: number
  /** |f(x) - target| */
  residual: number
}

/** グラフ描画との互換用。刻み逆算は point のみを返す。 */
export interface RangeSolution {
  kind: 'range'
  lo: number
  hi: number
  pick: number
}

export type Solution = RangeSolution | PointSolution

export interface SolveOptions {
  /** 一致とみなす許容差 */
  tol?: number
  /** 未知数を変化させる刻み幅 */
  step?: number
  /** 同じ近さの候補が複数ある場合、この値に近いものを優先する */
  prefer?: number
}

export interface SolveReport {
  /** 採用をすすめる最良候補 */
  best: PointSolution | null
  /** 最良候補とまったく同じ差になった候補数 */
  equallyBestCount: number
  solutions: Solution[]
  warnings: string[]
  samples: Sample[]
}

export interface SolveProgress {
  completed: number
  total: number
}

export interface AsyncSolveOptions extends SolveOptions {
  signal?: AbortSignal
  onProgress?: (progress: SolveProgress) => void
  /** 何候補ごとに画面へ制御を戻すか */
  chunkSize?: number
}

/** min から max まで step ずつ動かすときの候補数。任意の上限は設けない。 */
export function solveCandidateCount(lo: number, hi: number, step: number): number {
  if (![lo, hi, step].every(Number.isFinite) || hi < lo || step <= 0) return 0
  return Math.floor((hi - lo) / step + 1e-10) + 1
}

interface ScanState {
  best: PointSolution | null
  equallyBestCount: number
  valid: number
  bad: number
}

function emptyScan(): ScanState {
  return { best: null, equallyBestCount: 0, valid: 0, bad: 0 }
}

function consider(state: ScanState, sample: Sample, target: number, prefer?: number): void {
  if (!Number.isFinite(sample.y)) {
    state.bad++
    return
  }
  state.valid++
  const candidate: PointSolution = { kind: 'point', x: sample.x, y: sample.y, residual: Math.abs(sample.y - target) }
  if (!state.best || candidate.residual < state.best.residual) {
    state.best = candidate
    state.equallyBestCount = 1
    return
  }
  if (candidate.residual !== state.best.residual) return
  state.equallyBestCount++
  if (prefer !== undefined && Math.abs(candidate.x - prefer) < Math.abs(state.best.x - prefer)) state.best = candidate
}

function invalidReport(message: string): SolveReport {
  return { best: null, equallyBestCount: 0, solutions: [], warnings: [message], samples: [] }
}

function finishScan(state: ScanState, tol: number, samples: Sample[]): SolveReport {
  const warnings: string[] = []
  if (!state.valid) warnings.push('探索範囲のどの候補でも結果を計算できませんでした。ノードの接続と式を確認してください。')
  if (state.bad > 0) warnings.push(`${state.bad} 個の候補で計算できなかったため、その値は除外しました。`)
  if (state.best && state.best.residual > tol) warnings.push('完全一致する候補がないため、目標値に最も近い値を選びました。')
  return {
    best: state.best,
    equallyBestCount: state.equallyBestCount,
    solutions: state.best ? [state.best] : [],
    warnings,
    samples,
  }
}

/**
 * 未知数を step ずつ変化させ、結果が目標値に最も近くなる候補を探す。
 * @param lo,hi 探索範囲（未知数ノードの min/max）
 */
export function goalSeek(
  graph: Graph,
  unknownId: string,
  resultId: string,
  target: number,
  lo: number,
  hi: number,
  opts: SolveOptions = {},
): SolveReport {
  const tol = opts.tol ?? Math.max(1e-9, Math.abs(target) * 1e-9)
  const step = opts.step ?? 0
  const probe = makeProbe(graph, unknownId, resultId)
  const samples: Sample[] = []

  if (hi < lo) {
    return invalidReport('探索範囲が空です。未知数ノードの min / max を確認してください。')
  }
  if (!Number.isFinite(step) || step <= 0) {
    return invalidReport('逆算するパラメーターの刻みを 0 より大きくしてください。')
  }
  const count = solveCandidateCount(lo, hi, step)
  if (!Number.isFinite(count)) return invalidReport('探索候補数を計算できません。最小・最大・刻みを確認してください。')

  const state = emptyScan()
  // lo を起点に step ずつ動かす。toPrecision で 0.1 刻み等の誤差を抑える。
  for (let index = 0; index < count; index++) {
    const x = Number((lo + index * step).toPrecision(15))
    const sample = { x, y: probe(x) }
    samples.push(sample)
    consider(state, sample, target, opts.prefer)
  }
  return finishScan(state, tol, samples)
}

/** 候補数に上限を設けず、小分けに評価して画面を応答可能なまま保つ。 */
export async function goalSeekAsync(
  graph: Graph,
  unknownId: string,
  resultId: string,
  target: number,
  lo: number,
  hi: number,
  opts: AsyncSolveOptions = {},
): Promise<SolveReport> {
  const step = opts.step ?? 0
  if (hi < lo) return invalidReport('探索範囲が空です。未知数ノードの min / max を確認してください。')
  if (!Number.isFinite(step) || step <= 0) return invalidReport('逆算するパラメーターの刻みを 0 より大きくしてください。')
  const total = solveCandidateCount(lo, hi, step)
  if (!Number.isFinite(total)) return invalidReport('探索候補数を計算できません。最小・最大・刻みを確認してください。')

  const tol = opts.tol ?? Math.max(1e-9, Math.abs(target) * 1e-9)
  const chunkSize = Math.max(1, Math.floor(opts.chunkSize ?? 200))
  const probe = makeProbe(graph, unknownId, resultId)
  const state = emptyScan()
  opts.onProgress?.({ completed: 0, total })

  for (let start = 0; start < total; start += chunkSize) {
    if (opts.signal?.aborted) throw new DOMException('探索を中止しました', 'AbortError')
    const end = Math.min(total, start + chunkSize)
    for (let index = start; index < end; index++) {
      const x = Number((lo + index * step).toPrecision(15))
      consider(state, { x, y: probe(x) }, target, opts.prefer)
    }
    opts.onProgress?.({ completed: end, total })
    if (end < total) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return finishScan(state, tol, [])
}

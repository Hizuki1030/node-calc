/** グラフの評価。
 *
 * variable → block → result の順に依存をたどり、各ブロックの中では計算行を
 * 上から順に評価する。行は自分より上の行と入力ポートを名前で参照できる。
 */

import {
  type CalcNode,
  type Graph,
  inputPorts,
  isBlock,
  isMonitor,
  isResult,
  isTable,
  isVariable,
  outputPorts,
} from '../types.ts'
import { blockRowFactors, blockRowUnits, inferAstUnit, tryParseUnit, unitRatio, type UnitValue } from './units.ts'
import { type Ast, FormulaError, parse } from './parser.ts'
import { FUNCTIONS, excelMod } from './functions.ts'
import { lookupTable } from './table.ts'

export interface RowResult {
  value: number
  error?: string
}

export interface NodeResult {
  /** ノード全体を評価できなかった理由（循環参照・入力未接続など） */
  error?: string
  /** 入力ポート id → 値 */
  inputs: Record<string, number>
  /** テキスト出力・テキスト入力ポート id → 値。テキスト変数と、テーブルのテキスト入力専用。
   *  数式や表示ノードには乗らない、完全一致検索専用の経路。 */
  texts: Record<string, string>
  /** 計算行 id → 結果 */
  rows: Record<string, RowResult>
  /** 出力ポート id → 値 */
  outputs: Record<string, number>
}

export type EvalResult = Map<string, NodeResult>

/* ---------------- 式の評価 ---------------- */

/** 表記が違うだけの同じ量（h と s など）を、右辺を左辺の表記へ揃えてから combine する演算子。 */
const UNIT_ALIGNED_OPS = new Set(['+', '-', '%', '>', '>=', '<', '<=', '=', '<>'])

/**
 * unitEnv を渡すと、+ - % や比較演算子で左右の表記が違うだけの同じ量（h と s など）を
 * 右辺 → 左辺の表記へ換算してから計算する。配線が mm↔m を自動換算するのと同じ考え方で、
 * 式の中の生の数値どうしを取り違えて足さないようにする。単位が決まらない場合はそのまま計算する。
 */
export function evalAst(ast: Ast, env: Map<string, number>, unitEnv?: Map<string, UnitValue>): number {
  switch (ast.t) {
    case 'num':
      return ast.v
    case 'ref': {
      const v = env.get(ast.name)
      if (v === undefined) throw new FormulaError(`${ast.name} が見つかりません`)
      return v
    }
    case 'neg':
      return -evalAst(ast.x, env, unitEnv)
    case 'bin': {
      const a = evalAst(ast.l, env, unitEnv)
      let b = evalAst(ast.r, env, unitEnv)
      if (unitEnv && UNIT_ALIGNED_OPS.has(ast.op)) {
        try {
          const left = inferAstUnit(ast.l, unitEnv)
          const right = inferAstUnit(ast.r, unitEnv)
          const ratio = unitRatio(right.label, left.label)
          if (ratio !== 1) b *= ratio
        } catch {
          // 単位が決まらない式は換算せず、そのまま数値だけで計算する。
        }
      }
      switch (ast.op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b
        case '/':
          if (b === 0) throw new FormulaError('0 で割っています')
          return a / b
        case '^':
          return Math.pow(a, b)
        case '%':
          return excelMod(a, b)
        case '>':
          return a > b ? 1 : 0
        case '>=':
          return a >= b ? 1 : 0
        case '<':
          return a < b ? 1 : 0
        case '<=':
          return a <= b ? 1 : 0
        case '=':
          return a === b ? 1 : 0
        case '<>':
          return a !== b ? 1 : 0
      }
      break
    }
    case 'call': {
      const def = FUNCTIONS[ast.name]
      if (!def) throw new FormulaError(`${ast.name} という関数はありません`)
      if (ast.args.length < def.min || ast.args.length > def.max) {
        throw new FormulaError(`${ast.name} の引数の数が違います（${def.sig}）`)
      }
      return def.fn(...ast.args.map((a) => evalAst(a, env, unitEnv)))
    }
  }
  throw new FormulaError('評価できません')
}

/* ---------------- グラフの評価 ---------------- */

function emptyResult(): NodeResult {
  return { inputs: {}, texts: {}, rows: {}, outputs: {} }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 前回の評価結果を持ち越すための入れ物。
 * ノードの data 参照と入力値が前回と変わっていなければ計算をやり直さず、
 * 同じ NodeResult オブジェクトをそのまま返す。参照が保たれるので、
 * 画面側は「このノードは変わっていない」を === で判定して再描画を省ける。
 */
export interface EvalCache {
  nodes: Map<string, CalcNode>
  signatures: Map<string, string>
  results: EvalResult
}

export function createEvalCache(): EvalCache {
  return { nodes: new Map(), signatures: new Map(), results: new Map() }
}

/** 入力値と上流の状態を 1 本の文字列にまとめたもの。これが同じなら結果も同じ。 */
function signatureOf(node: CalcNode, r: NodeResult, upstreamBroken: boolean, missing: string[]): string {
  let signature = upstreamBroken ? '!' : ''
  signature += missing.join('')
  for (const port of inputPorts(node)) signature += `${port.id}=${r.inputs[port.id] ?? r.texts[port.id] ?? ''}`
  return signature
}

/**
 * グラフ全体を評価する。
 * @param overrides variable ノードの値を差し替える（スイープ・逆算で使う）
 * @param cache 前回の評価結果。渡すと変化のないノードの計算を省く
 */
export function evaluateGraph(graph: Graph, overrides?: Map<string, number>, cache?: EvalCache): EvalResult {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const signatures = new Map<string, string>()
  /** 接続先 `${nodeId}/${portId}` → 接続元と、表記をそろえるための倍率 */
  const incoming = new Map<string, { source: string; sourcePort: string; ratio: number }>()
  for (const e of graph.edges) {
    // 同じ量なら表記が違ってもつなげる。値は接続先の表記へ直して渡す（mm → m なら 1/1000）。
    const source = byId.get(e.source)
    const target = byId.get(e.target)
    const from = source && outputPorts(source).find((port) => port.id === e.sourcePort)?.unit
    const to = target && inputPorts(target).find((port) => port.id === e.targetPort)?.unit
    incoming.set(`${e.target}/${e.targetPort}`, {
      source: e.source,
      sourcePort: e.sourcePort,
      ratio: from && to ? unitRatio(from, to) : 1,
    })
  }

  const results: EvalResult = new Map()
  const state = new Map<string, 'visiting' | 'done'>()

  function visit(id: string): NodeResult {
    const cached = results.get(id)
    if (cached && state.get(id) === 'done') return cached
    if (state.get(id) === 'visiting') {
      const r = emptyResult()
      r.error = '循環参照です'
      results.set(id, r)
      state.set(id, 'done')
      return r
    }
    const node = byId.get(id)
    if (!node) {
      const r = emptyResult()
      r.error = 'ノードが見つかりません'
      return r
    }
    state.set(id, 'visiting')
    const r = compute(node)
    results.set(id, r)
    state.set(id, 'done')
    return r
  }

  function inputValue(node: CalcNode, portId: string): number | { missing: true } | { cyclic: true } {
    const src = incoming.get(`${node.id}/${portId}`)
    if (!src) return { missing: true }
    const up = visit(src.source)
    if (up.error) return { cyclic: true }
    const v = up.outputs[src.sourcePort]
    if (v === undefined) return { missing: true }
    return src.ratio === 1 ? v : v * src.ratio
  }

  /** テキスト値（テーブルのテキスト入力・テキスト変数専用）を接続元からたどる。単位換算はしない。 */
  function inputText(node: CalcNode, portId: string): string | { missing: true } | { cyclic: true } {
    const src = incoming.get(`${node.id}/${portId}`)
    if (!src) return { missing: true }
    const up = visit(src.source)
    if (up.error) return { cyclic: true }
    const v = up.texts[src.sourcePort]
    if (v === undefined) return { missing: true }
    return v
  }

  function compute(node: CalcNode): NodeResult {
    const r = emptyResult()

    if (isVariable(node)) {
      if ((node.data.mode ?? 'slider') === 'text') {
        r.texts.out = node.data.text ?? ''
        return r
      }
      const v = overrides?.get(node.id) ?? node.data.value
      r.outputs.out = v
      return r
    }

    // テーブルのテキスト入力（完全一致検索用）は数値パイプラインに乗らないため、
    // 通常の入力解決から除いて別に扱う。
    const textPortIds = isTable(node)
      ? new Set(node.data.inputs.filter((input) => input.kind === 'text').map((input) => input.id))
      : null

    const missing: string[] = []
    let upstreamBroken = false
    for (const p of inputPorts(node)) {
      if (textPortIds?.has(p.id)) continue
      const v = inputValue(node, p.id)
      if (typeof v === 'number') {
        r.inputs[p.id] = v
      } else if ('cyclic' in v) {
        upstreamBroken = true
      } else {
        missing.push(p.name)
      }
    }
    if (textPortIds?.size) {
      for (const p of inputPorts(node)) {
        if (!textPortIds.has(p.id)) continue
        const v = inputText(node, p.id)
        if (typeof v === 'string') {
          r.texts[p.id] = v
        } else if ('cyclic' in v) {
          upstreamBroken = true
        } else {
          missing.push(p.name)
        }
      }
    }

    // 入力の解決までは毎回やる（軽い）。重いのはこの先の式評価とテーブル引き当てで、
    // ノードの定義と入力値が前回と同じならそこは丸ごと省ける。
    if (cache) {
      const signature = signatureOf(node, r, upstreamBroken, missing)
      signatures.set(node.id, signature)
      if (cache.nodes.get(node.id) === node && cache.signatures.get(node.id) === signature) {
        const hit = cache.results.get(node.id)
        if (hit) return hit
      }
    }

    if (isResult(node)) {
      if (upstreamBroken) r.error = '上流にエラーがあります'
      else if (missing.length) r.error = '未接続です'
      else r.outputs.in = r.inputs.in
      return r
    }

    if (isMonitor(node)) {
      const ports = inputPorts(node)
      if (upstreamBroken) r.error = '上流にエラーがあります'
      else if (missing.length) r.error = `未接続: ${missing.join(', ')}`
      else {
        for (const port of ports) r.outputs[port.id] = r.inputs[port.id]
        if (ports[0]) r.outputs.in = r.inputs[ports[0].id]
      }
      return r
    }

    if (isTable(node)) {
      if (upstreamBroken) r.error = '上流にエラーがあります'
      else if (missing.length) r.error = `未接続: ${missing.join(', ')}`
      else if (!node.data.rows.length) r.error = 'CSVデータを読み込んでください'
      else {
        try {
          const values = node.data.inputs.map((input) =>
            input.kind === 'text' ? r.texts[input.id] : r.inputs[input.id])
          const lookup = lookupTable(node.data, values)
          node.data.outputs.forEach((output, index) => {
            r.outputs[output.id] = lookup.values[index]
            r.rows[output.id] = { value: lookup.values[index] }
          })
        } catch (error) {
          r.error = messageOf(error)
        }
      }
      return r
    }

    if (!isBlock(node)) return r

    const env = new Map<string, number>()
    // 式の中で h と s のように表記だけ違う同じ量を足し引きできるよう、名前ごとの
    // 単位も並行して持たせる（evalAst が右辺を左辺の表記へ揃えるのに使う）。
    const unitEnv = new Map<string, UnitValue>()
    for (const p of node.data.inputs) {
      const v = r.inputs[p.id]
      if (v !== undefined) env.set(p.name, v)
      const u = tryParseUnit(p.unit)
      if (u) unitEnv.set(p.name, u)
    }

    // 入力欄は式で使うものだけが必須。使っていない入力が残っているだけで
    // ブロック全体を未接続にすると、定数式や入力を整理中の式まで結果に渡せない。
    if (upstreamBroken) r.error = '上流にエラーがあります'

    // 式は入力に書かれた表記のまま計算し、行の出口で指定表記へ直す。
    const factors = blockRowFactors(node.data)
    const rowUnits = blockRowUnits(node.data)
    for (const [index, row] of node.data.calcs.entries()) {
      let res: RowResult
      try {
        const ast = parse(row.expr)
        const v = evalAst(ast, env, unitEnv) * factors[index]
        if (!Number.isFinite(v)) {
          res = { value: NaN, error: Number.isNaN(v) ? '数値になりません' : '値が無限大です' }
        } else {
          res = { value: v }
          env.set(row.name, v)
          const u = rowUnits[index]
          if (u) unitEnv.set(row.name, u)
        }
      } catch (e) {
        res = { value: NaN, error: messageOf(e) }
      }
      r.rows[row.id] = res
      if (row.exposed && res.error === undefined) r.outputs[row.id] = res.value
    }

    // 未接続の入力を実際に参照した場合は、行ごとのエラーに加えてブロックにも
    // 理由を出す。未使用の入力はここには含めない。
    if (!r.error) {
      const referencedMissing = missing.filter((name) =>
        Object.values(r.rows).some((row) => row.error?.includes(`${name} が見つかりません`)),
      )
      if (referencedMissing.length) r.error = `未接続: ${referencedMissing.join(', ')}`
    }
    return r
  }

  for (const n of graph.nodes) visit(n.id)

  if (cache) {
    cache.nodes = byId
    cache.signatures = signatures
    cache.results = results
  }
  return results
}

/** result ノードの現在値。評価できなければ NaN。 */
export function resultValue(res: EvalResult, nodeId: string): number {
  const r = res.get(nodeId)
  if (!r || r.error) return NaN
  const v = r.outputs.in
  return v === undefined ? NaN : v
}

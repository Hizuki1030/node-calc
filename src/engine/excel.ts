/** グラフを Excel シートの行に落とす。
 *
 * 1 ノード = 1 セクション（見出し行 + そのノードの計算行）。
 * 「計算過程ごとに分けて」出したいので、中間計算も 1 行 1 セルとして残す。
 *
 * 列の役割:
 *   A 名前 / B 値または数式 / C 元の式（名前のまま・参考表示） / D 単位・メモ
 * B に数式を入れるのが要点で、こうしないと入力セルを書き換えたときに
 * 下流のセルが追従しない。C は「その行が何を計算しているか」を人が読むための列。
 *
 * Excel の癖への対応:
 *  - Excel の単項マイナスは ^ より強く、=-2^2 は 4 になる。本ツールは -4 と評価するので
 *    生成時に必ず括弧を付けて食い違いを防ぐ。
 *  - Excel の % は後置のパーセント演算子。剰余は MOD() に書き換える。
 */

import {
  type CalcNode,
  type Graph,
  connectedInputUnit,
  inputPorts,
  isBlock,
  isResult,
  isTable,
  isVariable,
} from '../types.ts'
import type { EvalResult } from './evaluate.ts'
import { FUNCTIONS } from './functions.ts'
import { type Ast, parse } from './parser.ts'

export type RowStyle = 'title' | 'section' | 'variable' | 'input' | 'calc' | 'output' | 'result' | 'blank'

export interface SheetRow {
  /** 1 始まりの行番号 */
  row: number
  style: RowStyle
  /** A 列: 名前 */
  name?: string
  /** B 列: 定数として置く値（formula がある行では使わない） */
  value?: number
  /** B 列: 数式（先頭の = は含まない）。ここが Excel 上の生きたセルになる */
  formula?: string
  /** B 列に入れるキャッシュ値。Excel が開いた瞬間に再計算する */
  cached?: number
  /** C 列: 元の式や参照元の説明 */
  source?: string
  /** D 列: 単位・メモ */
  note?: string
}

export interface SheetPlan {
  rows: SheetRow[]
  warnings: string[]
}

/* ---------------- AST → Excel 式 ---------------- */

export function astToExcel(ast: Ast, resolve: (name: string) => string | null): string {
  switch (ast.t) {
    case 'num':
      return String(ast.v)
    case 'ref':
      return resolve(ast.name) ?? '#REF!'
    case 'neg':
      return `(-${astToExcel(ast.x, resolve)})`
    case 'bin': {
      const l = astToExcel(ast.l, resolve)
      const r = astToExcel(ast.r, resolve)
      if (ast.op === '%') return `MOD(${l},${r})`
      return `(${l}${ast.op}${r})`
    }
    case 'call': {
      const name = FUNCTIONS[ast.name]?.excel ?? ast.name
      return `${name}(${ast.args.map((a) => astToExcel(a, resolve)).join(',')})`
    }
  }
}

/* ---------------- 並び順 ---------------- */

/** 依存順にノードを並べる。循環があっても落ちないよう残りは末尾に付ける。 */
export function topoOrder(graph: Graph): CalcNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const deps = new Map<string, Set<string>>(graph.nodes.map((n) => [n.id, new Set<string>()]))
  for (const e of graph.edges) {
    if (byId.has(e.source) && byId.has(e.target)) deps.get(e.target)!.add(e.source)
  }
  const out: CalcNode[] = []
  const placed = new Set<string>()
  let progress = true
  while (progress) {
    progress = false
    for (const n of graph.nodes) {
      if (placed.has(n.id)) continue
      if ([...deps.get(n.id)!].every((x) => placed.has(x))) {
        out.push(n)
        placed.add(n.id)
        progress = true
      }
    }
  }
  for (const n of graph.nodes) if (!placed.has(n.id)) out.push(n)
  return out
}

/* ---------------- シート組み立て ---------------- */

const VALUE_COL = 'B'

function ref(row: number): string {
  return `$${VALUE_COL}$${row}`
}

/**
 * グラフを行の並びに変換する。
 * @param results 画面上の評価結果。数式セルのキャッシュ値として使う
 */
export function buildSheet(graph: Graph, results: EvalResult): SheetPlan {
  const rows: SheetRow[] = []
  const warnings: string[] = []
  /** `${nodeId}/${portId}` → セル参照 */
  const cellOf = new Map<string, string>()
  /** `${nodeId}/${portId}` → 表示名（C 列の説明用） */
  const labelOf = new Map<string, string>()
  const order = topoOrder(graph)

  let row = 0
  const push = (r: Omit<SheetRow, 'row'>): number => {
    row++
    rows.push({ ...r, row })
    return row
  }

  push({
    style: 'title',
    name: 'node-calc',
    source: '入力変数（青い行）を書き換えると下の計算が追従します',
    note: new Date().toLocaleString('ja-JP'),
  })
  push({ style: 'blank' })

  const variables = order.filter(isVariable)
  if (variables.length) {
    push({ style: 'section', name: '■ 入力変数' })
    for (const n of variables) {
      const r = push({
        style: 'variable',
        name: n.data.title,
        value: results.get(n.id)?.outputs.out ?? n.data.value,
        source: `範囲 ${n.data.min} 〜 ${n.data.max}`,
        note: n.data.unit,
      })
      cellOf.set(`${n.id}/out`, ref(r))
      labelOf.set(`${n.id}/out`, n.data.title)
    }
    push({ style: 'blank' })
  }

  for (const n of order) {
    if (isTable(n)) {
      push({ style: 'section', name: `■ ${n.data.title}`, note: `${n.data.sourceName ?? 'CSV'} / ${n.data.mode === 'nearest' ? '最近傍' : '補間'}` })
      const res = results.get(n.id)
      for (const input of n.data.inputs) {
        const edge = graph.edges.find((item) => item.target === n.id && item.targetPort === input.id)
        const key = edge ? `${edge.source}/${edge.sourcePort}` : ''
        const srcCell = edge ? cellOf.get(key) : undefined
        push({
          style: 'input',
          name: input.name,
          formula: srcCell,
          cached: res?.inputs[input.id],
          source: srcCell ? `← ${labelOf.get(key) ?? srcCell}` : undefined,
          note: input.unit || (srcCell ? undefined : '未接続'),
        })
        if (!srcCell) warnings.push(`${n.data.title}: 入力「${input.name}」が未接続です`)
      }
      const outputRow = push({
        style: 'output',
        name: n.data.output.name,
        value: res?.outputs[n.data.output.id],
        source: `${n.data.rows.length}行のCSVテーブル / ${n.data.mode === 'nearest' ? '最近傍' : '連続補間'}`,
        note: n.data.output.unit,
      })
      cellOf.set(`${n.id}/${n.data.output.id}`, ref(outputRow))
      labelOf.set(`${n.id}/${n.data.output.id}`, n.data.output.name)
      warnings.push(`${n.data.title}: CSVテーブル変換はExcel上では書き出し時の値に固定されます`)
      push({ style: 'blank' })
      continue
    }
    if (!isBlock(n)) continue
    push({ style: 'section', name: `■ ${n.data.title}`, note: n.data.note })
    const res = results.get(n.id)
    /** ブロック内の名前 → セル参照 */
    const local = new Map<string, string>()

    for (const p of inputPorts(n)) {
      const edge = graph.edges.find((e) => e.target === n.id && e.targetPort === p.id)
      const key = edge ? `${edge.source}/${edge.sourcePort}` : ''
      const srcCell = edge ? cellOf.get(key) : undefined
      const r = push({
        style: 'input',
        name: p.name,
        formula: srcCell,
        cached: res?.inputs[p.id],
        source: srcCell ? `← ${labelOf.get(key) ?? srcCell}` : undefined,
        note: srcCell ? undefined : '未接続',
      })
      if (!srcCell) warnings.push(`${n.data.title}: 入力「${p.name}」が未接続です`)
      local.set(p.name, ref(r))
      cellOf.set(`${n.id}/${p.id}`, ref(r))
      labelOf.set(`${n.id}/${p.id}`, p.name)
    }

    for (const c of n.data.calcs) {
      const rr = res?.rows[c.id]
      let formula = ''
      try {
        formula = astToExcel(parse(c.expr), (name) => local.get(name) ?? null)
      } catch {
        warnings.push(`${n.data.title}: 「${c.name}」の式を読めませんでした（${c.expr}）`)
      }
      if (formula.includes('#REF!')) {
        warnings.push(`${n.data.title}: 「${c.name}」に未定義の名前があります`)
        formula = ''
      }
      const r = push({
        style: c.exposed ? 'output' : 'calc',
        name: c.name,
        formula: formula || undefined,
        value: formula ? undefined : Number.NaN,
        cached: rr && !rr.error ? rr.value : undefined,
        source: `= ${c.expr}`,
        note: c.unit ?? rr?.error,
      })
      local.set(c.name, ref(r))
      cellOf.set(`${n.id}/${c.id}`, ref(r))
      labelOf.set(`${n.id}/${c.id}`, c.name)
    }
    push({ style: 'blank' })
  }

  const outputs = order.filter(isResult)
  if (outputs.length) {
    push({ style: 'section', name: '■ 結果' })
    for (const n of outputs) {
      const edge = graph.edges.find((e) => e.target === n.id && e.targetPort === 'in')
      const key = edge ? `${edge.source}/${edge.sourcePort}` : ''
      const srcCell = edge ? cellOf.get(key) : undefined
      const note = [connectedInputUnit(graph, n.id), n.data.target !== null ? `目標 ${n.data.target}` : undefined]
        .filter(Boolean)
        .join(' / ')
      push({
        style: 'result',
        name: n.data.title,
        formula: srcCell,
        cached: results.get(n.id)?.outputs.in,
        source: srcCell ? `← ${labelOf.get(key) ?? srcCell}` : undefined,
        note: note || undefined,
      })
      if (!srcCell) warnings.push(`結果「${n.data.title}」が未接続です`)
    }
  }

  return { rows, warnings }
}

/** プレビューやクリップボード用の TSV。 */
export function sheetToTsv(plan: SheetPlan): string {
  return plan.rows
    .map((r) =>
      [
        r.name ?? '',
        r.formula ? `=${r.formula}` : r.value !== undefined && Number.isFinite(r.value) ? String(r.value) : '',
        r.source ?? '',
        r.note ?? '',
      ].join('\t'),
    )
    .join('\n')
}

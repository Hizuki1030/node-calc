import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'

import { parse } from '../src/engine/parser.ts'
import { createEvalCache, evalAst, evaluateGraph, resultValue } from '../src/engine/evaluate.ts'
import { astToExcel, buildSheet, sheetToTsv } from '../src/engine/excel.ts'
import { goalSeek, goalSeekAsync, solveCandidateCount, sweep } from '../src/engine/solve.ts'
import { segments } from '../src/engine/preview.ts'
import { buildXlsx } from '../src/export/xlsx.ts'
import { iotBatteryGraph, sampleGraph } from '../src/library/presets.ts'
import { blockRowFactors, checkGraphUnits, convertValue, inferAstUnit, parseUnit, sameUnit, unitRatio } from '../src/engine/units.ts'
import { connectedInputUnit, type BlockData, type Graph, type ResultData, type VariableData } from '../src/types.ts'
import { formatCalcProgram, parseCalcProgram } from '../src/engine/program.ts'
import { digitsForStep, fmtNum, fmtStepNum } from '../src/format.ts'
import { normalizeGraph } from '../src/library/storage.ts'
import { lookupTable, parseNumericTable, splitHeaderUnit } from '../src/engine/table.ts'
import type { TableData } from '../src/types.ts'

const env = (o: Record<string, number>) => new Map(Object.entries(o))
const ev = (src: string, o: Record<string, number> = {}) => evalAst(parse(src), env(o))

test('四則と優先順位', () => {
  assert.equal(ev('1+2*3'), 7)
  assert.equal(ev('(1+2)*3'), 9)
  assert.equal(ev('2^3^2'), 512) // 右結合
  assert.equal(ev('-2^2'), -4) // 数学の慣習（Excel へは括弧付きで出す）
  assert.equal(ev('7%3'), 1)
  assert.equal(ev('a*b', { a: 3, b: 4 }), 12)
})

test('日本語の識別子が使える', () => {
  assert.equal(ev('全長mm/板幅mm', { 全長mm: 3000, 板幅mm: 500 }), 6)
  assert.equal(ev('{全長 mm}/{板幅 mm}', { '全長 mm': 3000, '板幅 mm': 500 }), 6)
})

test('複数行の計算プログラムを {結果名} = 数式 として解析できる', () => {
  const parsed = parseCalcProgram('{面積} = {幅}*{高さ}\n{価格} = {面積}*{単価}')
  assert.equal(parsed.error, undefined)
  assert.deepEqual(parsed.definitions, [
    { name: '面積', expr: '{幅}*{高さ}' },
    { name: '価格', expr: '{面積}*{単価}' },
  ])
  assert.match(parseCalcProgram('{面積} {幅}*{高さ}').error!, /1行目/)
  assert.match(parseCalcProgram('{面積} = 1\n{面積} = 2').error!, /重複/)
})

test('既存の計算行を波括弧記法のプログラムへ変換できる', () => {
  const source = formatCalcProgram(
    [{ id: 'width', name: '幅', unit: 'mm' }],
    [
      { id: 'area', name: '面積', expr: '幅*幅', unit: 'mm^2', exposed: false },
      { id: 'double', name: '面積2倍', expr: '面積*2', unit: 'mm^2', exposed: true },
    ],
  )
  assert.equal(source, '{面積} = {幅}*{幅}\n{面積2倍} = {面積}*2')
})

test('式で使わない未接続入力は結果を止めない', () => {
  const g: Graph = {
    nextId: 4,
    nodes: [
      { id: 'v', kind: 'variable', x: 0, y: 0, data: { title: 'x', value: 7, min: 0, max: 10, step: 1, sweep: true } },
      {
        id: 'b', kind: 'block', x: 0, y: 0,
        data: {
          title: '計算',
          inputs: [{ id: 'used', name: 'x' }, { id: 'unused', name: '使わない入力' }],
          calcs: [{ id: 'out', name: '答え', expr: 'x*2', exposed: true }],
        },
      },
      { id: 'r', kind: 'result', x: 0, y: 0, data: { title: '結果', target: null, digits: 3 } },
    ],
    edges: [
      { id: 'e1', source: 'v', sourcePort: 'out', target: 'b', targetPort: 'used' },
      { id: 'e2', source: 'b', sourcePort: 'out', target: 'r', targetPort: 'in' },
    ],
  }
  const results = evaluateGraph(g)
  assert.equal(results.get('b')?.error, undefined)
  assert.equal(results.get('r')?.outputs.in, 14)
})

test('モニターノードは入力値をそのまま表示用出力へ渡す', () => {
  const g: Graph = {
    nextId: 3,
    nodes: [
      { id: 'v', kind: 'variable', x: 0, y: 0, data: { title: '温度', value: 23.5, min: 0, max: 100, step: 0.1, sweep: true, unit: '℃' } },
      { id: 'm', kind: 'monitor', x: 0, y: 0, data: { title: 'モニター', digits: 1 } },
    ],
    edges: [{ id: 'e', source: 'v', sourcePort: 'out', target: 'm', targetPort: 'in' }],
  }
  assert.equal(evaluateGraph(g).get('m')?.outputs.in, 23.5)
})

test('円グラフモニターは複数入力を評価し、異なる単位を拒否する', () => {
  const g: Graph = {
    nextId: 4,
    nodes: [
      { id: 'a', kind: 'variable', x: 0, y: 0, data: { title: '通信', value: 30, min: 0, max: 100, step: 1, sweep: true, unit: 'mA' } },
      { id: 'b', kind: 'variable', x: 0, y: 0, data: { title: '待機', value: 70, min: 0, max: 100, step: 1, sweep: true, unit: 'mA' } },
      {
        id: 'm', kind: 'monitor', x: 0, y: 0,
        data: {
          title: '消費電流の割合', digits: 1, mode: 'pie',
          inputs: [{ id: 'p1', name: '入力1', unit: '' }, { id: 'p2', name: '入力2', unit: '' }],
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'a', sourcePort: 'out', target: 'm', targetPort: 'p1', label: 'ACTIVE' },
      { id: 'e2', source: 'b', sourcePort: 'out', target: 'm', targetPort: 'p2' },
    ],
  }

  const result = evaluateGraph(g).get('m')!
  assert.equal(result.error, undefined)
  assert.equal(result.inputs.p1, 30)
  assert.equal(result.inputs.p2, 70)
  assert.equal(checkGraphUnits(g).ok, true)

  ;(g.nodes[1].data as VariableData).unit = 's'
  const report = checkGraphUnits(g)
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((issue) => issue.message.includes('円グラフ') && issue.message.includes('mA と s')))
})

test('CSV数値テーブルを読み込み、ヘッダーから単位を取得できる', () => {
  const parsed = parseNumericTable('\uFEFF入力電圧 [V],出力電流 [A],効率 [%]\n5,1,80\n5,2,82\n不正,2,90\n')
  assert.deepEqual(parsed.headers, ['入力電圧 [V]', '出力電流 [A]', '効率 [%]'])
  assert.deepEqual(parsed.rows, [[5, 1, 80], [5, 2, 82]])
  assert.equal(parsed.skippedRows, 1)
  assert.deepEqual(splitHeaderUnit('入力電圧 [V]'), { name: '入力電圧', unit: 'V' })
  assert.deepEqual(splitHeaderUnit('効率(%)'), { name: '効率', unit: '%' })
})

test('デバッグ用CSV fixtureをすべて読み込める', () => {
  const expected = new Map([
    ['dcdc_efficiency_1d.csv', [10, 0]],
    ['dcdc_efficiency_grid.csv', [15, 0]],
    ['dcdc_efficiency_3d_temperature.csv', [18, 0]],
    ['dcdc_efficiency_sparse.csv', [10, 0]],
    ['dcdc_efficiency_invalid_rows.csv', [6, 3]],
  ])
  for (const [name, [rows, skipped]] of expected) {
    const source = readFileSync(new URL(`../samples/csv/${name}`, import.meta.url), 'utf8')
    const parsed = parseNumericTable(source)
    assert.equal(parsed.rows.length, rows, name)
    assert.equal(parsed.skippedRows, skipped, name)
  }
})

const dcTable = (mode: TableData['mode']): TableData => ({
  title: 'DCDC効率', mode, digits: 3,
  headers: ['Vin [V]', 'Iout [A]', 'Efficiency [%]'],
  inputs: [
    { id: 'vin', name: 'Vin', unit: 'V', column: 0 },
    { id: 'iout', name: 'Iout', unit: 'A', column: 1 },
  ],
  outputs: [{ id: 'out', name: 'Efficiency', unit: '%', column: 2 }],
  rows: [[5, 1, 80], [5, 3, 84], [12, 1, 86], [12, 3, 90]],
})

test('テーブル変換は複数入力の最近傍を選べる', () => {
  assert.deepEqual(lookupTable(dcTable('nearest'), [5.4, 2.8]), { values: [84], method: 'nearest' })
  assert.deepEqual(lookupTable(dcTable('nearest'), [12, 3]), { values: [90], method: 'exact' })
})

test('テーブル変換は2入力を双線形補間し、範囲外を端へ固定する', () => {
  const table = dcTable('linear')
  assert.deepEqual(lookupTable(table, [8.5, 2]), { values: [85], method: 'linear' })
  assert.deepEqual(lookupTable(table, [100, 3]), { values: [90], method: 'exact' })
})

test('テーブル変換は複数の出力を同時に返せる', () => {
  const table: TableData = {
    title: '2出力テーブル', mode: 'linear', digits: 3,
    headers: ['Vin [V]', 'Iout [A]', 'Efficiency [%]', 'Temp [C]'],
    inputs: [
      { id: 'vin', name: 'Vin', unit: 'V', column: 0 },
      { id: 'iout', name: 'Iout', unit: 'A', column: 1 },
    ],
    outputs: [
      { id: 'eff', name: 'Efficiency', unit: '%', column: 2 },
      { id: 'temp', name: 'Temp', unit: 'C', column: 3 },
    ],
    rows: [[5, 1, 80, 30], [5, 3, 84, 40], [12, 1, 86, 32], [12, 3, 90, 42]],
  }
  assert.deepEqual(lookupTable(table, [8.5, 2]), { values: [85, 36], method: 'linear' })
  assert.deepEqual(lookupTable(table, [12, 3]), { values: [90, 42], method: 'exact' })
})

test('テーブル変換はテキスト入力を完全一致で絞り込んでから数値入力で検索する', () => {
  const table: TableData = {
    title: '地域別単価', mode: 'linear', digits: 2,
    headers: ['地域', '数量', '単価'],
    inputs: [
      { id: 'region', name: '地域', unit: '', column: 0, kind: 'text' },
      { id: 'qty', name: '数量', unit: '個', column: 1 },
    ],
    outputs: [{ id: 'price', name: '単価', unit: '円', column: 2 }],
    rows: [
      ['東京', 10, 100],
      ['東京', 20, 90],
      ['大阪', 10, 95],
      ['大阪', 20, 85],
    ],
  }
  assert.deepEqual(lookupTable(table, ['東京', 15]), { values: [95], method: 'linear' })
  assert.deepEqual(lookupTable(table, ['大阪', 10]), { values: [95], method: 'exact' })
  assert.throws(() => lookupTable(table, ['福岡', 10]))
})

test('全入力がテキストのテーブルは一致した行をそのまま返す', () => {
  const table: TableData = {
    title: 'コード表', mode: 'nearest', digits: 0,
    headers: ['コード', '名称', '値'],
    inputs: [{ id: 'code', name: 'コード', unit: '', column: 0, kind: 'text' }],
    outputs: [{ id: 'value', name: '値', unit: '', column: 2 }],
    rows: [['A', '名称A', 1], ['B', '名称B', 2]],
  }
  assert.deepEqual(lookupTable(table, ['B']), { values: [2], method: 'exact' })
})

test('テキスト変数をCSVテーブル変換のテキスト入力へつなげてグラフ内で評価できる', () => {
  const table: TableData = {
    title: '地域別単価', mode: 'nearest', digits: 2,
    headers: ['地域', '単価'],
    inputs: [{ id: 'region', name: '地域', unit: '', column: 0, kind: 'text' }],
    outputs: [{ id: 'price', name: '単価', unit: '円', column: 1 }],
    rows: [['東京', 100], ['大阪', 90]],
  }
  const g: Graph = {
    nextId: 4,
    nodes: [
      { id: 'region', kind: 'variable', x: 0, y: 0, data: { title: '地域', value: 0, mode: 'text', text: '大阪', min: 0, max: 0, step: 1, sweep: false } },
      { id: 'table', kind: 'table', x: 0, y: 0, data: table },
      { id: 'result', kind: 'result', x: 0, y: 0, data: { title: '単価', target: null, digits: 2 } },
    ],
    edges: [
      { id: 'e1', source: 'region', sourcePort: 'out', target: 'table', targetPort: 'region' },
      { id: 'e2', source: 'table', sourcePort: 'price', target: 'result', targetPort: 'in' },
    ],
  }
  const result = evaluateGraph(g)
  assert.equal(result.get('table')?.outputs.price, 90)
  assert.equal(result.get('result')?.outputs.in, 90)
  assert.equal(checkGraphUnits(g).ok, true)
})

test('CSVテーブルノードをグラフ内で評価できる', () => {
  const table = dcTable('linear')
  const g: Graph = {
    nextId: 5,
    nodes: [
      { id: 'vin', kind: 'variable', x: 0, y: 0, data: { title: '入力電圧', value: 8.5, min: 5, max: 12, step: 0.1, sweep: true, unit: 'V' } },
      { id: 'iout', kind: 'variable', x: 0, y: 0, data: { title: '出力電流', value: 2, min: 1, max: 3, step: 0.1, sweep: true, unit: 'A' } },
      { id: 'table', kind: 'table', x: 0, y: 0, data: table },
      { id: 'result', kind: 'result', x: 0, y: 0, data: { title: '効率', target: null, digits: 2 } },
    ],
    edges: [
      { id: 'e1', source: 'vin', sourcePort: 'out', target: 'table', targetPort: 'vin' },
      { id: 'e2', source: 'iout', sourcePort: 'out', target: 'table', targetPort: 'iout' },
      { id: 'e3', source: 'table', sourcePort: 'out', target: 'result', targetPort: 'in' },
    ],
  }
  const result = evaluateGraph(g)
  assert.equal(result.get('table')?.outputs.out, 85)
  assert.equal(result.get('result')?.outputs.in, 85)
  assert.equal(checkGraphUnits(g).ok, true)
})

test('保存されたCSVテーブルノードを現在形式へ復元できる', () => {
  const graph = normalizeGraph({
    nextId: 2,
    nodes: [{ id: 'n1', kind: 'table', x: 10, y: 20, data: dcTable('linear') }],
    edges: [],
  })!
  assert.equal(graph.nodes[0].kind, 'table')
  const data = graph.nodes[0].data as TableData
  assert.equal(data.inputs.length, 2)
  assert.equal(data.outputs.length, 1)
  assert.equal(data.outputs[0].unit, '%')
  assert.deepEqual(data.rows[3], [12, 3, 90])
})

test('旧形式（output 単数）で保存されたCSVテーブルノードも復元できる', () => {
  const { outputs, ...legacyTable } = dcTable('linear')
  const graph = normalizeGraph({
    nextId: 2,
    nodes: [{ id: 'n1', kind: 'table', x: 10, y: 20, data: { ...legacyTable, output: outputs[0] } }],
    edges: [],
  })!
  const data = graph.nodes[0].data as TableData
  assert.equal(data.outputs.length, 1)
  assert.equal(data.outputs[0].id, 'out')
  assert.equal(data.outputs[0].unit, '%')
})

test('ポート id が重複した保存データは、読み込み時に別 id へ振り直す', () => {
  // 同じ id のハンドルが並ぶと、あとから増やした引数へ線がつながらなくなる。
  const graph = normalizeGraph({
    nextId: 2,
    nodes: [{
      id: 'n1', kind: 'block', x: 0, y: 0,
      data: {
        title: '重複',
        inputs: [{ id: 'p1', name: '幅', unit: 'mm' }, { id: 'p1', name: '高さ', unit: 'mm' }],
        calcs: [
          { id: 'c1', name: '面積', expr: '{幅}*{高さ}', unit: 'mm^2', exposed: true },
          { id: 'c1', name: '周長', expr: '({幅}+{高さ})*2', unit: 'mm', exposed: true },
        ],
      },
    }],
    edges: [{ id: 'e1', source: 'v', sourcePort: 'out', target: 'n1', targetPort: 'p1' }],
  })!
  const data = graph.nodes[0].data as BlockData
  assert.deepEqual(data.inputs.map((input) => input.id), ['p1', 'n1-input-2'])
  assert.deepEqual(data.calcs.map((calc) => calc.id), ['c1', 'n1-calc-2'])
  // 既にあった配線は先頭のポートに残す
  assert.equal(graph.edges[0].targetPort, 'p1')
})

test('結果とモニターの単位は接続元から自動取得する', () => {
  const g: Graph = {
    nextId: 4,
    nodes: [
      { id: 'v', kind: 'variable', x: 0, y: 0, data: { title: '長さ', value: 12, min: 0, max: 100, step: 1, sweep: true, unit: 'mm' } },
      { id: 'r', kind: 'result', x: 0, y: 0, data: { title: '結果', target: null, digits: 3 } },
      { id: 'm', kind: 'monitor', x: 0, y: 0, data: { title: 'モニター', digits: 3 } },
    ],
    edges: [
      { id: 'er', source: 'v', sourcePort: 'out', target: 'r', targetPort: 'in' },
      { id: 'em', source: 'v', sourcePort: 'out', target: 'm', targetPort: 'in' },
    ],
  }

  assert.equal(connectedInputUnit(g, 'r'), 'mm')
  assert.equal(connectedInputUnit(g, 'm'), 'mm')
  assert.equal(checkGraphUnits(g).ok, true)

  ;(g.nodes[0].data as VariableData).unit = 'cm'
  assert.equal(connectedInputUnit(g, 'r'), 'cm')
  assert.equal(connectedInputUnit(g, 'm'), 'cm')
})

test('旧形式や欠損のある保存グラフを黒画面にならない形へ補完する', () => {
  const graph = normalizeGraph({
    nodes: [
      { id: 'n1', kind: 'variable', data: { title: '旧変数', value: 12 } },
      {
        id: 'n2', kind: 'block', data: {
          title: '旧ブロック',
          inputs: [{ name: 'x' }],
          rows: [{ name: 'y', expr: 'x*2' }],
        },
      },
      { id: 'n3', kind: 'result', data: { title: '旧結果', digits: 999 } },
    ],
    edges: [{ source: 'n1', sourceHandle: 'out', target: 'n2', targetHandle: 'n2-input-1', label: 'BUS_A' }],
  })!

  assert.equal(graph.nodes.length, 3)
  assert.equal((graph.nodes[0].data as VariableData).step, 1)
  assert.equal((graph.nodes[1].data as BlockData).calcs[0].expr, 'x*2')
  assert.equal((graph.nodes[2].data as ResultData).target, null)
  assert.equal((graph.nodes[2].data as ResultData).digits, 12)
  assert.equal(graph.edges[0].sourcePort, 'out')
  assert.equal(graph.edges[0].label, 'BUS_A')
  assert.equal(graph.nextId, 4)
  assert.doesNotThrow(() => evaluateGraph(graph))
})


test('丸めが Excel の定義に合う', () => {
  assert.equal(ev('ROUNDUP(3000/455,0)'), 7)
  assert.equal(ev('ROUNDUP(-1.2,0)'), -2) // 0 から遠ざかる
  assert.equal(ev('ROUNDDOWN(-1.2,0)'), -1)
  assert.equal(ev('INT(-1.2)'), -2) // -∞ 方向
  assert.equal(ev('ROUND(2.5,0)'), 3)
  assert.equal(ev('ROUND(2.675,2)'), 2.68) // 二進小数の桁落ちに負けない
  assert.equal(ev('CEILING(123,5)'), 125)
  assert.equal(ev('FLOOR(123,5)'), 120)
  assert.equal(ev('ROUNDUP(1.005,2)'), 1.01)
  assert.equal(ev('MOD(-1,3)'), 2) // Excel の MOD は除数の符号に従う
})

test('表示桁数は細かい刻み幅に追従する', () => {
  assert.equal(digitsForStep(1), 4)
  assert.equal(digitsForStep(0.001), 4)
  assert.equal(digitsForStep(0.00001), 5)
  assert.equal(digitsForStep(2.5e-7), 8)
  assert.match(fmtNum(0.0000123, digitsForStep(1e-7)), /1\.2300000e-5/)
  assert.equal(fmtStepNum(531, 0.01), '531.00')
  assert.equal(fmtStepNum(531.2, 0.01), '531.20')
})

test('式のエラーは投げる', () => {
  assert.throws(() => ev('1+'), /値が必要です/)
  assert.throws(() => ev('FOO(1)'), /関数はありません/)
  assert.throws(() => ev('1/0'), /0 で割って/)
  assert.throws(() => ev('x+1'), /x が見つかりません/)
})

test('式プレビューが記号を数式らしく置き換える', () => {
  assert.deepEqual(
    segments('a*b/c^2>=x').map((s) => s.text),
    ['a', '×', 'b', '÷', 'c', '2', '≥', 'x'],
  )
  assert.equal(segments('a*b/c^2>=x').find((s) => s.sup)?.text, '2')
})

test('式プレビューは関数・参照・数値を色分けの種別で返す', () => {
  assert.deepEqual(
    segments('ROUNDUP(x,2)').map((s) => s.k),
    ['fn', 'paren', 'ref', 'op', 'num', 'paren'],
  )
})

test('式プレビューは冪の括弧まとまりも上付きにする', () => {
  const s = segments('x^(y+1)')
  assert.deepEqual(s.map((t) => t.text), ['x', '(', 'y', '+', '1', ')'])
  assert.deepEqual(s.map((t) => t.sup), [undefined, true, true, true, true, true])
})

test('式プレビューは書きかけ・不正な文字でも止まらない', () => {
  assert.doesNotThrow(() => segments('1+'))
  assert.equal(segments('1+@').at(-1)?.k, 'err')
})

test('Excel 式に落とすと括弧で守られる', () => {
  const cell = (n: string) => ({ x: '$B$2', a: '$B$3', b: '$B$4' })[n] ?? null
  assert.equal(astToExcel(parse('-x^2'), cell), '(-($B$2^2))')
  assert.equal(astToExcel(parse('a%b'), cell), 'MOD($B$3,$B$4)')
  assert.equal(astToExcel(parse('CEILING(x,5)'), cell), 'CEILING.MATH($B$2,5)')
  assert.equal(astToExcel(parse('ROUNDUP(a/b,0)'), cell), 'ROUNDUP(($B$3/$B$4),0)')
  assert.equal(astToExcel(parse('zzz'), cell), '#REF!')
})

/* ---- グラフ ---- */

function sample(): { g: Graph; block: string; result: string; len: string } {
  const g = sampleGraph()
  const block = g.nodes.find((n) => n.kind === 'block')!.id
  const result = g.nodes.find((n) => n.kind === 'result')!.id
  const len = g.nodes.find((n) => n.kind === 'variable')!.id
  return { g, block, result, len }
}

test('サンプルグラフが評価できる', () => {
  const { g, block, result } = sample()
  const res = evaluateGraph(g)
  const b = res.get(block)!
  assert.equal(b.error, undefined)
  // 3000 / 455 = 6.59… → 切り上げ 7 枚、単価 1200 で 8400 円
  const calcs = (g.nodes.find((n) => n.id === block)!.data as BlockData).calcs
  assert.equal(b.rows[calcs[0].id].value, 7)
  assert.equal(resultValue(res, result), 8400)
})

test('複数の代入式を上から評価し、複数出力にできる', () => {
  const { g, block } = sample()
  const data = g.nodes.find((n) => n.id === block)!.data as BlockData
  const res = evaluateGraph(g).get(block)!
  assert.equal(res.outputs[data.calcs[0].id], 7)
  assert.equal(res.outputs[data.calcs[1].id], 8400)
})

test('式から合成単位を推論できる', () => {
  const inferred = inferAstUnit(parse('幅*高さ'), new Map([
    ['幅', parseUnit('mm')],
    ['高さ', parseUnit('mm')],
  ]))
  assert.ok(sameUnit(inferred, parseUnit('mm^2')))
})

test('SI を基準に、表記どうしを換算できる', () => {
  assert.equal(unitRatio('mm', 'm'), 1e-3)
  assert.equal(unitRatio('m', 'mm'), 1e3)
  assert.equal(convertValue(2, 'h', 's'), 7200)
  assert.equal(convertValue(90, 'min', 'h'), 1.5)
  assert.equal(convertValue(1, 'kWh', 'J'), 3.6e6)
  assert.equal(convertValue(2, 'GB', 'MB'), 2000)
  // 量が違うものと、解釈できないものは触らない
  assert.equal(unitRatio('mm', 's'), 1)
  assert.equal(convertValue(5, '円', '円'), 5)
})

test('配線は表記が違ってもつながり、値は接続先の表記へ換算される', () => {
  const { g, block } = sample()
  assert.equal(checkGraphUnits(g).ok, true)
  const data = g.nodes.find((n) => n.id === block)!.data as BlockData
  data.inputs[0].unit = 'm'
  assert.equal(checkGraphUnits(g).ok, true, 'mm → m は表記の違いだけなのでエラーにしない')
  const res = evaluateGraph(g).get(block)!
  assert.equal(res.inputs[data.inputs[0].id], 3) // 3000 mm → 3 m
})

test('量そのものが違う配線は知らせる', () => {
  const { g, block } = sample()
  const data = g.nodes.find((n) => n.id === block)!.data as BlockData
  data.inputs[0].unit = 's'
  const report = checkGraphUnits(g)
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((issue) => issue.message.includes('量が違います')))
})

test('計算行の単位を別の表記にすると、値がその表記へ換算される', () => {
  const data: BlockData = {
    title: '面積',
    inputs: [{ id: 'p1', name: '幅', unit: 'mm' }, { id: 'p2', name: '高さ', unit: 'mm' }],
    calcs: [
      { id: 'c1', name: '面積', expr: '{幅}*{高さ}', unit: 'm^2', exposed: true },
      { id: 'c2', name: '面積そのまま', expr: '{幅}*{高さ}', unit: 'mm^2', exposed: true },
    ],
  }
  // mm^2 で出た値を m^2 の行にすると 1e-6 倍、mm^2 のままなら等倍
  assert.deepEqual(blockRowFactors(data), [1e-6, 1])
})

test('変数を差し替えると結果が動く', () => {
  const { g, result, len } = sample()
  const at = (x: number) => resultValue(evaluateGraph(g, new Map([[len, x]])), result)
  assert.equal(at(455), 1200) // ちょうど 1 枚
  assert.equal(at(456), 2400) // 1 mm 超えた瞬間 2 枚
})

test('未接続と循環参照でも落ちない', () => {
  const { g, block } = sample()
  const g2: Graph = { ...g, edges: g.edges.filter((e) => e.target !== block) }
  const res = evaluateGraph(g2)
  assert.match(res.get(block)!.error!, /未接続/)

  const cyc: Graph = {
    ...g,
    edges: [
      ...g.edges,
      { id: 'loop', source: block, sourcePort: 'x', target: block, targetPort: 'x' },
    ],
  }
  assert.doesNotThrow(() => evaluateGraph(cyc))
})

test('スイープが階段になる', () => {
  const { g, result, len } = sample()
  const s = sweep(g, len, result, 0, 2000, 200)
  assert.equal(s.length, 201)
  const ys = new Set(s.map((p) => p.y))
  assert.ok(ys.size > 2 && ys.size < 12, `階段の段数が想定外: ${ys.size}`)
})

/* ---- 逆算 ---- */

test('逆算はパラメーターを刻みずつ動かして完全一致する候補を返す', () => {
  const { g, result, len } = sample()
  const rep = goalSeek(g, len, result, 12000, 0, 10000, { step: 10, prefer: 3000 })
  assert.ok(rep.best)
  assert.equal(rep.best.x, 4100)
  assert.equal(rep.best.y, 12000)
  assert.equal(rep.best.residual, 0)
  assert.equal(rep.equallyBestCount, 46)
  assert.equal(resultValue(evaluateGraph(g, new Map([[len, rep.best.x]])), result), 12000)
  assert.ok(rep.samples.every((sample, index) => sample.x === index * 10))
})

test('完全一致がなくても刻み上で目標に最も近い値を返す', () => {
  const g: Graph = { nodes: [], edges: [], nextId: 1 }
  g.nodes.push(
    {
      id: 'v',
      kind: 'variable',
      x: 0,
      y: 0,
      data: { title: 'x', value: 1, min: 0, max: 100, step: 0, sweep: true } as VariableData,
    },
    {
      id: 'b',
      kind: 'block',
      x: 0,
      y: 0,
      data: {
        title: '二乗',
        inputs: [{ id: 'p1', name: 'x' }],
        calcs: [{ id: 'c1', name: 'y', expr: 'x^2', exposed: true }],
      } as BlockData,
    },
    {
      id: 'r',
      kind: 'result',
      x: 0,
      y: 0,
      data: { title: 'y', target: 50, digits: 3 } as ResultData,
    },
  )
  g.edges.push(
    { id: 'e1', source: 'v', sourcePort: 'out', target: 'b', targetPort: 'p1' },
    { id: 'e2', source: 'b', sourcePort: 'c1', target: 'r', targetPort: 'in' },
  )
  const rep = goalSeek(g, 'v', 'r', 50, 0, 100, { step: 1 })
  assert.equal(rep.solutions.length, 1)
  assert.equal(rep.best?.x, 7)
  assert.equal(rep.best?.y, 49)
  assert.equal(rep.best?.residual, 1)
  assert.match(rep.warnings.join(''), /最も近い値/)
})

test('小数の刻み幅より粗い値へ丸めずに逆算する', () => {
  const g: Graph = {
    nextId: 3,
    nodes: [
      { id: 'v', kind: 'variable', x: 0, y: 0, data: { title: 'x', value: 0, min: 0, max: 1, step: 0.001, sweep: true } },
      { id: 'r', kind: 'result', x: 0, y: 0, data: { title: 'y', target: 0.3334, digits: 5 } },
    ],
    edges: [{ id: 'e', source: 'v', sourcePort: 'out', target: 'r', targetPort: 'in' }],
  }
  const rep = goalSeek(g, 'v', 'r', 0.3334, 0, 1, { step: 0.001 })
  assert.equal(rep.best?.x, 0.333)
  assert.ok(Math.abs((rep.best?.y ?? 0) - 0.333) < 1e-12)
})

test('531付近の非線形計算でも0.01刻みの全候補中で真の最適値を返す', () => {
  const g: Graph = {
    nextId: 4,
    nodes: [
      { id: 'v', kind: 'variable', x: 0, y: 0, data: { title: 'x', value: 500, min: 500, max: 550, step: 0.01, sweep: true } },
      {
        id: 'b', kind: 'block', x: 0, y: 0,
        data: {
          title: '非線形', inputs: [{ id: 'in', name: 'x' }],
          calcs: [{ id: 'out', name: 'y', expr: 'x^2+3*x', exposed: true }],
        },
      },
      { id: 'r', kind: 'result', x: 0, y: 0, data: { title: 'y', target: 284000, digits: 4 } },
    ],
    edges: [
      { id: 'e1', source: 'v', sourcePort: 'out', target: 'b', targetPort: 'in' },
      { id: 'e2', source: 'b', sourcePort: 'out', target: 'r', targetPort: 'in' },
    ],
  }
  const rep = goalSeek(g, 'v', 'r', 284000, 500, 550, { step: 0.01 })
  const brute = Array.from({ length: 5001 }, (_, index) => Number((500 + index * 0.01).toFixed(2)))
    .map((x) => ({ x, error: Math.abs((x * x + 3 * x) - 284000) }))
    .sort((a, b) => a.error - b.error)[0]
  assert.equal(rep.best?.x, brute.x)
  assert.equal(rep.best?.residual, brute.error)
  assert.notEqual(rep.best?.x, Math.round(rep.best?.x ?? 0))
})

test('IoT電池サンプルは0.01秒刻みで目標3600時間に最も近い送信間隔を返す', () => {
  const g = iotBatteryGraph()
  const variable = g.nodes.find((node) => node.kind === 'variable' && node.data.title === '送信間隔')!
  const result = g.nodes.find((node) => node.kind === 'result')!
  const data = variable.data as VariableData
  const target = (result.data as ResultData).target!
  const rep = goalSeek(g, variable.id, result.id, target, data.min, data.max, { step: data.step })

  assert.equal(checkGraphUnits(g).ok, true)
  assert.equal(rep.samples.length, 59001)
  assert.equal(rep.best?.x, 467.45)
  assert.ok(Math.abs((rep.best?.y ?? 0) - 3600) < 0.04)
})

test('目標が結果範囲外でも最も近い端の候補を返す', () => {
  const { g, result, len } = sample()
  const rep = goalSeek(g, len, result, 999999, 0, 1000, { step: 10 })
  assert.equal(rep.best?.x, 920)
  assert.equal(rep.best?.y, 3600)
  assert.match(rep.warnings.join(''), /最も近い値/)
})

test('刻みが無効な場合は計算を止める', () => {
  const { g, result, len } = sample()
  assert.equal(goalSeek(g, len, result, 100, 0, 100, { step: 0 }).best, null)
})

test('候補数に上限を設けず、非同期探索で進捗を通知する', async () => {
  const { g, result, len } = sample()
  const total = solveCandidateCount(0, 20000, 1)
  assert.equal(total, 20001)
  const progress: number[] = []
  const rep = await goalSeekAsync(g, len, result, 999999, 0, 20000, {
    step: 1,
    chunkSize: 2000,
    onProgress: (value) => progress.push(value.completed),
  })
  assert.ok(rep.best)
  assert.equal(progress[0], 0)
  assert.equal(progress.at(-1), total)
  assert.ok(progress.length > 2)
})

/* ---- 書き出し ---- */

test('シートは 1 ノード 1 セクションで、B 列が数式になる', () => {
  const { g } = sample()
  const plan = buildSheet(g, evaluateGraph(g))
  assert.equal(plan.warnings.length, 0)

  const sections = plan.rows.filter((r) => r.style === 'section').map((r) => r.name)
  assert.deepEqual(sections, ['■ 入力変数', '■ 枚数と金額', '■ 結果'])

  // 入力変数は定数、計算行は数式
  const len = plan.rows.find((r) => r.name === '全長')!
  assert.equal(len.value, 3000)
  assert.equal(len.formula, undefined)

  const sheets = plan.rows.find((r) => r.name === '必要枚数')!
  assert.ok(sheets.formula?.startsWith('ROUNDUP('), sheets.formula)
  assert.equal(sheets.cached, 7)

  // 参照が上流のセルにつながっている（＝入力を書き換えると追従する）
  const money = plan.rows.find((r) => r.name === '合計金額' && r.style === 'output')!
  assert.match(money.formula!, /\$B\$\d+\*\$B\$\d+/)
  const total = plan.rows.find((r) => r.style === 'result')!
  assert.equal(total.formula, `$B$${money.row}`)

  assert.match(sheetToTsv(plan), /必要枚数\t=ROUNDUP/)
})

test('xlsx が組み立てられる', () => {
  const { g } = sample()
  const bytes = buildXlsx(buildSheet(g, evaluateGraph(g)))
  const files = unzipSync(bytes)
  for (const p of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]) {
    assert.ok(files[p], `${p} がない`)
  }
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
  assert.match(sheet, /<f>ROUNDUP\(/)
  assert.match(sheet, /fullCalcOnLoad|<v>7<\/v>/)
  assert.ok(!sheet.includes('undefined'), 'undefined が漏れている')
  assert.match(strFromU8(files['xl/workbook.xml']), /fullCalcOnLoad="1"/)
})

test('比較演算子を含む式も xlsx に落ちる（XML エスケープ）', () => {
  const g: Graph = {
    nodes: [
      {
        id: 'b',
        kind: 'block',
        x: 0,
        y: 0,
        data: {
          title: '段階',
          inputs: [],
          calcs: [{ id: 'c1', name: '料金', expr: 'IF(3>2,100,200)', exposed: true }],
        } as BlockData,
      },
    ],
    edges: [],
    nextId: 2,
  }
  const sheet = strFromU8(
    unzipSync(buildXlsx(buildSheet(g, evaluateGraph(g))))['xl/worksheets/sheet1.xml'],
  )
  assert.match(sheet, /IF\(\(3&gt;2\),100,200\)/)
})

/* ---------------- 増分評価とテーブルの前処理キャッシュ ---------------- */

test('評価結果を持ち越しても、値・式・接続の変更はすべて反映される', () => {
  const cache = createEvalCache()
  const base = sampleGraph()
  const first = evaluateGraph(base, undefined, cache)

  // 同じグラフを二度評価しても、キャッシュなしの結果と一致する
  const again = evaluateGraph(base, undefined, cache)
  for (const node of base.nodes) {
    assert.deepEqual(again.get(node.id), evaluateGraph(base).get(node.id), node.id)
  }
  // 変化がなければ結果オブジェクトごと使い回す（画面の再描画を省くための性質）
  const block = base.nodes.find((n) => n.kind === 'block')!
  assert.equal(again.get(block.id), first.get(block.id))

  // 変数を動かすと下流が追従する
  const variable = base.nodes.find((n) => n.kind === 'variable')!
  const moved: Graph = {
    ...base,
    nodes: base.nodes.map((n) => n.id === variable.id
      ? { ...n, data: { ...(n.data as VariableData), value: (n.data as VariableData).value + 1 } }
      : n),
  }
  assert.deepEqual(
    [...evaluateGraph(moved, undefined, cache)].map(([id, r]) => [id, r.outputs]),
    [...evaluateGraph(moved)].map(([id, r]) => [id, r.outputs]),
  )

  // 式を書き換えたときも、キャッシュを持たない評価と一致する
  const edited: Graph = {
    ...moved,
    nodes: moved.nodes.map((n) => n.id === block.id
      ? { ...n, data: { ...(n.data as BlockData), calcs: (n.data as BlockData).calcs.map((c, i) => i === 0 ? { ...c, expr: '1+1' } : c) } }
      : n),
  }
  assert.deepEqual(
    [...evaluateGraph(edited, undefined, cache)].map(([id, r]) => [id, r.rows]),
    [...evaluateGraph(edited)].map(([id, r]) => [id, r.rows]),
  )

  // 配線を外すと未接続として扱われる
  const cut: Graph = { ...edited, edges: edited.edges.slice(1) }
  assert.deepEqual(
    [...evaluateGraph(cut, undefined, cache)].map(([id, r]) => [id, r.error]),
    [...evaluateGraph(cut)].map(([id, r]) => [id, r.error]),
  )
})

test('持ち越した評価結果はスイープの上書き値を無視しない', () => {
  const cache = createEvalCache()
  const g = sampleGraph()
  const variable = g.nodes.find((n) => n.kind === 'variable')!
  evaluateGraph(g, undefined, cache)
  const overridden = evaluateGraph(g, new Map([[variable.id, 999]]), cache)
  assert.equal(overridden.get(variable.id)?.outputs.out, 999)
  assert.deepEqual(
    [...overridden].map(([id, r]) => [id, r.outputs]),
    [...evaluateGraph(g, new Map([[variable.id, 999]]))].map(([id, r]) => [id, r.outputs]),
  )
})

test('テーブルの前処理を使い回しても、行を差し替えれば新しい値を返す', () => {
  const table = dcTable('linear')
  assert.equal(lookupTable(table, [8.5, 2]).values[0], 85)
  assert.equal(lookupTable(table, [8.5, 2]).values[0], 85) // キャッシュ経由
  const replaced: TableData = { ...table, rows: table.rows.map((row) => [row[0], row[1], row[2] + 5]) }
  assert.equal(lookupTable(replaced, [8.5, 2]).values[0], 90)
})

test('格子が欠けた散布データも近傍の重み付けで連続に変化する', () => {
  const sparse: TableData = {
    ...dcTable('linear'),
    rows: [[5, 1, 80], [5, 3, 84], [12, 1, 86]],
  }
  const low = lookupTable(sparse, [11, 2.9])
  const high = lookupTable(sparse, [11.5, 2.9])
  assert.equal(low.method, 'continuous-neighbors')
  assert.ok(Number.isFinite(low.values[0]) && Number.isFinite(high.values[0]))
  assert.ok(Math.abs(low.values[0] - high.values[0]) < 2, '近い入力では近い値になる')
})

test('大きなテーブルでも端の値と補間値を返せる', () => {
  const rows: number[][] = []
  for (let x = 0; x < 400; x++) for (let y = 0; y < 40; y++) rows.push([x, y, x * 2 + y])
  const big: TableData = {
    title: '大きな表', mode: 'linear', digits: 2,
    headers: ['x', 'y', 'z'],
    inputs: [{ id: 'x', name: 'x', unit: '', column: 0 }, { id: 'y', name: 'y', unit: '', column: 1 }],
    outputs: [{ id: 'out', name: 'z', unit: '', column: 2 }],
    rows,
  }
  assert.deepEqual(lookupTable(big, [399, 39]), { values: [837], method: 'exact' })
  assert.deepEqual(lookupTable(big, [10.5, 20]), { values: [41], method: 'linear' })
  assert.deepEqual(lookupTable(big, [-5, 100]), { values: [39], method: 'exact' })
})

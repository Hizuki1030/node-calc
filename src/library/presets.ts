/** ブロックのプリセット。
 *
 * 「1 演算 = 1 ノード」も、計算行が 1 本だけのブロックとして表す。
 * エンジンとエクスポータを 1 系統に保つためで、置いたあとに行を足して
 * 育てていける（加算ノードに行を足して「送料込み合計」にする、など）。
 */

import type { BlockData, CalcNode, Graph, MonitorData, TableData, VariableData } from '../types.ts'

export interface PresetCalc {
  name: string
  expr: string
  exposed?: boolean
  unit?: string
}

export interface PresetInput {
  name: string
  unit?: string
}

export interface BlockPreset {
  key: string
  category: string
  title: string
  note?: string
  inputs: Array<string | PresetInput>
  calcs: PresetCalc[]
}

let seq = 0
export function uid(prefix = 'i'): string {
  seq += 1
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`
}

export const PRESETS: BlockPreset[] = [
  /* --- 四則 --- */
  { key: 'add', category: '四則', title: '加算', inputs: ['a', 'b'], calcs: [{ name: '和', expr: 'a+b', exposed: true }] },
  { key: 'sub', category: '四則', title: '減算', inputs: ['a', 'b'], calcs: [{ name: '差', expr: 'a-b', exposed: true }] },
  { key: 'mul', category: '四則', title: '乗算', inputs: ['a', 'b'], calcs: [{ name: '積', expr: 'a*b', exposed: true }] },
  { key: 'div', category: '四則', title: '除算', inputs: ['a', 'b'], calcs: [{ name: '商', expr: 'a/b', exposed: true }] },
  { key: 'pow', category: '四則', title: 'べき乗', inputs: ['a', 'b'], calcs: [{ name: 'べき乗', expr: 'a^b', exposed: true }] },
  { key: 'mod', category: '四則', title: '剰余', inputs: ['a', 'b'], calcs: [{ name: '余り', expr: 'MOD(a,b)', exposed: true }] },

  /* --- 丸め --- */
  {
    key: 'ceil',
    category: '丸め',
    title: '切り上げ',
    note: '第2引数が桁数。0 で整数、2 で小数第2位、-3 で千の位。',
    inputs: ['x'],
    calcs: [{ name: '切り上げ', expr: 'ROUNDUP(x,0)', exposed: true }],
  },
  {
    key: 'floor',
    category: '丸め',
    title: '切り捨て',
    inputs: ['x'],
    calcs: [{ name: '切り捨て', expr: 'ROUNDDOWN(x,0)', exposed: true }],
  },
  {
    key: 'round',
    category: '丸め',
    title: '四捨五入',
    inputs: ['x'],
    calcs: [{ name: '四捨五入', expr: 'ROUND(x,0)', exposed: true }],
  },
  {
    key: 'ceilUnit',
    category: '丸め',
    title: '単位で切り上げ',
    note: '5 mm 単位、100 円単位などの丸め。',
    inputs: ['x'],
    calcs: [{ name: '切り上げ', expr: 'CEILING(x,5)', exposed: true }],
  },
  {
    key: 'floorUnit',
    category: '丸め',
    title: '単位で切り捨て',
    inputs: ['x'],
    calcs: [{ name: '切り捨て', expr: 'FLOOR(x,5)', exposed: true }],
  },

  /* --- 数値 --- */
  { key: 'abs', category: '数値', title: '絶対値', inputs: ['x'], calcs: [{ name: '絶対値', expr: 'ABS(x)', exposed: true }] },
  { key: 'sqrt', category: '数値', title: '平方根', inputs: ['x'], calcs: [{ name: '平方根', expr: 'SQRT(x)', exposed: true }] },
  { key: 'min', category: '数値', title: '最小', inputs: ['a', 'b'], calcs: [{ name: '最小', expr: 'MIN(a,b)', exposed: true }] },
  { key: 'max', category: '数値', title: '最大', inputs: ['a', 'b'], calcs: [{ name: '最大', expr: 'MAX(a,b)', exposed: true }] },
  {
    key: 'clamp',
    category: '数値',
    title: '上下限クランプ',
    inputs: ['x', '下限', '上限'],
    calcs: [{ name: 'クランプ', expr: 'MAX(MIN(x,上限),下限)', exposed: true }],
  },

  /* --- 実例 --- */
  {
    key: 'blank',
    category: '実例',
    title: '空のブロック',
    note: '入力ポートと計算行を自分で足して使う。',
    inputs: ['a'],
    calcs: [{ name: '結果', expr: 'a', exposed: true }],
  },
  {
    key: 'battery',
    category: '実例',
    title: '電池残量計算',
    note: '容量と消費電流から残量と残り時間を出す。',
    inputs: [{ name: '容量mAh', unit: 'mAh' }, { name: '消費電流mA', unit: 'mA' }, { name: '経過時間h', unit: 'h' }],
    calcs: [
      { name: '消費量mAh', expr: '消費電流mA*経過時間h', unit: 'mAh' },
      { name: '残量mAh', expr: 'MAX(容量mAh-消費量mAh,0)', exposed: true, unit: 'mAh' },
      { name: '残量パーセント', expr: 'ROUNDDOWN(残量mAh/容量mAh*100,0)', exposed: true, unit: '%' },
      { name: '残り時間h', expr: 'ROUNDDOWN(残量mAh/消費電流mA,1)', exposed: true, unit: 'h' },
    ],
  },
  {
    key: 'iotBatteryLife',
    category: '実例',
    title: 'IoT電池寿命',
    note: '送信時と待機時のデューティ比から平均消費電流を求め、電池の推定稼働時間を計算する。',
    inputs: [
      { name: '電池容量', unit: 'mAh' },
      { name: '使用可能率', unit: '1' },
      { name: '送信時電流', unit: 'mA' },
      { name: '送信時間', unit: 's' },
      { name: '待機時電流', unit: 'mA' },
      { name: '送信間隔', unit: 's' },
    ],
    calcs: [
      {
        name: '平均消費電流',
        expr: '({送信時電流}*{送信時間}+{待機時電流}*MAX({送信間隔}-{送信時間},0))/{送信間隔}',
        exposed: true,
        unit: 'mA',
      },
      { name: '有効電池容量', expr: '{電池容量}*{使用可能率}', unit: 'mAh' },
      { name: '推定稼働時間', expr: '{有効電池容量}/{平均消費電流}', exposed: true, unit: 'h' },
    ],
  },
  {
    key: 'iotBatteryDcDcLife',
    category: '実例',
    title: 'IoT電池寿命（DCDC効率あり）',
    note: 'DCDCコンバータの変換効率と静止電流も考慮して、電池側から見た平均消費電流と推定稼働時間を出す。',
    inputs: [
      { name: '電池容量', unit: 'mAh' },
      { name: '電池電圧', unit: 'V' },
      { name: '使用可能率', unit: '1' },
      { name: 'DCDC効率', unit: '1' },
      { name: 'DCDC静止電流', unit: 'μA' },
      { name: '出力電圧', unit: 'V' },
      { name: '送信時負荷電流', unit: 'mA' },
      { name: '送信時間', unit: 's' },
      { name: '待機時負荷電流', unit: 'mA' },
      { name: '送信間隔', unit: 's' },
    ],
    calcs: [
      { name: '送信時出力電力', expr: '出力電圧*送信時負荷電流', unit: 'mW' },
      { name: '送信時入力電流', expr: '送信時出力電力/(DCDC効率*電池電圧)+DCDC静止電流/1000', unit: 'mA' },
      { name: '待機時出力電力', expr: '出力電圧*待機時負荷電流', unit: 'mW' },
      { name: '待機時入力電流', expr: '待機時出力電力/(DCDC効率*電池電圧)+DCDC静止電流/1000', unit: 'mA' },
      {
        name: '平均消費電流',
        expr: '(送信時入力電流*送信時間+待機時入力電流*MAX(送信間隔-送信時間,0))/送信間隔',
        exposed: true,
        unit: 'mA',
      },
      { name: '有効電池容量', expr: '電池容量*使用可能率', unit: 'mAh' },
      { name: '推定稼働時間', expr: '有効電池容量/平均消費電流', exposed: true, unit: 'h' },
    ],
  },
  {
    key: 'sheets',
    category: '実例',
    title: '枚数と金額',
    note: '切り上げが入るので、逆算すると解が「範囲」で返る例。',
    inputs: [{ name: '全長mm', unit: 'mm' }, { name: '板幅mm', unit: 'mm' }, { name: '単価', unit: '円' }],
    calcs: [
      { name: '必要枚数', expr: 'ROUNDUP(全長mm/板幅mm,0)', exposed: true, unit: '枚' },
      { name: '合計金額', expr: '必要枚数*単価', exposed: true, unit: '円' },
    ],
  },
  {
    key: 'unitPrice',
    category: '実例',
    title: '税込金額',
    inputs: [{ name: '本体価格', unit: '円' }, { name: '税率', unit: '1' }],
    calcs: [
      { name: '消費税', expr: 'ROUNDDOWN(本体価格*税率,0)', unit: '円' },
      { name: '税込', expr: '本体価格+消費税', exposed: true, unit: '円' },
    ],
  },
]

/* ---------------- ノード生成 ---------------- */

export function blockFromPreset(p: BlockPreset, x: number, y: number, id: string): CalcNode {
  const data: BlockData = {
    title: p.title,
    note: p.note,
    inputs: p.inputs.map((input) => ({
      id: uid('p'),
      name: typeof input === 'string' ? input : input.name,
      unit: typeof input === 'string' ? '' : (input.unit ?? ''),
    })),
    calcs: p.calcs.map((c) => ({
      id: uid('c'),
      name: c.name,
      expr: c.expr,
      exposed: c.exposed ?? false,
      unit: c.unit ?? '',
    })),
  }
  return { id, kind: 'block', x, y, data }
}

export function newVariable(x: number, y: number, id: string, over: Partial<VariableData> = {}): CalcNode {
  const data: VariableData = {
    title: '変数',
    value: 100,
    mode: 'slider',
    choices: [0, 100, 500, 1000],
    min: 0,
    max: 1000,
    step: 1,
    sweep: true,
    ...over,
  }
  return { id, kind: 'variable', x, y, data }
}

export function newResult(x: number, y: number, id: string, title = '結果'): CalcNode {
  return { id, kind: 'result', x, y, data: { title, target: null, digits: 3 } }
}

export function newMonitor(x: number, y: number, id: string, over: Partial<MonitorData> = {}): CalcNode {
  return {
    id,
    kind: 'monitor',
    x,
    y,
    data: { title: 'モニター', digits: 3, mode: 'value', inputs: [{ id: 'in', name: '入力1', unit: '' }], ...over },
  }
}

export function newTable(x: number, y: number, id: string, over: Partial<TableData> = {}): CalcNode {
  return {
    id,
    kind: 'table',
    x,
    y,
    data: {
      title: 'CSVテーブル変換',
      mode: 'linear',
      inputs: [
        { id: uid('ti'), name: '入力1', unit: '', column: 0 },
        { id: uid('ti'), name: '入力2', unit: '', column: 1 },
      ],
      outputs: [{ id: uid('to'), name: '出力', unit: '', column: 2 }],
      headers: ['入力1', '入力2', '出力'],
      rows: [],
      digits: 4,
      ...over,
    },
  }
}

/* ---------------- 初回のサンプル ---------------- */

export function sampleGraph(): Graph {
  const g: Graph = { nodes: [], edges: [], nextId: 1 }
  const nid = () => `n${g.nextId++}`

  const len = newVariable(40, 80, nid(), {
    title: '全長',
    value: 3000,
    min: 0,
    max: 10000,
    step: 10,
    unit: 'mm',
  })
  const width = newVariable(40, 250, nid(), {
    title: '板幅',
    value: 455,
    min: 100,
    max: 1000,
    step: 5,
    unit: 'mm',
  })
  const price = newVariable(40, 420, nid(), {
    title: '単価',
    value: 1200,
    min: 0,
    max: 5000,
    step: 100,
    unit: '円',
  })

  const block = blockFromPreset(PRESETS.find((p) => p.key === 'sheets')!, 400, 150, nid())
  const result = newResult(760, 220, nid(), '合計金額')
  ;(result.data as { target: number | null }).target = 12000

  g.nodes.push(len, width, price, block, result)

  const b = block.data as BlockData
  g.edges.push(
    { id: uid('e'), source: len.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[0].id },
    { id: uid('e'), source: width.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[1].id },
    { id: uid('e'), source: price.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[2].id },
    {
      id: uid('e'),
      source: block.id,
      sourcePort: b.calcs[1].id,
      target: result.id,
      targetPort: 'in',
    },
  )
  return g
}

/** 容量と消費電流から残量・残り時間を出す、いちばん基本の電池残量サンプル。 */
export function batteryGraph(): Graph {
  const g: Graph = { nodes: [], edges: [], nextId: 1 }
  const nid = () => `n${g.nextId++}`

  const capacity = newVariable(40, 60, nid(), { title: '容量mAh', value: 2000, min: 0, max: 5000, step: 50, unit: 'mAh' })
  const current = newVariable(40, 230, nid(), { title: '消費電流mA', value: 150, min: 0, max: 1000, step: 5, unit: 'mA' })
  const elapsed = newVariable(40, 400, nid(), { title: '経過時間h', value: 4, min: 0, max: 48, step: 0.5, unit: 'h' })

  const block = blockFromPreset(PRESETS.find((p) => p.key === 'battery')!, 400, 150, nid())
  const result = newResult(820, 200, nid(), '残量パーセント')
  ;(result.data as { target: number | null }).target = 50

  g.nodes.push(capacity, current, elapsed, block, result)

  const b = block.data as BlockData
  g.edges.push(
    { id: uid('e'), source: capacity.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[0].id },
    { id: uid('e'), source: current.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[1].id },
    { id: uid('e'), source: elapsed.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[2].id },
    // calcs: [消費量mAh, 残量mAh, 残量パーセント, 残り時間h]
    { id: uid('e'), source: block.id, sourcePort: b.calcs[2].id, target: result.id, targetPort: 'in' },
  )
  return g
}

/** 0.01 秒刻みの逆算も試せる、IoT 製品の電池持ちサンプル。 */
export function iotBatteryGraph(): Graph {
  const g: Graph = { nodes: [], edges: [], nextId: 1 }
  const nid = () => `n${g.nextId++}`

  const constant = (x: number, y: number, title: string, value: number, unit: string) => newVariable(x, y, nid(), {
    title,
    value,
    mode: 'constant',
    min: value,
    max: value,
    step: 1,
    sweep: false,
    unit,
  })
  const capacity = constant(40, 60, '電池容量', 2400, 'mAh')
  const usableRate = constant(40, 210, '使用可能率', 0.8, '1')
  const txCurrent = constant(40, 360, '送信時電流', 120, 'mA')
  const txDuration = constant(245, 60, '送信時間', 2, 's')
  const sleepCurrent = constant(245, 210, '待機時電流', 0.02, 'mA')
  const interval = newVariable(245, 360, nid(), {
    title: '送信間隔',
    value: 300,
    mode: 'slider',
    min: 10,
    max: 600,
    step: 0.01,
    sweep: true,
    unit: 's',
  })

  const block = blockFromPreset(PRESETS.find((p) => p.key === 'iotBatteryLife')!, 510, 125, nid())
  const result = newResult(930, 175, nid(), '電池持ち（時間）')
  ;(result.data as { target: number | null; digits: number }).target = 3600
  ;(result.data as { target: number | null; digits: number }).digits = 2
  const monitor = newMonitor(930, 380, nid(), { title: '平均消費電流', digits: 4 })

  g.nodes.push(capacity, usableRate, txCurrent, txDuration, sleepCurrent, interval, block, result, monitor)

  const b = block.data as BlockData
  g.edges.push(
    { id: uid('e'), source: capacity.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[0].id },
    { id: uid('e'), source: usableRate.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[1].id },
    { id: uid('e'), source: txCurrent.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[2].id },
    { id: uid('e'), source: txDuration.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[3].id },
    { id: uid('e'), source: sleepCurrent.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[4].id },
    { id: uid('e'), source: interval.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[5].id },
    {
      id: uid('e'),
      source: block.id,
      sourcePort: b.calcs[2].id,
      target: result.id,
      targetPort: 'in',
    },
    {
      id: uid('e'),
      source: block.id,
      sourcePort: b.calcs[0].id,
      target: monitor.id,
      targetPort: 'in',
    },
  )
  return g
}

/**
 * IoT 製品の電池持ちサンプル（DCDC 効率あり）。
 * MCU/センサーは DCDC コンバータが作る出力電圧側で動く前提で、
 * 変換効率のロスと静止電流を電池側の消費電流に上乗せしてから
 * デューティ比で平均し、推定稼働時間を出す。
 */
export function iotBatteryDcDcGraph(): Graph {
  const g: Graph = { nodes: [], edges: [], nextId: 1 }
  const nid = () => `n${g.nextId++}`

  const constant = (x: number, y: number, title: string, value: number, unit: string) => newVariable(x, y, nid(), {
    title,
    value,
    mode: 'constant',
    min: value,
    max: value,
    step: 1,
    sweep: false,
    unit,
  })
  const capacity = constant(40, 40, '電池容量', 2000, 'mAh')
  const battVoltage = constant(40, 190, '電池電圧', 3.7, 'V')
  const usableRate = constant(40, 340, '使用可能率', 0.8, '1')
  const dcdcEff = constant(40, 490, 'DCDC効率', 0.85, '1')
  const quiescent = constant(40, 640, 'DCDC静止電流', 5, 'μA')
  const outVoltage = constant(300, 40, '出力電圧', 3.3, 'V')
  const txCurrent = constant(300, 190, '送信時負荷電流', 30, 'mA')
  const txDuration = constant(300, 340, '送信時間', 2, 's')
  const sleepCurrent = constant(300, 490, '待機時負荷電流', 0.01, 'mA')
  const interval = newVariable(300, 640, nid(), {
    title: '送信間隔',
    value: 300,
    mode: 'slider',
    min: 10,
    max: 600,
    step: 0.01,
    sweep: true,
    unit: 's',
  })

  const block = blockFromPreset(PRESETS.find((p) => p.key === 'iotBatteryDcDcLife')!, 610, 260, nid())
  const result = newResult(1030, 200, nid(), '電池持ち（時間）')
  ;(result.data as { target: number | null; digits: number }).target = 7100
  ;(result.data as { target: number | null; digits: number }).digits = 1
  const monitor = newMonitor(1030, 420, nid(), { title: '平均消費電流（電池側）', digits: 4 })

  g.nodes.push(capacity, battVoltage, usableRate, dcdcEff, quiescent, outVoltage, txCurrent, txDuration, sleepCurrent, interval, block, result, monitor)

  const b = block.data as BlockData
  g.edges.push(
    { id: uid('e'), source: capacity.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[0].id },
    { id: uid('e'), source: battVoltage.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[1].id },
    { id: uid('e'), source: usableRate.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[2].id },
    { id: uid('e'), source: dcdcEff.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[3].id },
    { id: uid('e'), source: quiescent.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[4].id },
    { id: uid('e'), source: outVoltage.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[5].id },
    { id: uid('e'), source: txCurrent.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[6].id },
    { id: uid('e'), source: txDuration.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[7].id },
    { id: uid('e'), source: sleepCurrent.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[8].id },
    { id: uid('e'), source: interval.id, sourcePort: 'out', target: block.id, targetPort: b.inputs[9].id },
    // calcs: [送信時出力電力, 送信時入力電流, 待機時出力電力, 待機時入力電流, 平均消費電流, 有効電池容量, 推定稼働時間]
    { id: uid('e'), source: block.id, sourcePort: b.calcs[6].id, target: result.id, targetPort: 'in' },
    { id: uid('e'), source: block.id, sourcePort: b.calcs[4].id, target: monitor.id, targetPort: 'in' },
  )
  return g
}

/* ---------------- サンプル一覧 ---------------- */

export interface Example {
  key: string
  title: string
  note: string
  build(): Graph
}

/** 「開く」から選べるサンプルの一覧。 */
export const EXAMPLES: Example[] = [
  {
    key: 'sheets',
    title: '板の枚数と金額',
    note: '切り上げが入る数量計算。逆算すると解が「範囲」で返ってくる例。',
    build: sampleGraph,
  },
  {
    key: 'battery',
    title: '電池残量計算',
    note: '容量と消費電流から残量・残り時間を出す、いちばん基本の形。',
    build: batteryGraph,
  },
  {
    key: 'iotBatteryLife',
    title: 'IoT電池寿命（シンプル）',
    note: '送信・待機のデューティ比から平均消費電流を求める。DCDC損失は考えない。',
    build: iotBatteryGraph,
  },
  {
    key: 'iotBatteryDcDcLife',
    title: 'IoT電池寿命（DCDC効率あり）',
    note: 'DCDCコンバータの変換効率・静止電流も上乗せしてから平均消費電流を求める、より現実に近い形。',
    build: iotBatteryDcDcGraph,
  },
]

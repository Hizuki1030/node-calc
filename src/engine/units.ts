import { parse, type Ast } from './parser.ts'
import { connectedInputUnit, inputPorts, isBlock, isMonitor, isResult, isTable, isVariable, outputPorts, type BlockData, type Graph } from '../types.ts'
import { CATALOG_UNITS } from '../units/catalog.ts'

type Dims = Record<string, number>

export interface UnitValue {
  dims: Dims
  scale: number
  label: string
}

export interface UnitIssue {
  key: string
  nodeId: string
  level: 'error' | 'warning'
  message: string
}

export interface UnitReport {
  ok: boolean
  issues: UnitIssue[]
}

/**
 * 記号 → 次元と SI 倍率。
 * 量ごとの表記はカタログ側で SI 接頭語から組み立て、ここには
 * カタログに載らない書き方（個数の助数詞など）と、昔の保存データに
 * 出てくる記号を残しておく。
 */
const LEGACY: Record<string, { dims: Dims; scale: number }> = {
  '1': { dims: {}, scale: 1 },
  '%': { dims: {}, scale: 1 },
  枚: { dims: {}, scale: 1 },
  個: { dims: {}, scale: 1 },
  件: { dims: {}, scale: 1 },
  回: { dims: {}, scale: 1 },
  本: { dims: {}, scale: 1 },
  台: { dims: {}, scale: 1 },
  人: { dims: {}, scale: 1 },
  'μm': { dims: { L: 1 }, scale: 1e-6 },
  m: { dims: { L: 1 }, scale: 1 },
  cm: { dims: { L: 1 }, scale: 1e-2 },
  mm: { dims: { L: 1 }, scale: 1e-3 },
  km: { dims: { L: 1 }, scale: 1e3 },
  ha: { dims: { L: 2 }, scale: 1e4 },
  ms: { dims: { T: 1 }, scale: 1e-3 },
  s: { dims: { T: 1 }, scale: 1 },
  min: { dims: { T: 1 }, scale: 60 },
  h: { dims: { T: 1 }, scale: 3600 },
  day: { dims: { T: 1 }, scale: 86400 },
  mg: { dims: { M: 1 }, scale: 1e-6 },
  kg: { dims: { M: 1 }, scale: 1 },
  g: { dims: { M: 1 }, scale: 1e-3 },
  t: { dims: { M: 1 }, scale: 1e3 },
  A: { dims: { I: 1 }, scale: 1 },
  mA: { dims: { I: 1 }, scale: 1e-3 },
  Ah: { dims: { I: 1, T: 1 }, scale: 3600 },
  mAh: { dims: { I: 1, T: 1 }, scale: 3.6 },
  K: { dims: { TEMP: 1 }, scale: 1 },
  '℃': { dims: { CELSIUS: 1 }, scale: 1 },
  Hz: { dims: { T: -1 }, scale: 1 },
  N: { dims: { M: 1, L: 1, T: -2 }, scale: 1 },
  kN: { dims: { M: 1, L: 1, T: -2 }, scale: 1e3 },
  Pa: { dims: { M: 1, L: -1, T: -2 }, scale: 1 },
  kPa: { dims: { M: 1, L: -1, T: -2 }, scale: 1e3 },
  MPa: { dims: { M: 1, L: -1, T: -2 }, scale: 1e6 },
  bar: { dims: { M: 1, L: -1, T: -2 }, scale: 1e5 },
  J: { dims: { M: 1, L: 2, T: -2 }, scale: 1 },
  kJ: { dims: { M: 1, L: 2, T: -2 }, scale: 1e3 },
  Wh: { dims: { M: 1, L: 2, T: -2 }, scale: 3600 },
  kWh: { dims: { M: 1, L: 2, T: -2 }, scale: 3.6e6 },
  W: { dims: { M: 1, L: 2, T: -3 }, scale: 1 },
  kW: { dims: { M: 1, L: 2, T: -3 }, scale: 1e3 },
  V: { dims: { M: 1, L: 2, T: -3, I: -1 }, scale: 1 },
  mV: { dims: { M: 1, L: 2, T: -3, I: -1 }, scale: 1e-3 },
  'Ω': { dims: { M: 1, L: 2, T: -3, I: -2 }, scale: 1 },
  'kΩ': { dims: { M: 1, L: 2, T: -3, I: -2 }, scale: 1e3 },
  L: { dims: { L: 3 }, scale: 1e-3 },
  mL: { dims: { L: 3 }, scale: 1e-6 },
  kHz: { dims: { T: -1 }, scale: 1e3 },
  MHz: { dims: { T: -1 }, scale: 1e6 },
  B: { dims: { DATA: 1 }, scale: 1 },
  KB: { dims: { DATA: 1 }, scale: 1e3 },
  MB: { dims: { DATA: 1 }, scale: 1e6 },
  GB: { dims: { DATA: 1 }, scale: 1e9 },
  TB: { dims: { DATA: 1 }, scale: 1e12 },
}

const KNOWN: Record<string, { dims: Dims; scale: number }> = { ...LEGACY, ...CATALOG_UNITS }

/**
 * 単位の解析結果を覚えておく。評価のたびに配線ぶんだけ呼ばれるので、
 * 同じ記号を何度も読み直さない。
 */
const parseCache = new Map<string, UnitValue | null>()

/**
 * 単位表記を解釈する。失敗しても投げずに null を返す（キャッシュ付き）。
 * 式の評価は毎フレーム走るので、評価側で単位を引くときもこれを使い、
 * 同じ記号を毎回パースし直さないようにする。
 */
export function tryParseUnit(unit: string | undefined | null): UnitValue | null {
  const key = unit?.trim()
  if (!key) return null
  const hit = parseCache.get(key)
  if (hit !== undefined) return hit
  let value: UnitValue | null = null
  try { value = parseUnit(key) } catch { value = null }
  parseCache.set(key, value)
  return value
}

/** SI の基準単位で見たときの倍率。1 mm なら 1e-3。解釈できなければ 1。 */
export function unitScale(unit: string): number {
  return tryParseUnit(unit)?.scale ?? 1
}

/**
 * from の表記で書かれた値を、to の表記へ直すための倍率。
 * 同じ量の別表記どうし（mm と m、h と s）でだけ 1 以外を返し、
 * 次元が違う・解釈できない場合は 1 を返して値をそのまま通す。
 */
export function unitRatio(from: string | undefined, to: string | undefined): number {
  const a = from?.trim() ?? ''
  const b = to?.trim() ?? ''
  if (!a || !b || a === b) return 1
  const left = tryParseUnit(a)
  const right = tryParseUnit(b)
  if (!left || !right || !sameDims(left, right)) return 1
  return left.scale / right.scale
}

/** from の表記の値を to の表記へ直す。 */
export function convertValue(value: number, from: string, to: string): number {
  const ratio = unitRatio(from, to)
  return ratio === 1 ? value : value * ratio
}

/** 表記が違うだけで同じ量か。mm と m、s と h は true。 */
export function sameQuantity(a: string, b: string): boolean {
  const left = tryParseUnit(a)
  const right = tryParseUnit(b)
  return Boolean(left && right && sameDims(left, right))
}

const cleanDims = (dims: Dims): Dims => Object.fromEntries(Object.entries(dims).filter(([, power]) => Math.abs(power) > 1e-12))

function combine(a: UnitValue, b: UnitValue, sign: 1 | -1): UnitValue {
  const dims = { ...a.dims }
  for (const [key, power] of Object.entries(b.dims)) dims[key] = (dims[key] ?? 0) + sign * power
  return { dims: cleanDims(dims), scale: a.scale * Math.pow(b.scale, sign), label: '' }
}

function power(a: UnitValue, exponent: number): UnitValue {
  return {
    dims: cleanDims(Object.fromEntries(Object.entries(a.dims).map(([key, value]) => [key, value * exponent]))),
    scale: Math.pow(a.scale, exponent),
    label: '',
  }
}

/** `kg*m/s^2` のような単位を、次元と倍率へ変換する。未知の記号も固有次元として扱う。 */
export function parseUnit(source: string): UnitValue {
  const src = source.trim().replace(/·/g, '*')
  if (!src) throw new Error('単位が未設定です')
  const parts = src.match(/[^*/]+|[*/]/g)
  if (!parts) throw new Error(`単位「${source}」を解釈できません`)
  let result: UnitValue = { dims: {}, scale: 1, label: src }
  let op: 1 | -1 = 1
  let expectFactor = true
  for (const raw of parts) {
    const token = raw.trim()
    if (token === '*' || token === '/') {
      if (expectFactor) throw new Error(`単位「${source}」の演算子位置が不正です`)
      op = token === '*' ? 1 : -1
      expectFactor = true
      continue
    }
    const match = token.match(/^(.+?)(?:\^(-?\d+(?:\.\d+)?))?$/)
    if (!match) throw new Error(`単位「${token}」を解釈できません`)
    const symbol = match[1].trim()
    const exponent = Number(match[2] ?? 1)
    const known = KNOWN[symbol]
    const factor: UnitValue = known
      ? { dims: known.dims, scale: known.scale, label: symbol }
      : { dims: { [`custom:${symbol}`]: 1 }, scale: 1, label: symbol }
    result = combine(result, power(factor, exponent), op)
    expectFactor = false
  }
  if (expectFactor) throw new Error(`単位「${source}」が途中で終わっています`)
  result.label = src
  return result
}

function sameDims(a: UnitValue, b: UnitValue): boolean {
  const keys = new Set([...Object.keys(a.dims), ...Object.keys(b.dims)])
  return [...keys].every((key) => Math.abs((a.dims[key] ?? 0) - (b.dims[key] ?? 0)) < 1e-12)
}

export function sameUnit(a: UnitValue, b: UnitValue): boolean {
  return sameDims(a, b) && Math.abs(Math.log(a.scale / b.scale)) < 1e-10
}

const dimensionless = (): UnitValue => ({ dims: {}, scale: 1, label: '1' })
const argError = (name: string) => new Error(`${name} の引数の単位が一致しません`)

/** ASTから単位を推論する。数値リテラルは無次元として扱う。 */
export function inferAstUnit(ast: Ast, env: Map<string, UnitValue>): UnitValue {
  switch (ast.t) {
    case 'num': return dimensionless()
    case 'ref': {
      const found = env.get(ast.name)
      if (!found) throw new Error(`${ast.name} の単位が見つかりません`)
      return found
    }
    case 'neg': return inferAstUnit(ast.x, env)
    case 'bin': {
      const left = inferAstUnit(ast.l, env)
      const right = inferAstUnit(ast.r, env)
      if (ast.op === '*' ) return combine(left, right, 1)
      if (ast.op === '/') return combine(left, right, -1)
      if (ast.op === '^') {
        if (ast.r.t !== 'num') throw new Error('べき乗の指数は単位のない数値定数にしてください')
        if (!sameUnit(right, dimensionless())) throw new Error('べき乗の指数には単位を付けられません')
        return power(left, ast.r.v)
      }
      if (ast.op === '%') {
        // + - と同じく、表記が違うだけの同じ量（h と s など）は評価側で右辺を左辺の表記へ揃える。
        if (!sameDims(left, right)) throw argError('%')
        return left
      }
      const zeroLeft = ast.l.t === 'num' && ast.l.v === 0
      const zeroRight = ast.r.t === 'num' && ast.r.v === 0
      // 表記の違い（h と s など）は次元さえ合えば OK。評価側（evalAst）が右辺を左辺の
      // 表記へ換算してから計算するので、ここでは量（次元）だけを見る。
      if (!sameDims(left, right) && !zeroLeft && !zeroRight) throw new Error(`${ast.op} の左右の単位が一致しません（${left.label} と ${right.label}）`)
      if (zeroLeft) return ['>', '>=', '<', '<=', '=', '<>'].includes(ast.op) ? dimensionless() : right
      if (zeroRight) return ['>', '>=', '<', '<=', '=', '<>'].includes(ast.op) ? dimensionless() : left
      return ['>', '>=', '<', '<=', '=', '<>'].includes(ast.op) ? dimensionless() : left
    }
    case 'call': {
      const args = ast.args.map((arg) => inferAstUnit(arg, env))
      const first = args[0] ?? dimensionless()
      if (['ABS', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'FLOOR', 'CEILING'].includes(ast.name)) return first
      if (['MIN', 'MAX', 'MOD'].includes(ast.name)) {
        const firstNonZero = args.find((_, index) => !(ast.args[index]?.t === 'num' && ast.args[index].v === 0)) ?? first
        if (args.some((unit, index) => !(ast.args[index]?.t === 'num' && ast.args[index].v === 0) && !sameUnit(unit, firstNonZero))) throw argError(ast.name)
        return firstNonZero
      }
      if (ast.name === 'SQRT') return power(first, 0.5)
      if (ast.name === 'PI') return dimensionless()
      if (ast.name === 'IF') {
        if (args[0] && !sameDims(args[0], dimensionless())) throw new Error('IF の条件は無次元にしてください')
        if (args[1] && args[2] && !sameUnit(args[1], args[2])) throw new Error('IF の2つの結果の単位が一致しません')
        return args[1] ?? dimensionless()
      }
      return first
    }
  }
}

interface RowUnitInfo {
  /** 計算行の値を、その行に指定した表記へ直すための倍率。 */
  factor: number
  /** その行の単位（宣言があれば宣言、無ければ式から推論した単位）。評価側が
   *  この行の名前を後続の式から参照するとき、表記換算に使う。 */
  unit: UnitValue | undefined
}

/**
 * ブロックの各計算行の単位情報をまとめて求める。blockRowFactors と
 * blockRowUnits の両方が同じ推論結果を必要とするため、ここで一度だけ計算する。
 *
 * 式そのものは入力に書かれた表記のまま計算する。丸めや定数の意味が
 * 式を書いたときのまま変わらないようにするためで、換算は行の出口でだけ行う。
 * 例えば mm の入力から作った長さを行の単位 m にすると、ここで 1/1000 になる。
 */
const rowInfoCache = new WeakMap<BlockData, RowUnitInfo[]>()

function blockRowInfo(data: BlockData): RowUnitInfo[] {
  const cached = rowInfoCache.get(data)
  if (cached) return cached

  const env = new Map<string, UnitValue>()
  for (const input of data.inputs) {
    const unit = tryParseUnit(input.unit)
    if (unit) env.set(input.name, unit)
  }
  const info = data.calcs.map((row): RowUnitInfo => {
    const declared = tryParseUnit(row.unit) ?? undefined
    let factor = 1
    let unit = declared
    try {
      const inferred = inferAstUnit(parse(row.expr), env)
      if (declared && sameDims(inferred, declared)) factor = inferred.scale / declared.scale
      unit = declared ?? inferred
      env.set(row.name, unit)
    } catch {
      // 単位を決められない式は換算しない。理由は単位チェックの方で知らせる。
      if (declared) env.set(row.name, declared)
    }
    return { factor: Number.isFinite(factor) && factor !== 0 ? factor : 1, unit }
  })
  rowInfoCache.set(data, info)
  return info
}

export function blockRowFactors(data: BlockData): number[] {
  return blockRowInfo(data).map((info) => info.factor)
}

/** 計算行ごとの単位。式の中で前の行を参照するときの表記換算に使う。 */
export function blockRowUnits(data: BlockData): (UnitValue | undefined)[] {
  return blockRowInfo(data).map((info) => info.unit)
}

function declaredUnit(unit: string | undefined, what: string): UnitValue {
  if (!unit?.trim()) throw new Error(`${what}の単位が未設定です`)
  return parseUnit(unit)
}

export function checkGraphUnits(graph: Graph): UnitReport {
  const issues: UnitIssue[] = []
  const add = (nodeId: string, key: string, message: string, level: UnitIssue['level'] = 'error') =>
    issues.push({ nodeId, key: `${nodeId}:${key}`, message, level })

  for (const node of graph.nodes) {
    // テキスト変数は単位を持たない（数式や単位換算の対象にならない文字列専用）。
    if (isVariable(node) && (node.data.mode ?? 'slider') !== 'text') {
      try { declaredUnit(node.data.unit, node.data.title || 'ノード') } catch (error) { add(node.id, 'unit', (error as Error).message) }
    }
    if (isBlock(node)) {
      const env = new Map<string, UnitValue>()
      for (const input of node.data.inputs) {
        try { env.set(input.name, declaredUnit(input.unit, `入力「${input.name}」`)) }
        catch (error) { add(node.id, input.id, (error as Error).message) }
      }
      for (const row of node.data.calcs) {
        let declared: UnitValue | undefined
        try { declared = declaredUnit(row.unit, `計算「${row.name}」`) }
        catch (error) { add(node.id, row.id, (error as Error).message) }
        try {
          const inferred = inferAstUnit(parse(row.expr), env)
          // 表記の違い（mm と m など）は評価時に換算するので、次元だけを見る。
          if (declared && !sameDims(inferred, declared)) {
            add(node.id, `${row.id}:mismatch`, `「${row.name}」の式から求まる単位（${inferred.label}）は指定単位「${row.unit}」と量が違います`)
          }
          if (declared) env.set(row.name, declared)
        } catch (error) {
          add(node.id, `${row.id}:expr`, `「${row.name}」: ${(error as Error).message}`)
          if (declared) env.set(row.name, declared)
        }
      }
    }
    if (isTable(node)) {
      // テキスト入力（完全一致検索用）は単位を持たない。
      for (const input of node.data.inputs.filter((input) => input.kind !== 'text')) {
        try { declaredUnit(input.unit, `入力「${input.name}」`) }
        catch (error) { add(node.id, input.id, (error as Error).message) }
      }
      for (const output of node.data.outputs) {
        try { declaredUnit(output.unit, `出力「${output.name}」`) }
        catch (error) { add(node.id, output.id, (error as Error).message) }
      }
    }
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  for (const edge of graph.edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    const out = source && outputPorts(source).find((port) => port.id === edge.sourcePort)
    const input = target && inputPorts(target).find((port) => port.id === edge.targetPort)
    if (!source || !target || !out || !input || !out.unit || !input.unit || isResult(target) || isMonitor(target)) continue
    try {
      // 同じ量なら表記が違っても構わない。値は評価時に接続先の表記へ換算する。
      if (!sameDims(parseUnit(out.unit), parseUnit(input.unit))) {
        add(target.id, edge.id, `接続「${out.name} → ${input.name}」の単位の量が違います（${out.unit} → ${input.unit}）`)
      }
    } catch { /* 個別の未設定・構文エラーで報告済み */ }
  }
  for (const node of graph.nodes.filter(isMonitor)) {
    if ((node.data.mode ?? 'value') !== 'pie') continue
    const connectedUnits = inputPorts(node)
      .map((port) => ({ port, unit: connectedInputUnit(graph, node.id, port.id) }))
      .filter((item) => item.unit)
    const first = connectedUnits[0]
    if (!first) continue
    for (const item of connectedUnits.slice(1)) {
      try {
        if (!sameUnit(parseUnit(first.unit), parseUnit(item.unit))) {
          add(node.id, `pie:${item.port.id}`, `円グラフの入力単位が一致しません（${first.unit} と ${item.unit}）`)
        }
      } catch { /* 元ノード側の単位エラーで報告する */ }
    }
  }
  return { ok: issues.every((issue) => issue.level !== 'error'), issues }
}

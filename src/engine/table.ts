import type { TableCell, TableData, TableInputDef } from '../types.ts'

export interface ParsedNumericTable {
  headers: string[]
  rows: TableCell[][]
  /** 列ごとに、テキスト列（完全一致検索用）と判定されたか。数値変換できる値が1つもない列がテキスト列になる。 */
  textColumns: boolean[]
  skippedRows: number
}

export interface TableLookupResult {
  /** data.outputs と同じ順番の値。 */
  values: number[]
  /** 補間方法は入力座標の位置関係だけで決まるので、全出力で共通。 */
  method: 'exact' | 'nearest' | 'linear' | 'continuous-neighbors'
}

function delimiterOf(source: string): string {
  const line = source.split(/\r?\n/).find((item) => item.trim()) ?? ''
  const candidates = [',', '\t', ';']
  const counts = candidates.map((delimiter) => {
    let count = 0
    let quoted = false
    for (const char of line) {
      if (char === '"') quoted = !quoted
      else if (!quoted && char === delimiter) count++
    }
    return { delimiter, count }
  })
  return counts.sort((a, b) => b.count - a.count)[0]?.delimiter ?? ','
}

function parseRecords(source: string, delimiter: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"'
        index++
      } else quoted = !quoted
    } else if (!quoted && char === delimiter) {
      record.push(field)
      field = ''
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && source[index + 1] === '\n') index++
      record.push(field)
      if (record.some((item) => item.trim())) records.push(record)
      record = []
      field = ''
    } else {
      field += char
    }
  }
  record.push(field)
  if (record.some((item) => item.trim())) records.push(record)
  return records
}

function numericCell(source: string): number {
  const clean = source.trim().replace(/%$/, '')
  if (!clean) return Number.NaN
  return Number(clean)
}

/**
 * カンマ・タブ・セミコロン区切りの、ヘッダー付き表を読む。
 *
 * 列は基本的に数値として扱うが、数値に変換できる値が1つもない列（地名や型番などの
 * カテゴリ列）は、完全一致検索用のテキスト列として文字列のまま保持する。
 * 数値列の中にたまに混じる不正な値（1行だけ壊れている等）は、その行だけを除外する
 * 従来どおりの挙動を保つ。
 */
export function parseNumericTable(source: string): ParsedNumericTable {
  const records = parseRecords(source.replace(/^\uFEFF/, ''), delimiterOf(source))
  if (records.length < 2) throw new Error('ヘッダーと1行以上のデータが必要です')
  const headers = records[0].map((header, index) => header.trim() || `列${index + 1}`)
  if (headers.length < 2) throw new Error('入力列と出力列の2列以上が必要です')

  const dataRecords = records.slice(1)
  const textColumns = headers.map((_, col) =>
    !dataRecords.some((record) => {
      const cell = (record[col] ?? '').trim()
      return cell !== '' && Number.isFinite(numericCell(cell))
    }))

  const rows: TableCell[][] = []
  let skippedRows = 0
  for (const record of dataRecords) {
    const row = headers.map((_, col): TableCell => {
      const raw = record[col] ?? ''
      return textColumns[col] ? raw.trim() : numericCell(raw)
    })
    const valid = row.every((cell, col) => textColumns[col] || Number.isFinite(cell as number))
    if (valid) rows.push(row)
    else skippedRows++
  }
  if (!rows.length) throw new Error('データとして読める行がありません')
  return { headers, rows, textColumns, skippedRows }
}

/** `入力電圧 [V]` や `Vin(V)` から表示名と単位を取り出す。 */
export function splitHeaderUnit(header: string): { name: string; unit: string } {
  const match = header.trim().match(/^(.*?)\s*(?:\[([^\]]+)\]|\(([^)]+)\))\s*$/)
  return match ? { name: match[1].trim() || header, unit: (match[2] ?? match[3] ?? '').trim() } : { name: header.trim(), unit: '' }
}

const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))
const keyOf = (values: number[]): string => values.map((value) => String(value)).join('\u001f')
const isFiniteNumber = (value: TableCell): value is number => typeof value === 'number' && Number.isFinite(value)

interface TableRow {
  coordinates: number[]
  /** data.outputs と同じ順番の値。 */
  outputs: number[]
}
interface Range {
  min: number
  max: number
  span: number
}

/**
 * 1 つの TableData について、行の抽出・値域・軸・座標索引をまとめて 1 度だけ作る。
 * スライダー操作では同じテーブルへの引き当てが毎フレーム走るため、ここを都度
 * 作り直すと行数に比例して入力が重くなる。
 */
interface PreparedTable {
  rows: TableRow[]
  ranges: Range[]
  /** 次元ごとの、重複を除いた昇順の軸値 */
  axes: number[][]
  /** 座標キー → 出力値の配列。完全一致の引き当てと多線形補間の頂点取得に使う */
  byCoordinate: Map<string, number[]>
  /** 入力値 → 結果。同じ値へ戻す操作が多いので短期キャッシュを持つ */
  memo: Map<string, TableLookupResult>
}

/** 引き当て結果キャッシュの上限。超えたら丸ごと捨てる（LRU にするほどの差は出ない）。 */
const MEMO_LIMIT = 4096

const prepared = new WeakMap<TableData, PreparedTable>()

/** data は不変更新されるので、参照が同じ間は前処理を使い回せる。 */
function prepare(data: TableData): PreparedTable {
  const hit = prepared.get(data)
  if (hit) return hit

  const columns = data.inputs.map((input) => input.column)
  const outputColumns = data.outputs.map((output) => output.column)
  const dimensions = columns.length
  const rows: TableRow[] = []
  for (const row of data.rows) {
    const outputs = outputColumns.map((column) => row[column])
    if (!outputs.every(isFiniteNumber)) continue
    const coordinates = columns.map((column) => row[column])
    if (!coordinates.every(isFiniteNumber)) continue
    rows.push({ coordinates, outputs })
  }

  // 行数が多いと Math.min(...values) は引数を積みきれずに落ちるため、1 パスで畳む。
  const ranges: Range[] = Array.from({ length: dimensions }, () => ({ min: Infinity, max: -Infinity, span: 1 }))
  const axisSets = Array.from({ length: dimensions }, () => new Set<number>())
  for (const row of rows) {
    for (let dimension = 0; dimension < dimensions; dimension++) {
      const value = row.coordinates[dimension]
      const range = ranges[dimension]
      if (value < range.min) range.min = value
      if (value > range.max) range.max = value
      axisSets[dimension].add(value)
    }
  }
  for (const range of ranges) {
    if (!Number.isFinite(range.min)) {
      range.min = 0
      range.max = 0
    }
    range.span = range.max - range.min || 1
  }

  const value: PreparedTable = {
    rows,
    ranges,
    axes: axisSets.map((axis) => [...axis].sort((a, b) => a - b)),
    byCoordinate: new Map(rows.map((row) => [keyOf(row.coordinates), row.outputs])),
    memo: new Map(),
  }
  prepared.set(data, value)
  return value
}

function distance2(a: number[], b: number[], ranges: Range[]): number {
  let sum = 0
  for (let index = 0; index < a.length; index++) {
    const delta = (a[index] - b[index]) / ranges[index].span
    sum += delta * delta
  }
  return sum
}

/** 昇順配列で value 以上になる最初の位置。見つからなければ配列長。 */
function lowerBound(axis: number[], value: number): number {
  let low = 0
  let high = axis.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (axis[mid] < value) low = mid + 1
    else high = mid
  }
  return low
}

/** 軸上に「ほぼ等しい」値があればその軸値へ寄せる。以降は完全一致で索引を引ける。 */
function snapToAxis(axis: number[], value: number): number {
  const at = lowerBound(axis, value)
  for (const candidate of [axis[at], axis[at - 1]]) {
    if (candidate !== undefined && nearlyEqual(candidate, value)) return candidate
  }
  return value
}

/** 距離の小さい順に最大 count 件だけ選ぶ。全体ソートは行数が増えると入力を止める。 */
function nearestRows(rows: TableRow[], target: number[], ranges: Range[], count: number): TableRow[] {
  const best: Array<{ row: TableRow; distance: number }> = []
  let worst = Infinity
  for (const row of rows) {
    const distance = distance2(row.coordinates, target, ranges)
    if (best.length === count && distance >= worst) continue
    let at = best.length
    while (at > 0 && best[at - 1].distance > distance) at--
    best.splice(at, 0, { row, distance })
    if (best.length > count) best.pop()
    worst = best[best.length - 1].distance
  }
  return best.map((item) => item.row)
}

/** 数値入力だけで最近傍・多線形補間の索引を引く。同じ data の間は前処理を使い回す。 */
function lookupNumeric(data: TableData, values: number[]): TableLookupResult {
  const table = prepare(data)
  const { rows, ranges, axes } = table
  if (!rows.length) throw new Error('使用できるテーブルデータがありません')

  const memoKey = keyOf(values)
  const memoized = table.memo.get(memoKey)
  if (memoized) return memoized

  // 範囲外は端へ固定したうえで、軸上のほぼ等しい値へ寄せる。
  // 寄せておくと完全一致も格子の頂点も索引から O(1) で引ける。
  const clamped = values.map((value, index) =>
    snapToAxis(axes[index], Math.max(ranges[index].min, Math.min(ranges[index].max, value))))

  const result = lookupClamped(data, table, clamped, values.length)
  if (table.memo.size >= MEMO_LIMIT) table.memo.clear()
  table.memo.set(memoKey, result)
  return result
}

/**
 * 多入力・多出力テーブルを最近傍または多線形補間で評価する。範囲外は端へ固定する。
 *
 * テキスト入力（input.kind === 'text'）は数値の格子に混ぜず、まず完全一致で行を
 * 絞り込んでから、残りの数値入力で通常どおり検索する。全入力がテキストなら、
 * 一致した最初の行の出力をそのまま返す。
 */
export function lookupTable(data: TableData, values: Array<number | string>): TableLookupResult {
  if (!data.inputs.length) throw new Error('テーブル入力がありません')
  if (!data.outputs.length) throw new Error('テーブル出力がありません')
  if (values.length !== data.inputs.length) throw new Error('入力値が不正です')
  const inputColumns = data.inputs.map((input) => input.column)
  if (new Set(inputColumns).size !== inputColumns.length) throw new Error('同じCSV列を複数の入力へ指定できません')
  if (data.outputs.some((output) => inputColumns.includes(output.column))) throw new Error('入力列と出力列は別の列にしてください')

  const textEntries: Array<{ input: TableInputDef; index: number }> = []
  const numberEntries: Array<{ input: TableInputDef; index: number }> = []
  data.inputs.forEach((input, index) => (input.kind === 'text' ? textEntries : numberEntries).push({ input, index }))

  for (const { input, index } of numberEntries) {
    const value = values[index]
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`「${input.name}」の入力値が不正です`)
  }
  for (const { input, index } of textEntries) {
    if (typeof values[index] !== 'string') throw new Error(`「${input.name}」の入力値が不正です`)
  }

  let rows = data.rows
  if (textEntries.length) {
    rows = data.rows.filter((row) =>
      textEntries.every(({ input, index }) => String(row[input.column]).trim() === (values[index] as string).trim()))
    if (!rows.length) throw new Error('テキスト入力に一致する行が見つかりません')
  }

  if (!numberEntries.length) {
    // 全入力がテキスト：完全一致した最初の行をそのまま出力とする。
    const row = rows[0]
    const outValues = data.outputs.map((output) => {
      const cell = row[output.column]
      if (!isFiniteNumber(cell)) throw new Error(`出力「${output.name}」の列は数値である必要があります`)
      return cell
    })
    return { values: outValues, method: 'exact' }
  }

  const numberValues = numberEntries.map(({ index }) => values[index] as number)
  const numberData: TableData = textEntries.length
    ? { ...data, inputs: numberEntries.map(({ input }) => input), rows }
    : data
  return lookupNumeric(numberData, numberValues)
}

function lookupClamped(data: TableData, table: PreparedTable, clamped: number[], dimensions: number): TableLookupResult {
  const { rows, ranges, axes, byCoordinate } = table
  const outputCount = data.outputs.length

  const exact = byCoordinate.get(keyOf(clamped))
  if (exact !== undefined) return { values: exact, method: 'exact' }

  if (data.mode === 'nearest') {
    return { values: nearestRows(rows, clamped, ranges, 1)[0].outputs, method: 'nearest' }
  }

  // 直交格子が揃っていれば、1D線形・2D双線形を含む多線形補間を行う。
  if (dimensions <= 8) {
    const brackets = axes.map((axis, dimension) => {
      const upperIndex = lowerBound(axis, clamped[dimension])
      const upper = upperIndex >= axis.length ? axis[axis.length - 1] : axis[upperIndex]
      const lower = upperIndex <= 0 ? axis[0] : axis[upperIndex - 1]
      return { lower, upper }
    })
    let corners: Array<{ coordinates: number[]; weight: number }> = [{ coordinates: [], weight: 1 }]
    for (let dimension = 0; dimension < brackets.length; dimension++) {
      const { lower, upper } = brackets[dimension]
      const t = nearlyEqual(lower, upper) ? 0 : (clamped[dimension] - lower) / (upper - lower)
      corners = corners.flatMap((corner) => nearlyEqual(lower, upper)
        ? [{ coordinates: [...corner.coordinates, lower], weight: corner.weight }]
        : [
            { coordinates: [...corner.coordinates, lower], weight: corner.weight * (1 - t) },
            { coordinates: [...corner.coordinates, upper], weight: corner.weight * t },
          ])
    }
    const resolved = corners.map((corner) => ({ ...corner, outputs: byCoordinate.get(keyOf(corner.coordinates)) }))
    if (resolved.every((corner) => corner.outputs !== undefined)) {
      const values = Array.from({ length: outputCount }, (_, index) =>
        resolved.reduce((sum, corner) => sum + corner.weight * corner.outputs![index], 0))
      return { values, method: 'linear' }
    }
  }

  // 欠けた格子や散布データは、正規化距離の逆数で近傍点を連続補間する。
  const count = Math.min(rows.length, Math.max(2, Math.pow(2, Math.min(dimensions, 6))))
  const nearest = nearestRows(rows, clamped, ranges, count)
  const weighted = nearest.map((row) => ({ row, weight: 1 / Math.max(distance2(row.coordinates, clamped, ranges), 1e-24) }))
  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0)
  const values = Array.from({ length: outputCount }, (_, index) =>
    weighted.reduce((sum, item) => sum + item.row.outputs[index] * item.weight, 0) / weightTotal)
  return { values, method: 'continuous-neighbors' }
}

import type { TableData } from '../types.ts'

export interface ParsedNumericTable {
  headers: string[]
  rows: number[][]
  skippedRows: number
}

export interface TableLookupResult {
  value: number
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

/** カンマ・タブ・セミコロン区切りの、ヘッダー付き数値表を読む。 */
export function parseNumericTable(source: string): ParsedNumericTable {
  const records = parseRecords(source.replace(/^\uFEFF/, ''), delimiterOf(source))
  if (records.length < 2) throw new Error('ヘッダーと1行以上のデータが必要です')
  const headers = records[0].map((header, index) => header.trim() || `列${index + 1}`)
  if (headers.length < 2) throw new Error('入力列と出力列の2列以上が必要です')
  const rows: number[][] = []
  let skippedRows = 0
  for (const record of records.slice(1)) {
    const row = headers.map((_, index) => numericCell(record[index] ?? ''))
    if (row.every(Number.isFinite)) rows.push(row)
    else skippedRows++
  }
  if (!rows.length) throw new Error('数値として読めるデータ行がありません')
  return { headers, rows, skippedRows }
}

/** `入力電圧 [V]` や `Vin(V)` から表示名と単位を取り出す。 */
export function splitHeaderUnit(header: string): { name: string; unit: string } {
  const match = header.trim().match(/^(.*?)\s*(?:\[([^\]]+)\]|\(([^)]+)\))\s*$/)
  return match ? { name: match[1].trim() || header, unit: (match[2] ?? match[3] ?? '').trim() } : { name: header.trim(), unit: '' }
}

const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b))
const keyOf = (values: number[]): string => values.map((value) => String(value)).join('\u001f')

interface TableRow {
  coordinates: number[]
  output: number
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
  /** 座標キー → 出力値。完全一致の引き当てと多線形補間の頂点取得に使う */
  byCoordinate: Map<string, number>
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
  const dimensions = columns.length
  const rows: TableRow[] = []
  for (const row of data.rows) {
    const output = row[data.output.column]
    if (!Number.isFinite(output)) continue
    const coordinates = columns.map((column) => row[column])
    if (!coordinates.every(Number.isFinite)) continue
    rows.push({ coordinates, output })
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
    byCoordinate: new Map(rows.map((row) => [keyOf(row.coordinates), row.output])),
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

/** 多入力テーブルを最近傍または多線形補間で評価する。範囲外は端へ固定する。 */
export function lookupTable(data: TableData, values: number[]): TableLookupResult {
  if (!data.inputs.length) throw new Error('テーブル入力がありません')
  if (values.length !== data.inputs.length || values.some((value) => !Number.isFinite(value))) throw new Error('入力値が不正です')
  const inputColumns = data.inputs.map((input) => input.column)
  if (new Set(inputColumns).size !== inputColumns.length) throw new Error('同じCSV列を複数の入力へ指定できません')
  if (inputColumns.includes(data.output.column)) throw new Error('入力列と出力列は別の列にしてください')
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

function lookupClamped(data: TableData, table: PreparedTable, clamped: number[], dimensions: number): TableLookupResult {
  const { rows, ranges, axes, byCoordinate } = table

  const exact = byCoordinate.get(keyOf(clamped))
  if (exact !== undefined) return { value: exact, method: 'exact' }

  if (data.mode === 'nearest') {
    return { value: nearestRows(rows, clamped, ranges, 1)[0].output, method: 'nearest' }
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
    const resolved = corners.map((corner) => ({ ...corner, output: byCoordinate.get(keyOf(corner.coordinates)) }))
    if (resolved.every((corner) => corner.output !== undefined)) {
      return { value: resolved.reduce((sum, corner) => sum + corner.weight * corner.output!, 0), method: 'linear' }
    }
  }

  // 欠けた格子や散布データは、正規化距離の逆数で近傍点を連続補間する。
  const count = Math.min(rows.length, Math.max(2, Math.pow(2, Math.min(dimensions, 6))))
  const nearest = nearestRows(rows, clamped, ranges, count)
  const weighted = nearest.map((row) => ({ row, weight: 1 / Math.max(distance2(row.coordinates, clamped, ranges), 1e-24) }))
  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0)
  return {
    value: weighted.reduce((sum, item) => sum + item.row.output * item.weight, 0) / weightTotal,
    method: 'continuous-neighbors',
  }
}

/** localStorage への保存。グラフの自動保存と、ユーザーが作ったブロックの保管。 */

import type { BlockData, CalcNode, Edge, Graph, MonitorData, ResultData, TableData, VariableData } from '../types.ts'
import type { BlockPreset } from './presets.ts'

const GRAPH_KEY = 'node-calc.graph.v1'
const LIB_KEY = 'node-calc.library.v1'

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : null

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const text = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback

const displayDigits = (value: unknown): number => Math.max(0, Math.min(12, Math.round(finite(value, 3))))

/**
 * ポート id は 1 ノードの中で重複してはいけない。重複したまま描くと同じ id の
 * ハンドルが並び、あとから増やしたポートへ線をつなげなくなる。
 * 2 つ目以降に別の id を振り直し、既存の配線は先頭のポートへ残す。
 */
function withUniqueIds<T extends { id: string }>(items: T[], prefix: string): T[] {
  const seen = new Set<string>()
  return items.map((item, index) => {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      return item
    }
    let serial = index + 1
    let id = `${prefix}${serial}`
    while (seen.has(id)) id = `${prefix}${++serial}`
    seen.add(id)
    return { ...item, id }
  })
}

/**
 * 保存時期が古いプロジェクトや一部欠けた JSON を、現在の描画モデルへ補完する。
 * 読込データを直接 React コンポーネントへ渡して黒画面になるのを防ぐ。
 */
export function normalizeGraph(value: unknown): Graph | null {
  const source = record(value)
  if (!source || !Array.isArray(source.nodes) || !Array.isArray(source.edges)) return null

  const nodes: CalcNode[] = []
  for (const [index, rawNode] of source.nodes.entries()) {
    const item = record(rawNode)
    const data = record(item?.data)
    const kind = item?.kind
    if (!item || !data || !['variable', 'block', 'table', 'result', 'monitor'].includes(String(kind))) continue
    const id = text(item.id, `n${index + 1}`)
    const base = { id, kind: kind as CalcNode['kind'], x: finite(item.x, 80 + index * 20), y: finite(item.y, 80 + index * 20) }

    if (kind === 'variable') {
      const choices = Array.isArray(data.choices)
        ? data.choices.filter((candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate))
        : []
      const variable: VariableData = {
        title: text(data.title, '変数'),
        value: finite(data.value, 0),
        mode: data.mode === 'constant' || data.mode === 'select' || data.mode === 'slider' ? data.mode : 'slider',
        choices,
        min: finite(data.min, 0),
        max: finite(data.max, 1000),
        step: finite(data.step, 1),
        unit: text(data.unit),
        sweep: typeof data.sweep === 'boolean' ? data.sweep : true,
      }
      nodes.push({ ...base, kind: 'variable', data: variable })
      continue
    }

    if (kind === 'block') {
      const rawInputs = Array.isArray(data.inputs) ? data.inputs : []
      // 初期版で rows という名前だったデータも calcs として救済する。
      const rawCalcs = Array.isArray(data.calcs) ? data.calcs : Array.isArray(data.rows) ? data.rows : []
      const block: BlockData = {
        title: text(data.title, '計算'),
        note: text(data.note) || undefined,
        inputs: withUniqueIds(rawInputs.map((raw, inputIndex) => {
          const input = record(raw)
          return {
            id: text(input?.id, `${id}-input-${inputIndex + 1}`),
            name: text(input?.name, `入力${inputIndex + 1}`),
            unit: text(input?.unit),
          }
        }), `${id}-input-`),
        calcs: withUniqueIds(rawCalcs.map((raw, calcIndex) => {
          const calc = record(raw)
          return {
            id: text(calc?.id, `${id}-calc-${calcIndex + 1}`),
            name: text(calc?.name, `計算${calcIndex + 1}`),
            expr: text(calc?.expr, '0'),
            exposed: typeof calc?.exposed === 'boolean' ? calc.exposed : calcIndex === rawCalcs.length - 1,
            unit: text(calc?.unit),
          }
        }), `${id}-calc-`),
      }
      nodes.push({ ...base, kind: 'block', data: block })
      continue
    }

    if (kind === 'result') {
      const result: ResultData = {
        title: text(data.title, '結果'),
        target: typeof data.target === 'number' && Number.isFinite(data.target) ? data.target : null,
        digits: displayDigits(data.digits),
      }
      nodes.push({ ...base, kind: 'result', data: result })
      continue
    }

    if (kind === 'table') {
      const headers = Array.isArray(data.headers) ? data.headers.map((header, headerIndex) => text(header, `列${headerIndex + 1}`)) : []
      const rows = Array.isArray(data.rows) ? data.rows.flatMap((rawRow) => {
        if (!Array.isArray(rawRow)) return []
        const row = rawRow.map((cell) => finite(cell, Number.NaN))
        return row.every(Number.isFinite) ? [row] : []
      }) : []
      const rawInputs = Array.isArray(data.inputs) ? data.inputs : []
      const rawOutput = record(data.output)
      const table: TableData = {
        title: text(data.title, 'CSVテーブル変換'),
        mode: data.mode === 'nearest' ? 'nearest' : 'linear',
        inputs: withUniqueIds(rawInputs.map((raw, inputIndex) => {
          const input = record(raw)
          return {
            id: text(input?.id, `${id}-table-input-${inputIndex + 1}`),
            name: text(input?.name, `入力${inputIndex + 1}`),
            unit: text(input?.unit),
            column: Math.max(0, Math.round(finite(input?.column, inputIndex))),
          }
        }), `${id}-table-input-`),
        output: {
          id: text(rawOutput?.id, 'out'),
          name: text(rawOutput?.name, '出力'),
          unit: text(rawOutput?.unit),
          column: Math.max(0, Math.round(finite(rawOutput?.column, Math.max(0, headers.length - 1)))),
        },
        headers,
        rows,
        sourceName: text(data.sourceName) || undefined,
        digits: displayDigits(data.digits),
      }
      nodes.push({ ...base, kind: 'table', data: table })
      continue
    }

    const rawMonitorInputs = Array.isArray(data.inputs) ? data.inputs : [{ id: 'in', name: '入力1', unit: '' }]
    const monitor: MonitorData = {
      title: text(data.title, 'モニター'),
      digits: displayDigits(data.digits),
      mode: data.mode === 'pie' ? 'pie' : 'value',
      inputs: withUniqueIds(rawMonitorInputs.map((raw, inputIndex) => {
        const input = record(raw)
        return {
          id: text(input?.id, inputIndex === 0 ? 'in' : `${id}-monitor-${inputIndex + 1}`),
          name: text(input?.name, `入力${inputIndex + 1}`),
          unit: '',
        }
      }), `${id}-monitor-`),
      displayUnit: text(data.displayUnit) || undefined,
    }
    nodes.push({ ...base, kind: 'monitor', data: monitor })
  }

  const edges: Edge[] = source.edges.flatMap((rawEdge, index) => {
    const edge = record(rawEdge)
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') return []
    return [{
      id: text(edge.id, `edge-${index + 1}`),
      source: edge.source,
      sourcePort: text(edge.sourcePort ?? edge.sourceHandle, 'out'),
      target: edge.target,
      targetPort: text(edge.targetPort ?? edge.targetHandle, 'in'),
      label: text(edge.label) || undefined,
    }]
  })
  const largestNodeNumber = nodes.reduce((largest, node) => {
    const match = node.id.match(/^n(\d+)$/)
    return match ? Math.max(largest, Number(match[1])) : largest
  }, 0)
  return { nodes, edges, nextId: Math.max(finite(source.nextId, 1), largestNodeNumber + 1) }
}

export function saveGraph(g: Graph): void {
  try {
    localStorage.setItem(GRAPH_KEY, JSON.stringify(g))
  } catch {
    /* 容量超過などは黙って諦める（作業は続けられる） */
  }
}

export function loadGraph(): Graph | null {
  try {
    const raw = localStorage.getItem(GRAPH_KEY)
    if (!raw) return null
    return normalizeGraph(JSON.parse(raw))
  } catch {
    return null
  }
}

export function loadUserBlocks(): BlockPreset[] {
  try {
    const raw = localStorage.getItem(LIB_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as BlockPreset[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveUserBlocks(list: BlockPreset[]): void {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list))
  } catch {
    /* 同上 */
  }
}

/** キャンバス上のブロックを再利用できるプリセットに変換する。 */
export function blockToPreset(node: CalcNode): BlockPreset | null {
  if (node.kind !== 'block') return null
  const d = node.data as BlockData
  return {
    key: `user:${node.id}:${Date.now()}`,
    category: 'マイブロック',
    title: d.title,
    note: d.note,
    inputs: d.inputs.map((p) => ({ name: p.name, unit: p.unit })),
    calcs: d.calcs.map((c) => ({ name: c.name, expr: c.expr, exposed: c.exposed, unit: c.unit })),
  }
}

export function graphToJson(g: Graph): string {
  return JSON.stringify(g, null, 2)
}

export function graphFromJson(text: string): Graph {
  const graph = normalizeGraph(JSON.parse(text))
  if (!graph) throw new Error('node-calc のグラフ JSON ではないようです')
  return graph
}

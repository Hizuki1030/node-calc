/** グラフの状態。React Flow の内部状態ではなくこの Graph が唯一の真実で、
 *  キャンバスの表示はここから導出する。評価結果もここで一括して計算する。
 *
 *  状態は React の state ではなく購読可能なストアに置く。値を 1 つ変えただけで
 *  キャンバス上の全ノードが再描画されると、ノードが増えるほど入力が重くなるため、
 *  各ノードは useNode / useNodeResult で自分に関係する部分だけを購読する。 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  type BlockData,
  type CalcNode,
  type CalcRow,
  type Edge,
  type Graph,
  type MonitorData,
  type PortDef,
  type ResultData,
  type TableData,
  type VariableData,
  isBlock,
  outputPorts,
} from './types.ts'
import { type EvalResult, type NodeResult, createEvalCache, evaluateGraph } from './engine/evaluate.ts'
import { type BlockPreset, blockFromPreset, newMonitor, newResult, newTable, newVariable, sampleGraph, uid } from './library/presets.ts'
import { loadGraph, loadUserBlocks, normalizeGraph, saveGraph, saveUserBlocks } from './library/storage.ts'
import type { CalcDefinition } from './engine/program.ts'
import { unitRatio } from './engine/units.ts'
import { fmtNum } from './format.ts'

/** 状態を書き換える操作。参照は起動から終了まで変わらない。 */
export interface Actions {
  /** opts.toggle を立てると、その 1 個だけを選択に足す/外す（シフト・コマンドクリック用）。 */
  select(id: string | null, opts?: { toggle?: boolean }): void
  /** ボックス選択など、選択の中身をまるごと差し替えるとき用。 */
  selectMany(ids: string[]): void
  setGraph(g: Graph): void
  addPreset(p: BlockPreset, x: number, y: number): string
  addVariable(x: number, y: number): string
  addResult(x: number, y: number): string
  addMonitor(x: number, y: number): string
  addTable(x: number, y: number): string
  removeNode(id: string): void
  removeNodes(ids: string[]): void
  moveNode(id: string, x: number, y: number): void
  moveNodes(moves: Array<{ id: string; x: number; y: number }>): void
  patchVariable(id: string, patch: Partial<VariableData>): void
  patchResult(id: string, patch: Partial<ResultData>): void
  patchMonitor(id: string, patch: Partial<MonitorData>): void
  patchTable(id: string, patch: Partial<TableData>): void
  addTableInput(id: string): void
  removeTableInput(id: string, portId: string): void
  addMonitorInput(id: string): void
  removeMonitorInput(id: string, portId: string): void
  renameMonitorInput(id: string, portId: string, name: string): void
  patchBlock(id: string, patch: Partial<BlockData>): void
  addInput(id: string): void
  removeInput(id: string, portId: string): void
  renameInput(id: string, portId: string, name: string): void
  addCalc(id: string, after?: string): void
  patchCalc(id: string, rowId: string, patch: Partial<CalcRow>): void
  removeCalc(id: string, rowId: string): void
  moveCalc(id: string, rowId: string, dir: -1 | 1): void
  replaceCalculations(id: string, definitions: CalcDefinition[]): void
  replaceBlockDefinition(id: string, draft: BlockDraft): void
  connect(source: string, sourcePort: string, target: string, targetPort: string): void
  removeEdge(edgeId: string): void
  patchEdge(edgeId: string, patch: Partial<Pick<Edge, 'label'>>): void
  saveBlockToLibrary(id: string): void
  removeUserBlock(key: string): void
}

export interface Store extends Actions {
  graph: Graph
  results: EvalResult
  /** ちょうど 1 個だけ選ばれているときのその id。複数選択中や未選択なら null。 */
  selected: string | null
  /** 現在選ばれている全ノードの id。 */
  selectedIds: Set<string>
  userBlocks: BlockPreset[]
}

export interface BlockDraft {
  title: string
  note?: string
  inputs: Array<{ name: string; unit: string }>
  calcs: Array<{ name: string; expr: string; unit: string; exposed: boolean }>
}

/** 換算で出る浮動小数の端数を落とす。0.45500000000000007 のような値を見せない。 */
const tidy = (value: number): number => Number(value.toPrecision(12))

/** ノード 1 つだけを差し替えた新しいグラフを返す。 */
function withNode(g: Graph, id: string, fn: (n: CalcNode) => CalcNode): Graph {
  return { ...g, nodes: g.nodes.map((n) => (n.id === id ? fn(n) : n)) }
}

function replaceReference(expr: string, from: string, to: string): string {
  if (!from || from === to) return expr
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // このアプリで許可する識別子の内側だけは置換しない（例: 長さ と 全長 を区別）。
  const part = 'A-Za-z_À-ɏ々〆぀-ヿ㐀-䶿一-鿿０-ﾟ0-9.'
  return expr.replace(new RegExp(`(?<![${part}])${escaped}(?![${part}])`, 'g'), to)
}

/**
 * 差し替え後の並びに、元の行を 1 対 1 で対応づける。
 * 名前が一致する行を先に押さえ、余った行だけを同じ位置の行へ回す。
 *
 * 同じ元行を二度返さないことが要点。ここで id を二重に配ると、ポート id が
 * 重複したノードができ、あとから増やした引数へ線がつながらなくなる。
 */
function matchPrevious<P extends { id: string; name: string }>(
  next: { name: string }[],
  old: P[],
): (P | undefined)[] {
  // 名前で結ばれる行は、位置合わせの取り分から先に外しておく。
  const byName = new Set(next.flatMap((item) => {
    const match = old.find((row) => row.name === item.name)
    return match ? [match.id] : []
  }))
  const used = new Set<string>()
  return next.map((item, index) => {
    const exact = old.find((row) => row.name === item.name && !used.has(row.id))
    const sameSlot = old[index]
    const positional = sameSlot && !used.has(sameSlot.id) && !byName.has(sameSlot.id) ? sameSlot : undefined
    const previous = exact ?? positional
    if (previous) used.add(previous.id)
    return previous
  })
}

/* ---------------- 配線から導かれる表示用の索引 ---------------- */

/**
 * ノードが自分の周りの配線を調べるための索引。
 * これが無いと、1 ノードの表示を作るたびに全配線を走査することになり、
 * ノード数 × 配線数の走査がスライダーを動かすたびに起きる。
 */
interface Wiring {
  /** `${source}/${port}` → その出力から出ているネット名（中黒つなぎ） */
  outLabels: Map<string, string>
  /** `${target}/${port}` → 接続元の情報。packIncoming で 1 本の文字列に畳んである */
  incoming: Map<string, string>
  /** `${source}/${port}` → その出力ポートに配られた配線の色 */
  colors: Map<string, string>
}

/** 接続元のうち、入力側の表示に必要なもの。 */
export interface Incoming {
  connected: boolean
  /** 接続元の出力ポート名 */
  name: string
  unit: string
  /** 配線に付けたネット名 */
  label: string
  /** 接続元の出力ポートに配られた色 */
  color: string
}

/**
 * 配線を見分けるための色。出力ポート 1 つに 1 色を配るので、
 * 同じ値から枝分かれした線は同じ色になり、値の行き先を目で追える。
 * 隣り合う番号どうしが似ないよう、色相を飛ばして並べてある。
 */
export const NET_COLORS = [
  '#4c9aff', // 青
  '#ffb020', // 橙
  '#2ecc8f', // 緑
  '#c084fc', // 紫
  '#f87171', // 朱
  '#22d3ee', // 水
  '#f472b6', // 桃
  '#a3e635', // 黄緑
]

/** 未接続のポートの色。styles.css の --port-idle と揃えている。 */
export const PORT_IDLE = '#5a5a5a'

export const netColorAt = (index: number): string => NET_COLORS[index % NET_COLORS.length]

/** ポート名や単位に現れない制御文字を区切りに使う。 */
const SEP = String.fromCharCode(31)
const NOT_CONNECTED: Incoming = { connected: false, name: '', unit: '', label: '', color: PORT_IDLE }

// 文字列に畳んでおくと、値だけが変わった再評価では内容が同じことを ===
// ひとつで判定でき、無関係なノードの再描画が起きない。
const packIncoming = (name: string, unit: string, label: string, color: string) =>
  `${name}${SEP}${unit}${SEP}${label}${SEP}${color}`

function unpackIncoming(packed: string | undefined): Incoming {
  if (packed === undefined) return NOT_CONNECTED
  const [name, unit, label, color] = packed.split(SEP)
  return { connected: true, name, unit, label, color }
}

function buildWiring(graph: Graph): Wiring {
  const portOf = new Map<string, PortDef>()
  const colorOf = new Map<string, string>()
  let colorIndex = 0
  for (const node of graph.nodes) {
    for (const port of outputPorts(node)) {
      portOf.set(`${node.id}/${port.id}`, port)
      colorOf.set(`${node.id}/${port.id}`, netColorAt(colorIndex++))
    }
  }

  const labelLists = new Map<string, string[]>()
  const incoming = new Map<string, string>()
  for (const edge of graph.edges) {
    const source = `${edge.source}/${edge.sourcePort}`
    const port = portOf.get(source)
    const label = edge.label?.trim() ?? ''
    // 入力ポートに入る線は 1 本だけ。後から来た線が有効という既存の解釈に合わせる。
    if (port) {
      incoming.set(
        `${edge.target}/${edge.targetPort}`,
        packIncoming(port.name, port.unit, label, colorOf.get(source) ?? PORT_IDLE),
      )
    }
    if (!label) continue
    const list = labelLists.get(source)
    if (!list) labelLists.set(source, [label])
    else if (!list.includes(label)) list.push(label)
  }

  return {
    outLabels: new Map([...labelLists].map(([key, list]) => [key, list.join(' · ')])),
    incoming,
    colors: colorOf,
  }
}

/* ---------------- ストア本体 ---------------- */

interface GraphStore {
  subscribe(listener: () => void): () => void
  getGraph(): Graph
  getResults(): EvalResult
  getSelected(): string | null
  getSelectedIds(): Set<string>
  getUserBlocks(): BlockPreset[]
  getNode(id: string): CalcNode | undefined
  getWiring(): Wiring
  actions: Actions
}

function createGraphStore(initialGraph: Graph, initialBlocks: BlockPreset[]): GraphStore {
  const listeners = new Set<() => void>()
  // 前回の評価結果を持ち越し、値が変わっていないノードの計算と、
  // その結果を読んでいるコンポーネントの再描画を省く。
  const evalCache = createEvalCache()

  let graph = initialGraph
  let results = evaluateGraph(graph, undefined, evalCache)
  let selected: string | null = null
  let selectedIds = new Set<string>()
  let userBlocks = initialBlocks
  let nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]))
  // 配線索引は必要になったときだけ作る。誰も見ていないなら作らない。
  let wiring: Wiring | null = null

  const emit = () => {
    for (const listener of [...listeners]) listener()
  }

  const update = (fn: (g: Graph) => Graph) => {
    const next = fn(graph)
    if (next === graph) return
    graph = next
    nodeIndex = new Map(graph.nodes.map((n) => [n.id, n]))
    wiring = null
    results = evaluateGraph(graph, undefined, evalCache)
    emit()
  }

  const addNode = (make: (id: string) => CalcNode): string => {
    const id = `n${graph.nextId}`
    update((g) => ({ ...g, nextId: g.nextId + 1, nodes: [...g.nodes, make(id)] }))
    return id
  }

  // 選択が実際に変わったときだけ差し替えて emit する。中身が同じ Set を毎回
  // 作り直すと、購読側が Object.is で弾けず無関係な再描画を招く。
  const setSelection = (next: Set<string>) => {
    if (next.size === selectedIds.size && [...next].every((id) => selectedIds.has(id))) return
    selectedIds = next
    selected = next.size === 1 ? [...next][0] : null
    emit()
  }

  const actions: Actions = {
    select: (id, opts) => {
      if (id === null) {
        setSelection(new Set())
        return
      }
      if (opts?.toggle) {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelection(next)
        return
      }
      setSelection(new Set([id]))
    },
    selectMany: (ids) => setSelection(new Set(ids)),
    setGraph: (g) => {
      // プロジェクト切替・JSON読込・サンプル読込の全経路で現在形式へ揃える。
      // HMRで古いダイアログ状態が残っていても、生データを描画へ渡さない。
      selected = null
      selectedIds = new Set()
      update(() => normalizeGraph(g) ?? { nodes: [], edges: [], nextId: 1 })
      emit()
    },
    addPreset: (p, x, y) => addNode((id) => blockFromPreset(p, x, y, id)),
    addVariable: (x, y) => addNode((id) => newVariable(x, y, id)),
    addResult: (x, y) => addNode((id) => newResult(x, y, id)),
    addMonitor: (x, y) => addNode((id) => newMonitor(x, y, id)),
    addTable: (x, y) => addNode((id) => newTable(x, y, id)),
    removeNode: (id) => actions.removeNodes([id]),
    removeNodes: (ids) => {
      const dying = new Set(ids)
      update((g) => ({
        ...g,
        nodes: g.nodes.filter((n) => !dying.has(n.id)),
        edges: g.edges.filter((e) => !dying.has(e.source) && !dying.has(e.target)),
      }))
      // 消えたノードを選択に残さない。
      if ([...dying].some((id) => selectedIds.has(id))) {
        setSelection(new Set([...selectedIds].filter((id) => !dying.has(id))))
      }
    },
    moveNode: (id, x, y) => update((g) => withNode(g, id, (n) => ({ ...n, x, y }))),
    moveNodes: (moves) =>
      update((g) => {
        const patch = new Map(moves.map((m) => [m.id, m]))
        return { ...g, nodes: g.nodes.map((n) => { const m = patch.get(n.id); return m ? { ...n, x: m.x, y: m.y } : n }) }
      }),

    patchVariable: (id, patch) =>
      update((g) => withNode(g, id, (n) => {
        const current = n.data as VariableData
        const next: VariableData = { ...current, ...patch }
        // 表記を変えただけなら、表している量は同じ。値・範囲・刻みをその表記へ直す。
        // 例: 3000 mm を m にすると 3 m。値そのものを同時に指定されたときは触らない。
        if (patch.unit !== undefined && patch.value === undefined) {
          const ratio = unitRatio(current.unit, patch.unit)
          if (ratio !== 1) {
            next.value = tidy(current.value * ratio)
            next.min = tidy(current.min * ratio)
            next.max = tidy(current.max * ratio)
            next.step = tidy(current.step * ratio)
            if (current.choices?.length) next.choices = current.choices.map((value) => tidy(value * ratio))
          }
        }
        return { ...n, data: next }
      })),
    patchResult: (id, patch) =>
      update((g) => withNode(g, id, (n) => ({ ...n, data: { ...(n.data as ResultData), ...patch } }))),
    patchMonitor: (id, patch) =>
      update((g) => withNode(g, id, (n) => ({ ...n, data: { ...(n.data as MonitorData), ...patch } }))),
    patchTable: (id, patch) =>
      update((g) => {
        const current = g.nodes.find((node) => node.id === id)?.data as TableData | undefined
        if (!current) return g
        const next = { ...current, ...patch }
        const inputIds = new Set(next.inputs.map((input) => input.id))
        return {
          ...withNode(g, id, (node) => ({ ...node, data: next })),
          edges: g.edges.filter((edge) =>
            (edge.target !== id || inputIds.has(edge.targetPort))
            && (edge.source !== id || edge.sourcePort === next.output.id),
          ),
        }
      }),
    addTableInput: (id) =>
      update((g) => withNode(g, id, (node) => {
        const data = node.data as TableData
        const column = data.headers.findIndex((_, index) => !data.inputs.some((input) => input.column === index) && index !== data.output.column)
        const nextColumn = column >= 0 ? column : 0
        return { ...node, data: { ...data, inputs: [...data.inputs, { id: uid('ti'), name: data.headers[nextColumn] || `入力${data.inputs.length + 1}`, unit: '', column: nextColumn }] } }
      })),
    removeTableInput: (id, portId) =>
      update((g) => {
        const node = g.nodes.find((item) => item.id === id)
        const data = node?.data as TableData | undefined
        if (!data || data.inputs.length <= 1) return g
        return {
          ...withNode(g, id, (item) => ({ ...item, data: { ...(item.data as TableData), inputs: data.inputs.filter((input) => input.id !== portId) } })),
          edges: g.edges.filter((edge) => !(edge.target === id && edge.targetPort === portId)),
        }
      }),
    addMonitorInput: (id) =>
      update((g) => withNode(g, id, (n) => {
        const data = n.data as MonitorData
        const inputs = data.inputs?.length ? data.inputs : [{ id: 'in', name: '入力1', unit: '' }]
        const used = new Set(inputs.map((input) => input.name))
        let index = inputs.length + 1
        while (used.has(`入力${index}`)) index++
        return { ...n, data: { ...data, inputs: [...inputs, { id: uid('mi'), name: `入力${index}`, unit: '' }] } }
      })),
    removeMonitorInput: (id, portId) =>
      update((g) => {
        const monitor = g.nodes.find((node) => node.id === id)
        const data = monitor?.data as MonitorData | undefined
        const inputs = data?.inputs?.length ? data.inputs : [{ id: 'in', name: '入力1', unit: '' }]
        if (inputs.length <= 1) return g
        return {
          ...withNode(g, id, (n) => ({ ...n, data: { ...(n.data as MonitorData), inputs: inputs.filter((input) => input.id !== portId) } })),
          edges: g.edges.filter((edge) => !(edge.target === id && edge.targetPort === portId)),
        }
      }),
    renameMonitorInput: (id, portId, name) =>
      update((g) => withNode(g, id, (n) => {
        const data = n.data as MonitorData
        const inputs = data.inputs?.length ? data.inputs : [{ id: 'in', name: '入力1', unit: '' }]
        return { ...n, data: { ...data, inputs: inputs.map((input) => input.id === portId ? { ...input, name } : input) } }
      })),
    patchBlock: (id, patch) =>
      update((g) => withNode(g, id, (n) => ({ ...n, data: { ...(n.data as BlockData), ...patch } }))),

    addInput: (id) =>
      update((g) =>
        withNode(g, id, (n) => {
          const d = n.data as BlockData
          const used = new Set(d.inputs.map((p) => p.name))
          let name = '入力'
          let k = 1
          while (used.has(name)) name = `入力${++k}`
          return { ...n, data: { ...d, inputs: [...d.inputs, { id: uid('p'), name, unit: '' }] } }
        }),
      ),
    removeInput: (id, portId) =>
      update((g) => ({
        ...withNode(g, id, (n) => {
          const d = n.data as BlockData
          return { ...n, data: { ...d, inputs: d.inputs.filter((p) => p.id !== portId) } }
        }),
        edges: g.edges.filter((e) => !(e.target === id && e.targetPort === portId)),
      })),
    renameInput: (id, portId, name) =>
      update((g) =>
        withNode(g, id, (n) => {
          const d = n.data as BlockData
          const before = d.inputs.find((p) => p.id === portId)?.name ?? ''
          return {
            ...n,
            data: {
              ...d,
              inputs: d.inputs.map((p) => (p.id === portId ? { ...p, name } : p)),
              calcs: d.calcs.map((calc) => ({ ...calc, expr: replaceReference(calc.expr, before, name) })),
            },
          }
        }),
      ),

    addCalc: (id, after) =>
      update((g) =>
        withNode(g, id, (n) => {
          const d = n.data as BlockData
          const used = new Set(d.calcs.map((c) => c.name))
          let name = '計算'
          let k = 1
          while (used.has(name)) name = `計算${++k}`
          const row: CalcRow = { id: uid('c'), name, expr: '0', exposed: false, unit: '' }
          const at = after ? d.calcs.findIndex((c) => c.id === after) + 1 : d.calcs.length
          const calcs = [...d.calcs]
          calcs.splice(at, 0, row)
          return { ...n, data: { ...d, calcs } }
        }),
      ),
    patchCalc: (id, rowId, patch) =>
      update((g) => withNode(g, id, (n) => {
        const d = n.data as BlockData
        const before = d.calcs.find((c) => c.id === rowId)?.name ?? ''
        const at = d.calcs.findIndex((c) => c.id === rowId)
        return {
          ...n,
          data: {
            ...d,
            calcs: d.calcs.map((c, index) => {
              if (c.id === rowId) return { ...c, ...patch }
              if (patch.name !== undefined && index > at) return { ...c, expr: replaceReference(c.expr, before, patch.name) }
              return c
            }),
          },
        }
      })),
    removeCalc: (id, rowId) =>
      update((g) => ({
        ...withNode(g, id, (n) => {
          const d = n.data as BlockData
          return { ...n, data: { ...d, calcs: d.calcs.filter((c) => c.id !== rowId) } }
        }),
        edges: g.edges.filter((e) => !(e.source === id && e.sourcePort === rowId)),
      })),
    moveCalc: (id, rowId, dir) =>
      update((g) =>
        withNode(g, id, (n) => {
          const d = n.data as BlockData
          const i = d.calcs.findIndex((c) => c.id === rowId)
          const j = i + dir
          if (i < 0 || j < 0 || j >= d.calcs.length) return n
          const calcs = [...d.calcs]
          ;[calcs[i], calcs[j]] = [calcs[j], calcs[i]]
          return { ...n, data: { ...d, calcs } }
        }),
      ),

    replaceCalculations: (id, definitions) =>
      update((g) => {
        const node = g.nodes.find((item) => item.id === id)
        if (!node || !isBlock(node)) return g
        const matched = matchPrevious(definitions, node.data.calcs)
        const calcs = definitions.map((definition, index): CalcRow => {
          const previous = matched[index]
          return {
            id: previous?.id ?? uid('c'),
            name: definition.name,
            expr: definition.expr,
            unit: previous?.unit ?? '',
            exposed: previous?.exposed ?? false,
          }
        })
        const calcIds = new Set(calcs.map((row) => row.id))
        return {
          ...withNode(g, id, (item) => ({ ...item, data: { ...(item.data as BlockData), calcs } })),
          edges: g.edges.filter((edge) => edge.source !== id || calcIds.has(edge.sourcePort)),
        }
      }),

    replaceBlockDefinition: (id, draft) =>
      update((g) => {
        const node = g.nodes.find((item) => item.id === id)
        if (!node || !isBlock(node)) return g
        const old = node.data
        const matchedInputs = matchPrevious(draft.inputs, old.inputs)
        const matchedCalcs = matchPrevious(draft.calcs, old.calcs)
        const inputs = draft.inputs.map((input, index) => ({
          id: matchedInputs[index]?.id ?? uid('p'),
          name: input.name,
          unit: input.unit,
        }))
        const calcs = draft.calcs.map((calc, index) => ({
          id: matchedCalcs[index]?.id ?? uid('c'),
          ...calc,
        }))
        const inputIds = new Set(inputs.map((item) => item.id))
        const calcIds = new Set(calcs.map((item) => item.id))
        return {
          ...withNode(g, id, (item) => ({ ...item, data: { title: draft.title, note: draft.note, inputs, calcs } })),
          edges: g.edges.filter((edge) =>
            (edge.target !== id || inputIds.has(edge.targetPort))
            && (edge.source !== id || calcIds.has(edge.sourcePort)),
          ),
        }
      }),

    connect: (source, sourcePort, target, targetPort) =>
      update((g) => ({
        ...g,
        // 入力ポートは 1 本だけ。差し替えになるよう既存の線を外す
        edges: [
          ...g.edges.filter((e) => !(e.target === target && e.targetPort === targetPort)),
          { id: uid('e'), source, sourcePort, target, targetPort },
        ],
      })),
    removeEdge: (edgeId) => update((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== edgeId) })),
    patchEdge: (edgeId, patch) => update((g) => ({
      ...g,
      edges: g.edges.map((edge) => edge.id === edgeId ? { ...edge, ...patch } : edge),
    })),

    saveBlockToLibrary: (id) => {
      const node = graph.nodes.find((n) => n.id === id)
      if (!node || !isBlock(node)) return
      const d = node.data
      const preset: BlockPreset = {
        key: `user:${Date.now()}`,
        category: 'マイブロック',
        title: d.title,
        note: d.note,
        inputs: d.inputs.map((p) => ({ name: p.name, unit: p.unit })),
        calcs: d.calcs.map((c) => ({ name: c.name, expr: c.expr, exposed: c.exposed, unit: c.unit })),
      }
      userBlocks = [...userBlocks.filter((b) => b.title !== preset.title), preset]
      saveUserBlocks(userBlocks)
      emit()
    },
    removeUserBlock: (key) => {
      userBlocks = userBlocks.filter((b) => b.key !== key)
      saveUserBlocks(userBlocks)
      emit()
    },
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getGraph: () => graph,
    getResults: () => results,
    getSelected: () => selected,
    getSelectedIds: () => selectedIds,
    getUserBlocks: () => userBlocks,
    getNode: (id) => nodeIndex.get(id),
    getWiring: () => (wiring ??= buildWiring(graph)),
    actions,
  }
}

/* ---------------- React への接続 ---------------- */

const Ctx = createContext<GraphStore | null>(null)

function useGraphStore(): GraphStore {
  const s = useContext(Ctx)
  if (!s) throw new Error('GraphProvider の外で useStore を呼んでいます')
  return s
}

/**
 * ストアの一部分だけを購読する。selector の結果が前回と等しい間は再描画しない。
 * 参照ではなく値で比べたいときは isEqual を渡す。
 */
export function useStoreSelector<T>(
  selector: (store: GraphStore) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useGraphStore()
  const selectorRef = useRef(selector)
  const equalRef = useRef(isEqual)
  selectorRef.current = selector
  equalRef.current = isEqual
  // useSyncExternalStore は getSnapshot が === を返す間だけ再描画を止めるので、
  // 等価な結果は前回の参照のまま返す。
  const lastRef = useRef<{ value: T } | null>(null)

  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(store)
    const last = lastRef.current
    if (last && equalRef.current(last.value, next)) return last.value
    lastRef.current = { value: next }
    return next
  }, [store])

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

export function shallowEqualArray<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => Object.is(item, b[index]))
}

/** 状態を書き換える操作だけが必要なコンポーネント用。これ自体では再描画しない。 */
export function useActions(): Actions {
  return useGraphStore().actions
}

/** ノード 1 つ。data の不変更新により、他のノードが変わっても参照は保たれる。 */
export function useNode(id: string): CalcNode | undefined {
  return useStoreSelector(useCallback((store) => store.getNode(id), [id]))
}

/** ノード 1 つの評価結果。値が変わらなければ前回と同じ参照が返る。 */
export function useNodeResult(id: string): NodeResult | undefined {
  return useStoreSelector(useCallback((store) => store.getResults().get(id), [id]))
}

/** 配線の一覧。ノードの値だけが変わったときは参照が保たれる。 */
export function useEdges(): Edge[] {
  return useStoreSelector(useCallback((store) => store.getGraph().edges, []))
}

/** 出力ポートから出ているネット名。無ければ空文字。 */
export function useOutgoingLabel(id: string, portId: string): string {
  return useStoreSelector(useCallback((store) => store.getWiring().outLabels.get(`${id}/${portId}`) ?? '', [id, portId]))
}

/** 出力ポートに配られた配線の色。 */
export function useOutputColor(id: string, portId: string): string {
  return useStoreSelector(useCallback(
    (store) => store.getWiring().colors.get(`${id}/${portId}`) ?? PORT_IDLE,
    [id, portId],
  ))
}

/** 入力ポートへ来ている配線の色。未接続なら地色。 */
export function useIncomingColor(id: string, portId: string): string {
  return useStoreSelector(useCallback(
    (store) => unpackIncoming(store.getWiring().incoming.get(`${id}/${portId}`)).color,
    [id, portId],
  ))
}

/** 入力ポートへ来ている配線のネット名。無ければ空文字。 */
export function useIncomingLabel(id: string, portId: string): string {
  return useStoreSelector(useCallback(
    (store) => unpackIncoming(store.getWiring().incoming.get(`${id}/${portId}`)).label,
    [id, portId],
  ))
}

/** 入力ポートの単位。接続元の出力ポートから自動で取る。 */
export function useIncomingUnit(id: string, portId = 'in'): string {
  return useStoreSelector(useCallback(
    (store) => unpackIncoming(store.getWiring().incoming.get(`${id}/${portId}`)).unit,
    [id, portId],
  ))
}

/**
 * 複数の入力ポートの接続元をまとめて取る。
 * 畳んだ文字列の配列で比べるので、接続や名前が変わらない限り同じ配列を返す。
 */
export function useIncomingPorts(id: string, portIds: string[]): Incoming[] {
  const key = portIds.join(',')
  const packed = useStoreSelector(
    useCallback((store) => {
      const wiring = store.getWiring()
      return key ? key.split(',').map((portId) => wiring.incoming.get(`${id}/${portId}`) ?? '') : []
    }, [id, key]),
    shallowEqualArray,
  )
  return useMemo(() => packed.map((item) => (item ? unpackIncoming(item) : NOT_CONNECTED)), [packed])
}

/**
 * ブロック内の名前（入力名・計算行名）ごとに、その名前が式の中に出てきたとき
 * 配線と同じ色で見せるための色を引く。入力は接続元の配線色、計算行は自分の
 * 出力ポートに配られた色（buildWiring が全出力ポートへ配る）を使う。
 * 実際に色が変わったポートの分だけ再計算されるよう、詰めた文字列で比較する。
 */
export function useNameColors(id: string, inputs: PortDef[], calcs: CalcRow[]): Record<string, string> {
  const inputIds = inputs.map((p) => p.id)
  const calcIds = calcs.map((c) => c.id)
  const key = `${inputIds.join(',')}|${calcIds.join(',')}`
  const packed = useStoreSelector(
    useCallback((store) => {
      const wiring = store.getWiring()
      const [inPart, calcPart] = key.split('|')
      const ins = inPart ? inPart.split(',') : []
      const outs = calcPart ? calcPart.split(',') : []
      const inColors = ins.map((portId) => unpackIncoming(wiring.incoming.get(`${id}/${portId}`)).color)
      const outColors = outs.map((rowId) => wiring.colors.get(`${id}/${rowId}`) ?? PORT_IDLE)
      return [...inColors, ...outColors].join(',')
    }, [id, key]),
  )
  return useMemo(() => {
    const colors = packed.split(',')
    const map: Record<string, string> = {}
    inputs.forEach((p, i) => { if (p.name) map[p.name] = colors[i] })
    calcs.forEach((c, i) => { if (c.name) map[c.name] = colors[inputs.length + i] })
    return map
  }, [packed, inputs, calcs])
}

/**
 * ブロック内の名前（入力名・計算行名）ごとに、カーソルを乗せたとき見せる「今の値」の
 * 文字列を作る。式の中の変数と、入力ポート自身の両方の title 属性に使う。
 * 未接続の入力・エラーの計算行は、その旨だけ短く出す。
 */
export function useNameValues(id: string, inputs: PortDef[], calcs: CalcRow[]): Record<string, string> {
  const res = useNodeResult(id)
  return useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of inputs) {
      if (!p.name) continue
      const v = res?.inputs[p.id]
      map[p.name] = v === undefined ? `${p.name}: 未接続` : `${p.name} = ${fmtNum(v)}${p.unit ? ` ${p.unit}` : ''}`
    }
    for (const c of calcs) {
      if (!c.name) continue
      const row = res?.rows[c.id]
      map[c.name] = row?.error ? `${c.name}: ${row.error}` : `${c.name} = ${fmtNum(row?.value)}${c.unit ? ` ${c.unit}` : ''}`
    }
    return map
  }, [res, inputs, calcs])
}

export function useSelected(): string | null {
  return useStoreSelector(useCallback((store) => store.getSelected(), []))
}

/** 現在選ばれている全ノードの id。参照は選択が実際に変わったときだけ差し替わる。 */
export function useSelectedIds(): Set<string> {
  return useStoreSelector(useCallback((store) => store.getSelectedIds(), []))
}

export function useUserBlocks(): BlockPreset[] {
  return useStoreSelector(useCallback((store) => store.getUserBlocks(), []))
}

/** ノードの一覧。位置の変更や増減で入れ替わるが、個々のノードの参照は保たれる。 */
export function useNodes(): CalcNode[] {
  return useStoreSelector(useCallback((store) => store.getGraph().nodes, []))
}

/**
 * 購読せずに現在の状態を読むための入口。
 * イベントハンドラの中だけで必要な値は、これで読めば再描画の理由にならない。
 */
export function useStoreApi(): Pick<GraphStore, 'getGraph' | 'getResults' | 'getNode' | 'getSelected'> {
  return useGraphStore()
}

/** グラフ全体を購読する。編集パネルなど、広く読む場所だけで使う。 */
export function useStore(): Store {
  const store = useGraphStore()
  const graph = useStoreSelector(useCallback((s) => s.getGraph(), []))
  const results = useStoreSelector(useCallback((s) => s.getResults(), []))
  const selected = useSelected()
  const selectedIds = useSelectedIds()
  const userBlocks = useStoreSelector(useCallback((s) => s.getUserBlocks(), []))
  return useMemo(
    () => ({ graph, results, selected, selectedIds, userBlocks, ...store.actions }),
    [graph, results, selected, selectedIds, userBlocks, store],
  )
}

export function GraphProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createGraphStore(loadGraph() ?? sampleGraph(), loadUserBlocks()))

  // 保存はグラフが落ち着いてから、さらに手が空いた時に回す。
  // localStorage への書き込みは同期処理なので、CSV を抱えたグラフだと
  // そのあいだ入力が止まる。打鍵の合間に割り込ませない。
  useEffect(() => {
    let timer: number | undefined
    let idle = 0
    let saved = store.getGraph()

    const write = () => {
      idle = 0
      saveGraph(store.getGraph())
    }
    const unsubscribe = store.subscribe(() => {
      const graph = store.getGraph()
      if (graph === saved) return
      saved = graph
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (typeof requestIdleCallback !== 'function') return write()
        if (idle) cancelIdleCallback(idle)
        idle = requestIdleCallback(write, { timeout: 2000 })
      }, 400)
    })
    return () => {
      window.clearTimeout(timer)
      if (idle) cancelIdleCallback(idle)
      unsubscribe()
      // 離脱時は取りこぼさないよう確実に書く
      saveGraph(store.getGraph())
    }
  }, [store])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

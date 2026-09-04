/** ノードグラフのデータモデル。
 *
 * 設計の中心は「ノード = ミニ表計算ブロック」。ブロックは名前付き入力ポートと
 * 計算行の列を持ち、公開フラグの立った行が出力ポートになる。
 * 1 演算のノード（加算など）は計算行が 1 本だけのブロックのプリセットとして表す。
 */

export type NodeKind = 'variable' | 'block' | 'table' | 'result' | 'monitor'

/** ブロックの入力ポート。name が式の中で参照される識別子になる。 */
export interface PortDef {
  id: string
  name: string
  /** 値の単位。空文字は未設定として単位チェックでエラーにする。 */
  unit: string
}

/** ブロック内の計算行。上から順に評価し、前の行を name で参照できる。 */
export interface CalcRow {
  id: string
  name: string
  expr: string
  /** true ならこの行が出力ポートとして外に出る */
  exposed: boolean
  /** 計算結果の単位。公開・内部を問わず必須。 */
  unit: string
}

export interface BlockData {
  title: string
  inputs: PortDef[]
  calcs: CalcRow[]
  note?: string
}

export interface VariableData {
  title: string
  value: number
  /** 値の与え方: 固定値 / 候補リスト / 範囲スライダー / 文字列。
   *  'text' は数式の計算には使えず、CSVテーブル変換のテキスト入力（完全一致検索）専用。 */
  mode?: 'constant' | 'select' | 'slider' | 'text'
  /** mode === 'select' のときに選べる数値 */
  choices?: number[]
  /** mode === 'text' のときの値。 */
  text?: string
  min: number
  max: number
  step: number
  unit?: string
  /** スイープ・逆算の対象にするか。text モードでは意味を持たない。 */
  sweep: boolean
}

export interface ResultData {
  title: string
  /** 逆算のターゲット。未設定なら null */
  target: number | null
  /** 表示桁数 */
  digits: number
}

export interface MonitorData {
  title: string
  digits: number
  /** 単一の値を表示するか、複数入力を円グラフで比較するか。 */
  mode?: 'value' | 'pie'
  /** モニター専用の動的入力。旧データは inputPorts で1入力へ補完する。 */
  inputs?: PortDef[]
  /** 単一値表示のときだけ使う、表示用の表記（1h を 3600s で見たいときなど）。
   *  未設定なら接続元の表記のまま。量（次元）が違う表記を選んでも無視する。 */
  displayUnit?: string
}

/** CSVの1セルの値。数値列は number、テキスト列（完全一致検索用）は string のまま保持する。 */
export type TableCell = number | string

export interface TableInputDef extends PortDef {
  /** CSV内で参照する列番号。 */
  column: number
  /** 'text' なら数値化せず、完全一致でのみ絞り込む文字列列として扱う。省略時は 'number'。 */
  kind?: 'number' | 'text'
}

export interface TableOutputDef extends PortDef {
  column: number
}

/** CSVの離散データを最近傍または補間で連続的な値へ変換するノード。複数出力を持てる。 */
export interface TableData {
  title: string
  mode: 'nearest' | 'linear'
  inputs: TableInputDef[]
  outputs: TableOutputDef[]
  headers: string[]
  rows: TableCell[][]
  sourceName?: string
  digits: number
}

export type NodeData = BlockData | TableData | VariableData | ResultData | MonitorData

export interface CalcNode {
  id: string
  kind: NodeKind
  x: number
  y: number
  data: NodeData
}

export interface Edge {
  id: string
  /** 接続元ノード */
  source: string
  /** 接続元の出力ポート id。variable ノードは 'out' 固定 */
  sourcePort: string
  target: string
  /** 接続先の入力ポート id。result ノードは 'in' 固定 */
  targetPort: string
  /** 回路図のネット名のように、配線の両端へ表示するラベル。 */
  label?: string
}

export interface Graph {
  nodes: CalcNode[]
  edges: Edge[]
  nextId: number
}

/* ---- 型ガード ---- */

export function isVariable(n: CalcNode): n is CalcNode & { data: VariableData } {
  return n.kind === 'variable'
}
export function isBlock(n: CalcNode): n is CalcNode & { data: BlockData } {
  return n.kind === 'block'
}
export function isTable(n: CalcNode): n is CalcNode & { data: TableData } {
  return n.kind === 'table'
}
export function isResult(n: CalcNode): n is CalcNode & { data: ResultData } {
  return n.kind === 'result'
}
export function isMonitor(n: CalcNode): n is CalcNode & { data: MonitorData } {
  return n.kind === 'monitor'
}

/** ノードが外に出す出力ポートの一覧。 */
export function outputPorts(n: CalcNode): PortDef[] {
  if (isVariable(n)) return [{ id: 'out', name: n.data.title, unit: n.data.unit ?? '' }]
  if (isBlock(n))
    return n.data.calcs.filter((c) => c.exposed).map((c) => ({ id: c.id, name: c.name, unit: c.unit ?? '' }))
  if (isTable(n)) return n.data.outputs
  return []
}

/** ノードが受け取る入力ポートの一覧。 */
export function inputPorts(n: CalcNode): PortDef[] {
  if (isBlock(n)) return n.data.inputs
  if (isTable(n)) return n.data.inputs
  // 結果とモニターの単位は接続元から自動取得するため、入力ポート自身には持たせない。
  if (isResult(n)) return [{ id: 'in', name: n.data.title, unit: '' }]
  if (isMonitor(n)) {
    const inputs = n.data.inputs?.length ? n.data.inputs : [{ id: 'in', name: '入力1', unit: '' }]
    return (n.data.mode ?? 'value') === 'pie' ? inputs : inputs.slice(0, 1)
  }
  return []
}

/**
 * 出力ポートの一覧を、グラフの並び順どおりに畳んだ鍵。
 * 配線の色はこの順番で配るので、値を変えただけでは色が入れ替わらない。
 */
export function outputPortKeys(graph: Graph): string[] {
  return graph.nodes.flatMap((node) => outputPorts(node).map((port) => `${node.id}/${port.id}`))
}

/** 入力ポートへ接続されている元ポートとエッジ。凡例・配線ラベル表示に使う。 */
export function connectedSource(graph: Graph, targetId: string, targetPort: string): { edge: Edge; port: PortDef } | null {
  let edge: Edge | undefined
  for (const candidate of graph.edges) {
    if (candidate.target === targetId && candidate.targetPort === targetPort) edge = candidate
  }
  if (!edge) return null
  const source = graph.nodes.find((node) => node.id === edge!.source)
  const port = source && outputPorts(source).find((candidate) => candidate.id === edge!.sourcePort)
  return port ? { edge, port } : null
}

/** 出力ポートから出ているラベル付き配線のネット名。 */
export function outgoingLabels(graph: Graph, sourceId: string, sourcePort: string): string[] {
  return [...new Set(graph.edges
    .filter((edge) => edge.source === sourceId && edge.sourcePort === sourcePort && edge.label?.trim())
    .map((edge) => edge.label!.trim()))]
}

/** 指定した入力ポートへ接続された出力ポートの単位。表示用ノードの自動単位に使う。 */
export function connectedInputUnit(graph: Graph, targetId: string, targetPort = 'in'): string {
  return connectedSource(graph, targetId, targetPort)?.port.unit ?? ''
}

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge as RfEdge,
  type EdgeChange,
  type Node as RfNode,
  type NodeChange,
} from '@xyflow/react'

import { GraphProvider, netColorAt, PORT_IDLE, useActions, useEdges, useNodes, useSelectedIds, useStoreApi, useStoreSelector } from './store.tsx'
import { sameQuantity } from './engine/units.ts'
import { BlockNode } from './nodes/BlockNode.tsx'
import { VariableNode } from './nodes/VariableNode.tsx'
import { ResultNode } from './nodes/ResultNode.tsx'
import { MonitorNode } from './nodes/MonitorNode.tsx'
import { TableNode } from './nodes/TableNode.tsx'
import { Palette } from './panels/Palette.tsx'
import { InspectorPanel } from './panels/InspectorPanel.tsx'
import { FilesPanel } from './panels/FilesPanel.tsx'
import { SolvePanel } from './panels/SolvePanel.tsx'
import { BlockEditorModal } from './panels/BlockEditorModal.tsx'
import { VariableEditorModal } from './panels/VariableEditorModal.tsx'
import { ProjectControls, ProjectProvider } from './panels/ProjectControls.tsx'
import { TableEditorModal } from './panels/TableEditorModal.tsx'
import { MonitorEditorModal } from './panels/MonitorEditorModal.tsx'
import { inputPorts, outputPortKeys, outputPorts, type CalcNode, type PortDef } from './types.ts'

const nodeTypes = { variable: VariableNode, block: BlockNode, table: TableNode, result: ResultNode, monitor: MonitorNode }

// ノードの中身は各コンポーネントがストアから直接読むので、React Flow へ渡す data は空で足りる。
const EMPTY_DATA = {}

/**
 * React Flow はハンドルの実測座標をノードオブジェクトに紐づけて保持する。
 * 配列を毎回作り直すとその実測結果が捨てられ、ノードを選択しただけで
 * ハンドルが接続を受け付けなくなる。中身が変わらないノードは同じ参照のまま返す。
 */
function toRfNodes(nodes: CalcNode[], selectedIds: Set<string>, prev: RfNode[]): RfNode[] {
  const previous = new Map(prev.map((node) => [node.id, node]))
  let changed = nodes.length !== prev.length
  const next = nodes.map((n, index) => {
    const isSelected = selectedIds.has(n.id)
    const old = previous.get(n.id)
    if (!old || old.type !== n.kind) {
      changed = true
      return { id: n.id, type: n.kind, position: { x: n.x, y: n.y }, data: EMPTY_DATA, selected: isSelected }
    }
    if (old.position.x === n.x && old.position.y === n.y && old.selected === isSelected) {
      // 並び順が変わっただけでも React Flow には別物なので、そこは変化として扱う。
      if (prev[index] !== old) changed = true
      return old
    }
    changed = true
    return { ...old, position: { x: n.x, y: n.y }, selected: isSelected }
  })
  // 中身が 1 つも変わっていないなら配列ごと前回のものを返し、React Flow を動かさない。
  return changed ? next : prev
}

interface ResolvedConnection {
  source: string
  sourcePort: string
  target: string
  targetPort: string
  out: PortDef
  input: PortDef
}

/**
 * Loose モードでは入力側からドラッグした場合に source/target が逆になる。
 * 実際のポート種別を見て、計算グラフでは必ず「出力 → 入力」に正規化する。
 * 出力・入力どちらの組み合わせにもならない場合は null（型が合わない配線）。
 */
function resolveConnection(c: Connection, a: CalcNode, b: CalcNode): ResolvedConnection | null {
  const outA = outputPorts(a).find((p) => p.id === c.sourceHandle)
  const inB = c.targetHandle ? inputPorts(b).find((p) => p.id === c.targetHandle) : undefined
  if (outA && inB) return { source: c.source!, sourcePort: c.sourceHandle!, target: c.target!, targetPort: c.targetHandle!, out: outA, input: inB }
  const outB = outputPorts(b).find((p) => p.id === c.targetHandle)
  const inA = c.sourceHandle ? inputPorts(a).find((p) => p.id === c.sourceHandle) : undefined
  if (outB && inA) return { source: c.target!, sourcePort: c.targetHandle!, target: c.source!, targetPort: c.sourceHandle!, out: outB, input: inA }
  return null
}

function Canvas() {
  const nodes = useNodes()
  const edges = useEdges()
  const selectedIds = useSelectedIds()
  const { connect, moveNodes, removeNodes, removeEdge, patchEdge, select } = useActions()
  const api = useStoreApi()
  const { screenToFlowPosition } = useReactFlow()
  const wrapRef = useRef<HTMLDivElement>(null)
  // モニターは右パネルでも直せるが、ノードをダブルクリックしてもここで開く。
  const [monitorEditor, setMonitorEditor] = useState<string | null>(null)

  const [rfNodes, setRfNodes] = useState<RfNode[]>(() => toRfNodes(nodes, selectedIds, []))

  // React Flow のドラッグ中の座標はローカルに持つ。グラフ全体へ毎フレーム
  // 書き戻すと、評価とノード再生成が走ってドラッグが跳ねるため。
  useEffect(() => setRfNodes((prev) => toRfNodes(nodes, selectedIds, prev)), [nodes, selectedIds])

  // 配線の見た目に効くのは「エラーになっているノードの集合」だけ。
  // 評価結果そのものを見ると、値が変わるたびに全配線を作り直すことになる。
  const brokenNodes = useStoreSelector(
    useCallback((store) => {
      const ids: string[] = []
      for (const [id, result] of store.getResults()) if (result.error !== undefined) ids.push(id)
      return ids.join(',')
    }, []),
  )

  // 配線の色は出力ポートの並び順で決まる。値が変わっただけでは並びは動かないので、
  // 鍵の一覧を 1 本の文字列で購読して、スライダー操作のたびに配線を作り直さない。
  const portOrder = useStoreSelector(
    useCallback((store) => outputPortKeys(store.getGraph()).join(','), []),
  )
  const netColors = useMemo(
    () => new Map(portOrder.split(',').map((key, index) => [key, netColorAt(index)])),
    [portOrder],
  )

  const baseEdges: RfEdge[] = useMemo(() => {
    const broken = new Set(brokenNodes ? brokenNodes.split(',') : [])
    return edges.map((e) => {
      const color = netColors.get(`${e.source}/${e.sourcePort}`) ?? PORT_IDLE
      return {
        id: e.id,
        source: e.source,
        sourceHandle: e.sourcePort,
        target: e.target,
        targetHandle: e.targetPort,
        label: e.label || undefined,
        style: { '--nc-port': color } as CSSProperties,
        labelStyle: { fill: color, fontSize: 10, fontFamily: 'IBM Plex Mono' },
        labelBgStyle: { fill: '#2c2c2c', fillOpacity: 0.96 },
        labelBgPadding: [5, 3] as [number, number],
        labelBgBorderRadius: 3,
        className: `nc-edge${broken.has(e.target) ? ' is-broken' : ''}${e.label ? ' is-labeled' : ''}`,
      }
    })
  }, [edges, brokenNodes, netColors])

  // ノードと同じ理由で選択状態をローカルに保持する。React Flow は controlled
  // コンポーネントなので、select 変更をここで拾って反映しないと配線をクリックしても
  // 選択済みにならず、Backspace/Delete での削除が発火しない。
  const [rfEdges, setRfEdges] = useState<RfEdge[]>([])
  useEffect(() => {
    setRfEdges((prev) => {
      const selected = new Map(prev.map((e) => [e.id, e.selected]))
      return baseEdges.map((e) => ({ ...e, selected: selected.get(e.id) ?? false }))
    })
  }, [baseEdges])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setRfNodes((nodes) => applyNodeChanges(changes, nodes))
      // Backspace/Delete で選択中のノードを消したときも、ここを経由してストアへ反映する。
      const removedIds = changes.flatMap((c) => (c.type === 'remove' ? [c.id] : []))
      if (removedIds.length) removeNodes(removedIds)
    },
    [removeNodes],
  )

  // 配線自体をクリックで選び、Backspace/Delete で消せるようにする。ラベルの付け外しは
  // 右クリックのトグルに任せているので、ここは「線そのものを消す」ためだけの経路。
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((eds) => applyEdgeChanges(changes, eds))
      const removedIds = changes.flatMap((c) => (c.type === 'remove' ? [c.id] : []))
      for (const id of removedIds) removeEdge(id)
    },
    [removeEdge],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return
      const a = api.getNode(c.source)
      const b = api.getNode(c.target)
      if (!a || !b) return
      const resolved = resolveConnection(c, a, b)
      if (!resolved) return
      connect(resolved.source, resolved.sourcePort, resolved.target, resolved.targetPort)
    },
    [connect, api],
  )

  // 単位（量そのもの）が違うポートどうしはそもそも繋げない。ドラッグ中に見た目でも分かるよう
  // React Flow 側の検証にも渡す（未接続側や単位未設定は制限しない）。
  const isValidConnection = useCallback(
    (c: Connection | RfEdge) => {
      const conn = c as Connection
      if (!conn.source || !conn.target || !conn.sourceHandle || !conn.targetHandle) return false
      const a = api.getNode(conn.source)
      const b = api.getNode(conn.target)
      if (!a || !b) return false
      const resolved = resolveConnection(conn, a, b)
      if (!resolved) return false
      const { out, input } = resolved
      if (!out.unit || !input.unit) return true
      return sameQuantity(out.unit, input.unit)
    },
    [api],
  )

  const place = useCallback(() => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box) return { x: 80, y: 80 }
    return screenToFlowPosition({ x: box.left + box.width * 0.4, y: box.top + 120 })
  }, [screenToFlowPosition])

  return (
    <>
      <Palette place={place} />
      <div className="nc-canvas" ref={wrapRef}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(event, node) => {
            // ハンドルを掴みそこねたクリックまで拾うと編集モーダルが開き、その背景が
            // 以降のドラッグを飲み込んで、そのノードから線を引けなくなる。
            if ((event.target as HTMLElement).closest?.('.react-flow__handle')) return
            // Shift/Cmd/Ctrl を押しながらのクリックは、選択への追加・除外（複数選択）にする。
            const toggle = event.shiftKey || event.metaKey || event.ctrlKey
            select(node.id, { toggle })
          }}
          onNodeDoubleClick={(event, node) => {
            if ((event.target as HTMLElement).closest?.('.react-flow__handle')) return
            if (api.getNode(node.id)?.kind === 'monitor') setMonitorEditor(node.id)
          }}
          onNodeDragStop={(_, node, draggedNodes) => {
            // 複数選択したままドラッグすると React Flow が選択中の全ノードを一緒に動かす。
            // その全員分の着地位置をまとめてストアへ書き戻す。
            const moved = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node]
            moveNodes(moved.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })))
          }}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={32}
          // ハンドルを「ドラッグせずにクリック」すると React Flow のクリック接続待ちに
          // 入り、そのハンドルだけドラッグで線を引けなくなる。配線はドラッグ操作に統一する。
          connectOnClick={false}
          deleteKeyCode={['Backspace', 'Delete']}
          // 配線の右クリックはラベルの有無で切り替わるトグル。ポップアップは出さず即座に変える。
          // 無地の配線 → 接続元（変数やブロック出力）の名前をラベルにする。
          // ラベル済み → もう一度右クリックで外し、配線に戻す。
          onEdgeContextMenu={(event, edge) => {
            event.preventDefault()
            event.stopPropagation()
            const saved = api.getGraph().edges.find((item) => item.id === edge.id)
            if (!saved) return
            if (saved.label) {
              patchEdge(saved.id, { label: undefined })
              return
            }
            const source = api.getNode(saved.source)
            const sourceName = source ? outputPorts(source).find((p) => p.id === saved.sourcePort)?.name : undefined
            if (sourceName) patchEdge(saved.id, { label: sourceName })
          }}
          onPaneClick={() => { select(null); setMonitorEditor(null) }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          nodesFocusable
          edgesFocusable
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#3a3a3a" />
          <Controls showInteractive={false} />
        </ReactFlow>
        <BlockEditorModal />
        <VariableEditorModal />
        <TableEditorModal />
        {monitorEditor && <MonitorEditorModal id={monitorEditor} onClose={() => setMonitorEditor(null)} />}
      </div>
    </>
  )
}

type SideTab = 'inspect' | 'files' | 'solve'

function Shell() {
  const [tab, setTab] = useState<SideTab>('inspect')
  return (
    <ProjectProvider browseFiles={() => setTab('files')}>
      <div className="nc-app">
        <header className="nc-topbar">
          <h1>
            node<span>-calc</span>
          </h1>
          <p className="nc-tagline">計算のまとまりを並べて、振って、逆から解く</p>
          <ProjectControls />
          <button className="nc-btn nc-btn-primary" onClick={() => setTab('solve')}>逆算</button>
        </header>

        <div className="nc-main">
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>

          <aside className="nc-side">
            <div className="nc-tabs">
              <button className={tab === 'inspect' ? 'is-active' : ''} onClick={() => setTab('inspect')}>検査</button>
              <button className={tab === 'files' ? 'is-active' : ''} onClick={() => setTab('files')}>ファイル</button>
              <button className={tab === 'solve' ? 'is-active' : ''} onClick={() => setTab('solve')}>逆算</button>
            </div>
            <div className="nc-side-body">
              {tab === 'inspect' && <InspectorPanel />}
              {tab === 'files' && <FilesPanel />}
              {tab === 'solve' && <SolvePanel />}
            </div>
          </aside>
        </div>
      </div>
    </ProjectProvider>
  )
}

export default function App() {
  return (
    <GraphProvider>
      <Shell />
    </GraphProvider>
  )
}

import { useMemo } from 'react'
import { useStore } from '../store.tsx'
import { checkGraphUnits } from '../engine/units.ts'

export function UnitPanel() {
  const { graph, select } = useStore()
  const report = useMemo(() => checkGraphUnits(graph), [graph])
  const names = new Map(graph.nodes.map((node) => [node.id, node.data.title]))

  return <div className="nc-panel-body">
    <div className={`nc-unit-summary${report.ok ? ' is-ok' : ''}`}>
      <strong>{report.ok ? '単位は整合しています' : `${report.issues.length}件の単位エラー`}</strong>
      <span>入力から最終結果まで、接続と各計算式を検査します。</span>
    </div>
    <p className="nc-hint">単位は SI が基準です。<code>k</code>・<code>M</code>・<code>G</code> やミリ、時間の <code>min</code>・<code>h</code>・<code>day</code> は「同じ量をどう書くか」の選択で、<strong>表記が違うだけの接続は自動で換算します</strong>（<code>mm</code> → <code>m</code> なら 1/1000）。量そのものが違うときだけエラーにします。</p>
    <p className="nc-hint">入力変数・計算ブロック・CSVテーブルの入出力単位は必須です。結果とモニターは接続元から自動取得します。例：<code>mm</code>、<code>mm^2</code>、<code>m/s</code>、<code>kg*m/s^2</code>。効率などの比率は <code>%</code> または <code>1</code> を指定します。</p>
    <div className="nc-unit-issue-list">
      {report.issues.map((issue) => <button key={issue.key} onClick={() => select(issue.nodeId)}>
        <strong>{names.get(issue.nodeId) || '名称未設定'}</strong>
        <span>{issue.message}</span>
      </button>)}
    </div>
  </div>
}

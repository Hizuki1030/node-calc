import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store.tsx'
import { buildSheet, sheetToTsv } from '../engine/excel.ts'
import { buildXlsx, downloadBlob } from '../export/xlsx.ts'
import { graphFromJson, graphToJson } from '../library/storage.ts'
import { fmtNum } from '../format.ts'

/** 書き出し。xlsx は 1 ノード = 1 セクションで、中間計算もそれぞれ 1 セルに残す。 */
export function ExportPanel() {
  const { graph, results, setGraph } = useStore()
  const plan = useMemo(() => buildSheet(graph, results), [graph, results])
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const stamp = () => new Date().toISOString().slice(0, 10)

  const saveXlsx = () => {
    downloadBlob(
      buildXlsx(plan),
      `node-calc-${stamp()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    setMsg('xlsx を保存しました')
  }

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(sheetToTsv(plan))
      setMsg('TSV をコピーしました。Excel に ⌘V で貼れます')
    } catch {
      setMsg('コピーできませんでした。下の表を選んで手でコピーしてください')
    }
  }

  const saveJson = () => {
    downloadBlob(graphToJson(graph), `node-calc-${stamp()}.json`, 'application/json')
    setMsg('グラフ JSON を保存しました')
  }

  const openJson = async (file: File) => {
    try {
      setGraph(graphFromJson(await file.text()))
      setMsg('グラフを読み込みました')
    } catch (e) {
      setMsg(`読み込めませんでした: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="nc-panel-body">
      <div className="nc-btn-row">
        <button className="nc-btn nc-btn-primary" onClick={saveXlsx}>
          .xlsx を保存
        </button>
        <button className="nc-btn" onClick={copyTsv}>
          TSV をコピー
        </button>
      </div>
      <div className="nc-btn-row">
        <button className="nc-btn" onClick={saveJson}>
          グラフ JSON
        </button>
        <button className="nc-btn" onClick={() => fileRef.current?.click()}>
          JSON を読み込む
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void openJson(f)
            e.target.value = ''
          }}
        />
      </div>
      {msg && <p className="nc-note">{msg}</p>}

      {plan.warnings.map((w, i) => (
        <p className="nc-warn" key={i}>
          {w}
        </p>
      ))}

      <p className="nc-hint">
        B 列に数式が入ります。青い入力セルを書き換えると、下の計算と結果がそのまま追従します。
        C 列にはノードに書いた式をそのまま残しているので、どの行が何の計算かを追えます。
      </p>

      <div className="nc-sheet-wrap">
        <table className="nc-sheet">
          <thead>
            <tr>
              <th className="nc-rownum" />
              <th>A 名前</th>
              <th>B 値 / 数式</th>
              <th>C 元の式</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r) => (
              <tr key={r.row} className={`is-${r.style}`}>
                <td className="nc-rownum">{r.style === 'blank' ? '' : r.row}</td>
                <td>{r.name}</td>
                <td className="nc-mono">
                  {r.formula ? (
                    <span className="nc-formula">={r.formula}</span>
                  ) : r.value !== undefined && Number.isFinite(r.value) ? (
                    fmtNum(r.value)
                  ) : (
                    ''
                  )}
                </td>
                <td className="nc-mono nc-dim">{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

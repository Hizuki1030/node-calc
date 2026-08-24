import { useState, type ChangeEvent } from 'react'
import { UnitPicker } from '../components/UnitPicker.tsx'
import { parseNumericTable, splitHeaderUnit } from '../engine/table.ts'
import { uid } from '../library/presets.ts'
import { useStore } from '../store.tsx'
import { ImeInput } from '../components/ImeField.tsx'
import { isTable, type TableInputDef } from '../types.ts'

export function TableEditorModal() {
  const { graph, selected, select, patchTable, addTableInput, removeTableInput, removeNode } = useStore()
  const node = graph.nodes.find((item) => item.id === selected)
  const [message, setMessage] = useState('')
  if (!node || !isTable(node)) return null
  const data = node.data

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed = parseNumericTable(await file.text())
      const outputColumn = parsed.headers.length - 1
      const inputs: TableInputDef[] = parsed.headers.slice(0, -1).map((header, index) => {
        const meta = splitHeaderUnit(header)
        return {
          id: data.inputs[index]?.id ?? uid('ti'),
          name: meta.name || `入力${index + 1}`,
          unit: meta.unit || data.inputs[index]?.unit || '',
          column: index,
        }
      })
      const outputMeta = splitHeaderUnit(parsed.headers[outputColumn])
      patchTable(node.id, {
        headers: parsed.headers,
        rows: parsed.rows,
        sourceName: file.name,
        inputs,
        output: {
          id: data.output.id || 'out',
          name: outputMeta.name || '出力',
          unit: outputMeta.unit || data.output.unit || '',
          column: outputColumn,
        },
      })
      setMessage(`${parsed.rows.length}行を読み込みました${parsed.skippedRows ? `（数値でない${parsed.skippedRows}行を除外）` : ''}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      event.target.value = ''
    }
  }

  const patchInput = (id: string, patch: Partial<TableInputDef>) => patchTable(node.id, {
    inputs: data.inputs.map((input) => input.id === id ? { ...input, ...patch } : input),
  })

  return <div className="nc-modal-backdrop" onMouseDown={() => select(null)}>
    <section className="nc-table-modal nodrag" role="dialog" aria-modal="true" aria-label="CSVテーブル変換を編集" onMouseDown={(event) => event.stopPropagation()}>
      <header className="nc-modal-head">
        <div>
          <p>CSVテーブル変換</p>
          <ImeInput className="nc-modal-title" value={data.title} onCommit={(next) => patchTable(node.id, { title: next })} aria-label="テーブル名" />
        </div>
        <button className="nc-x" onClick={() => select(null)} title="閉じる">×</button>
      </header>

      <section className="nc-table-import">
        <div>
          <strong>{data.sourceName || 'CSVファイルを選択'}</strong>
          <span>{data.rows.length ? `${data.rows.length}行 × ${data.headers.length}列` : 'カンマ・タブ・セミコロン区切りに対応'}</span>
        </div>
        <label className="nc-btn nc-btn-primary">CSVを読み込む<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={importFile} hidden /></label>
      </section>
      {message && <p className="nc-table-message">{message}</p>}
      {!data.rows.length && <p className="nc-hint">例：<code>入力電圧 [V], 出力電流 [A], 効率 [%]</code> を1行目に書き、2行目以降へ数値を並べます。角括弧内の単位は自動取得します。</p>}

      <div className="nc-table-mode-row">
        <label>表にない値</label>
        <select className="nc-select" value={data.mode} onChange={(event) => patchTable(node.id, { mode: event.target.value as 'nearest' | 'linear' })}>
          <option value="nearest">一番近い値を使う</option>
          <option value="linear">間を補間して連続値にする</option>
        </select>
        <small>{data.mode === 'nearest' ? '全入力の距離が最も近い1行を採用します。' : '格子は線形・双線形・多線形で補間し、範囲外は端に固定します。'}</small>
      </div>

      <div className="nc-table-mapping">
        <section>
          <h4 className="nc-sub">入力列 <small>複数指定できます</small></h4>
          <div className="nc-table-map-list">
            {data.inputs.map((input) => <div className="nc-table-map-row" key={input.id}>
              <ImeInput className="nc-text" value={input.name} placeholder="入力名" onCommit={(next) => patchInput(input.id, { name: next })} />
              <UnitPicker value={input.unit} onChange={(unit) => patchInput(input.id, { unit })} ariaLabel={`${input.name}の単位`} />
              <select className="nc-select" value={input.column} onChange={(event) => patchInput(input.id, { column: Number(event.target.value) })} aria-label={`${input.name}のCSV列`}>
                {data.headers.map((header, index) => <option value={index} key={`${header}:${index}`}>{header}</option>)}
              </select>
              <button className="nc-x" disabled={data.inputs.length <= 1} onClick={() => removeTableInput(node.id, input.id)} title="入力を削除">×</button>
            </div>)}
          </div>
          <button className="nc-btn nc-btn-ghost" disabled={!data.headers.length} onClick={() => addTableInput(node.id)}>＋ 入力を追加</button>
        </section>
        <section>
          <h4 className="nc-sub">出力列</h4>
          <div className="nc-table-output-map">
            <ImeInput className="nc-text" value={data.output.name} placeholder="出力名" onCommit={(next) => patchTable(node.id, { output: { ...data.output, name: next } })} />
            <UnitPicker value={data.output.unit} onChange={(unit) => patchTable(node.id, { output: { ...data.output, unit } })} ariaLabel={`${data.output.name}の単位`} />
            <select className="nc-select" value={data.output.column} onChange={(event) => patchTable(node.id, { output: { ...data.output, column: Number(event.target.value) } })} aria-label="出力のCSV列">
              {data.headers.map((header, index) => <option value={index} key={`${header}:${index}`}>{header}</option>)}
            </select>
          </div>
          <label className="nc-table-digits">表示桁数<input className="nc-num" type="number" min={0} max={12} value={data.digits} onChange={(event) => patchTable(node.id, { digits: Math.max(0, Math.min(12, Number(event.target.value))) })} /></label>
        </section>
      </div>

      {data.rows.length > 0 && <div className="nc-table-preview">
        <table>
          <thead><tr>{data.headers.map((header, index) => <th key={`${header}:${index}`}>{header}</th>)}</tr></thead>
          <tbody>{data.rows.slice(0, 8).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
        </table>
        {data.rows.length > 8 && <small>先頭8行を表示（全{data.rows.length}行）</small>}
      </div>}

      <footer className="nc-modal-foot">
        <button className="nc-btn nc-btn-danger" onClick={() => { removeNode(node.id); select(null) }}>ブロックを削除</button>
        <button className="nc-btn nc-btn-primary" onClick={() => select(null)}>完了</button>
      </footer>
    </section>
  </div>
}

import { memo, useMemo, useState } from 'react'
import { useActions, useUserBlocks } from '../store.tsx'
import type { BlockPreset } from '../library/presets.ts'
import { NodeIcon } from '../components/NodeIcon.tsx'

const NEW_BLOCK: BlockPreset = {
  key: 'new-user-block',
  category: 'ユーザー定義',
  title: '新しい計算',
  note: '入力と単位を定義し、必要なだけ代入式を追加します。',
  inputs: [],
  calcs: [{ name: '結果', expr: '0', exposed: true }],
}

interface Props {
  /** 追加先のキャンバス座標を決める */
  place(): { x: number; y: number }
}

/** 左の引き出し。ブロックを置くところ。 */
export const Palette = memo(function Palette({ place }: Props) {
  const { addPreset, addVariable, addResult, addMonitor, addTable, removeUserBlock, select } = useActions()
  const userBlocks = useUserBlocks()
  const [q, setQ] = useState('')

  const groups = useMemo(() => {
    const all = userBlocks
    const hit = q.trim()
      ? all.filter((p) => (p.title + p.category + p.calcs.map((c) => c.expr).join(' ')).includes(q.trim()))
      : all
    const by = new Map<string, BlockPreset[]>()
    for (const p of hit) {
      const list = by.get(p.category) ?? []
      list.push(p)
      by.set(p.category, list)
    }
    return [...by.entries()]
  }, [q, userBlocks])

  const add = (p: BlockPreset) => {
    const { x, y } = place()
    select(addPreset(p, x, y))
  }

  return (
    <aside className="nc-palette">
      <div className="nc-palette-top">
        <button
          className="nc-btn nc-btn-var"
          onClick={() => {
            const { x, y } = place()
            select(addVariable(x, y))
          }}
        >
          <NodeIcon kind="variable" />＋ 入力変数
        </button>
        <button
          className="nc-btn nc-btn-res"
          onClick={() => {
            const { x, y } = place()
            select(addResult(x, y))
          }}
        >
          <NodeIcon kind="result" />＋ 結果
        </button>
      </div>

      <button className="nc-btn nc-btn-monitor" onClick={() => {
        const { x, y } = place()
        select(addMonitor(x, y))
      }}><NodeIcon kind="monitor" />＋ モニター</button>

      <button className="nc-btn nc-btn-table" onClick={() => {
        const { x, y } = place()
        select(addTable(x, y))
      }}>
        <span><NodeIcon kind="table" />＋ CSVテーブル変換</span>
        <small>複数入力から最近傍・補間で値を求める</small>
      </button>

      <button className="nc-btn nc-btn-new-block" onClick={() => add(NEW_BLOCK)}>
        <span><NodeIcon kind="block" />＋ ユーザー定義ブロック</span>
        <small>入力・複数の計算・出力を定義する</small>
      </button>

      <input
        className="nc-search"
        value={q}
        placeholder="保存したブロックを探す"
        onChange={(e) => setQ(e.target.value)}
        aria-label="ブロック検索"
      />

      <div className="nc-palette-list">
        <h2 className="nc-library-title">保存したブロック</h2>
        {groups.map(([cat, items]) => (
          <section key={cat}>
            <h3>{cat}</h3>
            {items.map((p) => (
              <div className="nc-preset" key={p.key}>
                <button className="nc-preset-btn" onClick={() => add(p)} title={p.note ?? p.title}>
                  <span className="nc-preset-title">{p.title}</span>
                  <span className="nc-preset-expr nc-mono">{p.calcs[0]?.expr}</span>
                </button>
                {p.category === 'マイブロック' && (
                  <button
                    className="nc-x"
                    onClick={() => removeUserBlock(p.key)}
                    title="ライブラリから削除"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </section>
        ))}
        {groups.length === 0 && (
          <p className="nc-hint">
            {q ? '見つかりませんでした。' : 'まだありません。ブロック右上の「保存」で再利用できます。'}
          </p>
        )}
      </div>
    </aside>
  )
})

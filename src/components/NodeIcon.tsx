import { memo, type ReactNode } from 'react'
import type { NodeKind } from '../types.ts'

/** ノードの種類の呼び名。アイコンの読み上げとツールチップに使う。 */
export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  variable: '入力変数',
  block: '計算ブロック',
  table: 'CSVテーブル変換',
  result: '結果',
  monitor: 'モニター',
}

/**
 * 16 の枠に線だけで描く。塗りを持たないので、置いた場所の文字色をそのまま拾う。
 * 種類が一目で分かればよいので、形はできるだけ単純にしてある。
 */
const SHAPES: Record<NodeKind, ReactNode> = {
  // スライダーのつまみ
  variable: <>
    <path d="M2 8h3.4M10.6 8H14" />
    <circle cx="8" cy="8" r="2.6" />
  </>,
  // 電卓
  block: <>
    <rect x="3" y="2" width="10" height="12" rx="2" />
    <path d="M5.5 5h5" />
    <path d="M6 8.5h.01M10 8.5h.01M6 11.5h.01M10 11.5h.01" strokeWidth="1.8" />
  </>,
  // 表
  table: <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 6.4h12M6.6 6.4V13" />
  </>,
  // 的（目標値を狙う）
  result: <>
    <circle cx="8" cy="8" r="5.6" />
    <circle cx="8" cy="8" r="1.9" />
  </>,
  // 円グラフ
  monitor: <>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 2.4V8l4 3.1" />
  </>,
}

/** ノードの種類を表す小さなアイコン。 */
export const NodeIcon = memo(function NodeIcon({ kind, size = 14 }: { kind: NodeKind; size?: number }) {
  return (
    <svg
      className="nc-node-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={NODE_KIND_LABEL[kind]}
    >
      <title>{NODE_KIND_LABEL[kind]}</title>
      {SHAPES[kind]}
    </svg>
  )
})

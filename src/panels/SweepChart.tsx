import { useMemo } from 'react'
import type { Sample, Solution } from '../engine/solve.ts'
import { fmtNum } from '../format.ts'

interface Props {
  samples: Sample[]
  target?: number | null
  current?: number
  solutions?: Solution[]
  xLabel?: string
  yLabel?: string
  height?: number
}

const PAD = { l: 52, r: 12, t: 14, b: 26 }

/** スイープ結果の折れ線。切り上げが入ると階段状になるので、点ではなく線分で描く。 */
export function SweepChart({
  samples,
  target,
  current,
  solutions = [],
  xLabel,
  yLabel,
  height = 190,
}: Props) {
  const width = 360

  // 現在値の縦線はドラッグのたびに動くので、曲線と軸はそれとは別に組み立てる。
  // ここを毎フレーム作り直すと、点の多いスイープでつまみが引っかかる。
  const geometry = useMemo(() => {
    const valid = samples.filter((s) => Number.isFinite(s.y))
    if (valid.length < 2) return null

    const xs = samples.map((s) => s.x)
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    let y0 = Math.min(...valid.map((s) => s.y))
    let y1 = Math.max(...valid.map((s) => s.y))
    if (target !== null && target !== undefined && Number.isFinite(target)) {
      y0 = Math.min(y0, target)
      y1 = Math.max(y1, target)
    }
    const nonNegative = y0 >= 0
    if (y1 - y0 < 1e-12) {
      y0 -= 1
      y1 += 1
    } else {
      const m = (y1 - y0) * 0.08
      y0 -= m
      y1 += m
    }
    // 金額や枚数のように 0 以上しか取らない量で、軸だけ負に伸びると読み違える
    if (nonNegative && y0 < 0) y0 = 0

    const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * (width - PAD.l - PAD.r)
    const sy = (v: number) => height - PAD.b - ((v - y0) / (y1 - y0)) * (height - PAD.t - PAD.b)

    // NaN のところで線を切る
    const segments: string[] = []
    let cur: string[] = []
    for (const s of samples) {
      if (Number.isFinite(s.y)) cur.push(`${sx(s.x).toFixed(2)},${sy(s.y).toFixed(2)}`)
      else if (cur.length) {
        segments.push(cur.join(' '))
        cur = []
      }
    }
    if (cur.length) segments.push(cur.join(' '))

    return {
      x0,
      x1,
      sx,
      sy,
      segments,
      xTicks: [0, 0.25, 0.5, 0.75, 1].map((t) => x0 + (x1 - x0) * t),
      yTicks: [0, 0.5, 1].map((t) => y0 + (y1 - y0) * t),
    }
  }, [samples, target, height])

  if (!geometry) {
    return <p className="nc-hint">グラフを描くだけの計算結果がありません。</p>
  }
  const { x0, x1, sx, sy, segments, xTicks, yTicks } = geometry

  return (
    <svg
      className="nc-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${xLabel ?? 'x'} を変えたときの ${yLabel ?? 'y'} の変化`}
    >
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line className="nc-grid" x1={PAD.l} x2={width - PAD.r} y1={sy(t)} y2={sy(t)} />
          <text className="nc-axis" x={PAD.l - 6} y={sy(t) + 3} textAnchor="end">
            {fmtNum(t, 2)}
          </text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text
          className="nc-axis"
          key={`x${t}`}
          x={sx(t)}
          y={height - 8}
          // 両端のラベルが枠の外にはみ出さないよう寄せる
          textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
        >
          {fmtNum(t, 2)}
        </text>
      ))}

      {solutions.map((s, i) =>
        s.kind === 'range' ? (
          <rect
            key={i}
            className="nc-sol-band"
            x={sx(s.lo)}
            width={Math.max(1.5, sx(s.hi) - sx(s.lo))}
            y={PAD.t}
            height={height - PAD.t - PAD.b}
          />
        ) : (
          <line
            key={i}
            className="nc-sol-line"
            x1={sx(s.x)}
            x2={sx(s.x)}
            y1={PAD.t}
            y2={height - PAD.b}
          />
        ),
      )}

      {target !== null && target !== undefined && Number.isFinite(target) && (
        <line className="nc-target-line" x1={PAD.l} x2={width - PAD.r} y1={sy(target)} y2={sy(target)} />
      )}

      {segments.map((pts, i) => (
        <polyline key={i} className="nc-line" points={pts} />
      ))}

      {current !== undefined && current >= x0 && current <= x1 && (
        <line className="nc-current" x1={sx(current)} x2={sx(current)} y1={PAD.t} y2={height - PAD.b} />
      )}

      <line className="nc-axis-line" x1={PAD.l} x2={width - PAD.r} y1={height - PAD.b} y2={height - PAD.b} />
      <line className="nc-axis-line" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={height - PAD.b} />
    </svg>
  )
}

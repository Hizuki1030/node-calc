import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useActions, useOutputColor } from '../store.tsx'
import type { CalcNode, VariableData } from '../types.ts'
import { clamp, fmtStepNum, snap } from '../format.ts'

export type VariableNodeRef = CalcNode & { data: VariableData }

interface Props {
  node: VariableNodeRef
  /** 目盛りの両端を下に出す */
  showEnds?: boolean
  ariaLabel?: string
}

/**
 * つまみの位置は即座に返し、グラフへの書き込みは 1 フレームに 1 回へまとめる。
 * ポインタは 1 フレームに何度も動くので、そのたびに評価と再描画をすると引っかかる。
 */
export function useSliderCommit(commit: (value: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null)
  const pending = useRef<number | null>(null)
  const frame = useRef(0)
  const commitRef = useRef(commit)
  commitRef.current = commit

  const flush = useCallback(() => {
    frame.current = 0
    if (pending.current === null) return
    commitRef.current(pending.current)
    pending.current = null
  }, [])

  useEffect(() => () => {
    if (frame.current) cancelAnimationFrame(frame.current)
  }, [])

  const change = useCallback((value: number) => {
    setDragging(value)
    pending.current = value
    if (!frame.current) frame.current = requestAnimationFrame(flush)
  }, [flush])

  // 指を離したら、間引きで持ち越した値を取りこぼさずに確定する。
  const settle = useCallback(() => {
    if (frame.current) {
      cancelAnimationFrame(frame.current)
      flush()
    }
    setDragging(null)
  }, [flush])

  return { dragging, change, settle }
}

/** 変数のスライダー。 */
export const ValueSlider = memo(function ValueSlider({ node, showEnds = false, ariaLabel }: Props) {
  const { patchVariable } = useActions()
  const d = node.data
  const { dragging, change, settle } = useSliderCommit(
    useCallback((value: number) => patchVariable(node.id, { value }), [patchVariable, node.id]),
  )
  const shown = dragging ?? clamp(d.value, d.min, d.max)
  // キャンバス上でこの変数から伸びている配線と同じ色にして、卓と線を結び付ける。
  const color = useOutputColor(node.id, 'out')

  return (
    <div className="nc-slider-block" style={{ '--nc-port': color } as CSSProperties}>
      <div className="nc-slider-head">
        <span>{d.title}</span>
        <strong className="nc-mono">
          {fmtStepNum(shown, d.step)} {d.unit}
        </strong>
      </div>
      <input
        className="nc-slider"
        type="range"
        min={d.min}
        max={d.max}
        step={d.step || 'any'}
        value={shown}
        onChange={(e) => change(clamp(snap(Number(e.target.value), d.step), d.min, d.max))}
        onPointerUp={settle}
        onBlur={settle}
        aria-label={ariaLabel ?? d.title}
      />
      {showEnds && (
        <div className="nc-slider-ends nc-mono">
          <span>{fmtStepNum(d.min, d.step)}</span>
          <span>{fmtStepNum(d.max, d.step)}</span>
        </div>
      )}
    </div>
  )
})

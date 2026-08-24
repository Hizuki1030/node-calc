import { useCallback, useEffect, useRef } from 'react'
import { useUpdateNodeInternals } from '@xyflow/react'

/** ハンドルを載せている行。ここの高さが変わると下のハンドルの座標がずれる。 */
const ROW_SELECTOR = '.nc-compact-formula, .nc-compact-port, .nc-table-port, .nc-table-output, .nc-monitor-port'

/**
 * ノードの中でハンドルが動いたら、React Flow が持つハンドル座標のキャッシュを取り直す。
 * このキャッシュが古いと、掴んだハンドルとは違う位置から接続線が伸びる。
 *
 * 高さの変化は ResizeObserver に任せる。再描画のたびに座標を測ると強制同期レイアウトが
 * 走り、ノードが増えるほど入力が重くなるため測定はしない。
 * ポートの増減だけは DOM のサイズが変わらないこともあるので portsKey で拾う。
 */
export function useHandleSync(id: string, portsKey: string) {
  const updateNodeInternals = useUpdateNodeInternals()
  const rootRef = useRef<HTMLElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const frameRef = useRef(0)

  // 行の数だけ監視しているので、1 行の変化で何度も座標を取り直さないよう
  // 1 フレームに 1 回へまとめる。計算行の多いブロックほど効く。
  const syncSoon = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      updateNodeInternals(id)
    })
  }, [id, updateNodeInternals])

  const observe = useCallback((root: HTMLElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!root) return
    const observer = new ResizeObserver(syncSoon)
    observer.observe(root)
    for (const row of root.querySelectorAll(ROW_SELECTOR)) observer.observe(row)
    observerRef.current = observer
  }, [syncSoon])

  const ref = useCallback((root: HTMLElement | null) => {
    rootRef.current = root
    observe(root)
  }, [observe])

  // ポートが増減したら監視をつなぎ直し、座標も取り直す
  useEffect(() => {
    observe(rootRef.current)
    updateNodeInternals(id)
  }, [portsKey, observe, id, updateNodeInternals])

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    observerRef.current?.disconnect()
  }, [])

  return ref
}

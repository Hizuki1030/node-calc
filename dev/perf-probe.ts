/**
 * 日本語入力の重さを実測するための一時的な計測。原因が分かったら消す。
 *
 * Long Animation Frame API で「フレームを止めた処理」と「強制レイアウトに使った時間」を、
 * Event Timing API で「操作から画面に出るまでの遅れ」を集め、開発サーバーへ送る。
 */

interface Row {
  [key: string]: unknown
}

const rows: Row[] = []
const counts: Record<string, number> = {}
let sending = false

const ms = (value: number | undefined) => (typeof value === 'number' ? Math.round(value * 10) / 10 : undefined)

function observe(type: string, options: PerformanceObserverInit, handle: (entry: PerformanceEntry) => void) {
  try {
    new PerformanceObserver((list) => list.getEntries().forEach(handle)).observe({ type, ...options } as PerformanceObserverInit)
  } catch {
    /* 対応していないブラウザでは何もしない */
  }
}

// どの処理がフレームを止めたか。scripts に呼び出し元と強制レイアウト時間が入る。
observe('long-animation-frame', { buffered: true }, (entry) => {
  const loaf = entry as PerformanceEntry & {
    renderStart: number
    styleAndLayoutStart: number
    blockingDuration: number
    scripts: Array<{
      invoker: string
      invokerType: string
      sourceURL: string
      sourceFunctionName: string
      duration: number
      forcedStyleAndLayoutDuration: number
      pauseDuration: number
    }>
  }
  rows.push({
    kind: 'frame',
    at: ms(loaf.startTime),
    duration: ms(loaf.duration),
    blocking: ms(loaf.blockingDuration),
    // レンダリング（スタイル計算・レイアウト・ペイント）に使った時間
    render: ms(loaf.renderStart ? loaf.startTime + loaf.duration - loaf.renderStart : 0),
    styleAndLayout: ms(loaf.styleAndLayoutStart ? loaf.startTime + loaf.duration - loaf.styleAndLayoutStart : 0),
    scripts: (loaf.scripts ?? []).map((script) => ({
      invoker: script.invoker,
      type: script.invokerType,
      source: `${script.sourceURL?.split('/').slice(-1)[0] ?? '?'}:${script.sourceFunctionName || '?'}`,
      duration: ms(script.duration),
      forcedLayout: ms(script.forcedStyleAndLayoutDuration),
    })),
  })
})

// 操作から画面に反映されるまでの遅れ
observe('event', { buffered: true, durationThreshold: 16 } as PerformanceObserverInit, (entry) => {
  const event = entry as PerformanceEventTiming
  rows.push({
    kind: 'event',
    name: event.name,
    at: ms(event.startTime),
    // イベントが届いてから、処理が始まるまでの待ち時間
    queued: ms(event.processingStart - event.startTime),
    // リスナーの実行時間
    handler: ms(event.processingEnd - event.processingStart),
    // 処理が終わってから画面に出るまで
    paint: ms(event.startTime + event.duration - event.processingEnd),
    // 発生から画面に出るまで
    total: ms(event.duration),
    target: (event.target as HTMLElement | null)?.className || (event.target as HTMLElement | null)?.tagName,
  })
})

/**
 * 画面の更新が実際に何ミリ秒おきに来ているかを測る。
 * メインスレッドが空いているのに操作が遅いなら、詰まっているのは描画側になる。
 */
let last = performance.now()
const gaps: number[] = []
function tick(now: number) {
  gaps.push(now - last)
  last = now
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

function frameStats() {
  if (!gaps.length) return null
  const sorted = [...gaps].sort((a, b) => a - b)
  const at = (q: number) => ms(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))])
  const stats = {
    frames: gaps.length,
    median: at(0.5),
    p90: at(0.9),
    worst: ms(sorted[sorted.length - 1]),
    over50ms: sorted.filter((gap) => gap > 50).length,
  }
  gaps.length = 0
  return stats
}

for (const name of ['keydown', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
  document.addEventListener(name, () => {
    counts[name] = (counts[name] ?? 0) + 1
  }, true)
}

async function send(reason: string) {
  const frames = frameStats()
  if (sending || (!rows.length && !frames)) return
  sending = true
  const payload = {
    reason,
    page: location.pathname,
    at: new Date().toISOString(),
    counts: { ...counts },
    frames,
    rows: rows.splice(0, rows.length),
  }
  try {
    await fetch('/api/perf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  } catch {
    /* 送れなくても操作の邪魔はしない */
  } finally {
    sending = false
  }
}

setInterval(() => void send('tick'), 2000)
console.info('[perf-probe] 計測中。日本語で入力すると記録されます。')

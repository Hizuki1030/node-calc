/** 画面に出す数値の整形。桁が揃うよう常に同じ規則で丸める。 */

export function fmtNum(v: number | undefined, digits = 4): string {
  if (v === undefined || Number.isNaN(v)) return '—'
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞'
  const a = Math.abs(v)
  if (a !== 0 && (a >= 1e9 || a < 1e-4)) return v.toExponential(Math.max(3, Math.min(12, digits)))
  return v.toLocaleString('ja-JP', { maximumFractionDigits: digits })
}

/** 刻み幅を見失わず表示するために必要な小数桁数。 */
export function decimalPlacesForStep(step: number | undefined): number {
  if (step === undefined || !Number.isFinite(step) || step <= 0) return 0
  const source = Math.abs(step).toString().toLowerCase()
  let decimals = 0
  if (source.includes('e')) {
    const [mantissa, exponentText] = source.split('e')
    const mantissaDecimals = (mantissa.split('.')[1] ?? '').length
    decimals = Math.max(0, mantissaDecimals - Number(exponentText))
  } else {
    decimals = (source.split('.')[1] ?? '').length
  }
  return Math.min(12, decimals)
}

export function digitsForStep(step: number | undefined, minimum = 4): number {
  return Math.max(minimum, decimalPlacesForStep(step))
}

/** 531 を 531.00 とするなど、刻み幅の桁を末尾まで明示する。 */
export function fmtStepNum(v: number | undefined, step: number | undefined): string {
  if (v === undefined || Number.isNaN(v) || !Number.isFinite(v)) return fmtNum(v, digitsForStep(step))
  const places = decimalPlacesForStep(step)
  const a = Math.abs(v)
  if (a !== 0 && (a >= 1e9 || a < 1e-4)) return fmtNum(v, digitsForStep(step))
  return v.toLocaleString('ja-JP', {
    minimumFractionDigits: places,
    maximumFractionDigits: Math.max(places, 4),
  })
}

/** スライダーの刻みに合わせる。 */
export function snap(v: number, step: number): number {
  if (!step || step <= 0) return v
  const r = Math.round(v / step) * step
  // 0.1 刻みなどで 2.7000000000000002 にならないよう桁を戻す
  const decimals = (String(step).split('.')[1] ?? '').length
  return Number(r.toFixed(Math.min(12, decimals + 2)))
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

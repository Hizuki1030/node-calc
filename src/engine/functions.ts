/** Excel 互換の組み込み関数。
 *
 * 丸めは Excel の定義に合わせる:
 *   ROUNDUP/ROUNDDOWN/ROUND は「0 から見た絶対値」に対して働く（-1.2 の切り上げは -2）
 *   CEILING.MATH/FLOOR.MATH は数直線上の +∞ / -∞ 方向に働く
 *   INT は常に -∞ 方向、TRUNC は 0 方向
 *
 * 二進小数の桁落ちで 2.675*100 = 267.49999… のような値になると丸めが 1 つずれるため、
 * 桁合わせ後に相対 ε を足し引きしてから ceil/floor する。
 */

const EPS = 1e-9

function nudge(v: number, dir: 1 | -1): number {
  return v + dir * EPS * Math.max(1, Math.abs(v))
}

function scale(d: number): number {
  return Math.pow(10, d)
}

export function roundUp(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x
  const p = scale(digits)
  const v = Math.abs(x) * p
  return (Math.sign(x) * Math.ceil(nudge(v, -1))) / p
}

export function roundDown(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x
  const p = scale(digits)
  const v = Math.abs(x) * p
  return (Math.sign(x) * Math.floor(nudge(v, 1))) / p
}

export function roundHalfUp(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x
  const p = scale(digits)
  const v = Math.abs(x) * p
  return (Math.sign(x) * Math.floor(nudge(v, 1) + 0.5)) / p
}

/** CEILING.MATH: unit の倍数へ +∞ 方向に丸める。 */
export function ceilingMath(x: number, unit = 1): number {
  if (unit === 0) return 0
  if (!Number.isFinite(x)) return x
  const q = x / unit
  return Math.ceil(nudge(q, -1)) * unit
}

/** FLOOR.MATH: unit の倍数へ -∞ 方向に丸める。 */
export function floorMath(x: number, unit = 1): number {
  if (unit === 0) return 0
  if (!Number.isFinite(x)) return x
  const q = x / unit
  return Math.floor(nudge(q, 1)) * unit
}

/** Excel の MOD は除数の符号に結果が従う（JS の % とは負数で異なる）。 */
export function excelMod(a: number, b: number): number {
  if (b === 0) return NaN
  return a - b * Math.floor(a / b)
}

export interface FnDef {
  /** 実行時の実装 */
  fn: (...args: number[]) => number
  min: number
  max: number
  /** Excel に書き出すときの関数名（省略時は同名） */
  excel?: string
  sig: string
  help: string
}

export const FUNCTIONS: Record<string, FnDef> = {
  ROUNDUP: {
    fn: (x, d = 0) => roundUp(x, d),
    min: 1,
    max: 2,
    sig: 'ROUNDUP(数値, 桁数)',
    help: '切り上げ。桁数 0 で整数、2 で小数第2位まで、-3 で千の位。',
  },
  ROUNDDOWN: {
    fn: (x, d = 0) => roundDown(x, d),
    min: 1,
    max: 2,
    sig: 'ROUNDDOWN(数値, 桁数)',
    help: '切り捨て。',
  },
  ROUND: {
    fn: (x, d = 0) => roundHalfUp(x, d),
    min: 1,
    max: 2,
    sig: 'ROUND(数値, 桁数)',
    help: '四捨五入。',
  },
  INT: {
    fn: (x) => Math.floor(nudge(x, 1)),
    min: 1,
    max: 1,
    sig: 'INT(数値)',
    help: '-∞ 方向に整数化。',
  },
  TRUNC: {
    fn: (x, d = 0) => roundDown(x, d),
    min: 1,
    max: 2,
    sig: 'TRUNC(数値, 桁数)',
    help: '0 方向に切り捨て。',
  },
  CEILING: {
    fn: (x, u = 1) => ceilingMath(x, u),
    min: 1,
    max: 2,
    excel: 'CEILING.MATH',
    sig: 'CEILING(数値, 単位)',
    help: '単位の倍数へ切り上げ。5 なら 123 → 125。',
  },
  'CEILING.MATH': {
    fn: (x, u = 1) => ceilingMath(x, u),
    min: 1,
    max: 2,
    excel: 'CEILING.MATH',
    sig: 'CEILING.MATH(数値, 単位)',
    help: 'CEILING と同じ。',
  },
  FLOOR: {
    fn: (x, u = 1) => floorMath(x, u),
    min: 1,
    max: 2,
    excel: 'FLOOR.MATH',
    sig: 'FLOOR(数値, 単位)',
    help: '単位の倍数へ切り捨て。5 なら 123 → 120。',
  },
  'FLOOR.MATH': {
    fn: (x, u = 1) => floorMath(x, u),
    min: 1,
    max: 2,
    excel: 'FLOOR.MATH',
    sig: 'FLOOR.MATH(数値, 単位)',
    help: 'FLOOR と同じ。',
  },
  ABS: { fn: Math.abs, min: 1, max: 1, sig: 'ABS(数値)', help: '絶対値。' },
  SQRT: { fn: Math.sqrt, min: 1, max: 1, sig: 'SQRT(数値)', help: '平方根。' },
  POWER: { fn: (a, b) => Math.pow(a, b), min: 2, max: 2, sig: 'POWER(底, 指数)', help: 'べき乗。a^b と同じ。' },
  MOD: { fn: excelMod, min: 2, max: 2, sig: 'MOD(数値, 除数)', help: '剰余。a%b と同じ。' },
  EXP: { fn: Math.exp, min: 1, max: 1, sig: 'EXP(数値)', help: 'e の冪。' },
  LN: { fn: Math.log, min: 1, max: 1, sig: 'LN(数値)', help: '自然対数。' },
  LOG10: { fn: Math.log10, min: 1, max: 1, sig: 'LOG10(数値)', help: '常用対数。' },
  PI: { fn: () => Math.PI, min: 0, max: 0, sig: 'PI()', help: '円周率。' },
  MIN: {
    fn: (...a) => Math.min(...a),
    min: 1,
    max: Infinity,
    sig: 'MIN(数値, ...)',
    help: '最小値。',
  },
  MAX: {
    fn: (...a) => Math.max(...a),
    min: 1,
    max: Infinity,
    sig: 'MAX(数値, ...)',
    help: '最大値。',
  },
  IF: {
    fn: (c, a, b) => (c !== 0 ? a : b),
    min: 3,
    max: 3,
    sig: 'IF(条件, 真のとき, 偽のとき)',
    help: '条件分岐。条件には a>=100 のような比較を書く。',
  },
}

/** パレットの式ヘルプに出す一覧。 */
export const FUNCTION_HELP = Object.entries(FUNCTIONS)
  .filter(([name]) => !name.includes('.'))
  .map(([, d]) => ({ sig: d.sig, help: d.help }))

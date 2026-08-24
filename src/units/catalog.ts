/** 単位のカタログ。
 *
 * 基準は SI。量ごとに SI の単位を 1 つ決め、k・M・G やミリなどの接頭語は
 * 「同じ量をどう書くか」という表記の選択肢として並べる。時間の min・h・day も
 * 秒に対する表記として同じ列に置く。
 *
 * factor は SI の基準単位に対する倍率。1 mm なら 1e-3 で、
 * 表記を変えても値そのもの（SI で見た量）は変わらない。
 */

export interface UnitNotation {
  symbol: string
  label: string
  /** SI 基準単位に対する倍率 */
  factor: number
}

export interface UnitQuantity {
  key: string
  /** 量の名前。ピッカーの見出しになる */
  name: string
  /** SI での基準単位。表記の既定値 */
  base: string
  /** 次元。null は「この量は次元を持たない/独自次元」で、単位解析側に任せる */
  dims: Record<string, number> | null
  notations: UnitNotation[]
}

interface Prefix {
  symbol: string
  label: string
  factor: number
}

const PREFIXES: Record<string, Prefix> = {
  p: { symbol: 'p', label: 'ピコ', factor: 1e-12 },
  n: { symbol: 'n', label: 'ナノ', factor: 1e-9 },
  μ: { symbol: 'μ', label: 'マイクロ', factor: 1e-6 },
  m: { symbol: 'm', label: 'ミリ', factor: 1e-3 },
  c: { symbol: 'c', label: 'センチ', factor: 1e-2 },
  '': { symbol: '', label: '', factor: 1 },
  k: { symbol: 'k', label: 'キロ', factor: 1e3 },
  M: { symbol: 'M', label: 'メガ', factor: 1e6 },
  G: { symbol: 'G', label: 'ギガ', factor: 1e9 },
  T: { symbol: 'T', label: 'テラ', factor: 1e12 },
}

/** SI 接頭語を付けた表記を並べる。keys の順がそのまま画面の並びになる。 */
function prefixed(base: string, baseLabel: string, keys: string[]): UnitNotation[] {
  return keys.map((key) => {
    const prefix = PREFIXES[key]
    return {
      symbol: `${prefix.symbol}${base}`,
      label: `${prefix.label}${baseLabel}`,
      factor: prefix.factor,
    }
  })
}

export const UNIT_QUANTITIES: UnitQuantity[] = [
  {
    key: 'ratio', name: '無次元・割合', base: '1', dims: {},
    notations: [
      { symbol: '1', label: '単位なし', factor: 1 },
      { symbol: '%', label: 'パーセント', factor: 1 },
    ],
  },
  {
    key: 'length', name: '長さ', base: 'm', dims: { L: 1 },
    notations: prefixed('m', 'メートル', ['n', 'μ', 'm', 'c', '', 'k']),
  },
  {
    key: 'area', name: '面積', base: 'm^2', dims: { L: 2 },
    notations: [
      { symbol: 'mm^2', label: '平方ミリメートル', factor: 1e-6 },
      { symbol: 'cm^2', label: '平方センチメートル', factor: 1e-4 },
      { symbol: 'm^2', label: '平方メートル', factor: 1 },
      { symbol: 'ha', label: 'ヘクタール', factor: 1e4 },
      { symbol: 'km^2', label: '平方キロメートル', factor: 1e6 },
    ],
  },
  {
    key: 'volume', name: '体積', base: 'm^3', dims: { L: 3 },
    notations: [
      { symbol: 'mm^3', label: '立方ミリメートル', factor: 1e-9 },
      { symbol: 'mL', label: 'ミリリットル', factor: 1e-6 },
      { symbol: 'cm^3', label: '立方センチメートル', factor: 1e-6 },
      { symbol: 'L', label: 'リットル', factor: 1e-3 },
      { symbol: 'm^3', label: '立方メートル', factor: 1 },
    ],
  },
  {
    key: 'time', name: '時間', base: 's', dims: { T: 1 },
    notations: [
      ...prefixed('s', '秒', ['n', 'μ', 'm', '']),
      { symbol: 'min', label: '分', factor: 60 },
      { symbol: 'h', label: '時間', factor: 3600 },
      { symbol: 'day', label: '日', factor: 86400 },
      // 暦の実際の日数（うるう年など）は見ず、1年 = 365日 = 8760h の固定倍率として扱う。
      { symbol: 'year', label: '年', factor: 365 * 86400 },
    ],
  },
  {
    key: 'frequency', name: '周波数', base: 'Hz', dims: { T: -1 },
    notations: prefixed('Hz', 'ヘルツ', ['m', '', 'k', 'M', 'G']),
  },
  {
    key: 'speed', name: '速度', base: 'm/s', dims: { L: 1, T: -1 },
    notations: [
      { symbol: 'mm/s', label: 'ミリメートル毎秒', factor: 1e-3 },
      { symbol: 'm/s', label: 'メートル毎秒', factor: 1 },
      { symbol: 'km/h', label: 'キロメートル毎時', factor: 1 / 3.6 },
      { symbol: 'km/s', label: 'キロメートル毎秒', factor: 1e3 },
    ],
  },
  {
    key: 'accel', name: '加速度', base: 'm/s^2', dims: { L: 1, T: -2 },
    notations: [
      { symbol: 'mm/s^2', label: 'ミリメートル毎秒毎秒', factor: 1e-3 },
      { symbol: 'm/s^2', label: 'メートル毎秒毎秒', factor: 1 },
    ],
  },
  {
    key: 'mass', name: '質量', base: 'kg', dims: { M: 1 },
    notations: [
      { symbol: 'mg', label: 'ミリグラム', factor: 1e-6 },
      { symbol: 'g', label: 'グラム', factor: 1e-3 },
      { symbol: 'kg', label: 'キログラム', factor: 1 },
      { symbol: 't', label: 'トン', factor: 1e3 },
    ],
  },
  {
    key: 'force', name: '力', base: 'N', dims: { M: 1, L: 1, T: -2 },
    notations: prefixed('N', 'ニュートン', ['m', '', 'k', 'M']),
  },
  {
    key: 'pressure', name: '圧力', base: 'Pa', dims: { M: 1, L: -1, T: -2 },
    notations: [
      ...prefixed('Pa', 'パスカル', ['', 'k', 'M', 'G']),
      { symbol: 'bar', label: 'バール', factor: 1e5 },
    ],
  },
  {
    key: 'energy', name: 'エネルギー', base: 'J', dims: { M: 1, L: 2, T: -2 },
    notations: [
      ...prefixed('J', 'ジュール', ['m', '', 'k', 'M', 'G']),
      { symbol: 'Wh', label: 'ワット時', factor: 3600 },
      { symbol: 'kWh', label: 'キロワット時', factor: 3.6e6 },
      { symbol: 'MWh', label: 'メガワット時', factor: 3.6e9 },
    ],
  },
  {
    key: 'power', name: '電力・仕事率', base: 'W', dims: { M: 1, L: 2, T: -3 },
    notations: prefixed('W', 'ワット', ['μ', 'm', '', 'k', 'M', 'G']),
  },
  {
    key: 'current', name: '電流', base: 'A', dims: { I: 1 },
    notations: prefixed('A', 'アンペア', ['μ', 'm', '', 'k']),
  },
  {
    key: 'voltage', name: '電圧', base: 'V', dims: { M: 1, L: 2, T: -3, I: -1 },
    notations: prefixed('V', 'ボルト', ['μ', 'm', '', 'k']),
  },
  {
    key: 'resistance', name: '抵抗', base: 'Ω', dims: { M: 1, L: 2, T: -3, I: -2 },
    notations: prefixed('Ω', 'オーム', ['m', '', 'k', 'M']),
  },
  {
    key: 'charge', name: '電荷・電池容量', base: 'C', dims: { I: 1, T: 1 },
    notations: [
      { symbol: 'C', label: 'クーロン', factor: 1 },
      { symbol: 'mAh', label: 'ミリアンペア時', factor: 3.6 },
      { symbol: 'Ah', label: 'アンペア時', factor: 3600 },
    ],
  },
  {
    key: 'temperature', name: '温度', base: 'K', dims: { TEMP: 1 },
    notations: [{ symbol: 'K', label: 'ケルビン', factor: 1 }],
  },
  {
    key: 'celsius', name: '温度（摂氏）', base: '℃', dims: { CELSIUS: 1 },
    notations: [{ symbol: '℃', label: '摂氏', factor: 1 }],
  },
  {
    key: 'data', name: 'データ量', base: 'B', dims: { DATA: 1 },
    notations: [
      { symbol: 'B', label: 'バイト', factor: 1 },
      { symbol: 'KB', label: 'キロバイト', factor: 1e3 },
      { symbol: 'MB', label: 'メガバイト', factor: 1e6 },
      { symbol: 'GB', label: 'ギガバイト', factor: 1e9 },
      { symbol: 'TB', label: 'テラバイト', factor: 1e12 },
    ],
  },
  {
    key: 'money', name: '金額・単価', base: '円', dims: null,
    notations: [
      { symbol: '円', label: '円', factor: 1 },
      { symbol: '円/個', label: '円毎個', factor: 1 },
      { symbol: '円/枚', label: '円毎枚', factor: 1 },
      { symbol: '円/m', label: '円毎メートル', factor: 1 },
      { symbol: '円/m^2', label: '円毎平方メートル', factor: 1 },
      { symbol: '円/h', label: '円毎時間', factor: 1 },
    ],
  },
  {
    key: 'count', name: '個数', base: '個', dims: null,
    notations: [
      { symbol: '個', label: '個', factor: 1 },
      { symbol: '枚', label: '枚', factor: 1 },
      { symbol: '本', label: '本', factor: 1 },
      { symbol: '台', label: '台', factor: 1 },
      { symbol: '件', label: '件', factor: 1 },
      { symbol: '回', label: '回', factor: 1 },
      { symbol: '人', label: '人', factor: 1 },
    ],
  },
]

/**
 * 単位解析へ渡す表。次元を持つ量の表記だけを載せる。
 * 金額や個数のように次元のない量は、解析側が独自次元として扱う。
 */
export const CATALOG_UNITS: Record<string, { dims: Record<string, number>; scale: number }> =
  Object.fromEntries(UNIT_QUANTITIES.flatMap((quantity) => (quantity.dims === null
    ? []
    : quantity.notations.map((notation) => [notation.symbol, { dims: quantity.dims!, scale: notation.factor }] as const))))

/** 記号からその量を引く。表記の切り替え候補を出すのに使う。 */
export function quantityOf(symbol: string): UnitQuantity | undefined {
  const clean = symbol.trim()
  return UNIT_QUANTITIES.find((quantity) => quantity.notations.some((notation) => notation.symbol === clean))
}

/** 記号の読み。 */
export function labelOf(symbol: string): string | undefined {
  const clean = symbol.trim()
  for (const quantity of UNIT_QUANTITIES) {
    const hit = quantity.notations.find((notation) => notation.symbol === clean)
    if (hit) return hit.label
  }
  return undefined
}

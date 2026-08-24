import type { CalcRow, PortDef } from '../types.ts'

export interface CalcDefinition {
  name: string
  expr: string
}

export interface CalcProgramResult {
  definitions: CalcDefinition[]
  error?: string
}

const IDENT_PART = 'A-Za-z_À-ɏ々〆぀-ヿ㐀-䶿一-鿿０-ﾟ0-9.'

/** 既存の式にある既知の参照を、読みやすい `{変数名}` 記法へ変換する。 */
export function braceReferences(expr: string, names: string[]): string {
  let result = expr
  const unique = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length)
  for (const name of unique) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result.replace(new RegExp(`(?<![${IDENT_PART}{])${escaped}(?![${IDENT_PART}}])`, 'g'), `{${name}}`)
  }
  return result
}

/** 保存済みの計算行を、複数行エディター用のテキストへ変換する。 */
export function formatCalcProgram(inputs: PortDef[], calcs: CalcRow[]): string {
  const known = inputs.map((input) => input.name)
  return calcs.map((calc) => {
    const line = `{${calc.name}} = ${braceReferences(calc.expr, known)}`
    known.push(calc.name)
    return line
  }).join('\n')
}

/** 1行1定義の `{結果名} = 数式` を解析する。空行は無視する。 */
export function parseCalcProgram(source: string): CalcProgramResult {
  const definitions: CalcDefinition[] = []
  const names = new Set<string>()
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (!line.trim()) continue
    const match = line.match(/^\s*\{([^{}]+)\}\s*=\s*(.*?)\s*$/)
    if (!match) return { definitions, error: `${index + 1}行目は {結果名} = 数式 の形で入力してください` }
    const name = match[1].trim()
    const expr = match[2].trim()
    if (!name) return { definitions, error: `${index + 1}行目の結果名が空です` }
    if (!expr) return { definitions, error: `${index + 1}行目の数式が空です` }
    if (names.has(name)) return { definitions, error: `${index + 1}行目の「${name}」は重複しています` }
    names.add(name)
    definitions.push({ name, expr })
  }
  if (!definitions.length) return { definitions, error: '計算式を1行以上入力してください' }
  return { definitions }
}

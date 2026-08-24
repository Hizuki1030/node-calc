/** Excel サブセットの式パーサ。
 *
 * ここで作った AST を評価器 (evaluate.ts) と Excel 式生成 (excel.ts) の
 * 両方が使う。同じ木から両方を出すことで、画面上の値と xlsx の値がずれない。
 */

export type Ast =
  | { t: 'num'; v: number }
  | { t: 'ref'; name: string }
  | { t: 'bin'; op: BinOp; l: Ast; r: Ast }
  | { t: 'neg'; x: Ast }
  | { t: 'call'; name: string; args: Ast[] }

export type BinOp = '+' | '-' | '*' | '/' | '^' | '%' | '>' | '>=' | '<' | '<=' | '=' | '<>'

export class FormulaError extends Error {
  /** 式の中での位置。エラー表示のハイライトに使う */
  pos: number | undefined

  constructor(message: string, pos?: number) {
    super(message)
    this.name = 'FormulaError'
    this.pos = pos
  }
}

/* ---------------- 字句解析 ---------------- */

type Tok =
  | { t: 'num'; v: number; p: number }
  | { t: 'ident'; v: string; p: number }
  | { t: 'op'; v: string; p: number }
  | { t: 'end'; p: number }

const OPS3: string[] = []
const OPS2 = ['>=', '<=', '<>']
const OPS1 = ['+', '-', '*', '/', '^', '%', '(', ')', ',', '>', '<', '=']

/** 識別子に使える文字。日本語（かな・漢字・全角英数）も許可する。 */
export function isIdentStart(ch: string): boolean {
  return /[A-Za-z_À-ɏ々〆぀-ヿ㐀-䶿一-鿿０-ﾟ]/.test(ch)
}
export function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || /[0-9.]/.test(ch)
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '{') {
      const start = i
      const end = src.indexOf('}', i + 1)
      if (end < 0) throw new FormulaError('} が必要です', start)
      const name = src.slice(i + 1, end).trim()
      if (!name) throw new FormulaError('{ } の中に変数名が必要です', start)
      if (/[\r\n{}]/.test(name)) throw new FormulaError('変数名の { } が不正です', start)
      out.push({ t: 'ident', v: name, p: start })
      i = end + 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i
      while (i < src.length && /[0-9]/.test(src[i])) i++
      if (src[i] === '.') {
        i++
        while (i < src.length && /[0-9]/.test(src[i])) i++
      }
      if (src[i] === 'e' || src[i] === 'E') {
        const save = i
        i++
        if (src[i] === '+' || src[i] === '-') i++
        if (/[0-9]/.test(src[i] ?? '')) {
          while (i < src.length && /[0-9]/.test(src[i])) i++
        } else {
          i = save
        }
      }
      out.push({ t: 'num', v: Number(src.slice(start, i)), p: start })
      continue
    }
    if (isIdentStart(ch)) {
      const start = i
      while (i < src.length && isIdentPart(src[i])) i++
      out.push({ t: 'ident', v: src.slice(start, i), p: start })
      continue
    }
    const three = src.slice(i, i + 3)
    if (OPS3.includes(three)) {
      out.push({ t: 'op', v: three, p: i })
      i += 3
      continue
    }
    const two = src.slice(i, i + 2)
    if (OPS2.includes(two)) {
      out.push({ t: 'op', v: two, p: i })
      i += 2
      continue
    }
    if (OPS1.includes(ch)) {
      out.push({ t: 'op', v: ch, p: i })
      i++
      continue
    }
    throw new FormulaError(`使えない文字です: ${ch}`, i)
  }
  out.push({ t: 'end', p: src.length })
  return out
}

/* ---------------- 構文解析（再帰下降） ---------------- */

// 優先順位が低いほど外側。比較 < 加減 < 乗除剰余 < 冪 < 単項 < 一次式
const CMP: string[] = ['>', '>=', '<', '<=', '=', '<>']

class Parser {
  private i = 0
  private readonly toks: Tok[]

  constructor(toks: Tok[]) {
    this.toks = toks
  }

  private peek(): Tok {
    return this.toks[this.i]
  }
  private isOp(...vs: string[]): boolean {
    const t = this.peek()
    return t.t === 'op' && vs.includes(t.v)
  }
  private eat(): Tok {
    return this.toks[this.i++]
  }
  private expectOp(v: string): void {
    if (!this.isOp(v)) throw new FormulaError(`${v} が必要です`, this.peek().p)
    this.i++
  }

  parse(): Ast {
    const e = this.comparison()
    if (this.peek().t !== 'end') {
      throw new FormulaError('式の終わりが余分です', this.peek().p)
    }
    return e
  }

  private comparison(): Ast {
    let l = this.additive()
    while (this.isOp(...CMP)) {
      const op = (this.eat() as { v: string }).v as BinOp
      l = { t: 'bin', op, l, r: this.additive() }
    }
    return l
  }

  private additive(): Ast {
    let l = this.multiplicative()
    while (this.isOp('+', '-')) {
      const op = (this.eat() as { v: string }).v as BinOp
      l = { t: 'bin', op, l, r: this.multiplicative() }
    }
    return l
  }

  private multiplicative(): Ast {
    let l = this.unary()
    while (this.isOp('*', '/', '%')) {
      const op = (this.eat() as { v: string }).v as BinOp
      l = { t: 'bin', op, l, r: this.unary() }
    }
    return l
  }

  private unary(): Ast {
    if (this.isOp('-')) {
      this.eat()
      return { t: 'neg', x: this.unary() }
    }
    if (this.isOp('+')) {
      this.eat()
      return this.unary()
    }
    return this.power()
  }

  /** 冪は右結合。-2^2 は -(2^2) になるよう unary の下に置く。 */
  private power(): Ast {
    const base = this.primary()
    if (this.isOp('^')) {
      this.eat()
      return { t: 'bin', op: '^', l: base, r: this.unary() }
    }
    return base
  }

  private primary(): Ast {
    const t = this.peek()
    if (t.t === 'num') {
      this.eat()
      return { t: 'num', v: t.v }
    }
    if (t.t === 'ident') {
      this.eat()
      if (this.isOp('(')) {
        this.eat()
        const args: Ast[] = []
        if (!this.isOp(')')) {
          args.push(this.comparison())
          while (this.isOp(',')) {
            this.eat()
            args.push(this.comparison())
          }
        }
        this.expectOp(')')
        return { t: 'call', name: t.v.toUpperCase(), args }
      }
      return { t: 'ref', name: t.v }
    }
    if (this.isOp('(')) {
      this.eat()
      const e = this.comparison()
      this.expectOp(')')
      return e
    }
    throw new FormulaError('値が必要です', t.p)
  }
}

const cache = new Map<string, Ast>()

/** 式文字列を AST にする。同じ文字列は使い回す。 */
export function parse(src: string): Ast {
  const hit = cache.get(src)
  if (hit) return hit
  const ast = new Parser(tokenize(src)).parse()
  cache.set(src, ast)
  return ast
}

/** 式が参照している識別子を集める（依存解析・未定義チェック用）。 */
export function refsOf(ast: Ast, into = new Set<string>()): Set<string> {
  switch (ast.t) {
    case 'ref':
      into.add(ast.name)
      break
    case 'bin':
      refsOf(ast.l, into)
      refsOf(ast.r, into)
      break
    case 'neg':
      refsOf(ast.x, into)
      break
    case 'call':
      for (const a of ast.args) refsOf(a, into)
      break
    case 'num':
      break
  }
  return into
}

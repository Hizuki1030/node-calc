/** 式のライブプレビュー用の寛容な字句解析。
 *
 * 評価用の parser.ts と違って、書きかけの式（`1+` や `(a+`）でも途中までトークンに
 * 分解して返す。返したトークンを数式らしい記号（× ÷ ≥ ≤ ≠ や上付き）に置き換え、
 * 色分け用の種別（数値・関数・参照・演算子・括弧・不正文字）を添える。
 */

import { isIdentStart, isIdentPart } from './parser.ts'
import { FUNCTIONS } from './functions.ts'

type Tok =
  | { k: 'num'; v: string }
  | { k: 'ident'; v: string }
  | { k: 'op'; v: string }
  | { k: 'paren'; v: string }
  | { k: 'ws'; v: string }
  | { k: 'err'; v: string }

/** 数式っぽく見せる記号の置き換え。 */
const OP_GLYPH: Record<string, string> = {
  '*': '×',
  '/': '÷',
  '>=': '≥',
  '<=': '≤',
  '<>': '≠',
}

export type SegKind = 'num' | 'fn' | 'ref' | 'op' | 'paren' | 'err' | 'space'

export interface Seg {
  k: SegKind
  text: string
  /** 冪の指数として上付きで描く */
  sup?: boolean
}

/** 書きかけでも止まらない字句解析。不正な文字は err トークンにする。 */
function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      let j = i
      while (j < src.length && /\s/.test(src[j])) j++
      out.push({ k: 'ws', v: src.slice(i, j) })
      i = j
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
      out.push({ k: 'num', v: src.slice(start, i) })
      continue
    }
    if (isIdentStart(ch)) {
      const start = i
      while (i < src.length && isIdentPart(src[i])) i++
      out.push({ k: 'ident', v: src.slice(start, i) })
      continue
    }
    const two = src.slice(i, i + 2)
    if (two === '>=' || two === '<=' || two === '<>') {
      out.push({ k: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/^%,><=()'.includes(ch)) {
      out.push({ k: ch === '(' || ch === ')' ? 'paren' : 'op', v: ch })
      i++
      continue
    }
    out.push({ k: 'err', v: ch })
    i++
  }
  return out
}

function skipWs(toks: Tok[], i: number): number {
  while (i < toks.length && toks[i].k === 'ws') i++
  return i
}

/** `^` の直後に上付きにする範囲の終端（排他）。対象がなければ -1。 */
function supSpanEnd(toks: Tok[], i: number): number {
  const t = toks[i]
  if (!t) return -1
  if (t.k === 'num' || t.k === 'ident') return i + 1
  if (t.k === 'op' && t.v === '-') {
    const n = toks[i + 1]
    if (n && (n.k === 'num' || n.k === 'ident')) return i + 2
    return -1
  }
  if (t.k === 'paren' && t.v === '(') {
    let depth = 0
    for (let j = i; j < toks.length; j++) {
      const u = toks[j]
      if (u.k === 'paren' && u.v === '(') depth++
      else if (u.k === 'paren' && u.v === ')') {
        depth--
        if (depth === 0) return j + 1
      }
    }
    return -1
  }
  return -1
}

function segOf(t: Tok, sup: boolean): Seg {
  switch (t.k) {
    case 'num':
      return { k: 'num', text: t.v, sup: sup || undefined }
    case 'ident':
      return { k: FUNCTIONS[t.v.toUpperCase()] ? 'fn' : 'ref', text: t.v, sup: sup || undefined }
    case 'paren':
      return { k: 'paren', text: t.v, sup: sup || undefined }
    case 'op':
      return { k: 'op', text: OP_GLYPH[t.v] ?? t.v, sup: sup || undefined }
    case 'err':
      return { k: 'err', text: t.v, sup: sup || undefined }
    default:
      return { k: 'space', text: t.v, sup: sup || undefined }
  }
}

/** 式文字列を、描画用の色分けセグメント列に分解する。 */
export function segments(src: string): Seg[] {
  const toks = tokenize(src)
  const out: Seg[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.k === 'ws') {
      out.push({ k: 'space', text: t.v })
      continue
    }
    if (t.k === 'op' && t.v === '^') {
      const j = skipWs(toks, i + 1)
      const end = supSpanEnd(toks, j)
      if (end > j) {
        for (let k = j; k < end; k++) {
          const u = toks[k]
          if (u.k === 'ws') continue
          out.push(segOf(u, true))
        }
        i = end - 1
      } else {
        out.push({ k: 'op', text: '^' })
      }
      continue
    }
    out.push(segOf(t, false))
  }
  return out
}

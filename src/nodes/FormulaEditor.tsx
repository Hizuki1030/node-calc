import { useEffect, useMemo, useRef, useState } from 'react'
import { MathFormula } from './MathFormula.tsx'
import { parseCalcProgram } from '../engine/program.ts'

const OPERATORS: [label: string, insert: string][] = [
  ['×', '*'],
  ['÷', '/'],
  ['xⁿ', '^'],
  ['(', '('],
  [')', ')'],
  [',', ','],
  ['≥', '>='],
  ['≤', '<='],
  ['≠', '<>'],
]

const FUNCS = ['MAX(', 'MIN(', 'IF(', 'ROUNDUP(', 'ROUNDDOWN(', 'CEILING(', 'SQRT(', 'PI()']

/** 打鍵が止まってから親へ渡すまでの待ち時間。 */
const COMMIT_DELAY = 200

/** 式の入力欄。素のテキストで打てるまま、下に数式らしく組んだライブプレビューを出し、
 *  フォーカス中は記号パレットでポチポチ入力を補助する。
 *
 *  入力中の値は DOM 側に持たせる（非制御）。React が value を握ったままだと、
 *  日本語の変換中に再描画が入るたび未確定の文字列が古い値へ書き戻され、
 *  変換が一文字ごとに引っかかる。 */
export function FormulaEditor({
  value,
  onChange,
  references = [],
  program = false,
  colors,
  values,
}: {
  value: string
  onChange: (v: string) => void
  references?: string[]
  program?: boolean
  /** 変数名 → 配線色。ライブプレビューの変数をキャンバスと同じ色で見せる。 */
  colors?: Record<string, string>
  /** 変数名 → ホバーで出す文字列（今の値など）。 */
  values?: Record<string, string>
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [focus, setFocus] = useState(false)
  // プレビューと行数のためだけの控え。ここが変わってもこの欄の中しか描き直さない。
  const [draft, setDraft] = useState(value)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  // 最後に自分から親へ渡した内容。これと同じ値が返ってきただけなら表示は触らない。
  const sent = useRef(value)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  const commit = () => {
    window.clearTimeout(timer.current)
    const el = ref.current
    if (!el || !dirty.current) return
    dirty.current = false
    sent.current = el.value
    changeRef.current(el.value)
  }

  // AI の提案を適用したときや、別のブロックを開いたときは表示を入れ替える。
  // 自分が打った内容が一周して返ってきただけの場合は、カーソルを飛ばさないよう何もしない。
  useEffect(() => {
    const el = ref.current
    if (!el || value === sent.current) return
    sent.current = value
    if (el.value === value) return
    window.clearTimeout(timer.current)
    dirty.current = false
    el.value = value
    setDraft(value)
  }, [value])

  // 閉じられても打ちかけの内容を捨てない
  useEffect(() => () => commit(), [])

  const edited = (composing: boolean) => {
    const el = ref.current
    if (!el) return
    // 変換中の未確定文字列はプレビューにも親にも渡さない。
    if (composing) return
    setDraft(el.value)
    dirty.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(commit, COMMIT_DELAY)
  }

  function insert(text: string) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const next = el.value.slice(0, start) + text + el.value.slice(end)
    el.value = next
    setDraft(next)
    dirty.current = true
    commit()
    const pos = start + text.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const parsed = useMemo(() => program ? parseCalcProgram(draft) : null, [program, draft])

  return (
    <div className={`nc-fed${program ? ' is-program' : ''}`}>
      <textarea
        ref={ref}
        className="nc-expr nodrag"
        defaultValue={value}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        rows={program ? Math.max(7, draft.split(/\r?\n/).length + 1) : 2}
        placeholder={program ? '{結果名} = {入力名} * 2' : undefined}
        onCompositionEnd={() => edited(false)}
        onChange={(e) => edited((e.nativeEvent as InputEvent).isComposing)}
        onFocus={() => setFocus(true)}
        onBlur={() => { setFocus(false); commit() }}
        aria-label={program ? '複数行の計算式' : '式'}
      />
      <div
        className="nc-fed-view nodrag"
        aria-hidden="true"
        onClick={() => ref.current?.focus()}
      >
        {!draft.trim()
          ? <span className="nc-fed-empty">式を入力</span>
          : program
            ? parsed?.error
              ? <span className="nc-fed-error">{parsed.error}</span>
              : <div className="nc-fed-program-preview">
                {parsed?.definitions.map((definition) => <MathFormula key={definition.name} name={definition.name} expr={definition.expr} colors={colors} values={values} />)}
              </div>
            : <MathFormula expr={draft} colors={colors} values={values} />}
      </div>
      {focus && (
        <div className="nc-fed-palette nodrag" onMouseDown={(e) => e.preventDefault()}>
          {references.map((name) => (
            <button className="nc-fed-ref" key={name} type="button" onClick={() => insert(`{${name}}`)} title={`${name} を参照`}>
              {`{${name}}`}
            </button>
          ))}
          {references.length > 0 && <span className="nc-fed-sep" />}
          {OPERATORS.map(([label, text]) => (
            <button key={label} type="button" onClick={() => insert(text)} title={text}>
              {label}
            </button>
          ))}
          <span className="nc-fed-sep" />
          {FUNCS.map((f) => (
            <button key={f} type="button" onClick={() => insert(f)} title={f}>
              {f.slice(0, -1)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

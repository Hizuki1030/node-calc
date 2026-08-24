import { useEffect, useRef, type ChangeEvent, type ComponentProps } from 'react'

/** 打鍵が止まってからグラフへ書き戻すまでの待ち時間。 */
const COMMIT_DELAY = 250

/**
 * 文字を打っている間はグラフを書き換えない入力欄。
 *
 * 一文字ごとに親へ値を返すと、グラフ全体の再評価と全ノードの再描画が走り、
 * ノードが増えるほど入力が重くなる。ここでは値を DOM 側に持たせ（非制御）、
 * 打鍵が止まってから、あるいはフォーカスが外れた時にまとめて渡す。
 * 日本語の変換中は isComposing を見て何も送らない。
 */
function useDeferredValue<T extends HTMLInputElement | HTMLTextAreaElement>(
  value: string,
  onCommit: (next: string) => void,
) {
  const ref = useRef<T>(null)
  const timer = useRef<number | undefined>(undefined)
  const dirty = useRef(false)
  // 最後に自分から渡した内容。同じ値が返ってきただけなら表示は触らない。
  const sent = useRef(value)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  const flush = () => {
    window.clearTimeout(timer.current)
    const el = ref.current
    if (!el || !dirty.current) return
    dirty.current = false
    sent.current = el.value
    commitRef.current(el.value)
  }

  const schedule = () => {
    dirty.current = true
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, COMMIT_DELAY)
  }

  // 自分の編集以外で値が変わったとき（提案の適用・別のノードを開いたなど）は表示を合わせる。
  // 自分が打った内容が一周して返ってきただけなら、カーソルを飛ばさないよう何もしない。
  useEffect(() => {
    const el = ref.current
    if (!el || value === sent.current) return
    sent.current = value
    if (el.value === value) return
    window.clearTimeout(timer.current)
    dirty.current = false
    el.value = value
  }, [value])

  // 閉じられても打ちかけの内容を捨てない
  useEffect(() => () => flush(), [])

  return {
    ref,
    defaultValue: value,
    onChange: (event: ChangeEvent<T>) => {
      if ((event.nativeEvent as InputEvent).isComposing) return
      schedule()
    },
    onCompositionEnd: () => schedule(),
    onBlur: flush,
  }
}

type InputProps = Omit<ComponentProps<'input'>, 'onChange' | 'value' | 'defaultValue'>
  & { value: string; onCommit: (next: string) => void }

export function ImeInput({ value, onCommit, ...rest }: InputProps) {
  return <input {...rest} {...useDeferredValue<HTMLInputElement>(value, onCommit)} />
}

type TextareaProps = Omit<ComponentProps<'textarea'>, 'onChange' | 'value' | 'defaultValue'>
  & { value: string; onCommit: (next: string) => void }

export function ImeTextarea({ value, onCommit, ...rest }: TextareaProps) {
  return <textarea {...rest} {...useDeferredValue<HTMLTextAreaElement>(value, onCommit)} />
}

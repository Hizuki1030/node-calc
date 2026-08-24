import { useEffect, useMemo, useRef, useState } from 'react'
import { parseUnit } from '../engine/units.ts'
import { labelOf, quantityOf, UNIT_QUANTITIES, type UnitQuantity } from '../units/catalog.ts'

const RECENT_KEY = 'node-calc.units.recent.v1'

function loadRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 6) : []
  } catch { return [] }
}

function remember(symbol: string): string[] {
  const next = [symbol, ...loadRecent().filter((item) => item !== symbol)].slice(0, 6)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* 保存できなくても選択は続ける */ }
  return next
}

/**
 * 単位を選ぶ。量（SI の基準単位）を選び、その中で k・M・G やミリなどの
 * 表記を選ぶ二段構え。表記を変えても表している量は同じで、値は自動で換算される。
 */
export function UnitPicker({ value, onChange, ariaLabel = '単位' }: {
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState('')
  const [customError, setCustomError] = useState('')
  const [recent, setRecent] = useState<string[]>(loadRecent)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    requestAnimationFrame(() => searchRef.current?.focus())
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const selectedLabel = labelOf(value)
  const current = quantityOf(value)
  const groups: UnitQuantity[] = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ja')
    if (!q) return UNIT_QUANTITIES
    return UNIT_QUANTITIES.map((quantity) => ({
      ...quantity,
      notations: quantity.notations.filter((item) =>
        `${item.symbol} ${item.label} ${quantity.name} ${quantity.base}`.toLocaleLowerCase('ja').includes(q)),
    })).filter((quantity) => quantity.notations.length > 0)
  }, [query])

  const choose = (symbol: string) => {
    onChange(symbol)
    setRecent(remember(symbol))
    setOpen(false)
    setQuery('')
  }

  const chooseCustom = () => {
    try {
      parseUnit(custom)
      choose(custom.trim())
      setCustom('')
      setCustomError('')
    } catch (error) {
      setCustomError(error instanceof Error ? error.message : String(error))
    }
  }

  const toggle = () => {
    if (!open) setOpenUp((root.current?.getBoundingClientRect().bottom ?? 0) > window.innerHeight - 430)
    setOpen((shown) => !shown)
  }

  const chips = (quantity: UnitQuantity) => quantity.notations.map((notation) => (
    <button
      type="button"
      key={notation.symbol}
      className={`nc-unit-chip${value === notation.symbol ? ' is-selected' : ''}${notation.symbol === quantity.base ? ' is-base' : ''}`}
      role="option"
      aria-selected={value === notation.symbol}
      title={`${notation.label}（${quantity.base} の ${notation.factor} 倍）`}
      onClick={() => choose(notation.symbol)}
    >
      {notation.symbol}
    </button>
  ))

  return <div className="nc-unit-picker" ref={root}>
    <button type="button" className={`nc-unit-trigger${!value.trim() ? ' is-required' : ''}`} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
      <span>{value || '単位を選択 *'}</span>
      {selectedLabel && <small>{selectedLabel}</small>}
      <i>⌄</i>
    </button>
    {open && <div className={`nc-unit-popover${openUp ? ' is-up' : ''}`}>
      <div className="nc-unit-search-row">
        <input ref={searchRef} className="nc-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="記号・単位名で検索" aria-label="単位を検索" />
        <button className="nc-x" type="button" onClick={() => setOpen(false)}>×</button>
      </div>

      {/* 今の単位と同じ量の表記。ここを押すだけで k・M・G を切り替えられる。 */}
      {!query && current && current.notations.length > 1 && <section className="nc-unit-notations">
        <h5>{current.name} の表記<em>SI: {current.base}</em></h5>
        <div className="nc-unit-chips" role="listbox">{chips(current)}</div>
      </section>}

      <div className="nc-unit-options">
        {!query && recent.length > 0 && <section>
          <h5>最近使った単位</h5>
          <div className="nc-unit-chips">{recent.map((symbol) => <button type="button" className="nc-unit-chip" key={symbol} onClick={() => choose(symbol)}>{symbol}</button>)}</div>
        </section>}
        {groups.map((quantity) => <section key={quantity.key}>
          <h5>{quantity.name}{quantity.dims && <em>SI: {quantity.base}</em>}</h5>
          <div className="nc-unit-chips" role="listbox">{chips(quantity)}</div>
        </section>)}
        {groups.length === 0 && <p className="nc-hint">一致する単位がありません。下のカスタム単位を使えます。</p>}
      </div>

      <div className="nc-unit-custom">
        <label>カスタム単位</label>
        <div><input className="nc-text" value={custom} onChange={(event) => { setCustom(event.target.value); setCustomError('') }} placeholder="例: kg/m^3" onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) chooseCustom() }} /><button className="nc-btn" type="button" disabled={!custom.trim()} onClick={chooseCustom}>使用</button></div>
        {customError && <small>{customError}</small>}
      </div>
    </div>}
  </div>
}

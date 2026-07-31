import { Children, forwardRef, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  options?: SelectOption[]
  placeholder?: string
  value?: string | number
  defaultValue?: string | number
  /** Native-compatible signature — existing call sites read `e.target.value`. */
  onChange?: React.ChangeEventHandler<HTMLSelectElement>
  children?: ReactNode
  className?: string
  disabled?: boolean
  name?: string
  id?: string
}

interface Item { value: string; label: ReactNode; disabled?: boolean }

/**
 * Themed dropdown that matches the app's menu styling (see ExportMenu).
 * Drop-in for a native <select>: same `options`/`placeholder`/`value`/`onChange`
 * (e.target.value) API and <option> children, but renders an on-brand popup via a
 * body portal (fixed position) so it never gets clipped by overflow containers.
 */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { className, options, placeholder, children, value, defaultValue, onChange, disabled, name, id },
  ref,
) {
  const items = useMemo<Item[]>(() => {
    const base: Item[] = options
      ? options.map((o) => ({ value: o.value, label: o.label }))
      : Children.toArray(children).flatMap((c) => {
          if (!isValidElement(c) || c.type !== 'option') return []
          const p = c.props as { value?: string | number; children?: ReactNode; disabled?: boolean }
          return [{ value: String(p.value ?? ''), label: p.children ?? String(p.value ?? ''), disabled: p.disabled }]
        })
    // Placeholder behaves like <option value="">…</option> — only add if not already present.
    if (placeholder && !base.some((i) => i.value === '')) base.unshift({ value: '', label: placeholder })
    return base
  }, [options, children, placeholder])

  const isControlled = value !== undefined
  const [internal, setInternal] = useState(String(defaultValue ?? ''))
  const current = isControlled ? String(value) : internal
  const selected = items.find((i) => i.value === current)

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number; up: boolean } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  const place = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    const above = r.top
    const up = below < 260 && above > below
    setPos({ top: up ? r.top : r.bottom, left: r.left, width: r.width, maxH: Math.min(288, (up ? above : below) - 12), up })
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const reposition = () => place()
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open, place])

  // When opening, highlight the current selection.
  useEffect(() => {
    if (!open) return
    const idx = items.findIndex((i) => i.value === current)
    setActive(idx >= 0 ? idx : 0)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function commit(v: string) {
    if (!isControlled) setInternal(v)
    // Runtime only reads e.target.value (verified across all call sites); cast the
    // lightweight synthetic event to the native type so typed handlers stay assignable.
    onChange?.({ target: { value: v, name }, currentTarget: { value: v, name } } as unknown as React.ChangeEvent<HTMLSelectElement>)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function moveActive(dir: 1 | -1) {
    setActive((a) => {
      let n = a
      for (let k = 0; k < items.length; k++) {
        n = (n + dir + items.length) % items.length
        if (!items[n].disabled) return n
      }
      return a
    })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true) }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(items.findIndex((i) => !i.disabled)) }
    else if (e.key === 'End') { e.preventDefault(); for (let n = items.length - 1; n >= 0; n--) if (!items[n].disabled) { setActive(n); break } }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const it = items[active]; if (it && !it.disabled) commit(it.value) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div className="relative">
      <button
        ref={(node) => { triggerRef.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node }}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-sm border border-border bg-surface pl-3 pr-9 text-left text-sm',
          'text-text-primary outline-none transition-colors',
          'focus:border-primary focus:ring-4 focus:ring-primary/10',
          'disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-primary ring-4 ring-primary/10',
          className,
        )}
      >
        <span className={cn('flex-1 truncate', (current === '' || !selected) && 'text-text-muted')}>
          {selected ? selected.label : (placeholder ?? '')}
        </span>
      </button>
      <ChevronDown size={16} className={cn('pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted transition-transform', open && 'rotate-180')} />

      {open && pos && createPortal(
        <ul
          ref={menuRef}
          role="listbox"
          style={{ position: 'fixed', left: pos.left, width: pos.width, maxHeight: pos.maxH, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          className="z-[300] mt-1 mb-1 overflow-auto rounded-sm border border-border bg-surface py-1 text-sm shadow-lg scrollbar-thin"
        >
          {items.length === 0 && <li className="px-3 py-2 text-text-muted">No options</li>}
          {items.map((it, i) => {
            const isSel = it.value === current
            return (
              <li
                key={`${it.value}-${i}`}
                role="option"
                aria-selected={isSel}
                aria-disabled={it.disabled}
                onMouseEnter={() => !it.disabled && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => !it.disabled && commit(it.value)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-3 py-2',
                  it.disabled && 'cursor-not-allowed opacity-40',
                  !it.disabled && i === active && 'bg-surface-2',
                  isSel && 'font-semibold text-primary',
                )}
              >
                <span className="flex-1 truncate">{it.label}</span>
                {isSel && <Check size={15} className="shrink-0 text-primary" />}
              </li>
            )
          })}
        </ul>,
        document.body,
      )}
    </div>
  )
})

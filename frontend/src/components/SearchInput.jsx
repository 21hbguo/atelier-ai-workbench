import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X } from 'lucide-react'

const isMobile = () => window.innerWidth < 640

export default function SearchInput({ value, onChange, placeholder = '搜索...', debounceMs = 300 }) {
  const [local, setLocal] = useState(value)
  const [expanded, setExpanded] = useState(false)
  const timer = useRef(null)
  const inputRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const pushedRef = useRef(false)
  const popClosingRef = useRef(false)
  const syncingHistoryRef = useRef(false)
  onChangeRef.current = onChange
  useEffect(() => { setLocal(value) }, [value])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    if (!expanded) return
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    if (isMobile() && !pushedRef.current) {
      window.history.pushState({ __search: true }, '')
      pushedRef.current = true
    }
    return () => clearTimeout(t)
  }, [expanded])
  useEffect(() => {
    if (!expanded || !isMobile()) return
    const onPop = () => { popClosingRef.current = true; inputRef.current?.blur(); setExpanded(false) }
    const t = setTimeout(() => window.addEventListener('popstate', onPop), 100)
    return () => { clearTimeout(t); window.removeEventListener('popstate', onPop) }
  }, [expanded])
  useEffect(() => {
    if (!expanded || !isMobile()) return
    const vv = window.visualViewport
    if (!vv) return
    const h0 = vv.height
    let hmin = h0
    const onResize = () => {
      hmin = Math.min(hmin, vv.height)
      if (hmin < h0 - 80 && vv.height >= h0 - 20) {
        inputRef.current?.blur()
        setExpanded(false)
      }
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [expanded])
  useEffect(() => {
    if (expanded || !pushedRef.current || !isMobile()) return
    if (popClosingRef.current) {
      popClosingRef.current = false
      pushedRef.current = false
      return
    }
    if (syncingHistoryRef.current) return
    syncingHistoryRef.current = true
    window.history.back()
    setTimeout(() => { pushedRef.current = false; syncingHistoryRef.current = false }, 0)
  }, [expanded])
  const handleChange = (v) => {
    setLocal(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onChangeRef.current(v), debounceMs)
  }
  const clear = useCallback((e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    if (timer.current) clearTimeout(timer.current)
    setLocal('')
    onChangeRef.current('')
    inputRef.current?.focus()
  }, [])
  const open = useCallback((e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    setExpanded(true)
  }, [])
  const close = useCallback(() => setExpanded(false), [])
  const hasValue = !!local
  const preview = hasValue ? `${local.slice(0, 1)}…` : ''
  if (!expanded) {
    return (
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button type="button" onClick={open} className={`flex h-8 items-center rounded-lg border transition-colors hover:bg-bg-hover ${hasValue ? 'gap-1 px-2' : 'w-8 justify-center'}`} style={{ borderColor: hasValue ? 'color-mix(in srgb, var(--accent) 35%, var(--border-color))' : 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: hasValue ? 'var(--accent)' : 'var(--text-secondary)' }} title={hasValue ? local : '搜索'}>
          <Search size={15} />
          {hasValue ? <span className="text-xs leading-none">{preview}</span> : null}
        </button>
        {hasValue ? <button type="button" onPointerDown={e => e.preventDefault()} onClick={clear} className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-bg-hover" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--accent)' }} title="清空搜索"><X size={14} /></button> : null}
      </div>
    )
  }
  return (
    <div className="relative flex-1 min-w-[10.5rem] sm:min-w-[13rem]">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: hasValue ? 'var(--accent)' : 'var(--text-secondary)' }} />
      <input
        ref={inputRef}
        value={local}
        onChange={e => handleChange(e.target.value)}
        onBlur={close}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            inputRef.current?.blur()
            setExpanded(false)
          }
        }}
        placeholder={placeholder}
        className="h-8 w-full pl-9 pr-10 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50"
        style={{ background: 'var(--bg-ai-bubble)', borderColor: hasValue ? 'color-mix(in srgb, var(--accent) 35%, var(--border-color))' : 'var(--border-color)', color: 'var(--text-primary)' }}
      />
      {hasValue ? <button type="button" onPointerDown={e => e.preventDefault()} onClick={clear} className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-lg" style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)' }} title="清空搜索"><X size={12} /></button> : null}
    </div>
  )
}

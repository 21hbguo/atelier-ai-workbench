import { useRef, useEffect } from 'react'

export default function CategoryFilter({ categories, active, onChange }) {
  const scrollRef = useRef(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        el.scrollLeft += e.deltaY
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div ref={scrollRef} className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
      <button
        onClick={() => onChange(null)}
        className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
        style={{
          background: active === null ? 'var(--accent)' : 'var(--bg-ai-bubble)',
          color: active === null ? '#fff' : 'var(--text-secondary)',
          border: '1px solid',
          borderColor: active === null ? 'var(--accent)' : 'var(--border-color)',
        }}
      >
        全部
      </button>
      {categories.map(c => (
        <button
          key={c.slug}
          onClick={() => onChange(c.slug)}
          className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap"
          style={{
            background: active === c.slug ? 'var(--accent)' : 'var(--bg-ai-bubble)',
            color: active === c.slug ? '#fff' : 'var(--text-secondary)',
            border: '1px solid',
            borderColor: active === c.slug ? 'var(--accent)' : 'var(--border-color)',
          }}
        >
          {c.label}
          <span className="ml-1 opacity-70">{c.count}</span>
        </button>
      ))}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { X, Check } from 'lucide-react'

export default function QuickSelector({ title, options, selected, onSelect, onClose }) {
  const panelRef = useRef(null)

  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    const onClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    setTimeout(() => document.addEventListener('mousedown', onClickOutside), 0)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [onClose])

  const handleSelect = (label) => {
    onSelect(label === selected ? null : label)
    onClose()
  }

  const grouped = options.reduce((acc, opt) => {
    if (!acc[opt.category]) acc[opt.category] = []
    acc[opt.category].push(opt)
    return acc
  }, {})

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border flex flex-col animate-fade-in-up z-30"
      style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-lg)', maxHeight: '320px' }}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0" style={{ borderColor: 'var(--border-color)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <button onClick={onClose} className="p-1 rounded-2xl hover:bg-bg-hover transition-colors" style={{ color: 'var(--text-secondary)' }}>
          <X size={16} />
        </button>
      </div>
      <div className="overflow-y-auto px-3 py-2 flex-1 min-h-0">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="mb-3 last:mb-0">
            <div className="text-xs font-medium mb-2 px-0.5" style={{ color: 'var(--text-secondary)' }}>{category}</div>
            <div className="grid grid-cols-3 gap-2">
              {items.map((opt) => {
                const isSelected = selected === opt.label
                return (
                  <button
                    key={opt.label}
                    onClick={() => handleSelect(opt.label)}
                    className="relative flex flex-col items-center gap-1 p-2.5 rounded-2xl border transition-all duration-150 hover:scale-[1.03] active:scale-[0.97]"
                    style={{
                      background: isSelected ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-card)',
                      borderColor: isSelected ? 'var(--accent)' : 'var(--border-color)',
                      boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                    }}
                  >
                    {opt.gradient && (
                      <div className="w-full h-5 rounded-2xl" style={{ background: opt.gradient }} />
                    )}
                    <span className="text-sm font-medium leading-tight text-center" style={{ color: isSelected ? 'var(--accent)' : 'var(--text-primary)' }}>
                      {opt.label}
                    </span>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                        <Check size={10} className="text-white" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

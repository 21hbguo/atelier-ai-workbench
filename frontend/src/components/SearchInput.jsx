import { useState, useEffect, useRef } from 'react'
import { Search } from 'lucide-react'

export default function SearchInput({ value, onChange, placeholder = '搜索...', debounceMs = 300 }) {
  const [local, setLocal] = useState(value)
  const timer = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => { setLocal(value) }, [value])

  useEffect(() => {
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [])

  const handleChange = (e) => {
    const v = e.target.value
    setLocal(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => onChangeRef.current(v), debounceMs)
  }

  return (
    <div className="flex-1 relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
      <input
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full pl-9 pr-3 py-2 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50"
        style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
      />
    </div>
  )
}

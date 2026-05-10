import { useState } from 'react'
import { X, Plus } from 'lucide-react'
export default function AdminCategorySuggestion({ result, categories, canEdit, onRemove, onChange }) {
  const [showPicker, setShowPicker] = useState(false)
  const [customSlug, setCustomSlug] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  if (!canEdit) {
    return <div className="flex items-center gap-1"><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: result.is_new_category ? 'var(--color-warning)' + '20' : 'var(--accent)' + '20', color: result.is_new_category ? 'var(--color-warning)' : 'var(--accent)' }}>{result.suggested_category_label || result.suggested_category}{result.is_new_category && ' (新)'}</span></div>
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1" style={{ background: result.is_new_category ? 'var(--color-warning)' + '20' : 'var(--accent)' + '20', color: result.is_new_category ? 'var(--color-warning)' : 'var(--accent)' }}>
          {result.suggested_category_label || result.suggested_category}
          {result.is_new_category && ' (新)'}
          <button onClick={onRemove} className="ml-0.5 hover:opacity-70"><X size={10} /></button>
        </span>
        <button onClick={() => setShowPicker(!showPicker)} className="p-0.5 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }} title="更改分类"><Plus size={12} /></button>
      </div>
      {showPicker && <div className="flex flex-wrap gap-1 mt-1">
        {categories.filter(c => c.slug !== result.suggested_category).map(c => <button key={c.slug} onClick={() => { onChange(result.id, c.slug, c.label, false); setShowPicker(false) }} className="px-2 py-0.5 rounded-full text-xs hover:opacity-80" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>{c.label}</button>)}
        <div className="flex gap-1 items-center">
          <input value={customSlug} onChange={e => setCustomSlug(e.target.value)} placeholder="slug" className="w-20 px-1.5 py-0.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          <input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="名称" className="w-20 px-1.5 py-0.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
          <button onClick={() => { if (customSlug && customLabel) { onChange(result.id, customSlug, customLabel, true); setShowPicker(false); setCustomSlug(''); setCustomLabel('') } }} className="px-2 py-0.5 rounded-lg text-xs text-white" style={{ background: 'var(--accent)' }}>添加</button>
        </div>
      </div>}
    </div>
  )
}

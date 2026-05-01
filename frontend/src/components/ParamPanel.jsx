export default function ParamPanel({ params, onChange }) {
  const sizeOptions = [
    { value: 'auto', label: '自动' },
    { value: '1024x1024', label: '1024×1024' },
    { value: '1536x1024', label: '1536×1024 横图' },
    { value: '1024x1536', label: '1024×1536 竖图' },
    { value: '2048x2048', label: '2048×2048' },
  ]

  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>尺寸</span>
        <select value={params.size ?? 'auto'} onChange={e => onChange(p => ({ ...p, size: e.target.value }))}
          className="px-2 py-1.5 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50"
          style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
          {sizeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </label>
    </div>
  )
}

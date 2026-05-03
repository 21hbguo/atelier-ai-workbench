import { useState, useEffect } from 'react'
import { configAPI } from '../api'

export default function ParamPanel({ params, onChange }) {
  const [models, setModels] = useState([])
  const sizeOptions = [
    { value: 'auto', label: '自动' },
    { value: '1:1', label: '1:1' },
    { value: '3:2', label: '3:2' },
    { value: '2:3', label: '2:3' },
    { value: '16:9', label: '16:9' },
    { value: '9:16', label: '9:16' },
    { value: '5:4', label: '5:4' },
    { value: '4:5', label: '4:5' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4' },
    { value: '21:9', label: '21:9' },
    { value: '9:21', label: '9:21' },
    { value: '1:3', label: '1:3' },
    { value: '3:1', label: '3:1' },
    { value: '2:1', label: '2:1' },
    { value: '1:2', label: '1:2' },
  ]

  useEffect(() => {
    configAPI.models().then(res => {
      setModels(res.data?.models || [])
    }).catch(() => {})
  }, [])

  return (
    <div className="grid gap-3">
      {models.length > 1 && (
        <label className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>模型</span>
          <select value={params.model_id ?? ''} onChange={e => onChange(p => ({ ...p, model_id: e.target.value }))}
            className="px-2 py-1.5 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50"
            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
            {models.map(m => <option key={m.model_id} value={m.model_id}>{m.label}</option>)}
          </select>
        </label>
      )}
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

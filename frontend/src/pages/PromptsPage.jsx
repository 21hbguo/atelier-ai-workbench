import { useState, useEffect, useRef } from 'react'
import { Plus, Edit2, Trash2, Search, Download, Upload, X } from 'lucide-react'
import { promptAPI } from '../api'
import PageLayout from '../components/PageLayout'

export default function PromptsPage() {
  const [prompts, setPrompts] = useState([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [editing, setEditing] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', prompt: '', negative_prompt: '', tags: '' })
  const fileRef = useRef(null)

  useEffect(() => { fetchPrompts() }, [query])

  const fetchPrompts = async () => {
    try { const { data } = await promptAPI.list(query); setPrompts(data.prompts) } catch { setPrompts([]) }
  }

  const handleSubmit = async () => {
    if (!form.name || !form.prompt) return
    try {
      if (editing) await promptAPI.update(editing, form)
      else await promptAPI.create(form)
      setForm({ name: '', prompt: '', negative_prompt: '', tags: '' }); setShowForm(false); setEditing(null); fetchPrompts()
    } catch (e) { alert('失败: ' + e.message) }
  }

  const handleDelete = async (id) => {
    if (!confirm('确定删除？')) return
    try { await promptAPI.delete(id); fetchPrompts() } catch {}
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0 || !confirm(`删除 ${selected.size} 条？`)) return
    try { await promptAPI.batchDelete([...selected]); setSelected(new Set()); fetchPrompts() } catch {}
  }

  const handleEdit = (p) => { setForm({ name: p.name, prompt: p.prompt, negative_prompt: p.negative_prompt || '', tags: (p.tags || []).join(', ') }); setEditing(p.id); setShowForm(true) }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try { const { data } = await promptAPI.import(file); alert(`成功: ${data.success}, 失败: ${data.failed}`); fetchPrompts() } catch {}
    e.target.value = ''
  }

  const handleExport = async () => {
    try { const { data } = await promptAPI.export(selected.size > 0 ? [...selected] : null, 'json'); const url = URL.createObjectURL(new Blob([data])); const a = document.createElement('a'); a.href = url; a.download = 'prompts.json'; a.click() } catch {}
  }

  return (
    <PageLayout className="p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg></button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>提示词仓库 ({prompts.length})</h1>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => { setForm({ name: '', prompt: '', negative_prompt: '', tags: '' }); setEditing(null); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Plus size={16} /> 新增</button>
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><Download size={16} /> 导出</button>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><Upload size={16} /> 导入</button>
          <input ref={fileRef} type="file" accept=".json,.csv" className="hidden" onChange={handleImport} />
          {selected.size > 0 && <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-500"><Trash2 size={16} /> 删除 ({selected.size})</button>}
        </div>
        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索..." className="w-full pl-9 pr-3 py-2 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50"
              style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
          </div>
        </div>
        {showForm && (
          <div className="p-4 rounded-xl mb-4 shadow-sm" style={{ background: 'var(--bg-ai-bubble)', border: '1px solid var(--border-color)' }}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>{editing ? '编辑' : '新增'}</h3>
              <button onClick={() => { setShowForm(false); setEditing(null) }} className="p-1 rounded hover:bg-black/5"><X size={16} style={{ color: 'var(--text-secondary)' }} /></button>
            </div>
            <div className="grid gap-3">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="名称"
                className="px-3 py-2 rounded-lg text-sm border outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} placeholder="内容" rows={3}
                className="px-3 py-2 rounded-lg text-sm border outline-none resize-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              <input value={form.negative_prompt} onChange={e => setForm(f => ({ ...f, negative_prompt: e.target.value }))} placeholder="反向提示词"
                className="px-3 py-2 rounded-lg text-sm border outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="标签，逗号分隔"
                className="px-3 py-2 rounded-lg text-sm border outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowForm(false); setEditing(null) }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>取消</button>
                <button onClick={handleSubmit} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>保存</button>
              </div>
            </div>
          </div>
        )}
        {prompts.length === 0 ? <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无提示词</div>
        : <div className="grid gap-3 sm:grid-cols-2">
          {prompts.map(p => (
            <div key={p.id} className={`p-4 rounded-xl border ${selected.has(p.id) ? 'ring-2 ring-accent/50' : ''}`}
              style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => { const n = new Set(selected); n.has(p.id) ? n.delete(p.id) : n.add(p.id); setSelected(n) }} className="mt-1" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{p.name}</h3>
                  <p className="text-xs whitespace-pre-wrap line-clamp-3 mb-2" style={{ color: 'var(--text-secondary)' }}>{p.prompt}</p>
                  {p.tags?.length > 0 && <div className="flex flex-wrap gap-1 mb-2">{p.tags.map((t, i) => <span key={i} className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>{t}</span>)}</div>}
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.created_at}</span>
                    <div className="ml-auto flex gap-1">
                      <button onClick={() => navigator.clipboard.writeText(p.prompt)} className="p-1 rounded hover:bg-black/5 text-xs" style={{ color: 'var(--text-secondary)' }}>复制</button>
                      <button onClick={() => handleEdit(p)} className="p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(p.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20" style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>}
      </div>
    </PageLayout>
  )
}

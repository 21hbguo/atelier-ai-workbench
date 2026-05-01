import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Download, Upload, X, Send } from 'lucide-react'
import { promptAPI } from '../api'
import PageLayout from '../components/PageLayout'
import SearchInput from '../components/SearchInput'

export default function PromptsPage() {
  const navigate = useNavigate()
  const [prompts, setPrompts] = useState([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [detail, setDetail] = useState(null)
  const [form, setForm] = useState({ name: '', prompt: '', tags: '' })
  const [showNewForm, setShowNewForm] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => { fetchPrompts() }, [query])

  const fetchPrompts = async () => {
    try { const { data } = await promptAPI.list(query, null, 'private'); setPrompts(data.prompts) } catch { setPrompts([]) }
  }

  const openDetail = (p) => {
    setForm({ name: p.name, prompt: p.prompt, tags: (p.tags || []).join(', ') })
    setDetail(p)
  }

  const handleSave = async () => {
    if (!form.name || !form.prompt) return
    const payload = { name: form.name, prompt: form.prompt, negative_prompt: '', tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [] }
    try {
      await promptAPI.update(detail.id, payload)
      setDetail(null)
      fetchPrompts()
    } catch (e) { alert('失败: ' + e.message) }
  }

  const handleCreate = async () => {
    if (!form.name || !form.prompt) return
    const payload = { name: form.name, prompt: form.prompt, negative_prompt: '', tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [] }
    try {
      await promptAPI.create(payload)
      setShowNewForm(false)
      setForm({ name: '', prompt: '', tags: '' })
      fetchPrompts()
    } catch (e) { alert('失败: ' + e.message) }
  }

  const handleDelete = async (id) => {
    if (!confirm('确定删除？')) return
    try { await promptAPI.delete(id); if (detail?.id === id) setDetail(null); fetchPrompts() } catch {}
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0 || !confirm(`删除 ${selected.size} 条？`)) return
    try { await promptAPI.batchDelete([...selected]); setSelected(new Set()); fetchPrompts() } catch {}
  }

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
      <div>
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg></button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>我的提示词 ({prompts.length})</h1>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => { setForm({ name: '', prompt: '', tags: '' }); setShowNewForm(true) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Plus size={16} /> 新增</button>
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><Download size={16} /> 导出</button>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><Upload size={16} /> 导入</button>
          <input ref={fileRef} type="file" accept=".json,.csv" className="hidden" onChange={handleImport} />
          {selected.size > 0 && <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-500"><Trash2 size={16} /> 删除 ({selected.size})</button>}
        </div>
        <div className="flex gap-2 mb-4">
          <SearchInput value={query} onChange={setQuery} placeholder="搜索..." />
        </div>

        {prompts.length === 0 && !showNewForm ? <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无提示词</div>
        : <div className="grid gap-3 sm:grid-cols-2">
          {showNewForm && (
            <div className="p-4 rounded-xl border shadow-md" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
              <div className="grid gap-3">
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="标题"
                  autoFocus
                  className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} placeholder="提示词内容" rows={4}
                  className="px-3 py-2 rounded-lg text-sm border outline-none resize-none focus:ring-1 focus:ring-accent/50" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="标签，逗号分隔"
                  className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setShowNewForm(false); setForm({ name: '', prompt: '', tags: '' }) }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>取消</button>
                  <button onClick={handleCreate} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>保存</button>
                </div>
              </div>
            </div>
          )}
          {prompts.map(p => (
            <div key={p.id} className={`p-4 rounded-xl border cursor-pointer hover:shadow-md transition-shadow ${selected.has(p.id) ? 'ring-2 ring-accent/50' : ''}`}
              style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}
              onClick={(e) => { if (e.target.type === 'checkbox' || e.target.closest('button')) return; openDetail(p) }}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => { const n = new Set(selected); n.has(p.id) ? n.delete(p.id) : n.add(p.id); setSelected(n) }} className="mt-1" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{p.name}</h3>
                  <p className="text-xs whitespace-pre-wrap line-clamp-3 mb-2" style={{ color: 'var(--text-secondary)' }}>{p.prompt}</p>
                  {p.tags?.length > 0 && <div className="flex flex-wrap gap-1 mb-2">{p.tags.map((t, i) => <span key={i} className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>{t}</span>)}</div>}
                  <div className="flex items-center gap-2">
                    <div className="ml-auto flex gap-1">
                      <button onClick={(e) => { e.stopPropagation(); localStorage.setItem('pending_prompt', p.prompt); navigate('/') }} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white" style={{ background: 'var(--accent)' }}><Send size={12} /> 使用</button>
                      <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(p.prompt) }} className="p-1 rounded hover:bg-black/5 text-xs" style={{ color: 'var(--text-secondary)' }}>复制</button>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20" style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>}
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="标题"
                className="font-semibold text-lg flex-1 bg-transparent outline-none" style={{ color: 'var(--text-primary)' }} />
              <button onClick={() => setDetail(null)} className="p-1 rounded hover:bg-black/5 ml-2"><X size={18} style={{ color: 'var(--text-secondary)' }} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>提示词内容</label>
                <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} rows={6}
                  className="w-full text-sm p-3 rounded-lg outline-none resize-none border focus:ring-1 focus:ring-accent/50" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>标签</label>
                <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="逗号分隔"
                  className="w-full text-sm p-3 rounded-lg outline-none border focus:ring-1 focus:ring-accent/50" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => { localStorage.setItem('pending_prompt', form.prompt); navigate('/') }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Send size={14} /> 使用</button>
              <button onClick={() => navigator.clipboard.writeText(form.prompt)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>复制</button>
              <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>保存</button>
              <button onClick={() => handleDelete(detail.id)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 ml-auto"><Trash2 size={14} /> 删除</button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2, Download, Upload, X, Send, CheckSquare, Square } from 'lucide-react'
import { promptAPI } from '../api'
import MainLayout from '../components/MainLayout'
import SearchInput from '../components/SearchInput'
import CardGrid from '../components/CardGrid'
import UnifiedDetailModal from '../components/UnifiedDetailModal'
import { useCardData } from '../hooks/useCardData'
import { useAppDialog } from '../components/AppDialogProvider'

export default function PromptsPage() {
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [detailIdx, setDetailIdx] = useState(null)
  const [form, setForm] = useState({ name: '', prompt: '', category: '' })
  const deps = useMemo(() => [query], [query])
  const [showNewForm, setShowNewForm] = useState(false)
  const [categories, setCategories] = useState([])
  const fileRef = useRef(null)

  useEffect(() => {
    promptAPI.categories().then(({ data }) => setCategories(data.categories)).catch(() => {})
  }, [])

  const { cards, total, page, setPage, loading, refresh, handleFavorite } = useCardData({
    type: 'prompt',
    apiFn: (p, s) => promptAPI.list(query, null, 'private', null, null, p, s),
    deps,
  })

  const handleUsePrompt = (input) => {
    const prompt = typeof input === 'object' ? input?.prompt : input
    localStorage.setItem('pending_prompt', prompt)
    navigate('/')
  }

  const handleCreate = async () => {
    if (!form.name || !form.prompt) return
    const payload = { name: form.name, prompt: form.prompt, category: form.category || null }
    try {
      await promptAPI.create(payload)
      setShowNewForm(false)
      setForm({ name: '', prompt: '', category: '' })
      refresh()
    } catch (e) { dialog.alert('失败: ' + e.message) }
  }

  const handleDelete = async (id) => {
    if (!await dialog.confirm('确定删除？')) return
    try { await promptAPI.delete(id); setDetailIdx(null); refresh() } catch (e) { dialog.alert(e.message || '删除失败') }
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0 || !await dialog.confirm(`删除 ${selected.size} 条？`)) return
    try { await promptAPI.batchDelete([...selected]); setSelected(new Set()); refresh() } catch (e) { dialog.alert(e.message || '批量删除失败') }
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try { const { data } = await promptAPI.import(file); dialog.alert(`成功: ${data.success}, 失败: ${data.failed}`); refresh() } catch (e) { dialog.alert(e.message || '导入失败') }
    e.target.value = ''
  }

  const handleExport = async () => {
    try { const { data } = await promptAPI.export(selected.size > 0 ? [...selected] : null, 'json'); const url = URL.createObjectURL(new Blob([data])); const a = document.createElement('a'); a.href = url; a.download = 'prompts.json'; a.click() } catch (e) { dialog.alert(e.message || '导出失败') }
  }

  const handleToggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleSelectAll = useCallback(() => {
    setSelected(new Set(cards.map(c => c.id)))
  }, [cards])

  const handleDeselectAll = useCallback(() => {
    setSelected(new Set())
  }, [])
  const handlePromptSave = useCallback(async (id, payload) => {
    await promptAPI.update(id, payload)
    refresh()
  }, [refresh])

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => { setForm({ name: '', prompt: '', category: '' }); setShowNewForm(true) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Plus size={16} /> 新增</button>
          <button onClick={handleExport} disabled={selected.size === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: 'var(--text-primary)' }}><Download size={16} /> 导出{selected.size > 0 ? ` (${selected.size})` : ''}</button>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-bg-hover" style={{ color: 'var(--text-primary)' }}><Upload size={16} /> 导入</button>
          <input ref={fileRef} type="file" accept=".json,.csv" className="hidden" onChange={handleImport} />
          {selected.size > 0 && <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-[var(--color-error)]"><Trash2 size={16} /> 删除 ({selected.size})</button>}
          {cards.length > 0 && (
            <>
              {selected.size === cards.length ? (
                <button onClick={handleDeselectAll} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-bg-hover" style={{ color: 'var(--text-primary)' }}><CheckSquare size={16} /> 取消全选</button>
              ) : (
                <button onClick={handleSelectAll} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-bg-hover" style={{ color: 'var(--text-primary)' }}><Square size={16} /> 全选</button>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2 mb-4">
          <SearchInput value={query} onChange={setQuery} placeholder="搜索..." />
        </div>

        {showNewForm && (
          <div className="p-4 rounded-xl mb-4 shadow-md" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', border: '1px solid var(--border-color)' }}>
            <div className="grid gap-3">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="标题"
                autoFocus
                className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              <textarea value={form.prompt} onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))} placeholder="提示词内容" rows={4}
                className="px-3 py-2 rounded-lg text-sm border outline-none resize-none focus:ring-1 focus:ring-accent/50" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                <option value="">无分类</option>
                {categories.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowNewForm(false); setForm({ name: '', prompt: '', category: '' }) }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>取消</button>
                <button onClick={handleCreate} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>保存</button>
              </div>
            </div>
          </div>
        )}

        <CardGrid
          cards={cards}
          totalUnit="条"
          loading={loading}
          total={total}
          page={page}
          totalPages={Math.ceil(total / 20)}
          onPageChange={setPage}
          onCardClick={(_, idx) => setDetailIdx(idx)}
          onFavorite={handleFavorite}
          onUsePrompt={handleUsePrompt}
          selectable
          selected={selected}
          onToggleSelect={handleToggleSelect}
          emptyText="暂无提示词"
        />
      </div>

      {detailIdx !== null && cards[detailIdx] && <UnifiedDetailModal card={cards[detailIdx]} cards={cards} currentIndex={detailIdx} onNavigate={setDetailIdx} onClose={() => setDetailIdx(null)} onFavorite={handleFavorite} onUsePrompt={handleUsePrompt} onDelete={handleDelete} title="提示词详情" hideDownload allowPromptEdit onPromptSave={handlePromptSave} />}
    </MainLayout>
  )
}

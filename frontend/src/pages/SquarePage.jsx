import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Image, BookOpen, Share2, Plus, Trash2, Download, Upload, X } from 'lucide-react'
import { squareAPI, promptAPI } from '../api'
import MainLayout from '../components/MainLayout'
import SearchInput from '../components/SearchInput'
import CardGrid from '../components/CardGrid'
import UnifiedDetailModal from '../components/UnifiedDetailModal'
import CategoryFilter from '../components/CategoryFilter'
import { useCardData } from '../hooks/useCardData'

function useImageActions() {
  const navigate = useNavigate()

  const handleUsePrompt = (prompt) => {
    localStorage.setItem('pending_prompt', prompt)
    navigate('/')
  }

  const handleUseImage = async (card) => {
    try {
      const res = await fetch(card.fullUrl)
      const blob = await res.blob()
      const reader = new FileReader()
      reader.onload = () => {
        localStorage.setItem('pending_image', JSON.stringify({ dataUrl: reader.result, name: card.filename || card.title || 'image' }))
        navigate('/')
      }
      reader.readAsDataURL(blob)
    } catch {}
  }

  return { handleUsePrompt, handleUseImage }
}

function usePromptActions() {
  const navigate = useNavigate()

  const handleUsePrompt = (prompt) => {
    localStorage.setItem('pending_prompt', prompt)
    navigate('/')
  }

  const handleUseImage = async (card) => {
    if (!card.fullUrl) return
    try {
      const res = await fetch(card.fullUrl)
      const blob = await res.blob()
      const reader = new FileReader()
      reader.onload = () => {
        localStorage.setItem('pending_image', JSON.stringify({ dataUrl: reader.result, name: (card.name || 'prompt') + '.jpg' }))
        navigate('/')
      }
      reader.readAsDataURL(blob)
    } catch {}
  }

  return { handleUsePrompt, handleUseImage }
}

export default function SquarePage() {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const isAdmin = user?.is_admin
  const [tab, setTab] = useState('works')

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex gap-1 p-0.5 rounded-lg mb-4" style={{ background: 'var(--border-color)' }}>
          {[{ k: 'works', l: '用户作品库', i: Image }, { k: 'prompts', l: '提示词库', i: BookOpen }, { k: 'my', l: '我的分享', i: Share2 }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              <Icon size={14} />{l}
            </button>
          ))}
        </div>

        {tab === 'works' ? <WorksTab /> : tab === 'prompts' ? <PromptsTab isAdmin={isAdmin} /> : <MySharesTab />}
      </div>
    </MainLayout>
  )
}

function WorksTab() {
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState('likes')
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useImageActions()
  const deps = useMemo(() => [searchQuery, sort], [searchQuery, sort])

  const { cards, total, page, setPage, loading, refreshing, refresh, handleLike } = useCardData({
    type: 'image',
    apiFn: (p, s) => squareAPI.list(p, s, searchQuery || undefined, sort),
    deps,
  })

  const totalPages = Math.ceil(total / 20)

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setSort('likes')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'likes' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'likes' ? 'var(--accent)' : 'var(--text-secondary)' }}>最热</button>
          <button onClick={() => setSort('time')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'time' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'time' ? 'var(--accent)' : 'var(--text-secondary)' }}>最新</button>
        </div>
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="搜索提示词/作者..." />
      </div>

      <CardGrid
        cards={cards}
        loading={loading}
        refreshing={refreshing}
        onRefresh={refresh}
        total={total}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        onCardClick={(_, idx) => setDetailIdx(idx)}
        onLike={handleLike}
        onUsePrompt={handleUsePrompt}
        onUseImage={handleUseImage}
        showAuthor
      />

      {detailIdx !== null && cards[detailIdx] && (
        <UnifiedDetailModal
          card={cards[detailIdx]}
          cards={cards}
          currentIndex={detailIdx}
          onNavigate={setDetailIdx}
          onClose={() => setDetailIdx(null)}
          onLike={handleLike}
          onUsePrompt={handleUsePrompt}
          onUseImage={handleUseImage}
          title={`${cards[detailIdx].author} 的作品`}
        />
      )}
    </>
  )
}

function MySharesTab() {
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useImageActions()

  const { cards, total, page, setPage, loading, refreshing, refresh, handleLike } = useCardData({
    type: 'image',
    apiFn: (p, s) => squareAPI.my(p, s),
    deps: [],
  })

  const totalPages = Math.ceil(total / 20)

  return (
    <>
      <CardGrid
        cards={cards}
        loading={loading}
        refreshing={refreshing}
        onRefresh={refresh}
        total={total}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        onCardClick={(_, idx) => setDetailIdx(idx)}
        onLike={handleLike}
        onUsePrompt={handleUsePrompt}
        onUseImage={handleUseImage}
        emptyText="暂无分享"
      />

      {detailIdx !== null && cards[detailIdx] && (
        <UnifiedDetailModal
          card={cards[detailIdx]}
          cards={cards}
          currentIndex={detailIdx}
          onNavigate={setDetailIdx}
          onClose={() => setDetailIdx(null)}
          onLike={handleLike}
          onUsePrompt={handleUsePrompt}
          onUseImage={handleUseImage}
          title="我的作品"
        />
      )}
    </>
  )
}

function PromptsTab({ isAdmin }) {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('likes')
  const [activeCategory, setActiveCategory] = useState(null)
  const [detailIdx, setDetailIdx] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', prompt: '', negative_prompt: '', tags: '', category: '' })
  const [categories, setCategories] = useState([])
  const fileRef = useRef(null)
  const { handleUsePrompt, handleUseImage } = usePromptActions()
  const deps = useMemo(() => [query, sort, activeCategory, isAdmin], [query, sort, activeCategory, isAdmin])

  useEffect(() => { fetchCategories() }, [])

  const fetchCategories = async () => {
    try {
      const { data } = await promptAPI.categories()
      setCategories(data.categories)
    } catch {}
  }

  const { cards, total, page, setPage, loading, refreshing, refresh, handleLike } = useCardData({
    type: 'prompt',
    apiFn: (p, s) => {
      if (!user) return promptAPI.listPublic(query, sort, activeCategory, p)
      return promptAPI.list(query, null, isAdmin ? 'all' : 'community', sort, activeCategory, p)
    },
    deps,
  })

  const totalPages = Math.ceil(total / 50)

  const handleSubmit = async () => {
    if (!form.name || !form.prompt) return
    const payload = {
      ...form,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      category: form.category || null,
    }
    try {
      if (editing) {
        await promptAPI.update(editing, payload)
      } else {
        await promptAPI.createPublic(payload)
      }
      setForm({ name: '', prompt: '', negative_prompt: '', tags: '', category: '' })
      setShowForm(false)
      setEditing(null)
      refresh()
    } catch (e) { alert('失败: ' + e.message) }
  }

  const handleDelete = async (id) => {
    if (!confirm('确定删除？')) return
    try { await promptAPI.delete(id); refresh(); fetchCategories() } catch {}
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0 || !confirm(`删除 ${selected.size} 条？`)) return
    try { await promptAPI.batchDelete([...selected]); setSelected(new Set()); refresh(); fetchCategories() } catch {}
  }

  const handleToggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const { data } = await promptAPI.importPublic(file)
      alert(`成功: ${data.success}, 失败: ${data.failed}`)
      refresh()
      fetchCategories()
    } catch {}
    e.target.value = ''
  }

  const handleExport = async () => {
    try {
      const ids = selected.size > 0 ? [...selected] : null
      const { data } = await promptAPI.export(ids, 'json')
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'prompts.json'
      a.click()
    } catch {}
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setSort('likes')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'likes' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'likes' ? 'var(--accent)' : 'var(--text-secondary)' }}>最热</button>
          <button onClick={() => setSort('time')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'time' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'time' ? 'var(--accent)' : 'var(--text-secondary)' }}>最新</button>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="搜索提示词..." />
      </div>

      {categories.length > 0 && (
        <div className="mb-4">
          <CategoryFilter categories={categories} active={activeCategory} onChange={setActiveCategory} />
        </div>
      )}

      {isAdmin && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => { setForm({ name: '', prompt: '', negative_prompt: '', tags: '', category: '' }); setEditing(null); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>
            <Plus size={16} /> 新增
          </button>
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
            <Download size={16} /> 导出
          </button>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
            <Upload size={16} /> 导入
          </button>
          <input ref={fileRef} type="file" accept=".json,.csv" className="hidden" onChange={handleImport} />
          {selected.size > 0 && (
            <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-red-500">
              <Trash2 size={16} /> 删除 ({selected.size})
            </button>
          )}
        </div>
      )}

      {showForm && isAdmin && (
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
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="px-3 py-2 rounded-lg text-sm border outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
              <option value="">无分类</option>
              {categories.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowForm(false); setEditing(null) }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>保存</button>
            </div>
          </div>
        </div>
      )}

      <CardGrid
        cards={cards}
        loading={loading}
        refreshing={refreshing}
        onRefresh={refresh}
        total={total}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        onCardClick={(_, idx) => setDetailIdx(idx)}
        onLike={handleLike}
        onUsePrompt={handleUsePrompt}
        onUseImage={handleUseImage}
        showAuthor
        selectable={isAdmin}
        selected={selected}
        onToggleSelect={handleToggleSelect}
        emptyText="暂无提示词"
      />

      {detailIdx !== null && cards[detailIdx] && (
        <UnifiedDetailModal
          card={cards[detailIdx]}
          cards={cards}
          currentIndex={detailIdx}
          onNavigate={setDetailIdx}
          onClose={() => setDetailIdx(null)}
          onLike={handleLike}
          onUsePrompt={handleUsePrompt}
          onUseImage={handleUseImage}
          title="提示词详情"
        />
      )}
    </>
  )
}

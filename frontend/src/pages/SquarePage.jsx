import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, User, Plus, Image, BookOpen, Edit2, Trash2, Download, Upload, X, Send } from 'lucide-react'
import { squareAPI, promptAPI } from '../api'
import PageLayout from '../components/PageLayout'
import SearchInput from '../components/SearchInput'
import ImageDetailModal from '../components/ImageDetailModal'

export default function SquarePage() {
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const isAdmin = user?.is_admin
  const [tab, setTab] = useState('works')

  return (
    <PageLayout className="p-4 sm:p-6">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>广场</h1>
        </div>

        <div className="flex gap-1 p-0.5 rounded-lg mb-4" style={{ background: 'var(--border-color)' }}>
          {[{ k: 'works', l: '用户作品库', i: Image }, { k: 'prompts', l: '提示词库', i: BookOpen }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              <Icon size={14} />{l}
            </button>
          ))}
        </div>

        {tab === 'works' ? <WorksTab /> : <PromptsTab isAdmin={isAdmin} />}
      </div>
    </PageLayout>
  )
}

function WorksTab() {
  const navigate = useNavigate()
  const [images, setImages] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState('likes')

  const handleUsePrompt = (prompt) => {
    localStorage.setItem('pending_prompt', prompt)
    navigate('/')
  }

  const handleUseImage = async (imgUrl) => {
    try {
      const res = await fetch(imgUrl)
      const blob = await res.blob()
      const reader = new FileReader()
      reader.onload = () => {
        localStorage.setItem('pending_image', JSON.stringify({ dataUrl: reader.result, name: imgUrl.split('/').pop() }))
        navigate('/')
      }
      reader.readAsDataURL(blob)
    } catch {}
  }

  useEffect(() => { setPage(1) }, [searchQuery, sort])
  useEffect(() => { fetchImages() }, [page, searchQuery, sort])

  const fetchImages = async () => {
    setLoading(true)
    try {
      const { data } = await squareAPI.list(page, 20, searchQuery || undefined, sort)
      setImages(data.images)
      setTotal(data.total)
    } catch {
      setImages([])
    } finally {
      setLoading(false)
    }
  }

  const handleLike = async (imageId) => {
    try {
      const { data } = await squareAPI.like(imageId)
      setImages(prev =>
        prev.map(img =>
          img.id === imageId
            ? { ...img, is_liked: data.liked, likes_count: img.likes_count + (data.liked ? 1 : -1) }
            : img
        )
      )
      if (selected?.id === imageId) {
        setSelected(prev => ({
          ...prev,
          is_liked: data.liked,
          likes_count: prev.likes_count + (data.liked ? 1 : -1),
        }))
      }
    } catch {}
  }

  const getImageUrl = (img) => `/api/images/file/${img.filename}`
  const getThumbUrl = (img) => `/api/images/thumb/${img.filename}`

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{total} 张作品</span>
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setSort('likes')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'likes' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'likes' ? 'var(--accent)' : 'var(--text-secondary)' }}>最热</button>
          <button onClick={() => setSort('time')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'time' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'time' ? 'var(--accent)' : 'var(--text-secondary)' }}>最新</button>
        </div>
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="搜索提示词/作者..." />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
        </div>
      ) : images.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无作品</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {images.map((img) => (
              <div
                key={img.id}
                className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => setSelected(img)}
              >
                <img
                  src={getThumbUrl(img)}
                  alt={img.filename}
                  className="w-full aspect-square object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors hidden md:flex items-center justify-center gap-1.5">
                  {img.prompt && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUsePrompt(img.prompt) }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/90 text-gray-800 hover:bg-white flex items-center gap-1"
                    >
                      <Plus size={12} /> 提示词
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUseImage(getImageUrl(img)) }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/90 text-gray-800 hover:bg-white flex items-center gap-1"
                  >
                    <Image size={12} /> 参考图
                  </button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
                  <p className="text-white text-xs truncate">{img.prompt || '无提示词'}</p>
                </div>
                <div onClick={(e) => { e.stopPropagation(); handleLike(img.id) }} className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm cursor-pointer hover:bg-black/70 transition-colors">
                  <Heart size={12} className={img.is_liked ? 'fill-red-500 text-red-500' : 'text-white'} />
                  <span className="text-white text-xs">{img.likes_count}</span>
                </div>
                <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm">
                  <User size={12} className="text-white" />
                  <span className="text-white text-xs truncate max-w-[80px]">{img.nickname || img.username}</span>
                </div>
              </div>
            ))}
          </div>

          {total > 20 && (
            <div className="flex justify-center gap-2 mt-6">
              {Array.from({ length: Math.ceil(total / 20) }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium ${p === page ? 'bg-accent text-white' : 'hover:bg-black/5'}`}
                  style={{ color: p !== page ? 'var(--text-primary)' : undefined }}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {selected && (
        <ImageDetailModal
          image={{
            url: getImageUrl(selected),
            filename: selected.filename,
            metadata: {
              prompt: selected.prompt,
              created_at: selected.created_at,
              type: selected.metadata?.type,
              size: selected.metadata?.size,
            },
          }}
          onClose={() => setSelected(null)}
          onAddPrompt={selected.prompt ? () => handleUsePrompt(selected.prompt) : undefined}
          onAddImage={() => handleUseImage(getImageUrl(selected))}
          title={`${selected.nickname || selected.username} 的作品`}
          detailContent={
            <div className="flex flex-col gap-4">
              {selected.prompt && (
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>提示词</label>
                  <p className="text-sm p-3 rounded-lg" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                    {selected.prompt}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                {selected.metadata?.type && (
                  <div>
                    <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>类型</label>
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      {selected.metadata.type === 'text' ? '纯文本' : '文本+图像'}
                    </p>
                  </div>
                )}
                {selected.metadata?.size && (
                  <div>
                    <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>尺寸</label>
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{selected.metadata.size}</p>
                  </div>
                )}
                <div>
                  <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>作者</label>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{selected.nickname || selected.username}</p>
                </div>
                <div>
                  <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>创建时间</label>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{selected.created_at}</p>
                </div>
              </div>
              <button
                onClick={() => handleLike(selected.id)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: selected.is_liked ? '#ef444415' : 'var(--bg-primary)',
                  color: selected.is_liked ? '#ef4444' : 'var(--text-primary)',
                }}
              >
                <Heart size={16} className={selected.is_liked ? 'fill-current' : ''} />
                {selected.is_liked ? '已点赞' : '点赞'} ({selected.likes_count})
              </button>
            </div>
          }
        />
      )}
    </>
  )
}

function PromptsTab({ isAdmin }) {
  const navigate = useNavigate()
  const [prompts, setPrompts] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', prompt: '', negative_prompt: '', tags: '' })
  const [detail, setDetail] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [sort, setSort] = useState('likes')
  const fileRef = useRef(null)

  useEffect(() => { fetchPrompts() }, [query, sort])

  const fetchPrompts = async () => {
    setLoading(true)
    try {
      const { data } = await promptAPI.list(query, null, isAdmin ? 'all' : 'public', sort)
      setPrompts(data.prompts)
    } catch {
      setPrompts([])
    } finally {
      setLoading(false)
    }
  }

  const handleLike = async (promptId) => {
    try {
      const { data } = await promptAPI.like(promptId)
      setPrompts(prev =>
        prev.map(p =>
          p.id === promptId
            ? { ...p, is_liked: data.liked, likes_count: p.likes_count + (data.liked ? 1 : -1) }
            : p
        )
      )
      if (detail?.id === promptId) {
        setDetail(prev => ({
          ...prev,
          is_liked: data.liked,
          likes_count: prev.likes_count + (data.liked ? 1 : -1),
        }))
      }
    } catch {}
  }

  const handleSubmit = async () => {
    if (!form.name || !form.prompt) return
    const payload = {
      ...form,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    }
    try {
      if (editing) {
        await promptAPI.update(editing, payload)
      } else {
        await promptAPI.createPublic(payload)
      }
      setForm({ name: '', prompt: '', negative_prompt: '', tags: '' })
      setShowForm(false)
      setEditing(null)
      fetchPrompts()
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

  const handleEdit = (p) => {
    setForm({ name: p.name, prompt: p.prompt, negative_prompt: p.negative_prompt || '', tags: (p.tags || []).join(', ') })
    setEditing(p.id)
    setShowForm(true)
  }

  const handleSaveDetail = async () => {
    if (!editForm || !detail) return
    try {
      await promptAPI.update(detail.id, {
        name: editForm.name,
        prompt: editForm.prompt,
        negative_prompt: editForm.negative_prompt,
        tags: editForm.tags ? editForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      })
      setDetail(null)
      setEditForm(null)
      fetchPrompts()
    } catch (e) { alert('保存失败: ' + e.message) }
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const { data } = await promptAPI.importPublic(file)
      alert(`成功: ${data.success}, 失败: ${data.failed}`)
      fetchPrompts()
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
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{prompts.length} 条提示词</span>
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setSort('likes')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'likes' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'likes' ? 'var(--accent)' : 'var(--text-secondary)' }}>最热</button>
          <button onClick={() => setSort('time')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'time' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'time' ? 'var(--accent)' : 'var(--text-secondary)' }}>最新</button>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="搜索提示词..." />
      </div>

      {isAdmin && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => { setForm({ name: '', prompt: '', negative_prompt: '', tags: '' }); setEditing(null); setShowForm(true) }}
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
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowForm(false); setEditing(null) }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={handleSubmit} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>保存</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
        </div>
      ) : prompts.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无提示词</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {prompts.map(p => (
            <div key={p.id} className={`p-4 rounded-xl border cursor-pointer hover:shadow-md transition-shadow ${selected.has(p.id) ? 'ring-2 ring-accent/50' : ''}`}
              style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}
              onClick={(e) => { if (e.target.type === 'checkbox' || e.target.closest('button')) return; setDetail(p) }}>
              <div className="flex items-start gap-3">
                {isAdmin && (
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => { const n = new Set(selected); n.has(p.id) ? n.delete(p.id) : n.add(p.id); setSelected(n) }} className="mt-1" />
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{p.name}</h3>
                  {isAdmin && (p.nickname || p.username) && (
                    <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{p.nickname || p.username}</p>
                  )}
                  <p className="text-xs whitespace-pre-wrap line-clamp-3 mb-2" style={{ color: 'var(--text-secondary)' }}>{p.prompt}</p>
                  {p.tags?.length > 0 && <div className="flex flex-wrap gap-1 mb-2">{p.tags.map((t, i) => <span key={i} className="px-2 py-0.5 rounded text-xs" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>{t}</span>)}</div>}
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.created_at}</span>
                    <div className="ml-auto flex gap-1">
                      <button onClick={(e) => { e.stopPropagation(); handleLike(p.id) }}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${p.is_liked ? 'bg-red-50 dark:bg-red-900/20' : 'hover:bg-black/5'}`}
                        style={{ color: p.is_liked ? '#ef4444' : 'var(--text-secondary)' }}>
                        <Heart size={12} className={p.is_liked ? 'fill-current' : ''} />{p.likes_count || 0}
                      </button>
                      <button onClick={() => { localStorage.setItem('pending_prompt', p.prompt); navigate('/') }} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white" style={{ background: 'var(--accent)' }}><Send size={12} /> 使用</button>
                      <button onClick={() => navigator.clipboard.writeText(p.prompt)} className="p-1 rounded hover:bg-black/5 text-xs" style={{ color: 'var(--text-secondary)' }}>复制</button>
                      {isAdmin && (
                        <button onClick={() => handleDelete(p.id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20" style={{ color: '#ef4444' }}><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { setDetail(null); setEditForm(null) }}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h2 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>{editForm?.name || detail.name}</h2>
              <button onClick={() => { setDetail(null); setEditForm(null) }} className="p-1 rounded hover:bg-black/5"><X size={18} style={{ color: 'var(--text-secondary)' }} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>提示词内容</label>
                <textarea
                  value={editForm?.prompt ?? detail.prompt}
                  onChange={e => {
                    if (!editForm) setEditForm({ prompt: detail.prompt, negative_prompt: detail.negative_prompt || '', tags: (detail.tags || []).join(', ') })
                    setEditForm(f => ({ ...f, prompt: e.target.value }))
                  }}
                  className="text-sm p-3 rounded-lg whitespace-pre-wrap w-full min-h-[120px] border outline-none resize-none"
                  style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>标签</label>
                <input
                  value={editForm?.tags ?? (detail.tags || []).join(', ')}
                  onChange={e => {
                    if (!editForm) setEditForm({ prompt: detail.prompt, negative_prompt: detail.negative_prompt || '', tags: (detail.tags || []).join(', ') })
                    setEditForm(f => ({ ...f, tags: e.target.value }))
                  }}
                  className="text-sm px-3 py-2 rounded-lg w-full border outline-none"
                  style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}
                  placeholder="标签，逗号分隔"
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>创建时间</label>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{detail.created_at}</p>
              </div>
              {isAdmin && (detail.nickname || detail.username) && (
                <div>
                  <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>作者</label>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{detail.nickname || detail.username}</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => { localStorage.setItem('pending_prompt', editForm?.prompt ?? detail.prompt); navigate('/') }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Send size={14} /> 使用</button>
              <button onClick={() => navigator.clipboard.writeText(editForm?.prompt ?? detail.prompt)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>复制</button>
              <button onClick={() => handleLike(detail.id)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: detail.is_liked ? '#ef444415' : 'var(--bg-primary)',
                  color: detail.is_liked ? '#ef4444' : 'var(--text-primary)',
                }}>
                <Heart size={14} className={detail.is_liked ? 'fill-current' : ''} />
                {detail.is_liked ? '已点赞' : '点赞'} ({detail.likes_count || 0})
              </button>
              {editForm && (
                <button onClick={handleSaveDetail} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>保存</button>
              )}
              {isAdmin && (
                <button onClick={() => { setDetail(null); setEditForm(null); handleDelete(detail.id) }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 ml-auto"><Trash2 size={14} /> 删除</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

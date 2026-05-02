import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, User, Plus, Image, BookOpen, Edit2, Trash2, Download, Upload, X, Send, RefreshCw, Share2 } from 'lucide-react'
import { squareAPI, promptAPI } from '../api'
import MainLayout from '../components/MainLayout'
import SearchInput from '../components/SearchInput'
import ImageDetailModal from '../components/ImageDetailModal'
import PromptCard from '../components/PromptCard'
import PromptDetailModal from '../components/PromptDetailModal'
import CategoryFilter from '../components/CategoryFilter'

export default function SquarePage() {
  const navigate = useNavigate()
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

function MySharesTab() {
  const navigate = useNavigate()
  const [images, setImages] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

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

  useEffect(() => { fetchImages() }, [page])

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchImages()
    setRefreshing(false)
  }

  const fetchImages = async () => {
    setLoading(true)
    try {
      const { data } = await squareAPI.my(page, 20)
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
        <button onClick={handleRefresh} disabled={refreshing}
          className="p-1.5 rounded-lg hover:bg-black/5 transition-colors disabled:opacity-50 ml-auto"
          style={{ color: 'var(--text-secondary)' }}>
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
        </div>
      ) : images.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无分享</div>
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
          title="我的作品"
          detailContent={
            <div className="flex flex-col gap-4">
              {selected.prompt && (
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>提示词</label>
                  <p className="text-sm p-3 rounded-lg max-h-48 md:max-h-72 overflow-y-auto whitespace-pre-wrap break-words" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
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

function WorksTab() {
  const navigate = useNavigate()
  const [images, setImages] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState('likes')
  const [refreshing, setRefreshing] = useState(false)

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

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchImages()
    setRefreshing(false)
  }

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
        <button onClick={handleRefresh} disabled={refreshing}
          className="p-1.5 rounded-lg hover:bg-black/5 transition-colors disabled:opacity-50"
          style={{ color: 'var(--text-secondary)' }}>
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
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
                  <p className="text-sm p-3 rounded-lg max-h-48 md:max-h-72 overflow-y-auto whitespace-pre-wrap break-words" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
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
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const [prompts, setPrompts] = useState([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', prompt: '', negative_prompt: '', tags: '', category: '' })
  const [detail, setDetail] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [sort, setSort] = useState('likes')
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage] = useState(1)
  const [categories, setCategories] = useState([])
  const [activeCategory, setActiveCategory] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => { fetchCategories() }, [])
  useEffect(() => { setPage(1); fetchPrompts() }, [query, sort, activeCategory, page])

  const fetchCategories = async () => {
    try {
      const { data } = await promptAPI.categories()
      setCategories(data.categories)
    } catch {}
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchPrompts()
    setRefreshing(false)
  }

  const fetchPrompts = async () => {
    setLoading(true)
    try {
      let data
      if (!user) {
        ({ data } = await promptAPI.listPublic(query, sort, activeCategory, page))
      } else {
        ({ data } = await promptAPI.list(query, null, isAdmin ? 'all' : 'community', sort, activeCategory, page))
      }
      setPrompts(data.prompts)
      setTotal(data.total)
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
      fetchPrompts()
    } catch (e) { alert('失败: ' + e.message) }
  }

  const handleDelete = async (id) => {
    if (!confirm('确定删除？')) return
    try { await promptAPI.delete(id); fetchPrompts(); fetchCategories() } catch {}
  }

  const handleBatchDelete = async () => {
    if (selected.size === 0 || !confirm(`删除 ${selected.size} 条？`)) return
    try { await promptAPI.batchDelete([...selected]); setSelected(new Set()); fetchPrompts(); fetchCategories() } catch {}
  }

  const handleUse = (p) => {
    localStorage.setItem('pending_prompt', p.prompt)
    navigate('/')
  }

  const handleUseImage = async (p) => {
    if (!p.image_path) return
    try {
      const resp = await fetch(`/api/prompts/evo-thumb/${p.image_path}?size=800`)
      const blob = await resp.blob()
      const reader = new FileReader()
      reader.onload = () => {
        localStorage.setItem('pending_image', JSON.stringify({
          dataUrl: reader.result,
          name: p.name + '.jpg',
        }))
        navigate('/')
      }
      reader.readAsDataURL(blob)
    } catch {}
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const { data } = await promptAPI.importPublic(file)
      alert(`成功: ${data.success}, 失败: ${data.failed}`)
      fetchPrompts()
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

  const totalPages = Math.ceil(total / 50)

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{total} 条提示词</span>
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setSort('likes')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'likes' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'likes' ? 'var(--accent)' : 'var(--text-secondary)' }}>最热</button>
          <button onClick={() => setSort('time')} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${sort === 'time' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: sort === 'time' ? 'var(--accent)' : 'var(--text-secondary)' }}>最新</button>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="搜索提示词..." />
        <button onClick={handleRefresh} disabled={refreshing}
          className="p-1.5 rounded-lg hover:bg-black/5 transition-colors disabled:opacity-50"
          style={{ color: 'var(--text-secondary)' }}>
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
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

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
        </div>
      ) : prompts.length === 0 ? (
        <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无提示词</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {prompts.map(p => (
            <PromptCard
              key={p.id}
              prompt={p}
              isAdmin={isAdmin}
              isSelected={selected.has(p.id)}
              onSelect={(id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n) }}
              onLike={handleLike}
              onUse={handleUse}
              onUseImage={handleUseImage}
              onClick={setDetail}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
            style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }}>
            上一页
          </button>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
            style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-primary)' }}>
            下一页
          </button>
        </div>
      )}

      <PromptDetailModal prompt={detail} onClose={() => setDetail(null)} onLike={handleLike} />
    </>
  )
}

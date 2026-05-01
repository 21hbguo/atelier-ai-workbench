import { useState, useEffect } from 'react'
import { Download, Trash2, X, Copy, Check, ExternalLink } from 'lucide-react'
import { imageAPI, hostingAPI } from '../api'
import PageLayout from '../components/PageLayout'

export default function GalleryPage() {
  const [tab, setTab] = useState('local')
  return (
    <PageLayout className="p-4 sm:p-6">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg></button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>图库</h1>
          <div className="ml-auto flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--border-color)' }}>
            {[{ k: 'local', l: '本地' }, { k: 'hosting', l: '图床' }].map(({ k, l }) => (
              <button key={k} onClick={() => setTab(k)} className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tab === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
                style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>
            ))}
          </div>
        </div>
        {tab === 'local' ? <LocalGallery /> : <HostingGallery />}
      </div>
    </PageLayout>
  )
}

function LocalGallery() {
  const [images, setImages] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [copied, setCopied] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())

  useEffect(() => { fetchImages() }, [page])

  const fetchImages = async () => {
    setLoading(true)
    try {
      const { data } = await imageAPI.list(page, 20)
      setImages(data.images); setTotal(data.total)
    } catch { setImages([]) }
    finally { setLoading(false) }
  }

  const handleDelete = async (f) => {
    if (!confirm('确定删除？')) return
    try { await imageAPI.delete(f); fetchImages(); setSelected(null); window.dispatchEvent(new Event('gallery-updated')) } catch {}
  }

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const toggleCheck = (filename) => {
    setChecked(prev => { const next = new Set(prev); next.has(filename) ? next.delete(filename) : next.add(filename); return next })
  }

  const toggleSelectAll = () => {
    if (checked.size === images.length) { setChecked(new Set()) }
    else { setChecked(new Set(images.map(i => i.filename))) }
  }

  const handleBatchDelete = async () => {
    if (!confirm(`确定删除选中的 ${checked.size} 张图片？`)) return
    for (const f of checked) { try { await imageAPI.delete(f) } catch {} }
    setChecked(new Set()); setSelectMode(false); fetchImages(); window.dispatchEvent(new Event('gallery-updated'))
  }

  const handleBatchDownload = () => {
    for (const img of images) {
      if (checked.has(img.filename)) {
        const a = document.createElement('a'); a.href = img.url; a.download = img.filename; a.click()
      }
    }
  }

  const exitSelectMode = () => { setSelectMode(false); setChecked(new Set()) }

  const meta = selected?.metadata || {}

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{total} 张</span>
        {selectMode ? (
          <button onClick={exitSelectMode} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
        ) : (
          <button onClick={() => setSelectMode(true)} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>选择</button>
        )}
      </div>
      {loading ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
      : images.length === 0 ? <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无图片</div>
      : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {images.map((img, i) => (
              <div key={i} className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => selectMode ? toggleCheck(img.filename) : setSelected(img)}>
                <img src={img.url.replace('/images/file/', '/images/thumb/')} alt={img.filename} className="w-full aspect-square object-cover" loading="lazy" />
                {img.metadata?.prompt && !selectMode && <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent"><p className="text-white text-xs truncate">{img.metadata.prompt}</p></div>}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                {selectMode && (
                  <div className={`absolute top-2 left-2 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${checked.has(img.filename) ? 'bg-accent border-accent' : 'bg-white/80 border-gray-300'}`}>
                    {checked.has(img.filename) && <Check size={12} className="text-white" />}
                  </div>
                )}
                {selectMode && checked.has(img.filename) && <div className="absolute inset-0 bg-accent/10 pointer-events-none" />}
              </div>
            ))}
          </div>
          {total > 20 && !selectMode && <div className="flex justify-center gap-2 mt-6">{Array.from({ length: Math.ceil(total/20) }, (_, i) => i + 1).map(p => (
            <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === page ? 'bg-accent text-white' : 'hover:bg-black/5'}`} style={{ color: p !== page ? 'var(--text-primary)' : undefined }}>{p}</button>
          ))}</div>}
        </>
      )}

      {selectMode && checked.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>已选 {checked.size} 张</span>
            <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
              {checked.size === images.length ? '取消全选' : '全选'}
            </button>
            <div className="ml-auto flex gap-2">
              <button onClick={handleBatchDownload} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Download size={14} /> 下载</button>
              <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /> 删除</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col md:flex-row shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="md:w-3/5 bg-black flex items-center justify-center min-h-[200px] md:min-h-0">
              <img src={selected.url} alt="" className="max-w-full max-h-[60vh] md:max-h-[90vh] object-contain" />
            </div>
            <div className="md:w-2/5 p-5 flex flex-col gap-4 overflow-y-auto" style={{ color: 'var(--text-primary)' }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>生成详情</span>
                <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-black/5"><X size={18} /></button>
              </div>

              {meta.prompt && (
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>提示词</label>
                  <div className="relative">
                    <p className="text-sm p-3 rounded-lg pr-9" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{meta.prompt}</p>
                    <button onClick={() => handleCopy(meta.prompt)} className="absolute right-2 top-2 p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                      <Copy size={14} />
                    </button>
                  </div>
                  {copied && <span className="text-xs mt-1" style={{ color: 'var(--accent)' }}>已复制</span>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {meta.type && <InfoItem label="类型" value={meta.type === 'text' ? '纯文本' : '文本+图像'} />}
                {meta.size && <InfoItem label="尺寸" value={meta.size} />}
                {meta.task_id && <InfoItem label="任务ID" value={meta.task_id} />}
                {meta.created_at && <InfoItem label="创建时间" value={meta.created_at} />}
              </div>

              {meta.input_urls?.length > 0 && (
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>输入图片</label>
                  <div className="flex gap-2 flex-wrap">
                    {meta.input_urls.map((url, i) => <img key={i} src={url} className="w-16 h-16 rounded-lg object-cover" />)}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-auto pt-2">
                <a href={selected.url} download className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Download size={14} /> 下载</a>
                <button onClick={() => handleDelete(selected.filename)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /> 删除</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function HostingGallery() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())
  const [selected, setSelected] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => { fetchItems() }, [])

  const fetchItems = async () => {
    setLoading(true)
    try {
      const { data } = await hostingAPI.list()
      setItems(data.items || [])
    } catch { setItems([]) }
    finally { setLoading(false) }
  }

  const toggleCheck = (url) => {
    setChecked(prev => { const next = new Set(prev); next.has(url) ? next.delete(url) : next.add(url); return next })
  }

  const toggleSelectAll = () => {
    if (checked.size === items.length) setChecked(new Set())
    else setChecked(new Set(items.map(i => i.url)))
  }

  const handleBatchDelete = async () => {
    if (!confirm(`确定删除选中的 ${checked.size} 条图床映射？`)) return
    try {
      await hostingAPI.delete([...checked])
      setChecked(new Set()); setSelectMode(false); fetchItems()
    } catch {}
  }

  const exitSelectMode = () => { setSelectMode(false); setChecked(new Set()) }

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{items.length} 张</span>
        {selectMode ? (
          <button onClick={exitSelectMode} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
        ) : (
          <button onClick={() => setSelectMode(true)} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>选择</button>
        )}
      </div>
      {loading ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
      : items.length === 0 ? <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无图床图片</div>
      : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {items.map((item, i) => (
            <div key={i} className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => selectMode ? toggleCheck(item.url) : setSelected(item)}>
              <img src={`/api/images/proxy-thumb?url=${encodeURIComponent(item.url)}`} alt={item.filename} className="w-full aspect-square object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
              {selectMode && (
                <div className={`absolute top-2 left-2 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${checked.has(item.url) ? 'bg-accent border-accent' : 'bg-white/80 border-gray-300'}`}>
                  {checked.has(item.url) && <Check size={12} className="text-white" />}
                </div>
              )}
              {selectMode && checked.has(item.url) && <div className="absolute inset-0 bg-accent/10 pointer-events-none" />}
              {!selectMode && !item.exists && <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-red-500/80"><p className="text-white text-xs">本地文件缺失</p></div>}
            </div>
          ))}
        </div>
      )}

      {selectMode && checked.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>已选 {checked.size} 张</span>
            <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
              {checked.size === items.length ? '取消全选' : '全选'}
            </button>
            <button onClick={handleBatchDelete} className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /> 删除映射</button>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col md:flex-row shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="md:w-3/5 bg-black flex items-center justify-center min-h-[200px] md:min-h-0">
              <img src={selected.url} alt="" className="max-w-full max-h-[60vh] md:max-h-[90vh] object-contain" />
            </div>
            <div className="md:w-2/5 p-5 flex flex-col gap-4 overflow-y-auto" style={{ color: 'var(--text-primary)' }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>图床信息</span>
                <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-black/5"><X size={18} /></button>
              </div>

              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>图床 URL</label>
                <div className="relative">
                  <p className="text-sm p-3 rounded-lg pr-9 break-all" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{selected.url}</p>
                  <button onClick={() => handleCopy(selected.url)} className="absolute right-2 top-2 p-1 rounded hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                    <Copy size={14} />
                  </button>
                </div>
                {copied && <span className="text-xs mt-1" style={{ color: 'var(--accent)' }}>已复制</span>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <InfoItem label="文件名" value={selected.filename} />
                <div>
                  <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>本地状态</label>
                  <p className="text-sm" style={{ color: selected.exists ? '#22c55e' : '#ef4444' }}>{selected.exists ? '文件存在' : '文件缺失'}</p>
                </div>
              </div>

              {selected.local_path && (
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>本地路径</label>
                  <p className="text-xs p-3 rounded-lg break-all" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>{selected.local_path}</p>
                </div>
              )}

              <div className="flex gap-2 mt-auto pt-2">
                <a href={selected.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><ExternalLink size={14} /> 打开原图</a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function InfoItem({ label, value }) {
  return (
    <div>
      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

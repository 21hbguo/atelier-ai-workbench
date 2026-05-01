import { useState, useEffect } from 'react'
import { Download, Trash2, X, Copy } from 'lucide-react'
import { imageAPI } from '../api'
import PageLayout from '../components/PageLayout'

export default function GalleryPage() {
  const [images, setImages] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [copied, setCopied] = useState(false)

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
    try { await imageAPI.delete(f); fetchImages(); setSelected(null) } catch {}
  }

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const meta = selected?.metadata || {}

  return (
    <PageLayout className="p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg></button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>图库 ({total})</h1>
        </div>
        {loading ? <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
        : images.length === 0 ? <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无图片</div>
        : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {images.map((img, i) => (
                <div key={i} className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => setSelected(img)}>
                  <img src={img.url} alt={img.filename} className="w-full aspect-square object-cover" loading="lazy" />
                  {img.metadata?.prompt && <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent"><p className="text-white text-xs truncate">{img.metadata.prompt}</p></div>}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </div>
              ))}
            </div>
            {total > 20 && <div className="flex justify-center gap-2 mt-6">{Array.from({ length: Math.ceil(total/20) }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === page ? 'bg-accent text-white' : 'hover:bg-black/5'}`} style={{ color: p !== page ? 'var(--text-primary)' : undefined }}>{p}</button>
            ))}</div>}
          </>
        )}
      </div>

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
    </PageLayout>
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

import { useState, useEffect } from 'react'
import { Heart, User } from 'lucide-react'
import { squareAPI } from '../api'
import PageLayout from '../components/PageLayout'
import ImageDetailModal from '../components/ImageDetailModal'

export default function SquarePage() {
  const [images, setImages] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)

  useEffect(() => { fetchImages() }, [page])

  const fetchImages = async () => {
    setLoading(true)
    try {
      const { data } = await squareAPI.list(page, 20)
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
    <PageLayout className="p-4 sm:p-6">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => history.back()} className="p-2 rounded-lg hover:bg-black/5" style={{ color: 'var(--text-primary)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>广场</h1>
          <span className="text-sm ml-2" style={{ color: 'var(--text-secondary)' }}>{total} 张作品</span>
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
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent">
                    <p className="text-white text-xs truncate">{img.prompt || '无提示词'}</p>
                  </div>
                  <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm">
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
      </div>

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
    </PageLayout>
  )
}

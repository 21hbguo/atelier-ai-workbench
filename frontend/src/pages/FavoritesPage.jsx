import { useMemo, useState } from 'react'
import { Image, BookOpen } from 'lucide-react'
import { favoriteAPI } from '../api'
import MainLayout from '../components/MainLayout'
import CardGrid from '../components/CardGrid'
import UnifiedDetailModal from '../components/UnifiedDetailModal'
import { useCardData } from '../hooks/useCardData'
import { normalizeList } from '../utils/cardAdapter'
import { useNavigate } from 'react-router-dom'

function useActions() {
  const navigate = useNavigate()
  const handleUsePrompt = (prompt) => {
    const text = String(prompt || '').trim()
    if (!text) return
    localStorage.setItem('pending_prompt', text)
    window.dispatchEvent(new Event('pending-prompt-updated'))
    navigate('/')
  }
  const handleUseImage = async (card) => {
    if (!card.fullUrl) return
    try {
      const res = await fetch(card.fullUrl)
      const blob = await res.blob()
      const reader = new FileReader()
      reader.onload = () => { localStorage.setItem('pending_image', JSON.stringify({ dataUrl: reader.result, name: card.filename || card.name || 'favorite' })); navigate('/') }
      reader.readAsDataURL(blob)
    } catch {}
  }
  return { handleUsePrompt, handleUseImage }
}

export default function FavoritesPage() {
  const [tab, setTab] = useState('all')
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useActions()
  const deps = useMemo(() => [tab], [tab])
  const { cards, total, page, setPage, loading, paging, refreshing, refresh, handleLike, handleFavorite } = useCardData({
    type: tab === 'prompt' ? 'prompt' : 'image',
    pageSize: 20,
    apiFn: async (p, s) => {
      const { data } = await favoriteAPI.list(tab, p, s)
      if (tab === 'image') return { data: { images: normalizeList(data.images || [], 'image'), total: data.total || 0 } }
      if (tab === 'prompt') return { data: { images: normalizeList(data.prompts || [], 'prompt'), total: data.total || 0 } }
      const images = normalizeList(data.images || [], 'image').map(x => ({ ...x, _favCreatedAt: x._raw.favorite_created_at || '' }))
      const prompts = normalizeList(data.prompts || [], 'prompt').map(x => ({ ...x, _favCreatedAt: x._raw.favorite_created_at || '' }))
      const mixed = [...images, ...prompts].sort((a, b) => String(b._favCreatedAt).localeCompare(String(a._favCreatedAt)))
      return { data: { images: mixed, total: data.total || 0 } }
    },
    deps,
    atomicPaging: true,
    preloadCount: 12,
    preloadTimeoutMs: 900,
    mapCards: items => items,
  })
  const totalPages = Math.ceil(total / 20)
  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex items-center gap-1 mb-3 p-0.5 rounded-lg max-w-sm" style={{ background: 'var(--border-color)' }}>
          {[{ k: 'all', l: '全部' }, { k: 'image', l: '图片', i: Image }, { k: 'prompt', l: '提示词', i: BookOpen }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => { setTab(k); setDetailIdx(null) }} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ${tab === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`} style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{Icon ? <Icon size={12} /> : null}{l}</button>
          ))}
        </div>
        <CardGrid cards={cards} showTotal totalUnit={tab === 'prompt' ? '条' : '项'} loading={loading} paging={paging} refreshing={refreshing} onRefresh={refresh} hideRefresh total={total} page={page} totalPages={totalPages} onPageChange={setPage} onCardClick={(_, idx) => setDetailIdx(idx)} onFavorite={handleFavorite} onUsePrompt={handleUsePrompt} onUseImage={handleUseImage} showAuthor showLike={false} emptyText="暂无收藏" />
      </div>
      {detailIdx !== null && cards[detailIdx] && <UnifiedDetailModal card={cards[detailIdx]} cards={cards} currentIndex={detailIdx} onNavigate={setDetailIdx} onClose={() => setDetailIdx(null)} onUsePrompt={handleUsePrompt} onUseImage={handleUseImage} title="收藏详情" hideDownload />}
    </MainLayout>
  )
}

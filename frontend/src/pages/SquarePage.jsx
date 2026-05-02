import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Image, BookOpen, Share2 } from 'lucide-react'
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
  const [tab, setTab] = useState('works')

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex gap-1 p-0.5 rounded-lg mb-4 overflow-x-auto scrollbar-hide" style={{ background: 'var(--border-color)', scrollbarWidth: 'none' }}>
          {[{ k: 'works', l: '用户作品库', i: Image }, { k: 'prompts', l: '提示词库', i: BookOpen }, { k: 'my', l: '我的分享', i: Share2 }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              <Icon size={14} />{l}
            </button>
          ))}
        </div>

        {tab === 'works' ? <WorksTab /> : tab === 'prompts' ? <PromptsTab /> : <MySharesTab />}
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
          hideDownload
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
          hideDownload
        />
      )}
    </>
  )
}

function PromptsTab() {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('likes')
  const [activeCategory, setActiveCategory] = useState(null)
  const [detailIdx, setDetailIdx] = useState(null)
  const [categories, setCategories] = useState([])
  const { handleUsePrompt, handleUseImage } = usePromptActions()
  const deps = useMemo(() => [query, sort, activeCategory], [query, sort, activeCategory])

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
      return promptAPI.list(query, null, 'community', sort, activeCategory, p)
    },
    deps,
  })

  const totalPages = Math.ceil(total / 50)

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
          hideDownload
        />
      )}
    </>
  )
}

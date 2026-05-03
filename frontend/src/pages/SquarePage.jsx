import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Image, BookOpen, Share2, Trash2, Snowflake, Sun, RefreshCw } from 'lucide-react'
import { squareAPI, promptAPI, adminAPI } from '../api'
import MainLayout from '../components/MainLayout'
import SearchInput from '../components/SearchInput'
import CardGrid from '../components/CardGrid'
import UnifiedDetailModal from '../components/UnifiedDetailModal'
import CategoryFilter from '../components/CategoryFilter'
import { useCardData } from '../hooks/useCardData'
import { readUser } from '../auth'
import { useAppDialog } from '../components/AppDialogProvider'

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
  const dialog = useAppDialog()
  const [tab, setTab] = useState('works')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('likes')
  const [activeCategory, setActiveCategory] = useState(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const isAdmin = Boolean(readUser()?.is_admin)

  const handleTabChange = (newTab) => {
    setTab(newTab)
    setQuery('')
    setSort('likes')
    setActiveCategory(null)
  }

  const handleRefresh = () => setRefreshTrigger(n => n + 1)

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="square-top-block sm:pt-4">
          <div className="square-tab-strip scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {[{ k: 'works', l: '用户作品库', i: Image }, { k: 'prompts', l: '提示词库', i: BookOpen }, { k: 'my', l: '我的分享', i: Share2 }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => handleTabChange(k)} className={`square-tab-btn ${tab === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              <Icon size={14} className="block shrink-0" /><span className="leading-none translate-y-[0.5px]">{l}</span>
            </button>
          ))}
          </div>
        </div>
        <div className="square-subtop-block sm:pt-3">
          <div className="square-section-row">
            {tab !== 'my' && (
              <div className="flex gap-1">
                <button onClick={() => setSort('likes')} className={`square-filter-btn ${sort === 'likes' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
                  style={{ color: sort === 'likes' ? 'var(--accent)' : 'var(--text-secondary)' }}>最热</button>
                <button onClick={() => setSort('time')} className={`square-filter-btn ${sort === 'time' ? 'bg-accent/10' : 'hover:bg-black/5'}`}
                  style={{ color: sort === 'time' ? 'var(--accent)' : 'var(--text-secondary)' }}>最新</button>
              </div>
            )}
            <div className="flex-1 min-w-0" />
            {tab !== 'my' && (
              <div className="square-search-wrap"><SearchInput value={query} onChange={setQuery} placeholder={tab === 'works' ? '搜索提示词/作者...' : '搜索提示词...'} /></div>
            )}
            <button onClick={handleRefresh} className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 transition-colors" style={{ color: 'var(--text-secondary)' }}>
              <RefreshCw size={16} />
            </button>
          </div>
          {tab === 'prompts' && (
            <div className="mt-2">
              <PromptsCategoryFilter active={activeCategory} onChange={setActiveCategory} />
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6">
          {tab === 'works' ? (
            <WorksTab query={query} sort={sort} isAdmin={isAdmin} dialog={dialog} refreshTrigger={refreshTrigger} />
          ) : tab === 'prompts' ? (
            <PromptsTab query={query} sort={sort} activeCategory={activeCategory} isAdmin={isAdmin} dialog={dialog} refreshTrigger={refreshTrigger} />
          ) : (
            <MySharesTab refreshTrigger={refreshTrigger} />
          )}
        </div>
      </div>
    </MainLayout>
  )
}

function WorksTab({ query, sort, isAdmin, dialog, refreshTrigger }) {
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useImageActions()
  const [status, setStatus] = useState('all')
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())

  const deps = useMemo(() => isAdmin ? [query, sort, status, refreshTrigger] : [query, sort, refreshTrigger], [query, sort, status, isAdmin, refreshTrigger])

  const { cards, total, page, setPage, loading, refreshing, refresh, handleLike } = useCardData({
    type: 'image',
    apiFn: (p, s) => isAdmin
      ? adminAPI.square(p, s, query || undefined, status)
      : squareAPI.list(p, s, query || undefined, sort),
    deps,
  })

  const totalPages = Math.ceil(total / 20)

  const toggleCheck = useCallback((id) => {
    setChecked(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (checked.size === cards.length) setChecked(new Set())
    else setChecked(new Set(cards.map(c => c.id)))
  }, [checked.size, cards])

  const handleBatchFreeze = useCallback(async (frozen) => {
    const ids = [...checked]
    try {
      await adminAPI.freezeSquare(ids, frozen)
      setChecked(new Set()); setSelectMode(false); refresh()
    } catch (e) { dialog.alert(e?.response?.data?.detail || e.message || '操作失败') }
  }, [checked, refresh, dialog])

  const handleBatchDelete = useCallback(async () => {
    if (!await dialog.confirm(`确定删除选中的 ${checked.size} 张图片？`)) return
    try {
      await adminAPI.batchDeleteSquare([...checked])
      setChecked(new Set()); setSelectMode(false); refresh()
    } catch (e) { dialog.alert(e?.response?.data?.detail || e.message || '删除失败') }
  }, [checked, refresh, dialog])

  const handleSingleFreeze = useCallback(async (id, frozen) => {
    try { await adminAPI.freezeSquare([id], frozen); refresh() }
    catch (e) { dialog.alert(e?.response?.data?.detail || e.message || '操作失败') }
  }, [refresh, dialog])

  const handleSingleDelete = useCallback(async (id) => {
    if (!await dialog.confirm('确定删除这张图片？')) return
    try { await adminAPI.batchDeleteSquare([id]); refresh() }
    catch (e) { dialog.alert(e?.response?.data?.detail || e.message || '删除失败') }
  }, [refresh, dialog])

  return (
    <>
      {isAdmin && (
        <>
          <div className="flex items-center gap-1 mb-3 p-0.5 rounded-lg" style={{ background: 'var(--border-color)' }}>
            {[{ k: 'all', l: '全部' }, { k: 'active', l: '正常' }, { k: 'frozen', l: '冻结' }].map(({ k, l }) => (
              <button key={k} onClick={() => setStatus(k)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${status === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
                style={{ color: status === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>
            ))}
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>共 {total} 张图片</span>
            <div className="flex items-center gap-2">
              {selectMode && (
                <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                  {checked.size === cards.length ? '取消全选' : '全选'}
                </button>
              )}
              {selectMode && checked.size > 0 && (
                <>
                  <button onClick={() => handleBatchFreeze(false)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600">
                    <Sun size={14} /> 解冻 {checked.size} 项
                  </button>
                  <button onClick={() => handleBatchFreeze(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600">
                    <Snowflake size={14} /> 冻结 {checked.size} 项
                  </button>
                  <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">
                    <Trash2 size={14} /> 删除 {checked.size} 项
                  </button>
                </>
              )}
              {selectMode ? (
                <button onClick={() => { setSelectMode(false); setChecked(new Set()) }} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
              ) : (
                <button onClick={() => setSelectMode(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>选择</button>
              )}
            </div>
          </div>
        </>
      )}

      <CardGrid
        cards={cards}
        showTotal={!isAdmin}
        loading={loading}
        refreshing={refreshing}
        onRefresh={refresh}
        hideRefresh
        total={total}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        onCardClick={(_, idx) => setDetailIdx(idx)}
        onLike={handleLike}
        onUsePrompt={handleUsePrompt}
        onUseImage={handleUseImage}
        showAuthor
        selectable={isAdmin && selectMode}
        selected={checked}
        onToggleSelect={isAdmin ? toggleCheck : undefined}
        renderOverlay={isAdmin ? (card) => (
          <>
            {card.isFrozen && (
              <div className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/90 text-white">
                <Snowflake size={10} className="inline mr-0.5" />冻结
              </div>
            )}
            {!selectMode && (
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between">
                <p className="text-white text-xs truncate flex-1">{card.prompt || '无提示词'}</p>
                <div className="flex items-center gap-1 ml-2">
                  <button onClick={(e) => { e.stopPropagation(); handleSingleFreeze(card.id, !card.isFrozen) }}
                    className="p-1 rounded bg-black/50 text-white hover:bg-blue-500" title={card.isFrozen ? '解冻' : '冻结'}>
                    {card.isFrozen ? <Sun size={12} /> : <Snowflake size={12} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleSingleDelete(card.id) }}
                    className="p-1 rounded bg-black/50 text-white hover:bg-red-500" title="删除">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : undefined}
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

function MySharesTab({ refreshTrigger }) {
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useImageActions()

  const { cards, total, page, setPage, loading, refreshing, refresh, handleLike } = useCardData({
    type: 'image',
    apiFn: (p, s) => squareAPI.my(p, s),
    deps: [refreshTrigger],
  })

  const totalPages = Math.ceil(total / 20)

  return (
    <>
      <CardGrid
        cards={cards}
        loading={loading}
        refreshing={refreshing}
        onRefresh={refresh}
        hideRefresh
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

function PromptsTab({ query, sort, activeCategory, isAdmin, dialog, refreshTrigger }) {
  const user = readUser()
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = usePromptActions()
  const [status, setStatus] = useState('all')
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())
  const deps = useMemo(() => isAdmin ? [query, sort, activeCategory, status, refreshTrigger] : [query, sort, activeCategory, refreshTrigger], [query, sort, activeCategory, status, isAdmin, refreshTrigger])

  const { cards, total, page, setPage, loading, refreshing, refresh, handleLike } = useCardData({
    type: 'prompt',
    pageSize: 50,
    apiFn: async (p, s) => {
      if (isAdmin) {
        const res = await adminAPI.prompts(p, s, query || undefined, activeCategory || undefined, status)
        res.data.prompts = res.data.items || []
        return res
      }
      if (!user) return promptAPI.listPublic(query, sort, activeCategory, p)
      return promptAPI.list(query, null, 'community', sort, activeCategory, p)
    },
    deps,
  })

  const totalPages = Math.ceil(total / 50)

  const toggleCheck = useCallback((id) => {
    setChecked(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (checked.size === cards.length) setChecked(new Set())
    else setChecked(new Set(cards.map(c => c.id)))
  }, [checked.size, cards])

  const handleBatchDelete = useCallback(async () => {
    if (!await dialog.confirm(`确定删除选中的 ${checked.size} 条提示词？`)) return
    try {
      await adminAPI.batchDeletePrompts([...checked])
      setChecked(new Set()); setSelectMode(false); refresh()
    } catch (e) { dialog.alert(e?.response?.data?.detail || e.message || '删除失败') }
  }, [checked, refresh, dialog])
  const handleBatchFreeze = useCallback(async (frozen) => {
    try {
      await adminAPI.freezePrompts([...checked], frozen)
      setChecked(new Set()); setSelectMode(false); refresh()
    } catch (e) { dialog.alert(e?.response?.data?.detail || e.message || '操作失败') }
  }, [checked, refresh, dialog])

  const handleDeletePrompt = useCallback(async (id) => {
    if (!await dialog.confirm('确定删除此提示词？')) return
    try { await adminAPI.deletePrompt(id); refresh() }
    catch (e) { dialog.alert(e?.response?.data?.detail || e.message || '删除失败') }
  }, [refresh, dialog])
  const handleTogglePromptFreeze = useCallback(async (id, frozen) => {
    try { await adminAPI.freezePrompts([id], frozen); refresh() }
    catch (e) { dialog.alert(e?.response?.data?.detail || e.message || '操作失败') }
  }, [refresh, dialog])

  return (
    <>
      {isAdmin && (
        <>
          <div className="flex items-center gap-1 mb-3 p-0.5 rounded-lg" style={{ background: 'var(--border-color)' }}>
            {[{ k: 'all', l: '全部' }, { k: 'active', l: '正常' }, { k: 'frozen', l: '冻结' }].map(({ k, l }) => (
              <button key={k} onClick={() => setStatus(k)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${status === k ? 'bg-white dark:bg-gray-800 shadow-sm' : ''}`}
                style={{ color: status === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>
            ))}
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>共 {total} 条提示词</span>
            <div className="flex items-center gap-2">
              {selectMode && (
                <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
                  {checked.size === cards.length ? '取消全选' : '全选'}
                </button>
              )}
              {selectMode && checked.size > 0 && (
                <>
                  <button onClick={() => handleBatchFreeze(false)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500 text-white hover:bg-blue-600">
                    <Sun size={14} /> 解冻 {checked.size} 条
                  </button>
                  <button onClick={() => handleBatchFreeze(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600">
                    <Snowflake size={14} /> 冻结 {checked.size} 条
                  </button>
                  <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">
                    <Trash2 size={14} /> 删除 {checked.size} 条
                  </button>
                </>
              )}
              {selectMode ? (
                <button onClick={() => { setSelectMode(false); setChecked(new Set()) }} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
              ) : (
                <button onClick={() => setSelectMode(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>选择</button>
              )}
            </div>
          </div>
        </>
      )}

      <CardGrid
        cards={cards}
        showTotal={!isAdmin}
        loading={loading}
        refreshing={refreshing}
        onRefresh={refresh}
        hideRefresh
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
        selectable={isAdmin && selectMode}
        selected={checked}
        onToggleSelect={isAdmin ? toggleCheck : undefined}
        renderOverlay={isAdmin ? (card) => (
          <>
            {card.isFrozen && (
              <div className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/90 text-white">
                <Snowflake size={10} className="inline mr-0.5" />冻结
              </div>
            )}
            {!selectMode ? (
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1">
                <button onClick={(e) => { e.stopPropagation(); handleTogglePromptFreeze(card.id, !card.isFrozen) }}
                  className="p-1 rounded bg-black/50 text-white hover:bg-blue-500" title={card.isFrozen ? '解冻' : '冻结'}>
                  {card.isFrozen ? <Sun size={12} /> : <Snowflake size={12} />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDeletePrompt(card.id) }}
                  className="p-1 rounded bg-black/50 text-white hover:bg-red-500" title="删除">
                  <Trash2 size={12} />
                </button>
              </div>
            ) : null}
          </>
        ) : undefined}
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

function PromptsCategoryFilter({ active, onChange }) {
  const [categories, setCategories] = useState([])

  useEffect(() => {
    promptAPI.categories().then(({ data }) => setCategories(data.categories)).catch(() => {})
  }, [])

  if (categories.length === 0) return null
  return <CategoryFilter categories={categories} active={active} onChange={onChange} />
}

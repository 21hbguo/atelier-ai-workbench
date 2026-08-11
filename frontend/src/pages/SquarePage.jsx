import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { ChevronUp } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Image, BookOpen, Share2, Trash2, Snowflake, Sun, RefreshCw, Star, X, Plus, Upload } from 'lucide-react'
import { squareAPI, promptAPI, adminAPI, favoriteAPI, configAPI } from '../api'
import MainLayout from '../components/MainLayout'
import SearchInput from '../components/SearchInput'
import CardGrid from '../components/CardGrid'
import UnifiedDetailModal from '../components/UnifiedDetailModal'
import CategoryFilter from '../components/CategoryFilter'
import { useCardData } from '../hooks/useCardData'
import { useLayoutMode } from '../LayoutModeContext'
import { normalizeList, normalizePrompt, normalizeImage } from '../utils/cardAdapter'
import { readUser } from '../auth'
import { useAppDialog } from '../components/AppDialogProvider'

function useImageActions() {
  const navigate = useNavigate()
  const ensureLiked = useCallback(async (card) => {
    if (!card?.id || card?.isLiked) return
    try { await squareAPI.like(card.id) } catch {}
  }, [])

  const handleUsePrompt = useCallback(async (input) => {
    const card = input && typeof input === 'object' ? input : null
    const text = String(card?.prompt || input || '').trim()
    if (!text) return
    await ensureLiked(card)
    localStorage.setItem('pending_prompt', text)
    window.dispatchEvent(new Event('pending-prompt-updated'))
    navigate('/draw')
    setTimeout(() => { if (window.location.pathname === '/square') window.location.href = '/draw' }, 120)
  }, [navigate, ensureLiked])

  const handleUseImage = useCallback(async (card) => {
    const url = card.fullUrl || card.thumbUrl2x || card.thumbUrl
    if (!url) { alert('图片地址不存在'); return }
    await ensureLiked(card)
    const stored = JSON.parse(localStorage.getItem('ref_images') || '[]')
    if (!stored.some(i => i.url === url)) { stored.push({ url, name: card.filename || card.title || 'image' }); localStorage.setItem('ref_images', JSON.stringify(stored)) }
    window.dispatchEvent(new Event('pending-image-updated'))
    navigate('/draw')
  }, [navigate, ensureLiked])

  return { handleUsePrompt, handleUseImage }
}

function usePromptActions() {
  const navigate = useNavigate()
  const ensureLiked = useCallback(async (card) => {
    if (!card?.id || card?.isLiked) return
    try { await promptAPI.like(card.id) } catch {}
  }, [])

  const handleUsePrompt = useCallback(async (input) => {
    const card = input && typeof input === 'object' ? input : null
    const text = String(card?.prompt || input || '').trim()
    if (!text) return
    await ensureLiked(card)
    localStorage.setItem('pending_prompt', text)
    window.dispatchEvent(new Event('pending-prompt-updated'))
    navigate('/draw')
    setTimeout(() => { if (window.location.pathname === '/square') window.location.href = '/draw' }, 120)
  }, [navigate, ensureLiked])

  const handleUseImage = useCallback(async (card) => {
    const url = card.fullUrl || card.thumbUrl2x || card.thumbUrl
    if (!url) { alert('图片地址不存在'); return }
    await ensureLiked(card)
    const stored = JSON.parse(localStorage.getItem('ref_images') || '[]')
    if (!stored.some(i => i.url === url)) { stored.push({ url, name: card.filename || card.name || 'prompt' }); localStorage.setItem('ref_images', JSON.stringify(stored)) }
    window.dispatchEvent(new Event('pending-image-updated'))
    navigate('/draw')
  }, [navigate, ensureLiked])

  return { handleUsePrompt, handleUseImage }
}

export default function SquarePage() {
  const dialog = useAppDialog()
  const { layoutMode, setLayoutMode } = useLayoutMode()
  const location = useLocation()
  const [tab, setTab] = useState(() => location.state?.tab === 'favorites' || location.state?.tab === 'shared' ? 'shared' : 'prompts')
  const [squarePageSize, setSquarePageSize] = useState(20)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('likes')
  const [activeCategories, setActiveCategories] = useState({ prompts: null, works: null })
  const [authorFilter, setAuthorFilter] = useState(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const isAdmin = Boolean(readUser()?.is_admin)
  useEffect(() => { setLayoutMode('masonry') }, [setLayoutMode])
  const [showBackToTop, setShowBackToTop] = useState(false)
  useEffect(() => {
    const el = document.getElementById('square-scroll-container')
    if (!el) return
    const onScroll = () => setShowBackToTop(el.scrollTop > 400)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  const activeCategory = tab === 'works' ? activeCategories.works : tab === 'prompts' ? activeCategories.prompts : null
  useEffect(() => { let dead = false; configAPI.get().then(({ data }) => { if (dead) return; setSquarePageSize(Math.max(1, Number(data?.square_page_size) || 20)) }).catch(() => {}); return () => { dead = true } }, [])

  const handleTabChange = (newTab) => {
    setTab(newTab)
    setQuery('')
    setSort('likes')
    setAuthorFilter(null)
  }

  const handleRefresh = () => setRefreshTrigger(n => n + 1)
  const handleCategoryChange = useCallback((next) => {
    setActiveCategories(prev => ({ ...prev, [tab]: next }))
  }, [tab])
  const handleAuthorFilter = useCallback((card) => {
    if (!card?.author) return
    setAuthorFilter({ id: card.authorId || null, name: card.authorName || card.author })
  }, [])

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="square-top-block sm:pt-4">
          <div className="square-tab-strip scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {[{ k: 'prompts', l: '提示词库', i: BookOpen }, { k: 'works', l: '用户作品库', i: Image }, { k: 'shared', l: '分享与收藏', i: Share2 }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => handleTabChange(k)} className={`square-tab-btn ${tab === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              <Icon size={14} className="block shrink-0" /><span className="leading-none translate-y-[0.5px]">{l}</span>
            </button>
          ))}
          </div>
        </div>
        <div className="square-subtop-block sm:pt-3">
          <div className="square-section-row">
            {tab !== 'shared' && (
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => setSort('likes')} className={`square-filter-btn ${sort === 'likes' ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
                  style={{ color: sort === 'likes' ? 'var(--accent)' : 'var(--text-secondary)' }}>最热</button>
                <button onClick={() => setSort('time')} className={`square-filter-btn ${sort === 'time' ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
                  style={{ color: sort === 'time' ? 'var(--accent)' : 'var(--text-secondary)' }}>最新</button>
              </div>
            )}
            {tab !== 'shared' && (
              <div className="square-search-wrap"><SearchInput value={query} onChange={setQuery} placeholder={tab === 'works' ? '搜索提示词/作者...' : '搜索提示词...'} /></div>
            )}
            <button onClick={handleRefresh} className="inline-flex h-8 w-8 items-center justify-center rounded-2xl hover:bg-bg-hover transition-colors flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
              <RefreshCw size={16} />
            </button>
          </div>
          {(tab === 'works' || tab === 'prompts') && authorFilter && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => setAuthorFilter(null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-accent/10 hover:bg-accent/15 transition-colors" style={{ color: 'var(--accent)' }}>
                <span>{`作者: ${authorFilter.name}`}</span><X size={12} />
              </button>
            </div>
          )}
          {(tab === 'prompts' || tab === 'works') && (
            <div className="mt-2">
              <PromptsCategoryFilter active={activeCategory} onChange={handleCategoryChange} />
            </div>
          )}
        </div>
        <div id="square-scroll-container" className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6 relative">
          {tab === 'works' ? (
            <WorksTab query={query} sort={sort} activeCategory={activeCategory} authorFilter={authorFilter} onAuthorFilter={handleAuthorFilter} isAdmin={isAdmin} dialog={dialog} refreshTrigger={refreshTrigger} layoutMode={layoutMode} pageSize={squarePageSize} />
          ) : tab === 'prompts' ? (
            <PromptsTab query={query} sort={sort} activeCategory={activeCategory} authorFilter={authorFilter} onAuthorFilter={handleAuthorFilter} isAdmin={isAdmin} dialog={dialog} refreshTrigger={refreshTrigger} layoutMode={layoutMode} pageSize={squarePageSize} />
          ) : tab === 'shared' ? (
            <SharedTab refreshTrigger={refreshTrigger} layoutMode={layoutMode} pageSize={squarePageSize} />
          ) : null}
          {showBackToTop && (
            <button
              onClick={() => document.getElementById('square-scroll-container')?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="fixed right-6 z-50 w-10 h-10 rounded-full flex items-center justify-center shadow-lg backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:opacity-100 active:scale-95"
              style={{ bottom: 'calc(6.5rem + env(safe-area-inset-bottom))', background: 'color-mix(in srgb, var(--accent) 60%, transparent)', color: '#fff', opacity: 0.75 }}
            >
              <ChevronUp size={20} />
            </button>
          )}
        </div>
      </div>
    </MainLayout>
  )
}

function WorksTab({ query, sort, activeCategory, authorFilter, onAuthorFilter, isAdmin, dialog, refreshTrigger, layoutMode, pageSize }) {
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useImageActions()
  const [status, setStatus] = useState('all')
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())

  const deps = useMemo(() => isAdmin ? [query, sort, status, refreshTrigger, authorFilter?.id || '', authorFilter?.name || '', activeCategory || ''] : [query, sort, refreshTrigger, authorFilter?.id || '', authorFilter?.name || '', activeCategory || ''], [query, sort, status, isAdmin, refreshTrigger, authorFilter, activeCategory])

  useEffect(() => { setDetailIdx(null) }, [query, sort, status, activeCategory])

  const { cards, total, page, setPage, loading, paging, refreshing, refresh, handleLike, handleFavorite, updateCard } = useCardData({
    type: 'image',
    pageSize,
    apiFn: (p, s) => isAdmin
      ? adminAPI.square(p, s, query || undefined, status, sort, authorFilter?.id || undefined, activeCategory || undefined)
      : squareAPI.list(p, s, query || undefined, sort, authorFilter?.id || undefined, activeCategory || undefined),
    deps,
    atomicPaging: true,
    preloadCount: 12,
    preloadTimeoutMs: 900,
  })

  const totalPages = Math.ceil(total / Math.max(1, pageSize || 20))
  const syncLiked = useCallback((card) => { if (!card?.id || card?.isLiked) return; updateCard(card.id, v => v ? { ...v, isLiked: true, likesCount: (v.likesCount || 0) + (v.isLiked ? 0 : 1) } : v) }, [updateCard])
  const handleUsePromptWithLike = useCallback(async (card) => { syncLiked(card); await handleUsePrompt(card) }, [syncLiked, handleUsePrompt])
  const handleUseImageWithLike = useCallback(async (card) => { syncLiked(card); await handleUseImage(card) }, [syncLiked, handleUseImage])

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
  const exitSelectMode = useCallback(() => { setSelectMode(false); setChecked(new Set()) }, [])
  const bottomDock = isAdmin && selectMode && checked.size > 0 ? (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>已选 {checked.size} 项</span>
        <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
          {checked.size === cards.length ? '取消全选' : '全选'}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => handleBatchFreeze(false)} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white" style={{ background: 'var(--color-info)' }}>
            <Sun size={14} /> 解冻
          </button>
          <button onClick={() => handleBatchFreeze(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white" style={{ background: 'var(--color-warning)' }}>
            <Snowflake size={14} /> 冻结
          </button>
          <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-[var(--color-error)] hover:bg-[var(--color-error)]/10">
            <Trash2 size={14} /> 删除
          </button>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      {isAdmin && (
        <>
          <div className="flex items-center gap-1 mb-3 p-0.5 rounded-2xl" style={{ background: 'var(--border-color)' }}>
            {[{ k: 'all', l: '全部' }, { k: 'active', l: '正常' }, { k: 'frozen', l: '冻结' }].map(({ k, l }) => (
              <button key={k} onClick={() => setStatus(k)}
                className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${status === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`}
                style={{ color: status === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>
            ))}
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>共 {total} 张图片</span>
            <div className="flex items-center gap-2">
              {selectMode ? (
                <button onClick={exitSelectMode} className="px-3 py-1.5 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
              ) : (
                <button onClick={() => setSelectMode(true)} className="px-3 py-1.5 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>选择</button>
              )}
            </div>
          </div>
        </>
      )}

      <CardGrid
        cards={cards}
        layoutMode={layoutMode}
        showTotal={!isAdmin}
        loading={loading}
        paging={paging}
        refreshing={refreshing}
        onRefresh={refresh}
        hideRefresh
        total={total}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        onCardClick={(_, idx) => setDetailIdx(idx)}
        onLike={handleLike}
        onFavorite={handleFavorite}
        onUsePrompt={handleUsePromptWithLike}
        onUseImage={handleUseImageWithLike}
        onAuthorClick={onAuthorFilter}
        paginationScrollTargetId="square-scroll-container"
        scrollAfterPaging
        cardUiMode="square"
        showAuthor
        selectable={isAdmin && selectMode}
        selected={checked}
        onToggleSelect={isAdmin ? toggleCheck : undefined}
        onSelectionChange={isAdmin ? setChecked : undefined}
        renderOverlay={isAdmin ? (card) => (
          <>
            {card.isFrozen && (
              <div className="absolute bottom-2 left-2 z-10 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/90 text-white">
                <Snowflake size={10} className="inline mr-0.5" />冻结
              </div>
            )}
            {!selectMode && (
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end">
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); handleSingleFreeze(card.id, !card.isFrozen) }}
                    className="p-1 rounded-lg bg-black/50 text-white hover:bg-blue-500" title={card.isFrozen ? '解冻' : '冻结'}>
                    {card.isFrozen ? <Sun size={12} /> : <Snowflake size={12} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleSingleDelete(card.id) }}
                    className="p-1 rounded-lg bg-black/50 text-white hover:bg-red-500" title="删除">
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
          onFavorite={handleFavorite}
          onUsePrompt={handleUsePromptWithLike}
          onUseImage={handleUseImageWithLike}
          title={`${cards[detailIdx].author} 的作品`}
          hideDownload
        />
      )}
      {bottomDock}
    </>
  )
}

function PromptsTab({ query, sort, activeCategory, authorFilter, onAuthorFilter, isAdmin, dialog, refreshTrigger, layoutMode, pageSize }) {
  const user = readUser()
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = usePromptActions()
  const [status, setStatus] = useState('all')
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())
  const deps = useMemo(() => isAdmin ? [query, sort, activeCategory, status, refreshTrigger, authorFilter?.id || '', authorFilter?.name || ''] : [query, sort, activeCategory, refreshTrigger, authorFilter?.id || '', authorFilter?.name || ''], [query, sort, activeCategory, status, isAdmin, refreshTrigger, authorFilter])

  useEffect(() => { setDetailIdx(null) }, [activeCategory, query, sort])

  const { cards, total, page, setPage, loading, paging, refreshing, refresh, handleLike, handleFavorite, updateCard } = useCardData({
    type: 'prompt',
    pageSize,
    apiFn: async (p, s) => {
      if (isAdmin) {
        const res = await adminAPI.prompts(p, s, query || undefined, activeCategory || undefined, status, sort, authorFilter?.id || undefined, authorFilter?.name || undefined)
        res.data.prompts = res.data.items || []
        return res
      }
      if (!user) return promptAPI.listPublic(query, sort, activeCategory, p, s, authorFilter?.id || undefined, authorFilter?.name || undefined)
      return promptAPI.list(query, null, 'community', sort, activeCategory, p, s, authorFilter?.id || undefined, authorFilter?.name || undefined)
    },
    deps,
    atomicPaging: true,
    preloadCount: 12,
    preloadTimeoutMs: 900,
  })

  const totalPages = Math.ceil(total / Math.max(1, pageSize || 20))
  const syncLiked = useCallback((card) => { if (!card?.id || card?.isLiked) return; updateCard(card.id, v => v ? { ...v, isLiked: true, likesCount: (v.likesCount || 0) + (v.isLiked ? 0 : 1) } : v) }, [updateCard])
  const handleUsePromptWithLike = useCallback(async (card) => { syncLiked(card); await handleUsePrompt(card) }, [syncLiked, handleUsePrompt])
  const handleUseImageWithLike = useCallback(async (card) => { syncLiked(card); await handleUseImage(card) }, [syncLiked, handleUseImage])

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
  const exitSelectMode = useCallback(() => { setSelectMode(false); setChecked(new Set()) }, [])
  const bottomDock = isAdmin && selectMode && checked.size > 0 ? (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>已选 {checked.size} 条</span>
        <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
          {checked.size === cards.length ? '取消全选' : '全选'}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => handleBatchFreeze(false)} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white" style={{ background: 'var(--color-info)' }}>
            <Sun size={14} /> 解冻
          </button>
          <button onClick={() => handleBatchFreeze(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white" style={{ background: 'var(--color-warning)' }}>
            <Snowflake size={14} /> 冻结
          </button>
          <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-[var(--color-error)] hover:bg-[var(--color-error)]/10">
            <Trash2 size={14} /> 删除
          </button>
        </div>
      </div>
    </div>
  ) : null

  const [newCard, setNewCard] = useState(null)
  const newCardRef = useRef(null)
  const [initialEditing, setInitialEditing] = useState(false)

  const handleCreate = useCallback(() => {
    const card = normalizePrompt({ id: '', name: '', prompt: '', category: null })
    setNewCard(card)
    newCardRef.current = card
    setInitialEditing(true)
  }, [])

  const handleImport = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const { data } = await promptAPI.importPublic(file)
      dialog.alert(`导入完成：成功 ${data.success} 条，失败 ${data.failed} 条`)
      refresh()
    } catch (err) {
      dialog.alert('导入失败: ' + (err?.response?.data?.detail || err.message || '未知错误'))
    }
    e.target.value = ''
  }, [refresh, dialog])

  const handlePromptCreate = useCallback(async (payload) => {
    const { data } = await promptAPI.createPublic(payload)
    const card = normalizePrompt(data)
    setNewCard(card)
    newCardRef.current = card
    setInitialEditing(false)
    refresh()
  }, [refresh])

  const handlePromptSave = useCallback(async (id, payload) => {
    await promptAPI.update(id, payload)
    if (newCardRef.current?.id === id) {
      const imgPath = payload.image_path
      const isEvoPath = imgPath && imgPath.includes('/')
      const imgUrl = imgPath ? (isEvoPath ? `/api/prompts/evo-thumb/${imgPath}` : `/api/prompts/image/${imgPath}`) : null
      const updated = {
        ...newCardRef.current,
        name: payload.name,
        prompt: payload.prompt,
        category: payload.category,
        categoryLabel: payload.category,
        title: payload.name,
        subtitle: payload.name || payload.prompt,
        imagePath: imgPath || null,
        thumbUrl: imgUrl ? (isEvoPath ? `${imgUrl}?size=400` : imgUrl) : null,
        thumbUrl2x: imgUrl ? (isEvoPath ? `${imgUrl}?size=800` : imgUrl) : null,
        fullUrl: imgUrl ? (isEvoPath ? `${imgUrl}?size=800` : imgUrl) : null,
      }
      setNewCard(updated)
      newCardRef.current = updated
    }
    refresh()
  }, [refresh])

  return (
    <>
      {isAdmin && (
        <>
          <div className="flex items-center gap-1 mb-3 p-0.5 rounded-2xl" style={{ background: 'var(--border-color)' }}>
            {[{ k: 'all', l: '全部' }, { k: 'active', l: '正常' }, { k: 'frozen', l: '冻结' }].map(({ k, l }) => (
              <button key={k} onClick={() => setStatus(k)}
                className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${status === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`}
                style={{ color: status === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>
            ))}
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>共 {total} 条提示词</span>
            <div className="flex items-center gap-2">
              {selectMode ? (
                <button onClick={exitSelectMode} className="px-3 py-1.5 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
              ) : (
                <>
                  <button onClick={handleCreate}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-medium text-white"
                    style={{ background: 'var(--accent)' }}>
                    <Plus size={14} /> 新增
                  </button>
                  <label className="flex items-center gap-1 px-3 py-1.5 rounded-2xl text-xs font-medium cursor-pointer hover:bg-bg-hover transition-colors" style={{ color: 'var(--text-secondary)' }}>
                    <Upload size={14} /> 导入
                    <input type="file" accept=".json,.csv" className="hidden" onChange={handleImport} />
                  </label>
                  <button onClick={() => setSelectMode(true)} className="px-3 py-1.5 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>选择</button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      <CardGrid
        cards={cards}
        layoutMode={layoutMode}
        showTotal={!isAdmin}
        loading={loading}
        paging={paging}
        refreshing={refreshing}
        onRefresh={refresh}
        hideRefresh
        total={total}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        onCardClick={(_, idx) => setDetailIdx(idx)}
        onLike={handleLike}
        onFavorite={handleFavorite}
        onUsePrompt={handleUsePromptWithLike}
        onUseImage={handleUseImageWithLike}
        onAuthorClick={onAuthorFilter}
        paginationScrollTargetId="square-scroll-container"
        scrollAfterPaging
        cardUiMode="square"
        showAuthor
        emptyText="暂无提示词"
        selectable={isAdmin && selectMode}
        selected={checked}
        onToggleSelect={isAdmin ? toggleCheck : undefined}
        onSelectionChange={isAdmin ? setChecked : undefined}
        renderOverlay={isAdmin ? (card) => (
          <>
            {card.isFrozen && (
              <div className="absolute bottom-2 left-2 z-10 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/90 text-white">
                <Snowflake size={10} className="inline mr-0.5" />冻结
              </div>
            )}
            {!selectMode ? (
              <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1">
                <button onClick={(e) => { e.stopPropagation(); handleTogglePromptFreeze(card.id, !card.isFrozen) }}
                  className="p-1 rounded-lg bg-black/50 text-white hover:bg-blue-500" title={card.isFrozen ? '解冻' : '冻结'}>
                  {card.isFrozen ? <Sun size={12} /> : <Snowflake size={12} />}
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDeletePrompt(card.id) }}
                  className="p-1 rounded-lg bg-black/50 text-white hover:bg-red-500" title="删除">
                  <Trash2 size={12} />
                </button>
              </div>
            ) : null}
          </>
        ) : undefined}
      />

      {(newCard || (detailIdx !== null && cards[detailIdx])) && (
        <UnifiedDetailModal
          card={newCard || cards[detailIdx]}
          cards={newCard ? [newCard] : cards}
          currentIndex={newCard ? 0 : detailIdx}
          onNavigate={newCard ? undefined : setDetailIdx}
          onClose={() => { setDetailIdx(null); setNewCard(null); newCardRef.current = null; setInitialEditing(false) }}
          onLike={handleLike}
          onFavorite={handleFavorite}
          onUsePrompt={handleUsePromptWithLike}
          onUseImage={handleUseImageWithLike}
          title="提示词详情"
          hideDownload
          allowPromptEdit={isAdmin}
          onPromptSave={handlePromptSave}
          onPromptCreate={handlePromptCreate}
          initialEditing={initialEditing && !!newCard}
        />
      )}
      {bottomDock}
    </>
  )
}

function SharedTab({ refreshTrigger, layoutMode, pageSize }) {
  const [subTab, setSubTab] = useState('all')
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useImageActions()
  const dialog = useAppDialog()
  const normalizeMixedItems = useCallback(items => (items || []).map(raw => {
    const base = raw?._mix_type === 'prompt' ? normalizePrompt(raw) : normalizeImage(raw)
    return { ...base, _isMyShare: !!raw?.is_my_share, _mixCreatedAt: raw?.mix_created_at || raw?.favorite_created_at || raw?.created_at || '', _raw: { ...base._raw, is_my_share: !!raw?.is_my_share, mix_created_at: raw?.mix_created_at || raw?.favorite_created_at || raw?.created_at || '' } }
  }), [])

  const deps = useMemo(() => [subTab, refreshTrigger], [subTab, refreshTrigger])
  const { cards, total, page, setPage, loading, paging, refreshing, refresh, handleLike, handleFavorite, updateCard } = useCardData({
    type: subTab === 'prompt' ? 'prompt' : 'image',
    pageSize,
    apiFn: async (p, s) => {
      if (subTab === 'my-shares') {
        const { data } = await squareAPI.my(p, s)
        return { data: { images: normalizeList(data.images || [], 'image').map(x => ({ ...x, _isMyShare: true, _mixCreatedAt: x.createdAt || '', _raw: { ...x._raw, is_my_share: true, mix_created_at: x.createdAt || '' } })), total: data.total || 0 } }
      }
      if (subTab === 'prompt') {
        const { data } = await favoriteAPI.list('prompt', p, s)
        return { data: { images: normalizeList(data.prompts || [], 'prompt'), total: data.total || 0 } }
      }
      if (subTab === 'image') {
        const { data } = await favoriteAPI.list('image', p, s)
        return { data: { images: normalizeList(data.images || [], 'image'), total: data.total || 0 } }
      }
      const { data } = await squareAPI.shared(p, s)
      return { data: { images: normalizeMixedItems(data.images || []), total: data.total || 0 } }
    },
    deps,
    atomicPaging: true,
    preloadCount: 12,
    preloadTimeoutMs: 900,
    mapCards: items => items,
    removeOnUnfavorite: subTab === 'all' ? card => !card._isMyShare : subTab !== 'my-shares',
  })
  const totalPages = Math.ceil(total / Math.max(1, pageSize || 20))
  const syncLiked = useCallback((card) => { if (!card?.id || card?.isLiked) return; updateCard(card.id, v => v ? { ...v, isLiked: true, likesCount: (v.likesCount || 0) + (v.isLiked ? 0 : 1) } : v) }, [updateCard])
  const handleUsePromptWithLike = useCallback(async (card) => { syncLiked(card); await handleUsePrompt(card) }, [syncLiked, handleUsePrompt])
  const handleUseImageWithLike = useCallback(async (card) => { syncLiked(card); await handleUseImage(card) }, [syncLiked, handleUseImage])

  const handleUnshare = useCallback(async (card) => {
    if (!await dialog.confirm('确定撤回该分享？撤回后图片将恢复3天有效期。')) return
    try {
      await squareAPI.unshare(card._raw.id)
      setDetailIdx(null)
      refresh()
    } catch (e) {
      dialog.alert(e?.response?.data?.detail || e.message || '撤回失败')
    }
  }, [refresh, dialog])

  return (
    <>
      <div className="flex items-center gap-1 mb-3 p-0.5 rounded-2xl max-w-sm" style={{ background: 'var(--bg-active)' }}>
        {[{ k: 'all', l: '全部' }, { k: 'my-shares', l: '分享', i: Share2 }, { k: 'image', l: '图片', i: Image }, { k: 'prompt', l: '提示词', i: BookOpen }].map(({ k, l, i: Icon }) => (
          <button key={k} onClick={() => { setSubTab(k); setDetailIdx(null) }} className={`flex-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center justify-center gap-1 ${subTab === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`} style={{ color: subTab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{Icon ? <Icon size={12} /> : null}{l}</button>
        ))}
      </div>
      <CardGrid
        cards={cards}
        layoutMode={subTab === 'prompt' ? 'grid' : layoutMode}
        showTotal
        totalUnit={subTab === 'prompt' ? '条' : '项'}
        loading={loading}
        paging={paging}
        refreshing={refreshing}
        onRefresh={refresh}
        hideRefresh
        total={total}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        paginationScrollTargetId="square-scroll-container"
        scrollAfterPaging
        onCardClick={(_, idx) => setDetailIdx(idx)}
        onFavorite={handleFavorite}
        onUsePrompt={handleUsePromptWithLike}
        onUseImage={handleUseImageWithLike}
        showAuthor
        showLike={false}
        cardUiMode="square"
        emptyText="暂无内容"
      />
      {detailIdx !== null && cards[detailIdx] && (
        <UnifiedDetailModal card={cards[detailIdx]} cards={cards} currentIndex={detailIdx} onNavigate={setDetailIdx} onClose={() => setDetailIdx(null)}
          onFavorite={subTab === 'my-shares' ? undefined : async (id) => { const targetId = cards[detailIdx]?.id; setDetailIdx(null); const ok = await handleFavorite(id); if (!ok && targetId) { const idx = cards.findIndex(c => c.id === targetId); if (idx >= 0) setDetailIdx(idx) } }}
          onUnshare={cards[detailIdx]?._isMyShare ? handleUnshare : undefined}
          onUsePrompt={handleUsePromptWithLike} onUseImage={handleUseImageWithLike}
          title={subTab === 'my-shares' ? '我的作品' : '收藏详情'} hideDownload />
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

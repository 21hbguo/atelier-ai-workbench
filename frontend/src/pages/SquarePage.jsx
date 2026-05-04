import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Image, BookOpen, Share2, Trash2, Snowflake, Sun, RefreshCw, Star, X, Plus } from 'lucide-react'
import { squareAPI, promptAPI, adminAPI, favoriteAPI } from '../api'
import MainLayout from '../components/MainLayout'
import SearchInput from '../components/SearchInput'
import CardGrid from '../components/CardGrid'
import UnifiedDetailModal from '../components/UnifiedDetailModal'
import CategoryFilter from '../components/CategoryFilter'
import { useCardData } from '../hooks/useCardData'
import { useLayoutMode } from '../LayoutModeContext'
import { normalizeList } from '../utils/cardAdapter'
import { readUser } from '../auth'
import { useAppDialog } from '../components/AppDialogProvider'

function useImageActions() {
  const navigate = useNavigate()

  const handleUsePrompt = (prompt) => {
    const text = String(prompt || '').trim()
    if (!text) return
    localStorage.setItem('pending_prompt', text)
    window.dispatchEvent(new Event('pending-prompt-updated'))
    navigate('/')
    setTimeout(() => { if (window.location.pathname === '/square') window.location.href = '/' }, 120)
  }

  const handleUseImage = (card) => {
    const url = card.thumbUrl2x || card.fullUrl
    if (!url) { alert('图片地址不存在'); return }
    const stored = JSON.parse(localStorage.getItem('ref_images') || '[]')
    if (!stored.some(i => i.url === url)) { stored.push({ url, name: card.filename || card.title || 'image' }); localStorage.setItem('ref_images', JSON.stringify(stored)) }
    window.dispatchEvent(new Event('pending-image-updated'))
    navigate('/')
  }

  return { handleUsePrompt, handleUseImage }
}

function usePromptActions() {
  const navigate = useNavigate()

  const handleUsePrompt = (prompt) => {
    const text = String(prompt || '').trim()
    if (!text) return
    localStorage.setItem('pending_prompt', text)
    window.dispatchEvent(new Event('pending-prompt-updated'))
    navigate('/')
    setTimeout(() => { if (window.location.pathname === '/square') window.location.href = '/' }, 120)
  }

  const handleUseImage = (card) => {
    const url = card.thumbUrl2x || card.fullUrl
    if (!url) { alert('图片地址不存在'); return }
    const stored = JSON.parse(localStorage.getItem('ref_images') || '[]')
    if (!stored.some(i => i.url === url)) { stored.push({ url, name: (card.name || 'prompt') + '.jpg' }); localStorage.setItem('ref_images', JSON.stringify(stored)) }
    window.dispatchEvent(new Event('pending-image-updated'))
    navigate('/')
  }

  return { handleUsePrompt, handleUseImage }
}

export default function SquarePage() {
  const dialog = useAppDialog()
  const { layoutMode, setLayoutMode } = useLayoutMode()
  const location = useLocation()
  const [tab, setTab] = useState(() => location.state?.tab === 'favorites' ? 'favorites' : 'prompts')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('likes')
  const [activeCategory, setActiveCategory] = useState(null)
  const [authorFilter, setAuthorFilter] = useState(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const isAdmin = Boolean(readUser()?.is_admin)
  useEffect(() => { setLayoutMode('masonry') }, [setLayoutMode])

  const handleTabChange = (newTab) => {
    setTab(newTab)
    setQuery('')
    setSort('likes')
    setActiveCategory(null)
    setAuthorFilter(null)
  }

  const handleRefresh = () => setRefreshTrigger(n => n + 1)
  const handleAuthorFilter = useCallback((card) => {
    if (!card?.author) return
    setAuthorFilter({ id: card.authorId || null, name: card.authorName || card.author })
  }, [])

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="square-top-block sm:pt-4">
          <div className="square-tab-strip scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {[{ k: 'prompts', l: '提示词库', i: BookOpen }, { k: 'works', l: '用户作品库', i: Image }, { k: 'my', l: '我的分享', i: Share2 }, { k: 'favorites', l: '收藏', i: Star }].map(({ k, l, i: Icon }) => (
            <button key={k} onClick={() => handleTabChange(k)} className={`square-tab-btn ${tab === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`}
              style={{ color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
              <Icon size={14} className="block shrink-0" /><span className="leading-none translate-y-[0.5px]">{l}</span>
            </button>
          ))}
          </div>
        </div>
        <div className="square-subtop-block sm:pt-3">
          <div className="square-section-row">
            {tab !== 'my' && tab !== 'favorites' && (
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => setSort('likes')} className={`square-filter-btn ${sort === 'likes' ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
                  style={{ color: sort === 'likes' ? 'var(--accent)' : 'var(--text-secondary)' }}>最热</button>
                <button onClick={() => setSort('time')} className={`square-filter-btn ${sort === 'time' ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
                  style={{ color: sort === 'time' ? 'var(--accent)' : 'var(--text-secondary)' }}>最新</button>
              </div>
            )}
            {tab !== 'my' && tab !== 'favorites' && (
              <div className="square-search-wrap"><SearchInput value={query} onChange={setQuery} placeholder={tab === 'works' ? '搜索提示词/作者...' : '搜索提示词...'} /></div>
            )}
            <button onClick={handleRefresh} className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-bg-hover transition-colors flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
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
          {tab === 'prompts' && (
            <div className="mt-2">
              <PromptsCategoryFilter active={activeCategory} onChange={setActiveCategory} />
            </div>
          )}
        </div>
        <div id="square-scroll-container" className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6">
          {tab === 'works' ? (
            <WorksTab query={query} sort={sort} authorFilter={authorFilter} onAuthorFilter={handleAuthorFilter} isAdmin={isAdmin} dialog={dialog} refreshTrigger={refreshTrigger} layoutMode={layoutMode} />
          ) : tab === 'prompts' ? (
            <PromptsTab query={query} sort={sort} activeCategory={activeCategory} authorFilter={authorFilter} onAuthorFilter={handleAuthorFilter} isAdmin={isAdmin} dialog={dialog} refreshTrigger={refreshTrigger} layoutMode={layoutMode} />
          ) : tab === 'my' ? (
            <MySharesTab refreshTrigger={refreshTrigger} layoutMode={layoutMode} />
          ) : (
            <FavoritesTab layoutMode={layoutMode} />
          )}
        </div>
      </div>
    </MainLayout>
  )
}

function WorksTab({ query, sort, authorFilter, onAuthorFilter, isAdmin, dialog, refreshTrigger, layoutMode }) {
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useImageActions()
  const [status, setStatus] = useState('all')
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())

  const deps = useMemo(() => isAdmin ? [query, sort, status, refreshTrigger, authorFilter?.id || '', authorFilter?.name || ''] : [query, sort, refreshTrigger, authorFilter?.id || '', authorFilter?.name || ''], [query, sort, status, isAdmin, refreshTrigger, authorFilter])

  useEffect(() => { setDetailIdx(null) }, [query, sort, status])

  const { cards, total, page, setPage, loading, paging, refreshing, refresh, handleLike, handleFavorite } = useCardData({
    type: 'image',
    apiFn: (p, s) => isAdmin
      ? adminAPI.square(p, s, query || undefined, status, sort, authorFilter?.id || undefined)
      : squareAPI.list(p, s, query || undefined, sort, authorFilter?.id || undefined),
    deps,
    atomicPaging: true,
    preloadCount: 12,
    preloadTimeoutMs: 900,
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
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${status === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`}
                style={{ color: status === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>
            ))}
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>共 {total} 张图片</span>
            <div className="flex items-center gap-2">
              {selectMode && (
                <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
                  {checked.size === cards.length ? '取消全选' : '全选'}
                </button>
              )}
              {selectMode && checked.size > 0 && (
                <>
                  <button onClick={() => handleBatchFreeze(false)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-info)] text-white hover:opacity-90">
                    <Sun size={14} /> 解冻 {checked.size} 项
                  </button>
                  <button onClick={() => handleBatchFreeze(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-warning)] text-white hover:opacity-90">
                    <Snowflake size={14} /> 冻结 {checked.size} 项
                  </button>
                  <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-error)] text-white hover:opacity-90">
                    <Trash2 size={14} /> 删除 {checked.size} 项
                  </button>
                </>
              )}
              {selectMode ? (
                <button onClick={() => { setSelectMode(false); setChecked(new Set()) }} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
              ) : (
                <button onClick={() => setSelectMode(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>选择</button>
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
        onUsePrompt={handleUsePrompt}
        onUseImage={handleUseImage}
        onAuthorClick={onAuthorFilter}
        paginationScrollTargetId="square-scroll-container"
        scrollAfterPaging
        showAuthor
        selectable={isAdmin && selectMode}
        selected={checked}
        onToggleSelect={isAdmin ? toggleCheck : undefined}
        renderOverlay={isAdmin ? (card) => (
          <>
            {card.isFrozen && (
              <div className="absolute bottom-2 left-2 z-10 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/90 text-white">
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
          onFavorite={handleFavorite}
          onUsePrompt={handleUsePrompt}
          onUseImage={handleUseImage}
          title={`${cards[detailIdx].author} 的作品`}
          hideDownload
        />
      )}
    </>
  )
}

function MySharesTab({ refreshTrigger, layoutMode }) {
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useImageActions()
  const dialog = useAppDialog()

  const { cards, total, page, setPage, loading, paging, refreshing, refresh, handleLike, handleFavorite } = useCardData({
    type: 'image',
    apiFn: (p, s) => squareAPI.my(p, s),
    deps: [refreshTrigger],
    atomicPaging: true,
    preloadCount: 12,
    preloadTimeoutMs: 900,
  })

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

  const totalPages = Math.ceil(total / 20)

  return (
    <>
      <CardGrid
        cards={cards}
        layoutMode={layoutMode}
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
        onUsePrompt={handleUsePrompt}
        onUseImage={handleUseImage}
        paginationScrollTargetId="square-scroll-container"
        scrollAfterPaging
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
          onFavorite={handleFavorite}
          onUsePrompt={handleUsePrompt}
          onUseImage={handleUseImage}
          onUnshare={handleUnshare}
          title="我的作品"
          hideDownload
        />
      )}
    </>
  )
}

function PromptsTab({ query, sort, activeCategory, authorFilter, onAuthorFilter, isAdmin, dialog, refreshTrigger, layoutMode }) {
  const user = readUser()
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = usePromptActions()
  const [status, setStatus] = useState('all')
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())
  const deps = useMemo(() => isAdmin ? [query, sort, activeCategory, status, refreshTrigger, authorFilter?.id || '', authorFilter?.name || ''] : [query, sort, activeCategory, refreshTrigger, authorFilter?.id || '', authorFilter?.name || ''], [query, sort, activeCategory, status, isAdmin, refreshTrigger, authorFilter])

  useEffect(() => { setDetailIdx(null) }, [activeCategory, query, sort])

  const { cards, total, page, setPage, loading, paging, refreshing, refresh, handleLike, handleFavorite } = useCardData({
    type: 'prompt',
    pageSize: 50,
    apiFn: async (p, s) => {
      if (isAdmin) {
        const res = await adminAPI.prompts(p, s, query || undefined, activeCategory || undefined, status, sort, authorFilter?.id || undefined, authorFilter?.name || undefined)
        res.data.prompts = res.data.items || []
        return res
      }
      if (!user) return promptAPI.listPublic(query, sort, activeCategory, p, 50, authorFilter?.id || undefined, authorFilter?.name || undefined)
      return promptAPI.list(query, null, 'community', sort, activeCategory, p, 50, authorFilter?.id || undefined, authorFilter?.name || undefined)
    },
    deps,
    atomicPaging: true,
    preloadCount: 12,
    preloadTimeoutMs: 900,
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

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', prompt: '', negative_prompt: '', tags: '', category: '' })
  const [categories, setCategories] = useState([])

  useEffect(() => {
    promptAPI.categories().then(({ data }) => setCategories(data.categories || [])).catch(() => {})
  }, [])

  const handleCreate = useCallback(async () => {
    if (!createForm.name || !createForm.prompt) return
    const payload = {
      name: createForm.name,
      prompt: createForm.prompt,
      negative_prompt: createForm.negative_prompt || '',
      tags: createForm.tags ? createForm.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      category: createForm.category || null,
    }
    try {
      await promptAPI.createPublic(payload)
      setShowCreateModal(false)
      setCreateForm({ name: '', prompt: '', negative_prompt: '', tags: '', category: '' })
      refresh()
    } catch (e) {
      dialog.alert(e?.response?.data?.detail || e.message || '创建失败')
    }
  }, [createForm, refresh, dialog])

  const handlePromptSave = useCallback(async (id, payload) => {
    await promptAPI.update(id, payload)
    refresh()
  }, [refresh])

  return (
    <>
      {isAdmin && (
        <>
          <div className="flex items-center gap-1 mb-3 p-0.5 rounded-lg" style={{ background: 'var(--border-color)' }}>
            {[{ k: 'all', l: '全部' }, { k: 'active', l: '正常' }, { k: 'frozen', l: '冻结' }].map(({ k, l }) => (
              <button key={k} onClick={() => setStatus(k)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${status === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`}
                style={{ color: status === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>
            ))}
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>共 {total} 条提示词</span>
            <div className="flex items-center gap-2">
              {selectMode && (
                <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
                  {checked.size === cards.length ? '取消全选' : '全选'}
                </button>
              )}
              {selectMode && checked.size > 0 && (
                <>
                  <button onClick={() => handleBatchFreeze(false)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-info)] text-white hover:opacity-90">
                    <Sun size={14} /> 解冻 {checked.size} 条
                  </button>
                  <button onClick={() => handleBatchFreeze(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-warning)] text-white hover:opacity-90">
                    <Snowflake size={14} /> 冻结 {checked.size} 条
                  </button>
                  <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-error)] text-white hover:opacity-90">
                    <Trash2 size={14} /> 删除 {checked.size} 条
                  </button>
                </>
              )}
              {selectMode ? (
                <button onClick={() => { setSelectMode(false); setChecked(new Set()) }} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
              ) : (
                <>
                  <button onClick={() => { setCreateForm({ name: '', prompt: '', negative_prompt: '', tags: '', category: '' }); setShowCreateModal(true) }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                    style={{ background: 'var(--accent)' }}>
                    <Plus size={14} /> 新增
                  </button>
                  <button onClick={() => setSelectMode(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>选择</button>
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
        onUsePrompt={handleUsePrompt}
        onUseImage={handleUseImage}
        onAuthorClick={onAuthorFilter}
        paginationScrollTargetId="square-scroll-container"
        scrollAfterPaging
        showAuthor
        emptyText="暂无提示词"
        selectable={isAdmin && selectMode}
        selected={checked}
        onToggleSelect={isAdmin ? toggleCheck : undefined}
        renderOverlay={isAdmin ? (card) => (
          <>
            {card.isFrozen && (
              <div className="absolute bottom-2 left-2 z-10 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/90 text-white">
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
          onFavorite={handleFavorite}
          onUsePrompt={handleUsePrompt}
          onUseImage={handleUseImage}
          title="提示词详情"
          hideDownload
          allowPromptEdit={isAdmin}
          onPromptSave={handlePromptSave}
        />
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCreateModal(false)}>
          <div className="rounded-2xl overflow-hidden max-w-lg w-full max-h-[85vh] flex flex-col"
            style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-lg)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <span className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>新增系统提示词</span>
              <button onClick={() => setShowCreateModal(false)} className="p-1 rounded hover:bg-bg-hover"><X size={18} style={{ color: 'var(--text-secondary)' }} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              <input value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                placeholder="标题" autoFocus
                className="px-3 py-2 rounded-lg text-sm border outline-none focus:ring-1 focus:ring-accent/50"
                style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>提示词内容</label>
                <textarea value={createForm.prompt} onChange={e => setCreateForm(f => ({ ...f, prompt: e.target.value }))}
                  placeholder="提示词内容" rows={5}
                  className="w-full text-sm p-3 rounded-lg outline-none resize-none border focus:ring-1 focus:ring-accent/50"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>反向提示词 (可选)</label>
                <textarea value={createForm.negative_prompt} onChange={e => setCreateForm(f => ({ ...f, negative_prompt: e.target.value }))}
                  placeholder="反向提示词，可选" rows={3}
                  className="w-full text-sm p-3 rounded-lg outline-none resize-none border focus:ring-1 focus:ring-accent/50"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>标签</label>
                <input value={createForm.tags} onChange={e => setCreateForm(f => ({ ...f, tags: e.target.value }))}
                  placeholder="逗号分隔"
                  className="w-full text-sm p-3 rounded-lg outline-none border focus:ring-1 focus:ring-accent/50"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>分类</label>
                <select value={createForm.category} onChange={e => setCreateForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full text-sm p-3 rounded-lg outline-none border focus:ring-1 focus:ring-accent/50"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>
                  <option value="">无分类</option>
                  {categories.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={handleCreate}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: 'var(--accent)' }}>保存</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function FavoritesTab({ layoutMode }) {
  const [subTab, setSubTab] = useState('all')
  const [detailIdx, setDetailIdx] = useState(null)
  const { handleUsePrompt, handleUseImage } = useImageActions()
  const deps = useMemo(() => [subTab], [subTab])
  const { cards, total, page, setPage, loading, paging, refreshing, refresh, handleLike, handleFavorite } = useCardData({
    type: subTab === 'prompt' ? 'prompt' : 'image',
    pageSize: 20,
    apiFn: async (p, s) => {
      const { data } = await favoriteAPI.list(subTab, p, s)
      if (subTab === 'image') return { data: { images: normalizeList(data.images || [], 'image'), total: data.total || 0 } }
      if (subTab === 'prompt') return { data: { images: normalizeList(data.prompts || [], 'prompt'), total: data.total || 0 } }
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
    removeOnUnfavorite: true,
  })
  const totalPages = Math.ceil(total / 20)
  return (
    <>
      <div className="flex items-center gap-1 mb-3 p-0.5 rounded-lg max-w-sm" style={{ background: 'var(--bg-active)' }}>
        {[{ k: 'all', l: '全部' }, { k: 'image', l: '图片', i: Image }, { k: 'prompt', l: '提示词', i: BookOpen }].map(({ k, l, i: Icon }) => (
          <button key={k} onClick={() => { setSubTab(k); setDetailIdx(null) }} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1 ${subTab === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`} style={{ color: subTab === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{Icon ? <Icon size={12} /> : null}{l}</button>
        ))}
      </div>
      <CardGrid cards={cards} layoutMode={subTab === 'image' ? layoutMode : 'grid'} showTotal totalUnit={subTab === 'prompt' ? '条' : '项'} loading={loading} paging={paging} refreshing={refreshing} onRefresh={refresh} hideRefresh total={total} page={page} totalPages={totalPages} onPageChange={setPage} paginationScrollTargetId="square-scroll-container" scrollAfterPaging onCardClick={(_, idx) => setDetailIdx(idx)} onFavorite={handleFavorite} onUsePrompt={handleUsePrompt} onUseImage={handleUseImage} showAuthor showLike={false} emptyText="暂无收藏" />
      {detailIdx !== null && cards[detailIdx] && <UnifiedDetailModal card={cards[detailIdx]} cards={cards} currentIndex={detailIdx} onNavigate={setDetailIdx} onClose={() => setDetailIdx(null)} onFavorite={async (id) => { const targetId = cards[detailIdx]?.id; setDetailIdx(null); const ok = await handleFavorite(id); if (!ok && targetId) { const idx = cards.findIndex(c => c.id === targetId); if (idx >= 0) setDetailIdx(idx) } }} onUsePrompt={handleUsePrompt} onUseImage={handleUseImage} title="收藏详情" hideDownload />}
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

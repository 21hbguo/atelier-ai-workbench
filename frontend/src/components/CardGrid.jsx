import { useState, useEffect, useRef } from 'react'
import { Heart, User, Plus, Image as ImageIcon, RefreshCw, Check, Star, ArrowUpRight } from 'lucide-react'
import Pagination from './Pagination'
import UnifiedCard from './UnifiedCard'
import { useDragSelection } from '../hooks/useDragSelection'
function trimCardText(v='',n=36){const s=String(v||'').replace(/\s+/g,' ').trim();return s.length>n?`${s.slice(0,n)}...`:s}
function getCardTag(card){return card.categoryLabel||card.category||card.metadataType==='image'?'图生图':card.metadataType==='text'?'文生图':card._type==='prompt'?'提示词':'作品'}
function getCardTitle(card){return trimCardText(card.title||card.name||card.prompt||card.subtitle||'未命名作品',18)}
function getCardMeta(card){return trimCardText(card.author||card.authorName||card.metadataSize||card.createdAt?.slice(0,10)||'',24)}

export function CardGridSkeleton({ layoutMode = 'grid', count = 10, label = '加载中...', className = '' }) {
  return <div className={className}><div className="card-feed-blank-stage" /></div>
}

export default function CardGrid({
  cards, onCardClick, onLike, onFavorite, onUsePrompt, onUseImage,
  onAuthorClick,
  showAuthor = false, selectable = false, selected = new Set(), onToggleSelect,
  onSelectionChange,
  loading = false, paging = false, refreshing = false, onRefresh, hideRefresh = false,
  total = 0, page = 1, totalPages = 1, onPageChange,
  showTotal = true, totalUnit = '张',
  emptyText = '暂无作品',
  showLike = true,
  layoutMode = 'grid',
  renderOverlay,
  paginationScrollTargetId,
  scrollAfterPaging = false,
  cardUiMode = 'default',
}) {
  const [failedUrls, setFailedUrls] = useState(new Set())
  const [layoutReady, setLayoutReady] = useState(true)
  const [gridMinHeight, setGridMinHeight] = useState(0)
  const gridRef = useRef(null)
  const { selectionRect, dragSelected, wasDraggedRef } = useDragSelection({
    enabled: selectable,
    selected,
    onSelectionChange,
    containerRef: gridRef,
  })
  const prevPagingRef = useRef(false)
  const revealTimerRef = useRef(null)
  const useMasonry = layoutMode === 'masonry'
  const mediaClassName = useMasonry ? 'card-feed-media-masonry' : 'card-feed-media'
  const layoutSignature = cards.map(c => `${c.id}:${c.thumbUrl || ''}:${c.width || ''}x${c.height || ''}`).join('|')
  const hoverWrapClass = 'absolute inset-0 hidden md:flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'
  const hoverBtnClass = 'inline-flex h-9 items-center gap-1.5 rounded-full border border-white/18 bg-white/92 px-3.5 text-xs font-semibold text-[var(--text-primary)] shadow-[0_10px_30px_rgba(0,0,0,0.16)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-white'
  const isSquareMode = cardUiMode === 'square'
  const scrollParentToTop = () => {
    if (paginationScrollTargetId) {
      const t = document.getElementById(paginationScrollTargetId)
      if (t) { t.scrollTop = 0; return }
    }
    let p = gridRef.current?.parentElement
    while (p) {
      const st = window.getComputedStyle(p)
      const oy = st.overflowY
      const scrollable = (oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight
      if (scrollable) { p.scrollTop = 0; return }
      p = p.parentElement
    }
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    setFailedUrls(prev => {
      const currentUrls = new Set(cards.map(c => c.thumbUrl).filter(Boolean))
      const next = new Set([...prev].filter(u => currentUrls.has(u)))
      return next.size === prev.size ? prev : next
    })
  }, [layoutSignature, useMasonry, cards.length])
  useEffect(() => {
    if (loading || paging || cards.length === 0) { setLayoutReady(false); return }
    const el = gridRef.current
    if (!el) return
    let observer = null
    const reveal = () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current); revealTimerRef.current = setTimeout(() => { observer?.disconnect(); setLayoutReady(true) }, 180) }
    setLayoutReady(false)
    reveal()
    observer = new ResizeObserver(() => reveal())
    observer.observe(el)
    return () => {
      observer?.disconnect()
      if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null }
    }
  }, [loading, paging, layoutSignature, cards.length, page])
  useEffect(() => {
    if (!loading && !paging && gridRef.current) {
      const h = gridRef.current.offsetHeight || 0
      if (h > 0) setGridMinHeight(h)
    }
  }, [loading, paging, cards.length, page])
  useEffect(() => {
    if (scrollAfterPaging && !prevPagingRef.current && paging) requestAnimationFrame(scrollParentToTop)
    prevPagingRef.current = paging
  }, [paging, scrollAfterPaging, page])
  if (loading && cards.length === 0) {
    return <CardGridSkeleton layoutMode={layoutMode} />
  }

  if (!loading && cards.length === 0) {
    return <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>{emptyText}</div>
  }

  return (
    <>
      {(!hideRefresh || (showTotal && total > 0)) && (
        <div className="flex items-center justify-between mb-3">
          {showTotal && total > 0 && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{total} {totalUnit}</span>}
          {!hideRefresh && onRefresh && (
            <button onClick={onRefresh} disabled={refreshing}
              className="p-1.5 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
              style={{ color: 'var(--text-secondary)' }}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
      )}

      <div ref={gridRef} className={useMasonry ? 'card-feed-masonry' : 'card-feed-grid'} style={{ position: 'relative', ...((loading || paging) && gridMinHeight > 0 ? { minHeight: `${gridMinHeight}px` } : undefined) }}>
        {!layoutReady && <div className="card-feed-loading-mask" />}
        {cards.map((card, idx) => { const ratio = card.width && card.height ? `${card.width} / ${card.height}` : '1 / 1'; const text = card.title || card.subtitle || '无提示词'; const len = text.length; const fontSize = len <= 4 ? '2rem' : len <= 8 ? '1.5rem' : len <= 16 ? '1.125rem' : '0.875rem'; const squareTag = getCardTag(card); const squareTitle = getCardTitle(card); const squareMeta = getCardMeta(card); const squareBody = trimCardText(card.prompt || card.subtitle || card.title || '', 64); const imageNode = card.thumbUrl && !failedUrls.has(card.thumbUrl) ? (useMasonry ? <img src={card.thumbUrl} srcSet={card.thumbUrl2x ? `${card.thumbUrl} 1x, ${card.thumbUrl2x} 2x` : undefined} sizes="(min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw" width={card.width || undefined} height={card.height || undefined} alt="" draggable={false} className={mediaClassName} loading={idx < 8 ? 'eager' : 'lazy'} onError={(e) => { e.target.onerror = null; setFailedUrls(prev => new Set(prev).add(card.thumbUrl)) }} /> : <div className="card-feed-media-shell" style={{ aspectRatio: ratio }}><img src={card.thumbUrl} srcSet={card.thumbUrl2x ? `${card.thumbUrl} 1x, ${card.thumbUrl2x} 2x` : undefined} sizes="(min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw" width={card.width || undefined} height={card.height || undefined} alt="" draggable={false} className={mediaClassName} loading={idx < 8 ? 'eager' : 'lazy'} onError={(e) => { e.target.onerror = null; setFailedUrls(prev => new Set(prev).add(card.thumbUrl)) }} /></div>) : <div className="w-full flex items-center justify-center p-3" style={{ aspectRatio: ratio, background: 'linear-gradient(145deg,color-mix(in srgb,var(--accent) 22%,transparent),color-mix(in srgb,var(--bg-card) 88%,#fff))' }}><p className="text-center font-bold leading-tight line-clamp-4" style={{ color: 'var(--accent)', fontSize }}>{text}</p></div>; const squareMedia = <div className="px-2.5 pt-2.5"><div className="w-full overflow-hidden rounded-[1.35rem] border border-black/6 bg-[var(--bg-ai-bubble)] shadow-[0_18px_40px_rgba(18,30,24,0.12)]"><div className="relative">{imageNode}<div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02)_26%,rgba(14,18,17,0.03)_54%,rgba(14,18,17,0.54)_100%)]" /><div className="pointer-events-none absolute inset-x-[14%] top-[8%] h-[18%] rounded-full bg-white/18 blur-2xl" /></div></div></div>; return <UnifiedCard
            key={card.id}
            data-card-id={String(card.id)}
            className={`${useMasonry ? 'card-feed-item-masonry' : ''} ${isSquareMode ? 'rounded-[1.75rem] border border-[color:color-mix(in_srgb,var(--accent)_14%,var(--border-color))] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--bg-card)_84%,#fff_16%),color-mix(in_srgb,var(--bg-primary)_92%,var(--bg-card)))] shadow-[0_18px_45px_rgba(26,39,32,0.08)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(26,39,32,0.14)]' : ''}`}
            checked={selectable && (selected.has(card.id) || dragSelected.has(String(card.id)))}
            onClick={(e) => { if (e.target.type === 'checkbox' || e.target.closest('button')) return; if (selectable) { if (wasDraggedRef.current) { wasDraggedRef.current = false; return } onToggleSelect?.(card.id); return } onCardClick?.(card, idx) }}
            mediaNode={isSquareMode ? squareMedia : (card.thumbUrl && !failedUrls.has(card.thumbUrl) ? (useMasonry ? <img src={card.thumbUrl} srcSet={card.thumbUrl2x ? `${card.thumbUrl} 1x, ${card.thumbUrl2x} 2x` : undefined} sizes="(min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw" width={card.width || undefined} height={card.height || undefined} alt="" draggable={false} className={mediaClassName} loading={idx < 8 ? 'eager' : 'lazy'} onError={(e) => { e.target.onerror = null; setFailedUrls(prev => new Set(prev).add(card.thumbUrl)) }} /> : <div className="card-feed-media-shell" style={{ aspectRatio: ratio }}><img src={card.thumbUrl} srcSet={card.thumbUrl2x ? `${card.thumbUrl} 1x, ${card.thumbUrl2x} 2x` : undefined} sizes="(min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw" width={card.width || undefined} height={card.height || undefined} alt="" draggable={false} className={mediaClassName} loading={idx < 8 ? 'eager' : 'lazy'} onError={(e) => { e.target.onerror = null; setFailedUrls(prev => new Set(prev).add(card.thumbUrl)) }} /></div>) : <div className="w-full flex items-center justify-center p-3" style={{ aspectRatio: ratio, background: 'linear-gradient(135deg, var(--accent)12, var(--accent)20)' }}><p className="text-center font-bold leading-tight line-clamp-4" style={{ color: 'var(--accent)', fontSize }}>{text}</p></div>)}
            hoverNode={isSquareMode ? null : <div className={hoverWrapClass}>{Boolean(card.prompt) && <button onClick={(e) => { e.stopPropagation(); onUsePrompt?.(card) }} className={hoverBtnClass}><Plus size={13} /> 提示词</button>}{Boolean(card.fullUrl) && <button onClick={(e) => { e.stopPropagation(); onUseImage?.(card) }} className={hoverBtnClass}><ImageIcon size={13} /> 参考图</button>}</div>}
            bottomNode={!isSquareMode && card.subtitle ? <div className="absolute bottom-0 left-0 right-0 hidden md:block px-2 py-1.5 bg-gradient-to-t from-black/72 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200"><p className="text-white text-xs truncate">{card.subtitle}</p></div> : null}
            topRightNode={!isSquareMode && ((showLike && onLike) || onFavorite) ? <div className="absolute top-2 right-2 hidden md:flex flex-col items-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">{showLike && onLike ? <div onClick={(e) => { e.stopPropagation(); onLike(card.id) }} className="flex items-center gap-1 h-7 px-2 rounded-full bg-black/50 backdrop-blur-sm cursor-pointer hover:bg-black/70 transition-colors"><Heart size={12} className={card.isLiked ? 'fill-red-500 text-red-500' : 'text-white'} />{(card.likesCount > 0 || card.isLiked) && <span className="text-white text-xs">{card.likesCount}</span>}</div> : null}{onFavorite ? <div onClick={(e) => { e.stopPropagation(); onFavorite(card.id) }} className="flex items-center justify-center w-7 h-7 rounded-full bg-black/50 backdrop-blur-sm cursor-pointer hover:bg-black/70 transition-colors"><Star size={12} className={card.isFavorited ? 'fill-yellow-400 text-yellow-400' : 'text-white'} /></div> : null}</div> : null}
            topLeftNode={showAuthor && Boolean(card.author) && !isSquareMode ? <button onClick={(e) => { e.stopPropagation(); onAuthorClick?.(card) }} className={`absolute z-10 flex items-center gap-1 h-7 px-2 rounded-full bg-black/72 backdrop-blur-sm text-white ${isSquareMode ? 'top-4 left-4' : 'top-2 left-2 hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity'} ${onAuthorClick && (card.authorId || card.authorName) ? 'cursor-pointer hover:bg-black/80 transition-colors' : 'cursor-default'}`} disabled={!onAuthorClick || (!card.authorId && !card.authorName)}><User size={12} className="text-white" /><span className="text-white text-xs truncate max-w-[56px] sm:max-w-[64px]">{card.author}</span></button> : null}
            selectNode={selectable ? <><div className={`absolute left-2 z-20 w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-colors ${(selected.has(card.id) || dragSelected.has(String(card.id))) ? 'bg-accent border-accent' : 'bg-[var(--bg-card)]/80 border-[var(--border-color)]'}`} style={{ top: isSquareMode ? '1rem' : showAuthor && card.author ? '2.5rem' : '0.5rem' }}>{(selected.has(card.id) || dragSelected.has(String(card.id))) && <Check size={12} className="text-white" />}</div>{(selected.has(card.id) || dragSelected.has(String(card.id))) && <div className="absolute inset-0 bg-accent/10 pointer-events-none z-10" />}</> : null}
            overlayNode={renderOverlay ? renderOverlay(card, idx) : null}
            footerNode={isSquareMode ? <div className="px-2.5 pb-2.5 pt-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em] uppercase" style={{ background: 'color-mix(in srgb,var(--accent) 12%,transparent)', color: 'var(--accent)' }}>{squareTag}</div><div className="mt-2 text-[1.05rem] leading-none" style={{ color: 'var(--text-primary)', fontFamily: '"Cormorant Garamond","STSong","Noto Serif SC",serif', fontWeight: 600 }}>{squareTitle}</div>{squareMeta ? <div className="mt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>{squareMeta}</div> : null}</div><div className="flex h-9 w-9 items-center justify-center rounded-full shrink-0" style={{ background: 'color-mix(in srgb,var(--accent) 12%,transparent)', color: 'var(--accent)' }}><ArrowUpRight size={15} /></div></div>{squareBody ? <p className="mt-3 text-xs leading-5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{squareBody}</p> : null}<div className="mt-3 flex items-center gap-1.5">{Boolean(card.prompt) ? <button onClick={(e) => { e.stopPropagation(); onUsePrompt?.(card) }} className="h-8 px-3 rounded-full text-[11px] font-medium border" style={{ color: 'var(--text-primary)', borderColor: 'color-mix(in srgb,var(--accent) 14%,var(--border-color))', background: 'color-mix(in srgb,var(--bg-primary) 84%,#fff 16%)' }}><span>做同款</span></button> : null}{showLike && onLike ? <button onClick={async (e) => { e.stopPropagation(); await onLike(card.id) }} className="flex items-center gap-1 px-2.5 h-8 rounded-full border" style={{ color: card.isLiked ? '#ef4444' : 'var(--text-secondary)', borderColor: 'color-mix(in srgb,var(--accent) 10%,var(--border-color))', background: 'color-mix(in srgb,var(--bg-primary) 84%,#fff 16%)' }}><Heart size={11} className={card.isLiked ? 'fill-red-500 text-red-500' : ''} /><span className="text-[11px] leading-none">{card.likesCount || 0}</span></button> : null}{onFavorite ? <button onClick={async (e) => { e.stopPropagation(); await onFavorite(card.id) }} className="flex items-center justify-center w-8 h-8 rounded-full border" style={{ color: card.isFavorited ? '#f59e0b' : 'var(--text-secondary)', borderColor: 'color-mix(in srgb,var(--accent) 10%,var(--border-color))', background: 'color-mix(in srgb,var(--bg-primary) 84%,#fff 16%)' }}><Star size={11} className={card.isFavorited ? 'fill-yellow-400 text-yellow-400' : ''} /></button> : null}</div></div> : null}
          /> })}
        {selectionRect && selectionRect.width > 5 && selectionRect.height > 5 && (
          <div className="drag-selection-rect" style={{
            position: 'fixed',
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
            height: selectionRect.height,
          }} />
        )}
      </div>

      {layoutReady && <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} scrollTargetId={paginationScrollTargetId} scrollBeforeChange={!scrollAfterPaging} />}
    </>
  )
}

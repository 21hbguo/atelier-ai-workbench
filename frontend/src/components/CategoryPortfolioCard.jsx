import { useState, useEffect } from 'react'
import { promptAPI, squareAPI } from '../api'

const GRID_LAYOUTS = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-2 grid-rows-2',
  5: 'grid-cols-3 grid-rows-2',
  6: 'grid-cols-3 grid-rows-2',
}

function useBreakpoint() {
  const [bp, setBp] = useState(() => {
    const w = window.innerWidth
    if (w < 640) return 'sm'
    if (w < 1024) return 'md'
    return 'lg'
  })

  useEffect(() => {
    const sm = window.matchMedia('(max-width: 639px)')
    const md = window.matchMedia('(min-width: 640px) and (max-width: 1023px)')
    const handler = () => {
      if (sm.matches) setBp('sm')
      else if (md.matches) setBp('md')
      else setBp('lg')
    }
    sm.addEventListener('change', handler)
    md.addEventListener('change', handler)
    return () => { sm.removeEventListener('change', handler); md.removeEventListener('change', handler) }
  }, [])

  return bp
}

const BP_PREVIEW_COUNT = { sm: 2, md: 4, lg: 6 }
const BP_GRID_COLS = { sm: 'grid-cols-1', md: 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' }

function ImagePlaceholder({ className = '' }) {
  return (
    <div className={`flex items-center justify-center bg-[var(--bg-ai-bubble)] ${className}`}>
      <svg className="w-8 h-8 text-[var(--text-secondary)] opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </div>
  )
}

export default function CategoryPortfolioCard({
  slug,
  label,
  count = 0,
  description = '',
  thumbnails = [],
  previewCount = 6,
  onClick,
  className = '',
}) {
  const thumbs = thumbnails.slice(0, previewCount)
  const n = thumbs.length
  const [failed, setFailed] = useState({})

  const gridClass = GRID_LAYOUTS[Math.min(n, 6)] || 'grid-cols-1'

  return (
    <div
      className={`group relative rounded-2xl overflow-hidden bg-[var(--bg-card)] shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer hover:-translate-y-1 ${className}`}
      onClick={() => onClick?.(slug)}
    >
      {/* Preview grid + gradient overlay */}
      <div className="relative">
        {n > 0 ? (
          <div className={`grid ${gridClass} gap-px`}>
            {thumbs.map((url, i) => (
              <div key={i} className="relative overflow-hidden bg-[var(--bg-ai-bubble)] aspect-square">
                {!failed[i] ? (
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    onError={() => setFailed(p => ({ ...p, [i]: true }))}
                  />
                ) : (
                  <ImagePlaceholder className="absolute inset-0" />
                )}
              </div>
            ))}
          </div>
        ) : (
          <ImagePlaceholder className="aspect-square" />
        )}

        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
      </div>

      {/* Info footer */}
      <div className="relative px-3 py-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold truncate mr-2" style={{ color: 'var(--text-primary)' }}>
            {label}
          </h3>
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {count} 张
          </span>
        </div>
        {description && (
          <p className="mt-1 text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
            {description}
          </p>
        )}
      </div>

      {/* Hover arrow */}
      <div
        className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  )
}

export function CategoryCollectionGrid({
  categories: propCategories,
  onCategoryClick,
  previewCount: previewCountProp,
  dataSource = 'prompt',
  className = '',
}) {
  const bp = useBreakpoint()
  const previewCount = previewCountProp ?? BP_PREVIEW_COUNT[bp]
  const gridCols = BP_GRID_COLS[bp]

  const [categories, setCategories] = useState(propCategories || [])
  const [previews, setPreviews] = useState({})
  const [loading, setLoading] = useState(!propCategories)

  useEffect(() => {
    if (propCategories) { setCategories(propCategories); return }
    promptAPI.categories().then(res => {
      setCategories(res.data?.categories || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (categories.length === 0) return
    let cancelled = false
    const MAX = 6

    const load = async () => {
      const results = {}
      await Promise.all(categories.map(async (cat) => {
        try {
          const fetches = []
          if (dataSource === 'prompt' || dataSource === 'both') {
            fetches.push(
              promptAPI.listPublic('', 'likes', cat.slug, 1, MAX)
                .then(r => (r.data?.prompts || []).map(p => {
                  if (!p.image_path) return null
                  const isEvo = p.image_path.includes('/')
                  const base = isEvo ? `/api/prompts/evo-thumb/${p.image_path}` : `/api/prompts/image/${p.image_path}`
                  return isEvo ? `${base}?size=400` : base
                }).filter(Boolean))
            )
          }
          if (dataSource === 'image' || dataSource === 'both') {
            fetches.push(
              squareAPI.list(1, MAX, '', 'likes', undefined, cat.slug)
                .then(r => (r.data?.images || []).map(img => `/api/images/thumb/${img.filename}?size=400`))
            )
          }
          const merged = (await Promise.all(fetches)).flat()
          results[cat.slug] = merged.slice(0, MAX)
        } catch {
          results[cat.slug] = []
        }
      }))
      if (!cancelled) setPreviews(results)
    }
    load()
    return () => { cancelled = true }
  }, [categories, dataSource])

  if (loading) {
    return (
      <div className={`grid ${gridCols} gap-3 ${className}`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-card)' }}>
            <div className="aspect-square animate-pulse" style={{ background: 'var(--bg-ai-bubble)' }} />
            <div className="px-3 py-2.5 space-y-2">
              <div className="h-4 w-1/2 rounded animate-pulse" style={{ background: 'var(--bg-ai-bubble)' }} />
              <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: 'var(--bg-ai-bubble)' }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={`grid ${gridCols} gap-3 ${className}`}>
      {categories.map(cat => (
        <CategoryPortfolioCard
          key={cat.slug}
          slug={cat.slug}
          label={cat.label}
          count={cat.count}
          thumbnails={previews[cat.slug] || []}
          previewCount={previewCount}
          onClick={onCategoryClick}
        />
      ))}
    </div>
  )
}

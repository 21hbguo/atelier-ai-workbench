import { useState, useEffect } from 'react'
import { Check, Plus, Image, Share2, BookOpen, Eye, EyeOff } from 'lucide-react'
import { squareAPI, shareAPI } from '../api'
import UnifiedCard from './UnifiedCard'
import { getExpiryInfo } from '../utils/expiry'
function normalizeCardText(v=''){return String(v||'').replace(/\s+/g,' ').trim()}
function isVipModel(modelId=''){return modelId==='grsai-vip'}
function getVipResolutionLabel(value=''){return value==='low'?'1K':value==='medium'?'2K':value==='high'?'4K':'1K'}
function getGenerationSizeLabel(params={}){
  if(isVipModel(params?.model_id)){
    const resolution=params?.resolution||'low';
    const ratio=params?.size||params?.aspect_ratio||params?.aspectRatio||'auto';
    const quality=params?.quality||'';
    const parts=[`比例:${ratio}`,`分辨率:${getVipResolutionLabel(resolution)}`];
    if(quality)parts.push(`画质:${quality}`);
    return parts.join(' / ')
  }
  const size=params?.size||'';
  return size?`比例:${size}`:''
}

const statusConfig = {
  queued: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', label: '排队中' },
  pending: { color: 'var(--text-secondary)', bg: 'var(--border-color)', label: '等待中' },
  processing: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', label: '生成中' },
  running: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', label: '生成中' },
  generating: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', label: '生成中' },
  completed: { color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 12%, transparent)', label: '已完成' },
  failed: { color: 'var(--color-error)', bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)', label: '失败' },
}

function getProgress(startedAt, status) {
  if (!startedAt || status === 'completed') return status === 'completed' ? 100 : 0
  if (status === 'failed') return 0
  const s = String(startedAt || '')
  const withTz = s.includes('T') ? (s.includes('+') || s.includes('Z') ? s : s + '+08:00') : s.replace(' ', 'T') + '+08:00'
  const elapsed = (Date.now() - new Date(withTz).getTime()) / 1000
  return Math.min(99 * (1 - Math.exp(-elapsed / 30)), 99)
}

export default function GenerationCard({ task, onAddImage, onAddPrompt, onAddToPromptLibrary, onRetry, selectMode, checked, onToggleCheck, wasDraggedRef, showUsername, username, onViewDetail, thumbnailBlurred = false, onToggleThumbnailBlur, masonry = false, nowTs = Date.now(), ...rest }) {
  const [progress, setProgress] = useState(() => getProgress(task.started_at, task.status))
  const [shared, setShared] = useState(false)
  const [sharing, setSharing] = useState(false)
  const isProcessing = ['processing', 'queued', 'running', 'generating'].includes(task.status)
  const mediaClassName = masonry ? 'card-feed-media-masonry' : 'card-feed-media'

  useEffect(() => {
    if (!isProcessing) return
    const timer = setInterval(() => setProgress(getProgress(task.started_at, task.status)), 1000)
    return () => clearInterval(timer)
  }, [task.started_at, task.status, isProcessing])

  useEffect(() => {
    if (task.status === 'completed') setProgress(100)
  }, [task.status])

  const cfg = statusConfig[task.status] || statusConfig.pending
  const isCompleted = task.status === 'completed' && Array.isArray(task.result_urls) && task.result_urls.length > 0
  const images = isCompleted
    ? task.result_urls.map(u => {
        const f = u.split('/').pop()
        return {
          thumb: `/api/images/thumb/${f}?size=400`,
          thumb2x: `/api/images/thumb/${f}?size=800`,
          full: `/api/images/file/${f}`,
          width: task.width || task.image_width || null,
          height: task.height || task.image_height || null,
        }
      })
    : (task.previewImages || []).map(u => ({ thumb: u, full: u }))
  const prompt = task.params?.prompt || task.prompt || ''
  const titleText = normalizeCardText(prompt || (task.status === 'failed' ? '生成失败' : '新的创作'))
  const metaText = normalizeCardText(username || '')
  const expiryInfo = getExpiryInfo({ expiresAt: task.expires_at, isPermanent: !!task.is_permanent, now: nowTs, fallbackDaysLeft: task.days_left })
  const hoverWrapClass = 'absolute inset-0 hidden md:flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'
  const hoverBtnClass = 'inline-flex h-9 items-center gap-1.5 rounded-full border border-white/18 bg-white/92 px-3.5 text-xs font-semibold text-[var(--text-primary)] shadow-[0_10px_30px_rgba(0,0,0,0.16)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-white'

  const mediaInnerNode = isCompleted && images.length > 0 ? (
    masonry ? (
      <img
        src={images[0].thumb}
        srcSet={images[0].thumb2x ? `${images[0].thumb} 1x, ${images[0].thumb2x} 2x` : undefined}
        sizes="(min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
        width={images[0].width || undefined}
        height={images[0].height || undefined}
        alt=""
        draggable={false}
        className={`${mediaClassName} ${thumbnailBlurred ? 'scale-105 blur-md' : ''}`}
      />
    ) : (
      <div className="card-feed-media-shell" style={{ aspectRatio: images[0].width && images[0].height ? `${images[0].width} / ${images[0].height}` : '1 / 1' }}>
        <img
          src={images[0].thumb}
          srcSet={images[0].thumb2x ? `${images[0].thumb} 1x, ${images[0].thumb2x} 2x` : undefined}
          sizes="(min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
          width={images[0].width || undefined}
          height={images[0].height || undefined}
          alt=""
          draggable={false}
          className={`${mediaClassName} ${thumbnailBlurred ? 'scale-105 blur-md' : ''}`}
        />
      </div>
    )
  ) : (
    <div className="w-full aspect-square flex flex-col items-center justify-center gap-3" style={{ background: cfg.bg }}>
      {isProcessing ? (
        <>
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: cfg.color, borderTopColor: 'transparent' }} />
          <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label} {Math.round(progress)}%</span>
        </>
      ) : task.status === 'failed' ? (
        <>
          <span className="text-2xl">!</span>
          <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
        </>
      ) : (
        <span className="text-xs font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
      )}
    </div>
  )

  const mediaNode = (
    <div className="px-2.5 pt-2.5">
      <div className="w-full overflow-hidden rounded-[1.35rem] border border-black/6 bg-[var(--bg-ai-bubble)] shadow-[0_18px_40px_rgba(18,30,24,0.12)]">
        <div className="relative overflow-hidden rounded-[1.35rem]">
          {mediaInnerNode}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02)_26%,rgba(14,18,17,0.03)_54%,rgba(14,18,17,0.54)_100%)]" />
          {thumbnailBlurred ? <div className="absolute inset-0 rounded-[1.35rem] bg-white/10 backdrop-blur-md" /> : null}
          <div className="pointer-events-none absolute inset-x-[14%] top-[8%] h-[18%] rounded-full bg-white/18 blur-2xl" />
        </div>
      </div>
    </div>
  )

  const handleShare = async (e) => {
    e.stopPropagation()
    if (shared || sharing) return
    setSharing(true)
    try {
      const filename = images[0].full.split('/').pop()
      await squareAPI.share({
        filename,
        prompt,
        metadata: { size: getGenerationSizeLabel(task.params||{}), type: task.params?.image_urls?.length ? 'image' : 'text' },
      })
      setShared(true)
    } catch (err) {
      if (err.message?.includes('已分享')) setShared(true)
    } finally {
      setSharing(false)
    }
  }

  const handleShareLink = async (e) => {
    e.stopPropagation()
    if (sharing) return
    setSharing(true)
    try {
      const filename = images[0].full.split('/').pop()
      const { data } = await shareAPI.create({ filename, expires_days: 7 })
      const url = `${window.location.origin}${data.url}`
      try { await navigator.clipboard.writeText(url) } catch {}
      setShared(true)
    } catch (err) {
      if (err.message?.includes('已分享')) setShared(true)
    } finally {
      setSharing(false)
    }
  }

  return (
    <UnifiedCard
      {...rest}
      className={[
        masonry ? 'card-feed-item-masonry' : '',
        'rounded-[1.75rem]',
        'border border-[color:color-mix(in_srgb,var(--accent)_14%,var(--border-color))]',
        'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--bg-card)_84%,#fff_16%),color-mix(in_srgb,var(--bg-primary)_92%,var(--bg-card)))]',
        'shadow-[0_18px_45px_rgba(26,39,32,0.08)]',
        'transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(26,39,32,0.14)]',
      ].filter(Boolean).join(' ')}
      checked={checked}
      onClick={() => {
        if (selectMode) {
          if (wasDraggedRef?.current) { wasDraggedRef.current = false; return }
          onToggleCheck?.()
          return
        }
        if (isCompleted) onViewDetail?.()
      }}
      mediaNode={mediaNode}
      hoverNode={null}
      bottomNode={task.error && !selectMode ? (
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-red-900/80 to-transparent">
          <p className="text-red-200 text-xs truncate">{task.error}</p>
        </div>
      ) : null}
      topLeftNode={null}
      topRightNode={!isCompleted && !selectMode ? (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm">
          <span className="text-white text-xs font-medium">{cfg.label}</span>
        </div>
      ) : null}
      selectNode={selectMode ? (
        <>
          <div className={`absolute top-2 left-2 z-20 w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-colors ${checked ? 'bg-accent border-accent' : 'bg-white/80 border-gray-300'}`}>
            {checked && <Check size={12} className="text-white" />}
          </div>
          {checked && <div className="absolute inset-0 bg-accent/10 pointer-events-none z-10" />}
        </>
      ) : null}
      overlayNode={isProcessing ? (
        <div className="absolute bottom-0 left-0 right-0 h-1">
          <div className="h-full transition-all duration-1000" style={{ width: `${progress}%`, background: cfg.color }} />
        </div>
      ) : null}
      footerNode={(
        <div className="px-2.5 pb-2.5 pt-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1">
              <div
                className="inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-[0.16em] uppercase"
                style={{ background: 'color-mix(in srgb,var(--accent) 12%,transparent)', color: task.status === 'failed' ? 'var(--color-error)' : task.status === 'completed' ? 'var(--accent)' : cfg.color }}
              >
                {task.status === 'failed' ? '失败' : isCompleted ? (task.params?.image_urls?.length ? '图生图' : '文生图') : cfg.label}
              </div>
              {isCompleted ? (
                <div
                  className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[10px] font-semibold"
                  style={{ background: 'color-mix(in srgb,var(--accent) 8%,transparent)', color: task.is_permanent ? '#7BC494' : expiryInfo.expired ? '#E07070' : '#D4A57A' }}
                >
                  {expiryInfo.text}
                </div>
              ) : null}
            </div>
            <div
              className="mt-2 min-w-0 truncate text-[1.05rem] leading-none"
              style={{ color: 'var(--text-primary)', fontFamily: '"Cormorant Garamond","STSong","Noto Serif SC",serif', fontWeight: 600 }}
            >
              {titleText}
            </div>
            {metaText ? <div className="mt-1 truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>{metaText}</div> : null}
          </div>
          {task.error ? <p className="mt-3 text-xs leading-5 line-clamp-2" style={{ color: 'var(--color-error)' }}>{task.error}</p> : null}
          {isCompleted ? (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              {prompt && onAddPrompt ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onAddPrompt(prompt) }}
                  className="h-8 px-3 rounded-full text-[11px] font-medium border"
                  style={{ color: 'var(--text-primary)', borderColor: 'color-mix(in srgb,var(--accent) 14%,var(--border-color))', background: 'color-mix(in srgb,var(--bg-primary) 84%,#fff 16%)' }}
                >
                  做同款
                </button>
              ) : null}
              {onAddImage ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onAddImage(images[0].full) }}
                  className="h-8 px-3 rounded-full text-[11px] font-medium border"
                  style={{ color: 'var(--text-secondary)', borderColor: 'color-mix(in srgb,var(--accent) 10%,var(--border-color))', background: 'color-mix(in srgb,var(--bg-primary) 84%,#fff 16%)' }}
                >
                  参考图
                </button>
              ) : null}
              {prompt && onAddToPromptLibrary ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onAddToPromptLibrary(task) }}
                  className="h-8 px-3 rounded-full text-[11px] font-medium border"
                  style={{ color: 'var(--text-secondary)', borderColor: 'color-mix(in srgb,var(--accent) 10%,var(--border-color))', background: 'color-mix(in srgb,var(--bg-primary) 84%,#fff 16%)' }}
                >
                  入库
                </button>
              ) : null}
              {onToggleThumbnailBlur ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleThumbnailBlur() }}
                  className="flex items-center justify-center w-8 h-8 rounded-full border"
                  style={{ color: 'var(--text-secondary)', borderColor: 'color-mix(in srgb,var(--accent) 10%,var(--border-color))', background: 'color-mix(in srgb,var(--bg-primary) 84%,#fff 16%)' }}
                >
                  {thumbnailBlurred ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    />
  )
}

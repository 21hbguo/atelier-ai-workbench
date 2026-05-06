import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Paperclip, X, Settings, Send, Maximize2, Share2, Loader2, Sparkles, Palette, Wind, Layers } from 'lucide-react'
import ParamPanel from './ParamPanel'
import QuickSelector from './QuickSelector'
import { TYPE_OPTIONS, STYLE_OPTIONS, MOOD_OPTIONS } from '../data/quickOptions'
import { promptOptimizeAPI } from '../api'
import { getCachedImages, setCachedImages, getPendingImage, clearPendingImage } from '../utils/imageDB'
const OPTIMIZE_DRAFT_KEY='chat_optimize_draft_v1'
function normalizeOptimizeResults(data,fallbackOriginal=''){const versions=Array.isArray(data?.versions)?data.versions.map(v=>typeof v==='string'?v.trim():(typeof v?.text==='string'?v.text.trim():'' )).filter(Boolean):[];return versions.length?{versions,original:typeof data?.original==='string'?data.original:fallbackOriginal}:null}
function normalizeStreamingVersions(data){return Array.isArray(data)?data.map(v=>({text:typeof v?.text==='string'?v.text:'',done:!!v?.done})).filter(v=>v.text||v.done):[]}
function normalizeMessage(value,fallback='操作失败'){if(Array.isArray(value))return value.map(v=>normalizeMessage(v,'')).filter(Boolean).join('；')||fallback;if(value&&typeof value==='object'){if(typeof value.message==='string'&&value.message.trim())return value.message;if(typeof value.detail==='string'&&value.detail.trim())return value.detail;if(typeof value.msg==='string'&&value.msg.trim())return value.msg;const parts=[value.loc?String(Array.isArray(value.loc)?value.loc.join('.') : value.loc):'',typeof value.msg==='string'?value.msg:''].filter(Boolean);return parts.join('：')||fallback}return typeof value==='string'&&value.trim()?value:fallback}
function loadOptimizeDraft(){try{const raw=localStorage.getItem(OPTIMIZE_DRAFT_KEY);if(!raw)return null;const data=JSON.parse(raw);if(!data||typeof data!=='object')return null;const optimizeResults=normalizeOptimizeResults(data.optimizeResults);const streamingVersions=normalizeStreamingVersions(data.streamingVersions);const showOptimizeOverlay=!!(data.showOptimizeOverlay&&(optimizeResults||streamingVersions.length));const showOptimizeModal=!!data.showOptimizeModal;const optimizeCount=Math.min(3,Math.max(1,Number(data.optimizeCount)||2));return{optimizeResults,streamingVersions,isStreaming:false,showOptimizeOverlay,showOptimizeModal,optimizeCount,restored:showOptimizeOverlay||showOptimizeModal}}catch{return null}}
function saveOptimizeDraft(data){try{const optimizeResults=normalizeOptimizeResults(data?.optimizeResults);const streamingVersions=normalizeStreamingVersions(data?.streamingVersions);const showOptimizeOverlay=!!data?.showOptimizeOverlay;const showOptimizeModal=!!data?.showOptimizeModal;if(!showOptimizeOverlay&&!showOptimizeModal&&!optimizeResults&&!streamingVersions.length){localStorage.removeItem(OPTIMIZE_DRAFT_KEY);return}localStorage.setItem(OPTIMIZE_DRAFT_KEY,JSON.stringify({showOptimizeOverlay,showOptimizeModal,optimizeResults,streamingVersions,optimizeCount:Math.min(3,Math.max(1,Number(data?.optimizeCount)||2)),savedAt:Date.now()}))}catch{}}
function clearOptimizeDraft(){try{localStorage.removeItem(OPTIMIZE_DRAFT_KEY)}catch{}}

function getImageExt(type, name = '') {
  const mime = String(type || '').split(';')[0].trim().toLowerCase()
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  const ext = match?.[1] || ''
  return ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'png'
}
function normalizeImageName(name, type, fallback = 'reference') {
  const raw = String(name || '').trim()
  const base = (raw.replace(/\.[^.]+$/, '') || fallback).replace(/[^\w.-]/g, '_').replace(/^\.+/, '') || fallback
  return `${base}.${getImageExt(type, raw)}`
}
const MAX_IMAGES=5
function normalizeInputFile(file,fallback=`reference-${Date.now()}`){const type=String(file?.type||'').split(';')[0].trim().toLowerCase();if(!['image/png','image/jpeg','image/webp'].includes(type))return null;if((file?.size||0)>10*1024*1024)return null;const name=normalizeImageName(file?.name||fallback,type,fallback);return file instanceof File&&file.name===name?file:new File([file],name,{type:type||'image/png'})}
function getClipboardImageFiles(event){const items=Array.from(event?.clipboardData?.items||[]);return items.filter(item=>item.kind==='file'&&String(item.type||'').startsWith('image/')).map((item,i)=>item.getAsFile&&normalizeInputFile(item.getAsFile(),`pasted-${Date.now()}-${i}`)).filter(Boolean)}

const ChatInput = forwardRef(function ChatInput({ onSubmit, loading, requestCost = 10, optimizeCost = 10 }, ref) {
  const initialOptimizeDraft=loadOptimizeDraft()
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState([])
  const [showParams, setShowParams] = useState(false)
  const [params, setParams] = useState({ size: 'auto', model_id: 'image-default', roll_count: 5, optimize_stream: false })
  const [shareToSquare, setShareToSquare] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [optimizeLoading, setOptimizeLoading] = useState(false)
  const [optimizeResults, setOptimizeResults] = useState(initialOptimizeDraft?.optimizeResults||null)
  const [showOptimizeOverlay, setShowOptimizeOverlay] = useState(initialOptimizeDraft?.showOptimizeOverlay||false)
  const [showOptimizeModal, setShowOptimizeModal] = useState(initialOptimizeDraft?.showOptimizeModal||false)
  const [optimizeCount, setOptimizeCount] = useState(initialOptimizeDraft?.optimizeCount||2)
  const [streamingVersions, setStreamingVersions] = useState(initialOptimizeDraft?.streamingVersions||[])
  const [isStreaming, setIsStreaming] = useState(initialOptimizeDraft?.isStreaming||false)
  const [toast, setToast] = useState(null)
  const [type, setType] = useState(() => localStorage.getItem('cached_type') || '')
  const [style, setStyle] = useState(() => localStorage.getItem('cached_style') || '')
  const [mood, setMood] = useState(() => localStorage.getItem('cached_mood') || '')
  const [showSelector, setShowSelector] = useState(null)
  const fileRef = useRef(null)
  const textareaRef = useRef(null)
  const paramsStatePushedRef = useRef(false)
  const paramsStateTokenRef = useRef(`chatinput_params_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  const paramsClosingByPopRef = useRef(false)
  const paramsPanelRef = useRef(null)
  const lightboxPushedRef = useRef(false)
  const lightboxClosingByPopRef = useRef(false)
  const imagesRef = useRef([])
  const pendingImageConsumedRef = useRef(false)
  const persistVersionRef = useRef(0)
  const persistImages = useCallback(async (list) => {
    try {
      const version = ++persistVersionRef.current
      const cached = await Promise.all((list || []).map(async (img, i) => {
        let blob = null
        if (img.file) blob = img.file
        else if (img.url) {
          const res = await fetch(img.url)
          blob = await res.blob()
        }
        return blob ? { blob, name: normalizeImageName(img.file?.name || img.name || `cached-${i}`, blob.type || img.file?.type || 'image/png', `cached-${i}`), type: blob.type || img.file?.type || 'image/png' } : null
      }))
      if (version !== persistVersionRef.current) return
      await setCachedImages(cached.filter(Boolean))
    } catch {}
  }, [])
  const appendImages = useCallback((items) => {
    if (!items?.length) return
    setImages(prev => {
      const remaining = MAX_IMAGES - prev.length
      if (remaining <= 0) {
        alert(`最多只能上传 ${MAX_IMAGES} 张参考图`)
        return prev
      }
      if (items.length > remaining) {
        alert(`最多只能上传 ${MAX_IMAGES} 张参考图，已自动截取前 ${remaining} 张`)
        const next = [...prev, ...items.slice(0, remaining)]
        void persistImages(next)
        return next
      }
      const next = [...prev, ...items]
      void persistImages(next)
      return next
    })
  }, [persistImages])

  const consumePending = useCallback(async () => {
    const pendingPrompt = localStorage.getItem('pending_prompt')
    const pendingImg = localStorage.getItem('pending_image')

    if (pendingPrompt) {
      localStorage.removeItem('pending_prompt')
      setPrompt(pendingPrompt)
    }

    // Legacy blob-based pending image (from IndexedDB)
    if (pendingImg || localStorage.getItem('pending_image_token')) {
      pendingImageConsumedRef.current = true
      try {
        let blob = null
        let name = `ref-${Date.now()}.png`
        let type = 'image/png'
        const pending = await getPendingImage()
        if (pending?.blob) {
          blob = pending.blob
          name = pending.name || name
          type = pending.type || pending.blob.type || type
        } else if (pendingImg) {
          const parsed = JSON.parse(pendingImg)
          if (parsed?.dataUrl) {
            const res = await fetch(parsed.dataUrl)
            blob = await res.blob()
            name = parsed.name || name
            type = blob.type || type
          }
        }
        if (blob) {
          const filename = normalizeImageName(name, type, `ref-${Date.now()}`)
          const file = new File([blob], filename, { type })
          const next = [{ file, preview: URL.createObjectURL(file), name: filename }]
          setImages(prev => {
            const merged = [...prev, ...next].slice(0, MAX_IMAGES)
            void persistImages(merged)
            return merged
          })
        }
      } catch (e) { console.error('[consumePending] error:', e) }
      localStorage.removeItem('pending_image')
      localStorage.removeItem('pending_image_token')
      await clearPendingImage().catch(() => {})
    }
  }, [persistImages])

  // 从缓存恢复提示词和参考图
  useEffect(() => {
    const cached = localStorage.getItem('cached_prompt')
    if (cached) setPrompt(cached)

    const refImages = JSON.parse(localStorage.getItem('ref_images') || '[]')
    const refUrl = localStorage.getItem('ref_image_url')
    const allRefs = refUrl ? [...refImages, { url: refUrl, name: 'reference.png' }] : refImages
    const unique = allRefs.filter((v, i, a) => a.findIndex(x => x.url === v.url) === i)
    if (unique.length > 0) {
      setImages(unique.map((r, i) => ({ url: r.url, preview: r.url, name: normalizeImageName(r.name || `reference-${i}`, '', `reference-${i}`) })))
    } else {
      ;(async () => {
        try {
          const cachedImages = await getCachedImages()
          console.log('[ChatInput mount] IndexedDB cachedImages count:', cachedImages.length)
          const items = cachedImages.map((item, i) => item?.blob ? (() => { const type = item.type || item.blob.type || 'image/png'; const name = normalizeImageName(item.name || `cached-${i}`, type, `cached-${i}`); return { file: new File([item.blob], name, { type }), preview: URL.createObjectURL(item.blob), name } })() : null).filter(Boolean)
          if (items.length > 0) setImages(items)
        } catch {}
      })()
    }
  }, [])

  // 组件卸载时释放 object URL
  useEffect(() => {
    return () => {
      for (const img of imagesRef.current) {
        if (img.file && img.preview) URL.revokeObjectURL(img.preview)
      }
    }
  }, [])

  // 提示词变化时同步到 localStorage
  useEffect(() => {
    if (prompt) localStorage.setItem('cached_prompt', prompt)
    else localStorage.removeItem('cached_prompt')
  }, [prompt])

  useEffect(() => {
    if (type) localStorage.setItem('cached_type', type)
    else localStorage.removeItem('cached_type')
  }, [type])

  useEffect(() => {
    if (style) localStorage.setItem('cached_style', style)
    else localStorage.removeItem('cached_style')
  }, [style])

  useEffect(() => {
    if (mood) localStorage.setItem('cached_mood', mood)
    else localStorage.removeItem('cached_mood')
  }, [mood])

  useEffect(() => { imagesRef.current = images }, [images])

  useEffect(() => {
    consumePending()
    window.addEventListener('pending-prompt-updated', consumePending)
    window.addEventListener('pending-image-updated', consumePending)
    return () => { window.removeEventListener('pending-prompt-updated', consumePending); window.removeEventListener('pending-image-updated', consumePending) }
  }, [consumePending])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [prompt])
  const openParams = useCallback(() => { setShowParams(true) }, [])
  const closeParams = useCallback(() => {
    if (!showParams) return
    if (paramsStatePushedRef.current && window.history.state?.__chatinput_params === paramsStateTokenRef.current && !paramsClosingByPopRef.current) {
      paramsClosingByPopRef.current = true
      window.history.back()
      return
    }
    setShowParams(false)
  }, [showParams])
  const toggleParams = useCallback(() => { if (showParams) closeParams(); else openParams() }, [showParams, closeParams, openParams])
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const resetWindowScroll = () => {
      window.scrollTo(0, 0)
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    }
    const onBlur = () => setTimeout(resetWindowScroll, 0)
    const vv = window.visualViewport
    const onViewportChange = () => {
      if (document.activeElement !== ta) setTimeout(resetWindowScroll, 0)
    }
    ta.addEventListener('blur', onBlur)
    vv?.addEventListener('resize', onViewportChange)
    return () => {
      ta.removeEventListener('blur', onBlur)
      vv?.removeEventListener('resize', onViewportChange)
    }
  }, [])
  useEffect(() => {
    if (!showParams) return
    if (!paramsStatePushedRef.current) {
      window.history.pushState({ __chatinput_params: paramsStateTokenRef.current }, '')
      paramsStatePushedRef.current = true
    }
    const onPopState = () => {
      if (!paramsStatePushedRef.current) return
      paramsStatePushedRef.current = false
      paramsClosingByPopRef.current = true
      setShowParams(false)
      setTimeout(() => { paramsClosingByPopRef.current = false }, 0)
    }
    const onKeyDown = (e) => { if (e.key === 'Escape') closeParams() }
    const onClickOutside = (e) => {
      if (paramsPanelRef.current && !paramsPanelRef.current.contains(e.target)) closeParams()
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('keydown', onKeyDown)
    setTimeout(() => document.addEventListener('mousedown', onClickOutside), 0)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [showParams, closeParams])

  useEffect(() => {
    if (!lightbox) return
    if (!lightboxPushedRef.current) {
      window.history.pushState({ __chatinput_lightbox: true }, '')
      lightboxPushedRef.current = true
    }
    const onPopState = () => {
      if (!lightboxPushedRef.current) return
      lightboxPushedRef.current = false
      lightboxClosingByPopRef.current = true
      setLightbox(null)
      setTimeout(() => { lightboxClosingByPopRef.current = false }, 0)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [lightbox])

  const closeLightbox = useCallback(() => {
    if (!lightbox) return
    if (lightboxPushedRef.current && window.history.state?.__chatinput_lightbox && !lightboxClosingByPopRef.current) {
      lightboxClosingByPopRef.current = true
      window.history.back()
      return
    }
    lightboxPushedRef.current = false
    setLightbox(null)
  }, [lightbox])
  const openFilePicker = useCallback(() => {
    const input = fileRef.current
    if (!input) return
    input.value = ''
    if (typeof input.showPicker === 'function') {
      try { input.showPicker(); return } catch {}
    }
    input.click()
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => { saveOptimizeDraft({ showOptimizeOverlay, showOptimizeModal, optimizeResults, streamingVersions, optimizeCount }) }, [showOptimizeOverlay, showOptimizeModal, optimizeResults, streamingVersions, optimizeCount])

  useEffect(() => {
    if (!initialOptimizeDraft?.restored) return
    setToast({ message: initialOptimizeDraft.showOptimizeModal ? '已恢复上次优化弹窗' : '已恢复上次优化结果', type: 'success' })
  }, [])

  const handleOptimize = useCallback(() => {
    if (!prompt.trim() || optimizeLoading) return
    setShowOptimizeModal(true)
  }, [prompt, optimizeLoading])

  const handleConfirmOptimize = useCallback(async () => {
    setShowOptimizeModal(false)
    setOptimizeLoading(true)
    const fullPrompt = `${type ? `类型为${type} ` : ''}${style ? `风格为${style} ` : ''}${mood ? `氛围为${mood} ` : ''}${prompt.trim()}`.trim()

    if (params.optimize_stream !== false) {
      setStreamingVersions([{ text: '', done: false }])
      setIsStreaming(true)
      setShowOptimizeOverlay(true)
      setOptimizeResults(null)

      let doneCalled = false
      await promptOptimizeAPI.optimizeStream(fullPrompt, optimizeCount, {
        onChunk: (data) => {
          setStreamingVersions(prev => {
            const next = [...prev]
            while (next.length <= data.version_index) next.push({ text: '', done: false })
            next[data.version_index] = { text: data.text, done: !!data.done }
            saveOptimizeDraft({showOptimizeOverlay:true,optimizeResults:null,streamingVersions:next})
            return next
          })
        },
        onDone: (data) => {
          doneCalled = true
          const nextResults=normalizeOptimizeResults({ versions: data.versions, original: fullPrompt }, fullPrompt)
          setOptimizeResults(nextResults)
          setStreamingVersions([])
          setIsStreaming(false)
          setOptimizeLoading(false)
          saveOptimizeDraft({showOptimizeOverlay:true,showOptimizeModal:false,optimizeResults:nextResults,streamingVersions:[],optimizeCount})
          if (data.points_balance != null) {
            const u = JSON.parse(localStorage.getItem('user') || 'null')
            if (u) { u.points = data.points_balance; localStorage.setItem('user', JSON.stringify(u)) }
            window.dispatchEvent(new Event('points-updated'))
          }
        },
        onError: async (detail) => {
          doneCalled = true
          setIsStreaming(false)
          setStreamingVersions([])
          try {
            const { data } = await promptOptimizeAPI.optimize(fullPrompt, optimizeCount)
            const nextResults=normalizeOptimizeResults(data, fullPrompt)
            setOptimizeResults(nextResults)
            setStreamingVersions([])
            setShowOptimizeOverlay(true)
            saveOptimizeDraft({showOptimizeOverlay:true,showOptimizeModal:false,optimizeResults:nextResults,streamingVersions:[],optimizeCount})
            if (data.points_balance != null) {
              const u = JSON.parse(localStorage.getItem('user') || 'null')
              if (u) { u.points = data.points_balance; localStorage.setItem('user', JSON.stringify(u)) }
              window.dispatchEvent(new Event('points-updated'))
            }
          } catch {
            setToast({ message: normalizeMessage(detail,'优化失败，请重试'), type: 'error' })
            setShowOptimizeOverlay(false)
          } finally {
            setOptimizeLoading(false)
          }
        },
      })
      if (!doneCalled) {
        setOptimizeLoading(false)
        setIsStreaming(false)
      }
    } else {
      try {
        const { data } = await promptOptimizeAPI.optimize(fullPrompt, optimizeCount)
        const nextResults=normalizeOptimizeResults(data, fullPrompt)
        setOptimizeResults(nextResults)
        setStreamingVersions([])
        setShowOptimizeOverlay(true)
        saveOptimizeDraft({showOptimizeOverlay:true,showOptimizeModal:false,optimizeResults:nextResults,streamingVersions:[],optimizeCount})
        if (data.points_balance != null) {
          const u = JSON.parse(localStorage.getItem('user') || 'null')
          if (u) { u.points = data.points_balance; localStorage.setItem('user', JSON.stringify(u)) }
          window.dispatchEvent(new Event('points-updated'))
        }
      } catch (e) {
        setToast({ message: normalizeMessage(e?.message,'优化失败，请重试'), type: 'error' })
      } finally {
        setOptimizeLoading(false)
      }
    }
  }, [prompt, type, style, mood, optimizeCount, params.optimize_stream])

  const handleSelectOptimized = useCallback((text) => {
    let cleaned = text
    const stripPrefix = (s, label, val) => {
      if (!val) return s
      const re = new RegExp(`^${label}为${val}[,，\\s]*`)
      return s.replace(re, '')
    }
    cleaned = stripPrefix(cleaned, '类型', type)
    cleaned = stripPrefix(cleaned, '风格', style)
    cleaned = stripPrefix(cleaned, '氛围', mood)
    setPrompt(cleaned)
    setShowOptimizeOverlay(false)
    setOptimizeResults(null)
    setStreamingVersions([])
    clearOptimizeDraft()
  }, [type, style, mood])

  const handleDismissOptimize = useCallback(() => {
    if (isStreaming) return
    setShowOptimizeOverlay(false)
    setOptimizeResults(null)
    setStreamingVersions([])
    clearOptimizeDraft()
  }, [isStreaming])
  const handleClearAll = useCallback(() => {
    for (const img of imagesRef.current) {
      if (img?.file && img.preview) URL.revokeObjectURL(img.preview)
    }
    setPrompt('')
    setImages([])
    setType('')
    setStyle('')
    setMood('')
    setShowSelector(null)
    setLightbox(null)
    setShowOptimizeModal(false)
    setShowOptimizeOverlay(false)
    setOptimizeResults(null)
    setStreamingVersions([])
    setIsStreaming(false)
    setOptimizeLoading(false)
    clearOptimizeDraft()
    localStorage.removeItem('cached_prompt')
    localStorage.removeItem('cached_type')
    localStorage.removeItem('cached_style')
    localStorage.removeItem('cached_mood')
    localStorage.removeItem('ref_images')
    localStorage.removeItem('ref_image_url')
    localStorage.removeItem('ref_image_name')
    localStorage.removeItem('pending_prompt')
    localStorage.removeItem('pending_image')
    localStorage.removeItem('pending_image_token')
    setCachedImages([]).catch(() => {})
    clearPendingImage().catch(() => {})
  }, [])

  useImperativeHandle(ref, () => ({
    addFiles(files) { handleFiles(files) },
    setPrompt(text) { setPrompt(text) },
    async addImage(url) {
      if (!url) return
      appendImages([{ url, preview: url }])
      const stored = JSON.parse(localStorage.getItem('ref_images') || '[]')
      if (!stored.some(i => i.url === url)) { stored.push({ url, name: 'reference.png' }); localStorage.setItem('ref_images', JSON.stringify(stored)) }
    }
  }))

  const handleFiles = useCallback((files) => {
    const valid = Array.from(files||[]).map((f,i)=>normalizeInputFile(f,`reference-${Date.now()}-${i}`)).filter(Boolean)
    appendImages(valid.map(f => ({ file: f, preview: URL.createObjectURL(f) })))
  }, [appendImages])
  const handlePaste = useCallback((e) => {
    const pasted=getClipboardImageFiles(e)
    if(!pasted.length)return
    e.preventDefault()
    appendImages(pasted.map(f=>({file:f,preview:URL.createObjectURL(f),name:f.name})))
    setToast({ message: `已粘贴 ${Math.min(pasted.length,Math.max(0,MAX_IMAGES-images.length))} 张参考图`, type: 'success' })
  }, [appendImages,images.length])

  const canSend = prompt.trim() || type || style || mood
  const handleSend = async (batch = false) => {
    if (!canSend || loading) return
    const fullPrompt = `${type ? `类型为${type} ` : ''}${style ? `风格为${style} ` : ''}${mood ? `氛围为${mood} ` : ''}${prompt.trim()}`.trim()
    const ok = await onSubmit({ prompt: fullPrompt, images, params, shareToSquare, rollCount: batch ? Math.min(5, Math.max(2, Number(params.roll_count) || 5)) : 1 })
    if (ok === false) return
    setPrompt('')
    setImages([])
    setType('')
    setStyle('')
    setMood('')
    localStorage.removeItem('ref_images')
    localStorage.removeItem('ref_image_url')
    localStorage.removeItem('ref_image_name')
    setCachedImages([]).catch(() => {})
  }
  const batchCount = Math.min(5, Math.max(2, Number(params.roll_count) || 5))

  const removeImage = (idx) => {
    setImages(prev => {
      const next = [...prev]; if (next[idx].file) URL.revokeObjectURL(next[idx].preview); next.splice(idx, 1)
      const refUrls = next.filter(i => i.url && !i.file).map(i => ({ url: i.url, name: i.name }))
      if (refUrls.length > 0) localStorage.setItem('ref_images', JSON.stringify(refUrls)); else localStorage.removeItem('ref_images')
      void persistImages(next); return next
    })
  }

  return (
    <>
      <div className="w-full px-4 pt-2 pb-2 relative">
        {showOptimizeOverlay && (isStreaming || optimizeResults || streamingVersions.length > 0) && (() => {
          const displayVersions = optimizeResults
            ? optimizeResults.versions.map((v, i) => ({ text: v, done: true }))
            : streamingVersions
          return (
            <div className="absolute bottom-full left-0 right-0 mb-3 z-30 pointer-events-none">
              <div className="pointer-events-auto rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-lg)' }}>
                <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center gap-1.5">
                    <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>AI 优化结果</span>
                    {(isStreaming||(!optimizeResults&&streamingVersions.some(v=>!v.done)))
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded-full animate-pulse" style={{ background: 'var(--accent)', color: '#fff', opacity: 0.85 }}>生成中</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent)', color: '#fff', opacity: 0.85 }}>{optimizeResults?.versions?.length||displayVersions.length}</span>
                    }
                  </div>
                  {!(isStreaming||(!optimizeResults&&streamingVersions.some(v=>!v.done))) && <button onClick={handleDismissOptimize} className="p-1 rounded-lg hover:bg-bg-hover transition-colors"><X size={14} style={{ color: 'var(--text-secondary)' }} /></button>}
                </div>
                <div className="p-2 space-y-1.5 max-h-56 overflow-y-auto">
                  {displayVersions.map((v, i) => (
                    <div key={i} className="group rounded-xl border p-3 transition-all hover:border-[var(--accent)]" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5" style={{ background: 'var(--accent)', color: '#fff' }}>{i + 1}</span>
                        <p className="flex-1 text-xs leading-relaxed min-w-0" style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                          {v.text}
                          {isStreaming && !v.done && <span className="inline-block w-0.5 h-3.5 ml-0.5 align-middle animate-pulse" style={{ background: 'var(--accent)' }} />}
                        </p>
                        {v.done && <button onClick={() => handleSelectOptimized(v.text)} className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" style={{ background: 'var(--accent)', color: '#fff' }}>使用</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}
        {showOptimizeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowOptimizeModal(false)}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative w-full max-w-xs rounded-2xl p-5" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>AI 优化提示词</span>
              </div>
              <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>将优化当前提示词，生成更精确的描述以获得更好的生成效果。</p>
              <div className="mb-4">
                <span className="text-xs mb-2 block" style={{ color: 'var(--text-secondary)' }}>生成条数</span>
                <div className="flex gap-2">
                  {[1, 2, 3].map(n => (
                    <button key={n} onClick={() => setOptimizeCount(n)}
                      className="flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                      style={{
                        background: optimizeCount === n ? 'var(--accent)' : 'transparent',
                        borderColor: optimizeCount === n ? 'var(--accent)' : 'var(--border-color)',
                        color: optimizeCount === n ? '#fff' : 'var(--text-secondary)',
                      }}>{n} 条</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between mb-4 px-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>消耗积分</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>{optimizeCost * optimizeCount}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowOptimizeModal(false)} className="flex-1 py-2 rounded-lg text-xs font-medium border transition-colors" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>取消</button>
                <button onClick={handleConfirmOptimize} className="flex-1 py-2 rounded-lg text-xs font-medium text-white transition-colors" style={{ background: 'var(--accent)' }}>确认优化</button>
              </div>
            </div>
          </div>
        )}
        {toast && (
          <div className="absolute bottom-full left-0 right-0 mb-1 mx-4 flex justify-center z-40 pointer-events-none">
            <div className="px-3 py-1.5 rounded-lg text-xs font-medium animate-fade-in-up" style={{ background: toast.type === 'success' ? 'var(--color-success)' : 'var(--color-error)', color: '#fff' }}>{toast.message}</div>
          </div>
        )}
        <div className="flex gap-2 mb-1.5 px-1 relative">
          {showSelector && (
            <QuickSelector
              title={showSelector === 'type' ? '选择类型' : showSelector === 'style' ? '选择风格' : '选择氛围'}
              options={showSelector === 'type' ? TYPE_OPTIONS : showSelector === 'style' ? STYLE_OPTIONS : MOOD_OPTIONS}
              selected={showSelector === 'type' ? type : showSelector === 'style' ? style : mood}
              onSelect={(val) => { showSelector === 'type' ? setType(val) : showSelector === 'style' ? setStyle(val) : setMood(val) }}
              onClose={() => setShowSelector(null)}
            />
          )}
          <button
            onClick={() => setShowSelector(showSelector === 'type' ? null : 'type')}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
            style={{
              background: type ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-card)',
              borderColor: type ? 'var(--accent)' : 'var(--border-color)',
              color: type ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <Layers size={13} />
            <span>{type || '类型'}</span>
          </button>
          <button
            onClick={() => setShowSelector(showSelector === 'style' ? null : 'style')}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
            style={{
              background: style ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-card)',
              borderColor: style ? 'var(--accent)' : 'var(--border-color)',
              color: style ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <Palette size={13} />
            <span>{style || '风格'}</span>
          </button>
          <button
            onClick={() => setShowSelector(showSelector === 'mood' ? null : 'mood')}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
            style={{
              background: mood ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-card)',
              borderColor: mood ? 'var(--accent)' : 'var(--border-color)',
              color: mood ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <Wind size={13} />
            <span>{mood || '氛围'}</span>
          </button>
          <button onClick={handleClearAll} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            <X size={13} />
            <span>清空</span>
          </button>
        </div>
        <div
          className="rounded-2xl border transition-all duration-300"
          style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-md)', position: 'relative' }}
        >
          {showParams && <div ref={paramsPanelRef} className="p-3 border-b" style={{ borderColor: 'var(--border-color)' }}><ParamPanel params={params} onChange={setParams} /></div>}
          {images.length > 0 && (
            <div className="flex gap-2 p-3 pb-0 overflow-x-auto">
              {images.map((img, i) => (
                <div key={i} className="relative w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden group cursor-pointer">
                  <img src={img.preview} alt="" className="w-full h-full object-cover" onClick={() => setLightbox(img.preview)} />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center" onClick={() => setLightbox(img.preview)}>
                    <Maximize2 size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-white" />
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); removeImage(i) }} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={10} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="px-2 pt-2 pb-2">
            {(type || style || mood) && (
              <div className="flex gap-1.5 mb-1 flex-wrap">
                {type && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>
                    {type}
                    <button onClick={() => setType('')} className="ml-0.5 hover:opacity-70"><X size={11} /></button>
                  </span>
                )}
                {style && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>
                    {style}
                    <button onClick={() => setStyle('')} className="ml-0.5 hover:opacity-70"><X size={11} /></button>
                  </span>
                )}
                {mood && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' }}>
                    {mood}
                    <button onClick={() => setMood('')} className="ml-0.5 hover:opacity-70"><X size={11} /></button>
                  </span>
                )}
              </div>
            )}
            <textarea ref={textareaRef} value={prompt} onChange={e => setPrompt(e.target.value)} onPaste={handlePaste}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(false) } }}
              placeholder="把脑洞变成画✨ 支持粘贴图片做参考图"
              className="block w-full resize-none bg-transparent outline-none py-2"
              rows={1} style={{ color: 'var(--text-primary)', minHeight: '40px', maxHeight: '120px', fontSize: '15px', paddingLeft: '10px' }} />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                <button onClick={toggleParams} title="参数设置" className="inline-flex items-center px-1.5 py-2 rounded-lg hover:bg-bg-hover transition-colors" style={{ color: showParams ? 'var(--accent)' : 'var(--text-secondary)' }}><Settings size={15} /></button>
                <button type="button" onClick={openFilePicker} title="上传参考图" className="inline-flex items-center px-1.5 py-2 rounded-lg hover:bg-bg-hover transition-colors" style={{ color: 'var(--text-secondary)' }}><Paperclip size={16} /></button>
                <button onClick={() => { const next = !shareToSquare; setShareToSquare(next); setToast({ message: next ? '已开启分享到广场，作品将长久保存' : '已关闭分享到广场', type: 'success' }) }} className="inline-flex items-center gap-1 px-1.5 py-2 rounded-lg hover:bg-bg-hover transition-colors relative" style={{ color: shareToSquare ? 'var(--color-success)' : 'var(--text-secondary)' }} title={shareToSquare ? '已开启分享到广场' : '已关闭分享到广场'}><Share2 size={15} /><span className="text-[11px]">分享</span><span className="absolute -right-0.5 -top-0.5 w-2.5 h-2.5 rounded-full" style={{ background: shareToSquare ? 'var(--color-success)' : 'var(--border-color)' }} /></button>
                <button onClick={handleOptimize} disabled={!prompt.trim() || loading || optimizeLoading} title="AI 优化提示词" className="inline-flex items-center gap-1 px-1.5 py-2 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40" style={{ color: 'var(--accent)' }}>{optimizeLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}<span className="text-[11px]">优化</span></button>
              </div>
              <div className="min-w-0 flex items-center justify-end gap-1 flex-1">
                {loading && <span className="inline-flex items-center gap-1 text-[10px] flex-shrink-0" style={{ color: 'var(--accent)' }}><Loader2 size={11} className="animate-spin" /><span>{images.length > 0 ? '上传并提交中' : '提交中'}</span></span>}
                {prompt.length > 0 && <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{prompt.length}</span>}
                <button onClick={() => handleSend(true)} disabled={!canSend || loading} title={`批量生成 ${batchCount} 张`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white disabled:opacity-40 flex-shrink-0" style={{ background: canSend && !loading ? 'var(--accent)' : 'var(--border-color)' }}>{loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}<span className="text-xs font-medium leading-none">×{batchCount}</span></button>
                <button onClick={() => handleSend(false)} disabled={!canSend || loading} title="生成 1 张" className="px-2.5 py-1.5 rounded-lg transition-all duration-150 disabled:opacity-40 flex-shrink-0" style={{ background: canSend && !loading ? 'var(--accent)' : 'var(--border-color)', color: '#fff' }}>{loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}</button>
              </div>
            </div>
          </div>
        </div>
        <div className="px-1 pt-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>AI生成结果仅供参考，请勿用于违法用途；失败将退还积分。</div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only"
          onChange={e => handleFiles(e.target.files)} />
      </div>

      {lightbox && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={closeLightbox}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
})

export default ChatInput

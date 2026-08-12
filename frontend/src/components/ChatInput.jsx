import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { Paperclip, X, Settings, Send, Maximize2, Share2, Loader2, Sparkles, Palette, Wind, Layers, AlertCircle, Check } from 'lucide-react'
import ParamPanel from './ParamPanel'
import QuickSelector from './QuickSelector'
import { TYPE_OPTIONS, STYLE_OPTIONS, MOOD_OPTIONS } from '../data/quickOptions'
import { promptOptimizeAPI, uploadAPI } from '../api'
import { getCachedImages, setCachedImages, getPendingImage, clearPendingImage } from '../utils/imageDB'
const OPTIMIZE_DRAFT_KEY='chat_optimize_draft_v1'
function normalizeOptimizeResults(data,fallbackOriginal=''){
  const versions=Array.isArray(data?.versions)
    ?data.versions.map(v=>typeof v==='string'?v.trim():(typeof v?.text==='string'?v.text.trim():'')).filter(Boolean)
    :[];
  return versions.length?{versions,original:typeof data?.original==='string'?data.original:fallbackOriginal}:null
}
function normalizeStreamingVersions(data){
  return Array.isArray(data)?data.map(v=>({text:typeof v?.text==='string'?v.text:'',done:!!v?.done})).filter(v=>v.text||v.done):[]
}
function normalizeMessage(value,fallback='操作失败'){
  if(Array.isArray(value))return value.map(v=>normalizeMessage(v,'')).filter(Boolean).join('；')||fallback;
  if(value&&typeof value==='object'){
    if(typeof value.message==='string'&&value.message.trim())return value.message;
    if(typeof value.detail==='string'&&value.detail.trim())return value.detail;
    if(typeof value.msg==='string'&&value.msg.trim())return value.msg;
    const parts=[
      value.loc?String(Array.isArray(value.loc)?value.loc.join('.'):value.loc):'',
      typeof value.msg==='string'?value.msg:''
    ].filter(Boolean);
    return parts.join('：')||fallback
  }
  return typeof value==='string'&&value.trim()?value:fallback
}
function loadOptimizeDraft(){
  try{
    const raw=localStorage.getItem(OPTIMIZE_DRAFT_KEY);
    if(!raw)return null;
    const data=JSON.parse(raw);
    if(!data||typeof data!=='object')return null;
    const optimizeResults=normalizeOptimizeResults(data.optimizeResults);
    const streamingVersions=normalizeStreamingVersions(data.streamingVersions);
    const showOptimizeOverlay=!!(data.showOptimizeOverlay&&(optimizeResults||streamingVersions.length));
    const showOptimizeModal=!!data.showOptimizeModal;
    const optimizeCount=Math.min(3,Math.max(1,Number(data.optimizeCount)||2));
    const optimizeMode=data.optimizeMode==='refine'?'refine':'simple';
    return{
      optimizeResults,
      streamingVersions,
      isStreaming:false,
      showOptimizeOverlay,
      showOptimizeModal,
      optimizeCount,
      optimizeMode,
      restored:showOptimizeOverlay||showOptimizeModal
    }
  }catch{return null}
}
function saveOptimizeDraft(data){
  try{
    const optimizeResults=normalizeOptimizeResults(data?.optimizeResults);
    const streamingVersions=normalizeStreamingVersions(data?.streamingVersions);
    const showOptimizeOverlay=!!data?.showOptimizeOverlay;
    const showOptimizeModal=!!data?.showOptimizeModal;
    if(!showOptimizeOverlay&&!showOptimizeModal&&!optimizeResults&&!streamingVersions.length){
      localStorage.removeItem(OPTIMIZE_DRAFT_KEY);return
    }
    localStorage.setItem(OPTIMIZE_DRAFT_KEY,JSON.stringify({
      showOptimizeOverlay,
      showOptimizeModal,
      optimizeResults,
      streamingVersions,
      optimizeCount:Math.min(3,Math.max(1,Number(data?.optimizeCount)||2)),
      optimizeMode:data?.optimizeMode==='refine'?'refine':'simple',
      savedAt:Date.now()
    }))
  }catch{return}
}
function clearOptimizeDraft(){try{localStorage.removeItem(OPTIMIZE_DRAFT_KEY)}catch{return}}
function formatOptimizeText(text, format) {
  if (format === 'json') {
    try {
      const parsed = JSON.parse(text)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return JSON.stringify({ prompt: text }, null, 2)
    }
  }
  return text
}

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
function isVipModel(modelId=''){return modelId==='grsai-vip'}
function getVipResolutionLabel(value=''){return value==='low'?'1K':value==='medium'?'2K':value==='high'?'4K':'1K'}
function getVipResolutionCost(params={},fallback=10){
  const costs=params?._resolution_costs||params?.resolution_costs||{};
  const key=params?.resolution||'auto';
  const value=costs[key]??costs.auto??params?._points_cost;
  const num=Number(value);
  return num>0?num:fallback
}
function getModelRequestCost(params={},fallback=10){
  return isVipModel(params?.model_id)?getVipResolutionCost(params,fallback):(Number(params?._points_cost)>0?Number(params._points_cost):fallback)
}
function normalizeGenerationParams(params={}){
  const next={...(params||{})};
  if(isVipModel(next.model_id)){
    next.size=next.size||'auto';
    next.resolution=next.resolution||'low';
    next.aspectRatio=next.size&&next.size!=='auto'?next.size:''
  }
  return next
}
function createImageId(){
  if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
  return`ref-${Date.now()}-${Math.random().toString(36).slice(2,10)}`
}
function createInputImageItem(input={},fallback=`reference-${Date.now()}`){
  const file=input?.file||null;
  const type=input?.type||file?.type||'image/png';
  const name=normalizeImageName(input?.name||file?.name||fallback,type,fallback);
  const uploadedUrl=String(input?.uploadedUrl||'').trim();
  const uploadedStorageName=String(input?.uploadedStorageName||'').trim();
  const uploadStatus=input?.uploadStatus||(uploadedUrl&&(uploadedStorageName||uploadedUrl)?'success':'pending');
  const uploadPhase=input?.uploadPhase||(uploadStatus==='success'?'done':'uploading');
  return{
    id:input?.id||createImageId(),
    name,
    type,
    preview:input?.preview||input?.url||'',
    url:input?.url||'',
    file,
    uploadStatus,
    uploadPhase,
    uploadProgress:uploadStatus==='success'?100:Math.max(0,Math.min(100,Number(input?.uploadProgress)||0)),
    uploadedUrl,
    uploadedStorageName:uploadedStorageName||uploadedUrl,
    uploadError:String(input?.uploadError||'')
  }
}
function snapshotInputImages(list=[]){
  return list.map((img,i)=>({
    id:img?.id||`reference-${i}`,
    name:img?.name||img?.file?.name||`reference-${i}`,
    type:img?.type||img?.file?.type||'image/png',
    preview:img?.preview||img?.url||'',
    url:img?.url||'',
    file:img?.file||null,
    uploadStatus:img?.uploadStatus||'pending',
    uploadPhase:img?.uploadPhase||(img?.uploadStatus==='success'?'done':'uploading'),
    uploadProgress:Number(img?.uploadProgress)||0,
    uploadedUrl:img?.uploadedUrl||'',
    uploadedStorageName:img?.uploadedStorageName||'',
    uploadError:img?.uploadError||''
  }))
}
function normalizeInputFile(file,fallback=`reference-${Date.now()}`){
  const type=String(file?.type||'').split(';')[0].trim().toLowerCase();
  if(!['image/png','image/jpeg','image/webp'].includes(type))return null;
  if((file?.size||0)>20*1024*1024)return null;
  const name=normalizeImageName(file?.name||fallback,type,fallback);
  return file instanceof File&&file.name===name?file:new File([file],name,{type:type||'image/png'})
}
function clampUploadingProgress(value){
  return Math.max(0,Math.min(95,Number(value)||0))
}
function getClipboardImageFiles(event){
  const items=Array.from(event?.clipboardData?.items||[]);
  return items
    .filter(item=>item.kind==='file'&&String(item.type||'').startsWith('image/'))
    .map((item,i)=>item.getAsFile&&normalizeInputFile(item.getAsFile(),`pasted-${Date.now()}-${i}`))
    .filter(Boolean)
}
function getFileRejectReason(file){
  const type=String(file?.type||'').split(';')[0].trim().toLowerCase();
  const name=String(file?.name||'').toLowerCase();
  if(type==='application/pdf'||name.endsWith('.pdf'))return'参考图不支持 PDF';
  if(!['image/png','image/jpeg','image/webp'].includes(type))return'参考图仅支持 PNG/JPG/WebP';
  if((file?.size||0)>20*1024*1024)return'参考图不能超过 20MB';
  return''
}
function getClipboardText(event){return String(event?.clipboardData?.getData?.('text/plain')||'').trim()}
function inferImageUrlName(url,type='image/png'){
  const clean=String(url||'').split('#')[0].split('?')[0];
  const last=decodeURIComponent(clean.split('/').pop()||'').trim();
  return normalizeImageName(last||`reference-${Date.now()}`,type,`reference-${Date.now()}`)
}
async function resolveClipboardImageUrl(text){
  if(!/^https?:\/\//i.test(text))return null;
  try{
    const res=await fetch(text,{method:'HEAD'}).catch(()=>fetch(text));
    if(!res?.ok)return{error:'图片链接不可访问'};
    const type=String(res.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(!['image/png','image/jpeg','image/webp'].includes(type))return{error:'仅支持 PNG/JPG/WebP 图片链接'};
    const size=Number(res.headers.get('content-length')||0);
    if(size>20*1024*1024)return{error:'参考图不能超过 20MB'};
    return{url:text,name:inferImageUrlName(text,type)}
  }catch{return{error:'图片链接读取失败'}}
}

const ChatInput = forwardRef(function ChatInput({ onSubmit, loading, requestCost = 10, optimizeCost = 10, refineOptimizeCost = 20 }, ref) {
  const initialOptimizeDraft=loadOptimizeDraft()
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState([])
  const [showParams, setShowParams] = useState(false)
  const [params, setParams] = useState({ size: 'auto', resolution: 'low', aspectRatio: '', model_id: 'gpt-image-2', roll_count: 5, optimize_stream: false })
  const [shareToSquare, setShareToSquare] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [optimizeLoading, setOptimizeLoading] = useState(false)
  const [optimizeResults, setOptimizeResults] = useState(initialOptimizeDraft?.optimizeResults||null)
  const [showOptimizeOverlay, setShowOptimizeOverlay] = useState(initialOptimizeDraft?.showOptimizeOverlay||false)
  const [showOptimizeModal, setShowOptimizeModal] = useState(initialOptimizeDraft?.showOptimizeModal||false)
  const [optimizeCount, setOptimizeCount] = useState(initialOptimizeDraft?.optimizeCount||2)
  const [optimizeMode, setOptimizeMode] = useState(initialOptimizeDraft?.optimizeMode||'simple')
  const [optimizeFormat, setOptimizeFormat] = useState('json')
  const [streamingVersions, setStreamingVersions] = useState(initialOptimizeDraft?.streamingVersions||[])
  const [isStreaming, setIsStreaming] = useState(initialOptimizeDraft?.isStreaming||false)
  const [toast, setToast] = useState(null)
  const [type, setType] = useState(() => localStorage.getItem('cached_type') || '')
  const [style, setStyle] = useState(() => localStorage.getItem('cached_style') || '')
  const [mood, setMood] = useState(() => localStorage.getItem('cached_mood') || '')
  const [showSelector, setShowSelector] = useState(null)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [selectedBatchCount, setSelectedBatchCount] = useState(1)
  const [requestSubmitting, setRequestSubmitting] = useState(false)
  const modelRequestCost=getModelRequestCost(params,requestCost)
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
  const uploadAbortRef = useRef(new Map())
  const uploadStartedRef = useRef(new Set())
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
    } catch { return }
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
        const next = [...prev, ...items.slice(0, remaining).map((item,i)=>createInputImageItem(item,`reference-${Date.now()}-${i}`))]
        void persistImages(next)
        return next
      }
      const next = [...prev, ...items.map((item,i)=>createInputImageItem(item,`reference-${Date.now()}-${i}`))]
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
          const next = [createInputImageItem({ file, preview: URL.createObjectURL(file), name: filename }, filename)]
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
      setImages(unique.map((r, i) => createInputImageItem({
        url: r.url,
        preview: r.url,
        name: normalizeImageName(r.name || `reference-${i}`, '', `reference-${i}`),
        uploadStatus: 'success',
        uploadProgress: 100,
        uploadedUrl: r.url,
        uploadedStorageName: r.storage_name || r.url,
      }, `reference-${i}`)))
    } else {
      ;(async () => {
        try {
          const cachedImages = await getCachedImages()
          console.log('[ChatInput mount] IndexedDB cachedImages count:', cachedImages.length)
          const items = cachedImages.map((item, i) => item?.blob ? (() => {
            const type = item.type || item.blob.type || 'image/png'
            const name = normalizeImageName(item.name || `cached-${i}`, type, `cached-${i}`)
            return createInputImageItem({
              file: new File([item.blob], name, { type }),
              preview: URL.createObjectURL(item.blob),
              name,
            }, `cached-${i}`)
          })() : null).filter(Boolean)
          if (items.length > 0) setImages(items)
        } catch { return }
      })()
    }
  }, [])

  // 组件卸载时释放 object URL
  useEffect(() => {
    return () => {
      for (const controller of uploadAbortRef.current.values()) controller.abort()
      uploadAbortRef.current.clear()
      uploadStartedRef.current.clear()
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
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 80) + 'px'
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
      try { input.showPicker(); return } catch { input.click(); return }
    }
    input.click()
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    saveOptimizeDraft({
      showOptimizeOverlay,
      showOptimizeModal,
      optimizeResults,
      streamingVersions,
      optimizeCount,
      optimizeMode,
    })
  }, [showOptimizeOverlay, showOptimizeModal, optimizeResults, streamingVersions, optimizeCount, optimizeMode])

  useEffect(() => {
    if (!initialOptimizeDraft?.restored) return
    setToast({ message: initialOptimizeDraft.showOptimizeModal ? '已恢复上次优化弹窗' : '已恢复上次优化结果', type: 'success' })
  }, [])

  const handleOptimize = useCallback(() => {
    if (!prompt.trim() || optimizeLoading) return
    setShowOptimizeModal(true)
  }, [prompt, optimizeLoading])
  useEffect(() => { if (optimizeMode === 'refine' && optimizeCount !== 1) setOptimizeCount(1) }, [optimizeMode, optimizeCount])

  const handleConfirmOptimize = useCallback(async () => {
    setShowOptimizeModal(false)
    setOptimizeLoading(true)
    const fullPrompt = `${type ? `类型为${type} ` : ''}${style ? `风格为${style} ` : ''}${mood ? `氛围为${mood} ` : ''}${prompt.trim()}`.trim()
    const finalOptimizeCount = optimizeMode === 'refine' ? 1 : optimizeCount

    if (params.optimize_stream !== false) {
      setStreamingVersions([{ text: '', done: false }])
      setIsStreaming(true)
      setShowOptimizeOverlay(true)
      setOptimizeResults(null)

      let doneCalled = false
      await promptOptimizeAPI.optimizeStream(fullPrompt, finalOptimizeCount, {
        format: optimizeFormat,
        mode: optimizeMode,
        onChunk: (data) => {
          setStreamingVersions(prev => {
            const next = [...prev]
            while (next.length <= data.version_index) next.push({ text: '', done: false })
            next[data.version_index] = { text: data.text, done: !!data.done }
            saveOptimizeDraft({showOptimizeOverlay:true,optimizeResults:null,streamingVersions:next,optimizeMode})
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
          saveOptimizeDraft({showOptimizeOverlay:true,showOptimizeModal:false,optimizeResults:nextResults,streamingVersions:[],optimizeCount:finalOptimizeCount,optimizeMode})
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
            const { data } = await promptOptimizeAPI.optimize(fullPrompt, finalOptimizeCount, optimizeFormat, optimizeMode)
            const nextResults=normalizeOptimizeResults(data, fullPrompt)
            setOptimizeResults(nextResults)
            setStreamingVersions([])
            setShowOptimizeOverlay(true)
            saveOptimizeDraft({showOptimizeOverlay:true,showOptimizeModal:false,optimizeResults:nextResults,streamingVersions:[],optimizeCount:finalOptimizeCount,optimizeMode})
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
        const { data } = await promptOptimizeAPI.optimize(fullPrompt, finalOptimizeCount, optimizeFormat, optimizeMode)
        const nextResults=normalizeOptimizeResults(data, fullPrompt)
        setOptimizeResults(nextResults)
        setStreamingVersions([])
        setShowOptimizeOverlay(true)
        saveOptimizeDraft({showOptimizeOverlay:true,showOptimizeModal:false,optimizeResults:nextResults,streamingVersions:[],optimizeCount:finalOptimizeCount,optimizeMode})
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
  }, [prompt, type, style, mood, optimizeCount, optimizeFormat, optimizeMode, params.optimize_stream])

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
  const persistRemoteImages = useCallback((list) => {
    const refs=(list||[]).filter(img=>img?.uploadedUrl&&img?.uploadStatus==='success').map(img=>({
      url:img.uploadedUrl,
      name:img.name,
      storage_name:img.uploadedStorageName||img.uploadedUrl
    }))
    if(refs.length>0)localStorage.setItem('ref_images',JSON.stringify(refs));
    else localStorage.removeItem('ref_images')
  }, [])
  const updateImageItem = useCallback((id,updater,syncRemote=false) => {
    setImages(prev => {
      let changed=false
      const next=prev.map(img=>{
        if(img.id!==id)return img
        changed=true
        return typeof updater==='function'?updater(img):{...img,...updater}
      })
      if(!changed)return prev
      if(syncRemote)persistRemoteImages(next)
      return next
    })
  }, [persistRemoteImages])
  const startImageUpload = useCallback(async (item) => {
    if(!item?.id||uploadStartedRef.current.has(item.id))return
    uploadStartedRef.current.add(item.id)
    const controller=new AbortController()
    uploadAbortRef.current.set(item.id,controller)
    updateImageItem(item.id,img=>({
      ...(img||item),
      uploadStatus:'uploading',
      uploadPhase:'uploading',
      uploadProgress:0,
      uploadError:'',
      uploadedUrl:'',
      uploadedStorageName:''
    }))
    try{
      let uploadFile=item.file
      if(!uploadFile&&item.url){
        const res=await fetch(item.url,item.url.startsWith('/')?{credentials:'include',signal:controller.signal}:{signal:controller.signal})
        if(!res.ok)throw new Error(`图片读取失败(${res.status})`)
        const blob=await res.blob()
        const type=blob.type||item.type||'image/png'
        uploadFile=new File([blob],normalizeImageName(item.name||`reference-${Date.now()}`,type,`reference-${Date.now()}`),{type})
      }
      if(!uploadFile)throw new Error('图片文件不存在')
      const {data}=await uploadAPI.upload(uploadFile,{
        signal:controller.signal,
        onProgress:(percent)=>updateImageItem(item.id,img=>img&&img.uploadStatus!=='success'?{
          ...img,
          uploadStatus:'uploading',
          uploadPhase:Number(percent)>=100?'processing':'uploading',
          uploadProgress:clampUploadingProgress(percent),
          uploadError:''
        }:img)
      })
      if(controller.signal.aborted)return
      updateImageItem(item.id,img=>img?{
        ...img,
        url:data?.url||img.url,
        uploadStatus:'success',
        uploadPhase:'done',
        uploadProgress:100,
        uploadedUrl:data?.url||'',
        uploadedStorageName:data?.storage_name||data?.url||'',
        uploadError:''
      }:img,true)
    }catch(e){
      if(controller.signal.aborted)return
      updateImageItem(item.id,img=>img?{
        ...img,
        uploadStatus:'error',
        uploadPhase:'uploading',
        uploadProgress:0,
        uploadedUrl:'',
        uploadedStorageName:'',
        uploadError:normalizeMessage(e?.message||e,'上传失败，请删除后重新添加')
      }:img)
    }finally{
      uploadAbortRef.current.delete(item.id)
      uploadStartedRef.current.delete(item.id)
    }
  }, [updateImageItem])
  useEffect(() => {
    for (const img of images) {
      if ((img?.file || img?.url) && (img.uploadStatus === 'pending' || img.uploadStatus === 'uploading') && !uploadStartedRef.current.has(img.id)) void startImageUpload(img)
    }
  }, [images, startImageUpload])
  const hasUploadingImages=images.some(img=>img.uploadStatus==='uploading'||img.uploadStatus==='pending')
  const hasErrorImages=images.some(img=>img.uploadStatus==='error')
  const sendDisabledReason=hasUploadingImages?'参考图上传中，请稍候再提交':hasErrorImages?'存在上传失败的参考图，请删除后重新添加':''
  useEffect(() => { void persistImages(images); persistRemoteImages(images) }, [images, persistImages, persistRemoteImages])
  const handleClearAll = useCallback(() => {
    for (const controller of uploadAbortRef.current.values()) controller.abort()
    uploadAbortRef.current.clear()
    uploadStartedRef.current.clear()
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
      appendImages([{ url, preview: url, name: 'reference.png' }])
    }
  }))

  const handleFiles = useCallback((files) => {
    const list=Array.from(files||[])
    const rejected=list.map(getFileRejectReason).filter(Boolean)
    if(rejected.length)setToast({ message: rejected[0], type: 'error' })
    const valid = list.map((f,i)=>normalizeInputFile(f,`reference-${Date.now()}-${i}`)).filter(Boolean)
    appendImages(valid.map(f => ({ file: f, preview: URL.createObjectURL(f) })))
  }, [appendImages])
  const handlePaste = useCallback(async (e) => {
    const pasted=getClipboardImageFiles(e)
    if(pasted.length){
      e.preventDefault();
      appendImages(pasted.map(f=>({file:f,preview:URL.createObjectURL(f),name:f.name})));
      setToast({ message: `已粘贴 ${Math.min(pasted.length,Math.max(0,MAX_IMAGES-images.length))} 张参考图`, type: 'success' });
      return
    }
    const text=getClipboardText(e)
    if(!text)return
    const resolved=await resolveClipboardImageUrl(text)
    if(!resolved)return
    e.preventDefault()
    if(resolved.error){setToast({ message: resolved.error, type: 'error' });return}
    appendImages([{url:resolved.url,preview:resolved.url,name:resolved.name}])
    setToast({ message: '已添加图片链接作为参考图', type: 'success' })
  }, [appendImages,images.length])

  const canSend = prompt.trim() || type || style || mood
  const clearComposer = useCallback(() => {
    for (const controller of uploadAbortRef.current.values()) controller.abort()
    uploadAbortRef.current.clear()
    uploadStartedRef.current.clear()
    for (const img of imagesRef.current) {
      if (img?.file && img.preview) URL.revokeObjectURL(img.preview)
    }
    setPrompt('')
    setImages([])
    setType('')
    setStyle('')
    setMood('')
    localStorage.removeItem('cached_prompt')
    localStorage.removeItem('cached_type')
    localStorage.removeItem('cached_style')
    localStorage.removeItem('cached_mood')
    localStorage.removeItem('ref_images')
    localStorage.removeItem('ref_image_url')
    localStorage.removeItem('ref_image_name')
    setCachedImages([]).catch(() => {})
  }, [])
  const handleSend = async (batchCount = 1) => {
    if (!canSend || loading || requestSubmitting) return
    if (hasUploadingImages) { setToast({ message: '参考图上传中，请稍候再提交', type: 'error' }); return }
    if (hasErrorImages) { setToast({ message: '存在上传失败的参考图，请删除后重新添加', type: 'error' }); return }
    const fullPrompt = `${type ? `类型为${type} ` : ''}${style ? `风格为${style} ` : ''}${mood ? `氛围为${mood} ` : ''}${prompt.trim()}`.trim()
    const inputImages = snapshotInputImages(images.filter(img=>img.uploadStatus==='success'))
    setRequestSubmitting(true)
    try {
      const ok = await onSubmit({ prompt: fullPrompt, images: inputImages, params: normalizeGenerationParams(params), shareToSquare, rollCount: batchCount, clearInput: clearComposer })
      if (ok === false) return
      if (ok !== 'cleared') clearComposer()
    } finally {
      setRequestSubmitting(false)
    }
  }

  const removeImage = (idx) => {
    setImages(prev => {
      const next = [...prev]
      const target=next[idx]
      if(!target)return prev
      uploadAbortRef.current.get(target.id)?.abort()
      uploadAbortRef.current.delete(target.id)
      uploadStartedRef.current.delete(target.id)
      if (target.file && target.preview) URL.revokeObjectURL(target.preview)
      next.splice(idx, 1)
      persistRemoteImages(next)
      void persistImages(next); return next
    })
  }

  return (
    <>
      <div className="w-full px-4 pt-2 pb-2 relative">
        {showOptimizeOverlay && (isStreaming || optimizeResults || streamingVersions.length > 0) && (() => {
          const displayVersions = optimizeResults
            ? optimizeResults.versions.map(v => ({ text: v, done: true }))
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
                  {displayVersions.map((v, i) => {
                    const displayText = v.done && optimizeFormat === 'json' ? formatOptimizeText(v.text, 'json') : v.text
                    return (
                    <div key={i} className="group rounded-2xl border p-3 transition-all hover:border-[var(--accent)]" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5" style={{ background: 'var(--accent)', color: '#fff' }}>{i + 1}</span>
                        <p className="flex-1 text-xs leading-relaxed min-w-0 whitespace-pre-wrap" style={{ color: 'var(--text-primary)', wordBreak: 'break-word', fontFamily: optimizeFormat === 'json' ? 'monospace' : undefined }}>
                          {displayText}
                          {isStreaming && !v.done && <span className="inline-block w-0.5 h-3.5 ml-0.5 align-middle animate-pulse" style={{ background: 'var(--accent)' }} />}
                        </p>
                        {v.done && <button onClick={() => handleSelectOptimized(v.text)} className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" style={{ background: 'var(--accent)', color: '#fff' }}>使用</button>}
                      </div>
                    </div>
                    )
                  })}
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
                <span className="text-xs mb-2 block" style={{ color: 'var(--text-secondary)' }}>优化模式</span>
                <div className="grid grid-cols-2 gap-2">
                  {[{ key: 'simple', label: '简单优化', desc: '快速润色' }, { key: 'refine', label: '精细优化', desc: '基于示例优化' }].map(m => (
                    <button key={m.key} onClick={() => setOptimizeMode(m.key)} className="px-3 py-2 rounded-2xl text-left border transition-colors" style={{ background: optimizeMode === m.key ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent', borderColor: optimizeMode === m.key ? 'var(--accent)' : 'var(--border-color)', color: 'var(--text-primary)' }}>
                      <div className="text-xs font-medium">{m.label}</div>
                      <div className="text-[10px]" style={{ color: optimizeMode === m.key ? 'var(--accent)' : 'var(--text-secondary)' }}>{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <span className="text-xs mb-2 block" style={{ color: 'var(--text-secondary)' }}>生成条数</span>
                {optimizeMode === 'refine' ? (
                  <div className="px-3 py-2 rounded-2xl border text-xs" style={{ borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>精细优化固定生成 1 条</div>
                ) : (
                  <div className="flex gap-2">
                    {[1, 2, 3].map(n => (
                      <button key={n} onClick={() => setOptimizeCount(n)}
                        className="flex-1 py-1.5 rounded-2xl text-xs font-medium border transition-colors"
                        style={{
                          background: optimizeCount === n ? 'var(--accent)' : 'transparent',
                          borderColor: optimizeCount === n ? 'var(--accent)' : 'var(--border-color)',
                          color: optimizeCount === n ? '#fff' : 'var(--text-secondary)',
                        }}>{n} 条</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mb-4">
                <span className="text-xs mb-2 block" style={{ color: 'var(--text-secondary)' }}>输出格式</span>
                <div className="flex gap-2">
                  {[{ key: 'text', label: '文本' }, { key: 'json', label: 'JSON' }].map(f => (
                    <button key={f.key} onClick={() => setOptimizeFormat(f.key)}
                      className="flex-1 py-1.5 rounded-2xl text-xs font-medium border transition-colors"
                      style={{
                        background: optimizeFormat === f.key ? 'var(--accent)' : 'transparent',
                        borderColor: optimizeFormat === f.key ? 'var(--accent)' : 'var(--border-color)',
                        color: optimizeFormat === f.key ? '#fff' : 'var(--text-secondary)',
                      }}>{f.label}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between mb-4 px-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>消耗积分</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>{(optimizeMode === 'refine' ? refineOptimizeCost : optimizeCost) * (optimizeMode === 'refine' ? 1 : optimizeCount)}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowOptimizeModal(false)} disabled={requestSubmitting} className="flex-1 py-2 rounded-2xl text-xs font-medium border transition-colors disabled:opacity-40" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>取消</button>
                <button onClick={handleConfirmOptimize} disabled={requestSubmitting} className="flex-1 py-2 rounded-2xl text-xs font-medium text-white transition-colors disabled:opacity-40" style={{ background: 'var(--accent)' }}>{requestSubmitting?'请求中...':'确认优化'}</button>
              </div>
            </div>
          </div>
        )}
        {showBatchModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowBatchModal(false)}>
            <div className="absolute inset-0 bg-black/50" />
            <div className="relative w-full max-w-xs rounded-2xl p-5" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <Send size={16} style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>批量生成</span>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>选择生成张数，每张消耗 {modelRequestCost} 积分。</p>
              <div className="mb-3 p-2.5 rounded-xl" style={{ background: 'var(--bg-ai-bubble)' }}>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  <span style={{ color: 'var(--text-secondary)' }}>模型: <span style={{ color: 'var(--text-primary)' }}>{params._model_label || params.model_id}</span></span>
                  <span style={{ color: 'var(--text-secondary)' }}>比例: <span style={{ color: 'var(--text-primary)' }}>{params.size || 'auto'}</span></span>
                  {isVipModel(params.model_id)?<span style={{ color: 'var(--text-secondary)' }}>分辨率: <span style={{ color: 'var(--text-primary)' }}>{getVipResolutionLabel(params.resolution||'low')}</span></span>:null}
                  {params.quality?<span style={{ color: 'var(--text-secondary)' }}>{isVipModel(params.model_id)?'画质':'质量'}: <span style={{ color: 'var(--text-primary)' }}>{params.quality}</span></span>:null}
                  {type && <span style={{ color: 'var(--text-secondary)' }}>类型: <span style={{ color: 'var(--accent)' }}>{type}</span></span>}
                  {style && <span style={{ color: 'var(--text-secondary)' }}>风格: <span style={{ color: 'var(--accent)' }}>{style}</span></span>}
                  {mood && <span style={{ color: 'var(--text-secondary)' }}>氛围: <span style={{ color: 'var(--accent)' }}>{mood}</span></span>}
                </div>
              </div>
              <div className="mb-4">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={n} onClick={() => setSelectedBatchCount(n)}
                      className="flex-1 py-1.5 rounded-2xl text-xs font-medium border transition-colors"
                      style={{
                        background: selectedBatchCount === n ? 'var(--accent)' : 'transparent',
                        borderColor: selectedBatchCount === n ? 'var(--accent)' : 'var(--border-color)',
                        color: selectedBatchCount === n ? '#fff' : 'var(--text-secondary)',
                      }}>{n}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between mb-4 px-1">
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>消耗积分</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>{modelRequestCost * selectedBatchCount}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowBatchModal(false)} disabled={requestSubmitting} className="flex-1 py-2 rounded-2xl text-xs font-medium border transition-colors disabled:opacity-40" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>取消</button>
                <button onClick={() => { setShowBatchModal(false); handleSend(selectedBatchCount) }} disabled={requestSubmitting} className="flex-1 py-2 rounded-2xl text-xs font-medium text-white transition-colors disabled:opacity-40" style={{ background: 'var(--accent)' }}>{requestSubmitting?'正在提交...':'确认生成'}</button>
              </div>
            </div>
          </div>
        )}
        {requestSubmitting && (
          <div className="absolute bottom-full left-0 right-0 mb-2 mx-4 flex justify-center z-40 pointer-events-none">
            <div className="px-4 py-2 rounded-2xl text-xs font-medium flex items-center gap-2 animate-fade-in-up" style={{ background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow-md)' }}>
              <Loader2 size={14} className="animate-spin" />
              <span>正在提交请求，请稍候...</span>
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
                <div
                  key={img.id||i}
                  className="relative w-14 h-14 flex-shrink-0 rounded-lg overflow-hidden group cursor-pointer border"
                  style={{
                    borderColor: img.uploadStatus==='error'
                      ?'var(--color-error)'
                      :img.uploadStatus==='success'
                        ?'color-mix(in srgb,var(--color-success) 45%,var(--border-color))'
                        :'color-mix(in srgb,var(--accent) 28%,var(--border-color))'
                  }}
                >
                  <img src={img.preview} alt="" className="w-full h-full object-cover" onClick={() => setLightbox(img.preview)} />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center" onClick={() => setLightbox(img.preview)}>
                    <Maximize2 size={14} className={`transition-opacity text-white ${img.uploadStatus==='uploading'||img.uploadStatus==='error'?'opacity-0':'opacity-0 group-hover:opacity-100'}`} />
                  </div>
                  {img.uploadStatus==='uploading'&&(
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="relative flex items-center justify-center w-9 h-9 rounded-full bg-black/45 text-white">
                        {img.uploadPhase==='processing'?(
                          <>
                            <Loader2 size={15} className="animate-spin-slow" />
                            <span className="absolute -bottom-3 text-[8px] font-semibold whitespace-nowrap">处理中</span>
                          </>
                        ):(
                          <>
                            <svg className="-rotate-90" width="30" height="30" viewBox="0 0 36 36">
                              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="3"/>
                              <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                                strokeDasharray={`${Math.max(0,Math.min(100,Number(img.uploadProgress)||0))*0.94} 100`}/>
                            </svg>
                            <span className="absolute text-[9px] font-semibold">{Math.max(0,Math.min(100,Math.round(Number(img.uploadProgress)||0)))}%</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {img.uploadStatus==='error'&&(
                    <div className="absolute inset-0 bg-[rgba(181,52,52,.58)] flex flex-col items-center justify-center gap-0.5 px-1 text-white">
                      <AlertCircle size={14} />
                      <span className="text-[8px] leading-none text-center">上传失败</span>
                    </div>
                  )}
                  {img.uploadStatus==='success'&&(
                    <div className="absolute left-1 bottom-1 w-4 h-4 rounded-full flex items-center justify-center text-white" style={{background:'var(--color-success)'}}>
                      <Check size={10} />
                    </div>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); removeImage(i) }} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={10} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="px-2 pt-2 pb-2">
            {(type || style || mood) && (
              <div className="flex gap-1.5 mb-2 flex-wrap">
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
              placeholder="和 AI 助手聊聊，支持多模型对话与多模态创作 ✨"
              className="block w-full resize-none bg-transparent outline-none py-2"
              rows={1} style={{ color: 'var(--text-primary)', minHeight: '40px', maxHeight: '80px', fontSize: '15px', paddingLeft: '10px' }} />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center flex-shrink-0 whitespace-nowrap gap-0.5">
                <button onClick={toggleParams} title="参数设置" className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg hover:bg-bg-hover transition-colors" style={{ color: showParams ? 'var(--accent)' : 'var(--text-secondary)' }}><Settings size={14} /><span className="text-[11px] leading-none">设置</span></button>
                <button type="button" onClick={openFilePicker} title="上传参考图" className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg hover:bg-bg-hover transition-colors" style={{ color: 'var(--text-secondary)' }}><Paperclip size={15} /><span className="text-[11px] leading-none">上传</span></button>
                <button
                  onClick={() => {
                    const next = !shareToSquare
                    setShareToSquare(next)
                    setToast({ message: next ? '已开启分享到广场，作品将长久保存' : '已关闭分享到广场', type: 'success' })
                  }}
                  className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg hover:bg-bg-hover transition-colors relative"
                  style={{ color: shareToSquare ? 'var(--color-success)' : 'var(--text-secondary)' }}
                  title={shareToSquare ? '已开启分享到广场' : '已关闭分享到广场'}
                >
                  <Share2 size={13} />
                  <span className="text-[11px] leading-none">分享</span>
                  <span className="absolute -right-0.5 -top-0.5 w-2.5 h-2.5 rounded-full" style={{ background: shareToSquare ? 'var(--color-success)' : 'var(--border-color)' }} />
                </button>
                <button
                  onClick={handleOptimize}
                  disabled={!prompt.trim() || loading || requestSubmitting || optimizeLoading}
                  title="AI 优化提示词"
                  className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-40"
                  style={{ color: 'var(--accent)' }}
                >
                  {optimizeLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  <span className="text-[11px] leading-none">AI优化</span>
                </button>
              </div>
              <div className="min-w-0 flex items-center justify-end gap-1 flex-1">
                {prompt.length > 0 && <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{prompt.length}</span>}
                {!hasUploadingImages&&sendDisabledReason&&!requestSubmitting&&<span className="text-[10px] flex-shrink-0 font-medium" style={{ color: hasErrorImages ? 'var(--color-error)' : 'var(--accent)' }}>{sendDisabledReason}</span>}
                <button
                  onClick={() => {
                    if(sendDisabledReason){setToast({ message: sendDisabledReason, type: 'error' });return}
                    setShowBatchModal(true)
                  }}
                  disabled={!canSend || loading || requestSubmitting || !!sendDisabledReason}
                  title="生成"
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-2xl text-white disabled:opacity-40 flex-shrink-0"
                  style={{
                    background: canSend && !loading && !requestSubmitting && !sendDisabledReason
                      ? 'var(--accent)'
                      : 'var(--border-color)'
                  }}
                >
                  {loading || requestSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
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

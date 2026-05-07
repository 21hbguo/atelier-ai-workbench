import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useDragSelection } from '../hooks/useDragSelection'
import { useNavigate } from 'react-router-dom'
import { Download, Trash2, RefreshCw, Coins, ChevronDown } from 'lucide-react'
import ChatInput from '../components/ChatInput'
import { CardGridSkeleton } from '../components/CardGrid'
import GenerationCard from '../components/GenerationCard'
import PortfolioShowcaseCard from '../components/PortfolioShowcaseCard'
import SearchInput from '../components/SearchInput'
import MainLayout from '../components/MainLayout'
import UnifiedDetailModal from '../components/UnifiedDetailModal'
import { useAppDialog } from '../components/AppDialogProvider'
import { useLayoutMode } from '../LayoutModeContext'
import { generateAPI, uploadAPI, taskAPI, imageAPI, squareAPI, adminAPI, pointsAPI, configAPI, promptAPI } from '../api'
import { readUser } from '../auth'
import { getSubmissionQueue, setSubmissionQueue } from '../utils/imageDB'

function formatLocalTime(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }).catch(e => { clearTimeout(timer); reject(e) })
  })
}
function makeTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') { const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = Array.from(b, v => v.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` }
  return `task-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}
function getExpiryByFilename(map, filename) { return (filename && map && map[filename]) ? map[filename] : {} }
function parseTaskTime(value) {
  const s = String(value || '')
  // 数据库存储的是北京时间（无时区后缀），添加 +08:00 确保正确解析
  const withTz = s.includes('T') ? (s.includes('+') || s.includes('Z') ? s : s + '+08:00') : s.replace(' ', 'T') + '+08:00'
  const ts = Date.parse(withTz)
  return Number.isNaN(ts) ? 0 : ts
}
function getUploadExt(type, name = '') {
  const mime = String(type || '').split(';')[0].trim().toLowerCase()
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  const ext = match?.[1] || ''
  return ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'png'
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || `download_${Date.now()}`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url) }, 1500)
}
async function saveBlob(blob, filename) {
  if (window.isSecureContext && typeof window.showSaveFilePicker === 'function') {
    try {
      const ext = filename.includes('.') ? `.${filename.split('.').pop().toLowerCase()}` : ''
      const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Download', accept: { [blob.type || 'application/octet-stream']: ext ? [ext] : ['.bin'] } }] })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch (e) {
      if (e?.name === 'AbortError') return false
      throw e
    }
  }
  downloadBlob(blob, filename)
  return true
}
function getDownloadFilename(headers, fallback) {
  const raw = headers?.['content-disposition'] || headers?.['Content-Disposition'] || ''
  const utf8 = raw.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (utf8) return decodeURIComponent(utf8)
  const plain = raw.match(/filename="?([^"]+)"?/i)?.[1]
  return plain || fallback
}
function normalizeUploadName(name, type, url = '') {
  const raw = String(name || '').trim() || decodeURIComponent(String(url || '').split('?')[0].split('/').pop() || '')
  const base = (raw.replace(/\.[^.]+$/, '') || 'reference').replace(/[^\w.-]/g, '_').replace(/^\.+/, '') || 'reference'
  return `${base}.${getUploadExt(type, raw)}`
}
function formatSubmitSettings(params, shareToSquare, imageCount) {
  const modelLabel = params?._model_label || params?.model_id || '默认模型'
  const lines = [`模型：${modelLabel}`]
  if (params?.size) lines.push(`尺寸：${params.size}`)
  const extra = Object.entries(params || {}).filter(([key, value]) => !['size', 'model_id', '_model_label', '_points_cost', 'roll_count', 'optimize_stream'].includes(key) && value !== undefined && value !== null && value !== '')
  for (const [key, value] of extra) lines.push(`${key}：${value}`)
  lines.push(`参考图：${imageCount || 0} 张`)
  lines.push(`分享：${shareToSquare ? '开启' : '关闭'}`)
  return lines.join('\n')
}
function makePromptLibraryName(prompt=''){const clean=String(prompt||'').replace(/\s+/g,' ').trim();return(clean.slice(0,20)||'未命名提示词')+(clean.length>20?'...':'')}
function getThumbnailBlurStorageKey(user){const id=user?.id??user?.user_id??user?.username??'guest';return`chat_thumbnail_blur_${id}`}
function getThumbnailBlurMap(user){try{return JSON.parse(localStorage.getItem(getThumbnailBlurStorageKey(user))||'{}')}catch{return {}}}
function getThumbnailBlurItemKey(task){return String(task?.result_urls?.[0]?.split('/').pop()||task?.task_id||'')}
function buildDetailCardsFromTask(task, expiryByFilename = {}, squareIdMap = {}) { const prompt = task?.params?.prompt || task?.prompt || ''; return (task?.result_urls || []).map((url, idx) => { const filename = url.split('/').pop(); const exp = getExpiryByFilename(expiryByFilename, filename); const expired = typeof exp.expired === 'boolean' ? exp.expired : !!task.expired; return { _type: 'image', _raw: { filename, metadata: { prompt, task_id: task.task_id, created_at: task.created_at, started_at: task.started_at, completed_at: task.completed_at, type: task?.params?.image_urls?.length ? 'image' : 'text', size: task?.params?.size, input_urls: task?.params?.image_urls } }, id: `${task.task_id}-${idx}`, prompt, fullUrl: `/api/images/file/${filename}`, filename, expiresAt: exp.expires_at || task.expires_at || null, is_permanent: typeof exp.is_permanent === 'boolean' ? exp.is_permanent : !!task.is_permanent, daysLeft: typeof exp.days_left === 'number' ? exp.days_left : task.days_left, expired, square_image_id: squareIdMap[filename] || exp.square_image_id || task.square_image_id || null } }) }
function mergeTasksById(list = []) { const map = new Map(); for (const task of list) { if (!task?.task_id) continue; map.set(task.task_id, { ...(map.get(task.task_id) || {}), ...task }) } return Array.from(map.values()) }
function buildSubmissionImages(items = []) { return items.map((img, idx) => ({ name: img?.name || img?.file?.name || `reference-${idx}`, type: img?.type || img?.file?.type || 'image/png', url: img?.url || '', preview: img?.preview || img?.url || '', file: img?.file || null })) }
function buildPendingTaskFromSubmission(item) { const prompt = item?.prompt || item?.params?.prompt || ''; return { task_id: item.real_task_id || item.temp_task_id, status: item.status || 'processing', prompt, params: { ...(item.params || {}), prompt }, previewImages: (item.images || []).map(img => img?.preview || img?.url).filter(Boolean), created_at: item.created_at || formatLocalTime(new Date()), started_at: item.started_at || item.created_at || formatLocalTime(new Date()), completed_at: item.completed_at || null, error: item.error || null, _active: false, _local_submission: true, _points_consumed: !!item.points_consumed, type: item.type || ((item.images || []).length ? 'text_image' : 'text') } }
function normalizeTaskResultUrls(task, imageFilenameSet) { const urls = (task?.result_urls || []).filter(Boolean); if (!urls.length) return urls; return urls.filter(url => imageFilenameSet.has(url.split('/').pop())) }

export default function ChatPage() {
  const dialog = useAppDialog()
  const { layoutMode } = useLayoutMode()
  const [currentUser, setCurrentUser] = useState(() => readUser())
  const isAdmin = Boolean(currentUser?.is_admin)
  const activeStatuses = ['pending', 'queued', 'processing', 'running', 'generating']
  const activeCacheKey = currentUser?.id ? `active_tasks_${currentUser.id}` : 'active_tasks_guest'
  const [tasks, setTasks] = useState([])
  const loading = false
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [timeRange, setTimeRange] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [timeRangeOpen, setTimeRangeOpen] = useState(false)
  const [timeRangeMenuPos, setTimeRangeMenuPos] = useState(null)
  const [userList, setUserList] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [points, setPoints] = useState(currentUser?.points ?? 0)
  const [requestCost, setRequestCost] = useState(10)
  const [optimizeCost, setOptimizeCost] = useState(10)
  const [extendCostPerImage, setExtendCostPerImage] = useState(2)
  const [loadError, setLoadError] = useState('')
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [selectedDetailTaskId, setSelectedDetailTaskId] = useState(null)
  const [detailCards, setDetailCards] = useState([])
  const [downloadProgress, setDownloadProgress] = useState({ open: false, phase: 'idle', current: 0, total: 0, percent: 0, filename: '' })
  const [thumbnailBlurMap, setThumbnailBlurMap] = useState({})
  const [expiryNowTs, setExpiryNowTs] = useState(() => Date.now())
  const [expiryByFilenameMap, setExpiryByFilenameMap] = useState({})
  const [feedLayoutReady, setFeedLayoutReady] = useState(false)
  const [pendingSubmissions, setPendingSubmissions] = useState([])
  const feedRef = useRef(null)
  const cardGridRef = useRef(null)
  const feedRevealTimerRef = useRef(null)
  const feedLayoutInitializedRef = useRef(false)
  const { selectionRect, dragSelected, wasDraggedRef } = useDragSelection({
    enabled: selectMode,
    selected: checked,
    onSelectionChange: setChecked,
    containerRef: cardGridRef,
  })
  const inputRef = useRef(null)
  const dragCounter = useRef(0)
  const downloadLockRef = useRef(false)
  const recoveringRef = useRef(new Set())
  const submissionProcessingRef = useRef(new Set())
  const squareIdMapRef = useRef({})
  const timeRangeMenuRef = useRef(null)
  const timeRangeButtonRef = useRef(null)
  const timeRangePanelRef = useRef(null)
  const navigate = useNavigate()
  const timeRangeOptions = useMemo(() => ([{ k: '1d', l: '近1天' }, { k: '3d', l: '近3天' }, { k: '7d', l: '近7天' }, { k: 'all', l: '全部' }]), [])
  const visibleTasks = useMemo(() => {
    const now = Date.now()
    const limit = timeRange === 'all' ? 0 : timeRange === '1d' ? 24 * 60 * 60 * 1000 : timeRange === '3d' ? 3 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    return tasks.filter(t => {
      if (t.expired) return false
      if (!limit) return true
      const ts = parseTaskTime(t.created_at)
      return ts > 0 ? now - ts <= limit : true
    })
  }, [tasks, timeRange])
  const showPortfolioEmptyState = visibleTasks.length === 0 && !searchQuery && (!isAdmin || !selectedUserId)
  const loadCachedActiveTasks = useCallback(() => {
    try {
      const raw = localStorage.getItem(activeCacheKey)
      if (!raw) return []
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return []
      return arr.filter(t => t?.task_id && activeStatuses.includes(t.status))
    } catch {
      return []
    }
  }, [activeCacheKey])
  const saveCachedActiveTasks = useCallback((taskList) => {
    try {
      const arr = (Array.isArray(taskList) ? taskList : []).filter(t => t?.task_id && activeStatuses.includes(t.status)).map(t => ({ task_id: t.task_id, status: t.status, progress: t.progress ?? 0, error: t.error || null, type: t.type || 'text', params: t.params || {}, prompt: t.prompt || '', created_at: t.created_at || '', started_at: t.started_at || '', completed_at: t.completed_at || null, result_urls: t.result_urls || [], previewImages: t.previewImages || [], _active: !!t._active, _local_submission: !!t._local_submission, _points_consumed: !!t._points_consumed }))
      localStorage.setItem(activeCacheKey, JSON.stringify(arr.slice(0, 100)))
    } catch {}
  }, [activeCacheKey])
  const submissionQueueKey = currentUser?.id ? `submission_queue_${currentUser.id}` : 'submission_queue_guest'
  const savePendingSubmissions = useCallback(async (list) => { try { await setSubmissionQueue(submissionQueueKey, list) } catch {} }, [submissionQueueKey])
  const syncPendingSubmissions = useCallback((updater) => {
    setPendingSubmissions(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      void savePendingSubmissions(next)
      return next
    })
  }, [savePendingSubmissions])

  const refreshTasks = useCallback(async () => {
    const uid = isAdmin ? selectedUserId : undefined
    const q = searchQuery || undefined
    let allTasks
    let allImages
    let myShares = []
    try {
      const taskRes = await withTimeout(taskAPI.list(50, 0, uid, q), 10000, '任务列表加载超时，请重试')
      allTasks = taskRes.data || []
    } catch (e) {
      setLoadError(e.message || '任务列表加载失败')
      const cached = loadCachedActiveTasks()
      if (cached.length > 0) setTasks(prev => [...cached, ...prev.filter(t => !cached.some(c => c.task_id === t.task_id))])
      else if (!loaded) setTasks([])
      if (!loaded) setLoaded(true)
      return
    }
    const cachedActive = loadCachedActiveTasks()
    if (cachedActive.length > 0) {
      const ids = new Set(allTasks.map(t => t.task_id))
      for (const t of cachedActive) {
        if (!ids.has(t.task_id)) allTasks.push(t)
      }
    }
    try {
      const imgRes = await withTimeout(imageAPI.list(1, 100, uid), 12000, '图片列表加载超时，已仅显示任务列表')
      allImages = imgRes.data.images || []
      setLoadError('')
    } catch (e) {
      allImages = []
      setLoadError(e.message || '图片列表加载失败，已仅显示任务列表')
    }
    if (!isAdmin || !uid) {
      try {
        const shareRes = await withTimeout(squareAPI.my(1, 200), 10000, '我的分享加载超时')
        myShares = shareRes.data?.images || []
      } catch {}
    }
    const latestMap = {}
    for (const img of allImages || []) {
      if (img?.filename && img?.square_image_id) latestMap[img.filename] = img.square_image_id
    }
    for (const s of myShares) {
      if (s?.filename && s?.id) latestMap[s.filename] = s.id
    }
    squareIdMapRef.current = { ...squareIdMapRef.current, ...latestMap }
    const taskImageFiles = new Set()
    for (const t of allTasks) {
      for (const u of (t.result_urls || [])) taskImageFiles.add(u.split('/').pop())
    }
    const imageFilenameSet = new Set(allImages.map(img => img.filename).filter(Boolean))
    const expiryByFilename = Object.fromEntries(allImages.map(img => [img.filename, { expires_at: img.expires_at, is_permanent: !!img.is_permanent, days_left: img.days_left, expired: !!img.expired, width: img.width || null, height: img.height || null, square_image_id: img.square_image_id || null }]))
    setExpiryByFilenameMap(expiryByFilename)
    let orphans = allImages.filter(img => !taskImageFiles.has(img.filename)).map(img => ({
      task_id: 'img-' + img.filename,
      status: 'completed',
      result_urls: [img.url],
      params: img.metadata || {},
      created_at: img.created_at,
      started_at: img.created_at,
      completed_at: img.created_at,
      username: img.username || '',
      expires_at: img.expires_at,
      is_permanent: !!img.is_permanent,
      days_left: img.days_left,
      expired: !!img.expired,
      width: img.width || null,
      height: img.height || null,
      square_image_id: img.square_image_id || null,
    }))
    if (q) {
      const lower = q.toLowerCase()
      orphans = orphans.filter(o => ((o.params?.prompt || '').toLowerCase().includes(lower)))
    }
    const merged = [...orphans, ...allTasks.map(t => { const result_urls = normalizeTaskResultUrls(t, imageFilenameSet); const fn = result_urls?.[0]?.split('/').pop(); const exp = getExpiryByFilename(expiryByFilename, fn); const allExpired = result_urls.length > 0 && result_urls.every(u => { const f = u.split('/').pop(); const e = getExpiryByFilename(expiryByFilename, f); return typeof e.expired === 'boolean' ? e.expired : false }); return { ...t, result_urls, expires_at: exp.expires_at || t.expires_at, is_permanent: typeof exp.is_permanent === 'boolean' ? exp.is_permanent : t.is_permanent, days_left: typeof exp.days_left === 'number' ? exp.days_left : t.days_left, expired: allExpired ? true : typeof exp.expired === 'boolean' ? exp.expired : !!t.expired, width: exp.width || t.width || null, height: exp.height || t.height || null, square_image_id: exp.square_image_id || t.square_image_id || null } }).filter(t => t.status !== 'completed' || (t.result_urls?.length || 0) > 0)].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    setTasks(merged)
    const completedMerged = merged.filter(t => t.status === 'completed' && t.result_urls?.length)
    setDetailCards(completedMerged.flatMap(task => buildDetailCardsFromTask(task, expiryByFilename, squareIdMapRef.current)))
    saveCachedActiveTasks(merged)
    if (!loaded) setLoaded(true)
  }, [loaded, isAdmin, selectedUserId, searchQuery, loadCachedActiveTasks, saveCachedActiveTasks])

  useEffect(() => { refreshTasks() }, [refreshTasks])
  useEffect(() => {
    if (loaded) return
    const cached = loadCachedActiveTasks()
    if (cached.length > 0) setTasks(prev => prev.length ? prev : cached)
  }, [loaded, loadCachedActiveTasks])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await getSubmissionQueue(submissionQueueKey)
        if (!cancelled) setPendingSubmissions(Array.isArray(list) ? list : [])
      } catch {}
    })()
    return () => { cancelled = true }
  }, [submissionQueueKey])
  useEffect(() => {
    if (!pendingSubmissions.length) return
    const localTasks = pendingSubmissions.map(buildPendingTaskFromSubmission)
    if (!localTasks.length) return
    setTasks(prev => {
      const existingIds = new Set(prev.map(t => t.task_id))
      const merged = [...prev]
      for (const task of localTasks) if (!existingIds.has(task.task_id)) merged.push(task)
      const next = mergeTasksById(merged)
      saveCachedActiveTasks(next)
      return next
    })
  }, [pendingSubmissions, saveCachedActiveTasks])

  useEffect(() => {
    if (!isAdmin) return
    adminAPI.users(1, 100).then(({ data }) => setUserList(data.users || [])).catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    const syncUser = () => setCurrentUser(readUser())
    window.addEventListener('auth-changed', syncUser)
    window.addEventListener('points-updated', syncUser)
    return () => { window.removeEventListener('auth-changed', syncUser); window.removeEventListener('points-updated', syncUser) }
  }, [])
  useEffect(() => {
    setPoints(currentUser?.points ?? 0)
  }, [currentUser])
  useEffect(() => {
    setThumbnailBlurMap(getThumbnailBlurMap(currentUser))
  }, [currentUser?.id,currentUser?.user_id,currentUser?.username])
  useEffect(() => {
    try { localStorage.setItem(getThumbnailBlurStorageKey(currentUser), JSON.stringify(thumbnailBlurMap)) } catch {}
  }, [thumbnailBlurMap,currentUser?.id,currentUser?.user_id,currentUser?.username])
  useEffect(() => {
    pointsAPI.balance().then(res => setPoints(res.data.points)).catch(() => {})
    const handleUpdate = () => {
      const u = readUser()
      setCurrentUser(u)
      if (u) setPoints(u.points ?? 0)
    }
    window.addEventListener('points-updated', handleUpdate)
    return () => window.removeEventListener('points-updated', handleUpdate)
  }, [])
  useEffect(() => {
    configAPI.get().then(res => {
      setRequestCost(Math.max(0, Number(res.data?.points_cost_per_generation) || 10))
      setOptimizeCost(Math.max(0, Number(res.data?.points_cost_per_optimize) || 10))
      setExtendCostPerImage(Math.max(1, Number(res.data?.points_cost_per_image_extend) || 2))
    }).catch(() => { setRequestCost(10); setOptimizeCost(10) })
  }, [])

  useEffect(() => {
    if (loaded && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [loaded])
  useEffect(() => {
    if (!timeRangeOpen) return
    const updateTimeRangeMenuPos = () => {
      const rect = timeRangeButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      setTimeRangeMenuPos({ top: rect.bottom + 8, left: rect.right, width: Math.max(rect.width, 112) })
    }
    const handlePointerDown = (e) => { if (!timeRangeMenuRef.current?.contains(e.target) && !timeRangePanelRef.current?.contains(e.target)) setTimeRangeOpen(false) }
    updateTimeRangeMenuPos()
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', updateTimeRangeMenuPos)
    window.addEventListener('scroll', updateTimeRangeMenuPos, true)
    return () => { window.removeEventListener('pointerdown', handlePointerDown); window.removeEventListener('resize', updateTimeRangeMenuPos); window.removeEventListener('scroll', updateTimeRangeMenuPos, true) }
  }, [timeRangeOpen])
  useEffect(() => {
    if (!loaded || visibleTasks.length === 0 || feedLayoutInitializedRef.current) return
    const el = cardGridRef.current
    if (!el) return
    let observer = null
    const reveal = () => { if (feedRevealTimerRef.current) clearTimeout(feedRevealTimerRef.current); feedRevealTimerRef.current = setTimeout(() => { observer?.disconnect(); feedLayoutInitializedRef.current = true; setFeedLayoutReady(true) }, 180) }
    setFeedLayoutReady(false)
    reveal()
    observer = new ResizeObserver(() => reveal())
    observer.observe(el)
    return () => {
      observer?.disconnect()
      if (feedRevealTimerRef.current) { clearTimeout(feedRevealTimerRef.current); feedRevealTimerRef.current = null }
    }
  }, [loaded, visibleTasks.length])
  useEffect(() => {
    const tick = () => setExpiryNowTs(Date.now())
    tick()
    const timer = setInterval(tick, 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const handler = () => refreshTasks()
    window.addEventListener('gallery-updated', handler)
    return () => window.removeEventListener('gallery-updated', handler)
  }, [refreshTasks])
  useEffect(() => {
    const vk = navigator.virtualKeyboard
    if (!vk) return
    const prev = vk.overlaysContent
    vk.overlaysContent = true
    return () => { vk.overlaysContent = prev }
  }, [])

  const scroll = useCallback(() => {
    const el = feedRef.current
    if (el) setTimeout(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }), 50)
  }, [])

  const handleAddPrompt = useCallback((input) => {
    const promptText = typeof input === 'object' ? input?.prompt : input
    inputRef.current?.setPrompt(String(promptText || ''))
  }, [])
  const handleAddToPromptLibrary = useCallback(async (task) => {
    if (!isAdmin) return
    const promptText=String(task?.params?.prompt||task?.prompt||'').trim()
    if (!promptText) { dialog.alert('该作品没有可入库的提示词'); return }
    if (!await dialog.confirm('确定将该作品的提示词加入广场 Tab 的提示词库子 Tab 吗？\n作者将留空。')) return
    try {
      const imagePath = task?.filename || task?._raw?.filename || null
      await promptAPI.createPublic({ name: makePromptLibraryName(promptText), prompt: promptText, negative_prompt: '', tags: [], category: null, image_path: imagePath })
      dialog.alert('已加入广场提示词库')
    } catch (e) {
      dialog.alert(e?.message || '加入提示词库失败')
    }
  }, [dialog,isAdmin])
  const markSquareShared = useCallback((filename, shareId) => {
    if (!filename || !shareId) return
    squareIdMapRef.current[filename] = shareId
    setDetailCards(prev => prev.map(c => c.filename === filename ? { ...c, square_image_id: shareId } : c))
  }, [])

  const updateTask = useCallback((taskId, updates) => {
    setTasks(prev => {
      const next = prev.map(t => t.task_id === taskId ? { ...t, ...updates } : t)
      saveCachedActiveTasks(next)
      return next
    })
  }, [saveCachedActiveTasks])
  const shareImageToSquare = useCallback(async (filename, prompt, params, hasImages, imageUrls) => {
    try {
      const { data } = await squareAPI.share({
        filename,
        prompt,
        metadata: { size: params?.size, type: hasImages ? 'image' : 'text', input_urls: imageUrls?.length ? imageUrls : undefined },
      })
      markSquareShared(filename, data?.id)
    } catch {}
  }, [markSquareShared])
  const refreshPointsOnFailed = useCallback(() => {
    pointsAPI.balance().then(res => {
      setPoints(res.data.points)
      const u = readUser()
      if (u) { u.points = res.data.points; localStorage.setItem('user', JSON.stringify(u)) }
      window.dispatchEvent(new Event('points-updated'))
    }).catch(() => {})
  }, [])
  const finalizeSubmissionQueueItem = useCallback((clientRequestId, updater) => {
    if (!clientRequestId) return
    syncPendingSubmissions(prev => prev.flatMap(item => {
      if (item.client_request_id !== clientRequestId) return [item]
      const next = typeof updater === 'function' ? updater(item) : { ...item, ...(updater || {}) }
      return next ? [next] : []
    }))
  }, [syncPendingSubmissions])
  const markSubmissionFailed = useCallback((item, message) => {
    if (!item) return
    finalizeSubmissionQueueItem(item.client_request_id, { ...item, status: 'failed', error: message || '提交失败', real_task_id: item.real_task_id || null, completed_at: formatLocalTime(new Date()) })
    updateTask(item.real_task_id || item.temp_task_id, { status: 'failed', error: message || '提交失败', _active: false, _local_submission: false })
  }, [finalizeSubmissionQueueItem, updateTask])

  const pollTask = useCallback(async (taskId, startTime, shareToSquare, prompt, params, hasImages) => {
    const maxWaitMs = 15 * 60 * 1000
    const getDelay = (elapsed) => {
      if (elapsed >= 50_000 && elapsed < 120_000) return 6000
      if (elapsed < 50_000) return 10000
      return 90000
    }
    let missingCount = 0
    let errorCount = 0

    for (let attempt = 0; Date.now() - startTime < maxWaitMs; attempt++) {
      const elapsed = Date.now() - startTime
      await new Promise(r => setTimeout(r, getDelay(elapsed)))
      try {
        const { data: st } = await taskAPI.get(taskId)
        missingCount = 0
        errorCount = 0
        if (st.status === 'completed') {
          const completedTask = { ...st, _active: false, task_id: taskId }
          updateTask(taskId, completedTask)
          if (st.result_urls?.length) {
            const cardPrompt = st.params?.prompt || st.prompt || prompt
            const newCards = st.result_urls.map((url, idx) => {
              const filename = url.split('/').pop()
              return { _type: 'image', _raw: { filename, metadata: { prompt: cardPrompt, task_id: taskId, created_at: st.created_at, started_at: st.started_at, completed_at: st.completed_at, type: st.params?.image_urls?.length ? 'image' : 'text', size: st.params?.size, input_urls: st.params?.local_image_urls || st.params?.image_urls } }, id: `${taskId}-${idx}`, prompt: cardPrompt, fullUrl: `/api/images/file/${filename}`, filename }
            })
            setDetailCards(prev => {
              const existing = new Set(prev.map(c => c.id))
              const toAdd = newCards.filter(c => !existing.has(c.id))
              return toAdd.length ? [...prev, ...toAdd] : prev
            })
          }
          if (shareToSquare && st.result_urls?.length) {
            shareImageToSquare(st.result_urls[0].split('/').pop(), prompt, params, hasImages, params?.local_image_urls || params?.image_urls)
          }
          syncPendingSubmissions(prev => prev.filter(item => item.real_task_id !== taskId))
          return
        }
        if (st.status === 'failed') {
          updateTask(taskId, { ...st, _active: false })
          refreshPointsOnFailed()
          syncPendingSubmissions(prev => prev.filter(item => item.real_task_id !== taskId))
          return
        }
        updateTask(taskId, { ...st, _active: true })
      } catch (e) {
        const msg = (e?.message || '').toLowerCase()
        if (msg.includes('404') || msg.includes('任务不存在') || msg.includes('not found')) {
          missingCount += 1
          if (missingCount >= 3) {
            updateTask(taskId, { status: 'failed', error: '后端未找到任务，提交可能失败', _active: false })
            refreshPointsOnFailed()
            syncPendingSubmissions(prev => prev.filter(item => item.real_task_id !== taskId))
            return
          }
        } else {
          errorCount += 1
          if (errorCount >= 5) {
            updateTask(taskId, { status: 'failed', error: '任务状态查询失败，请重试', _active: false })
            syncPendingSubmissions(prev => prev.filter(item => item.real_task_id !== taskId))
            return
          }
        }
      }
    }
    updateTask(taskId, { status: 'failed', error: '生成超时（已等待15分钟）', _active: false })
    refreshPointsOnFailed()
    syncPendingSubmissions(prev => prev.filter(item => item.real_task_id !== taskId))
  }, [updateTask, shareImageToSquare, refreshPointsOnFailed, syncPendingSubmissions])

  const processSubmission = useCallback(async (item) => {
    const submissionId = item?.client_request_id
    if (!submissionId || submissionProcessingRef.current.has(submissionId)) return
    if (item.status === 'failed' || item.status === 'completed') return
    submissionProcessingRef.current.add(submissionId)
    const createdAt = item.created_at || formatLocalTime(new Date())
    const startedAt = item.started_at || formatLocalTime(new Date())
    const prompt = item.prompt || item?.params?.prompt || ''
    const baseParams = { ...(item.params || {}), prompt, share_to_square: !!item.shareToSquare }
    const realTaskId = item.real_task_id || makeTaskId()
    const hasExistingRealTask = !!item.real_task_id
    if (!hasExistingRealTask) {
      finalizeSubmissionQueueItem(submissionId, current => current ? { ...current, real_task_id: realTaskId, status: 'processing', started_at: startedAt } : null)
      setTasks(prev => {
        const next = prev.map(task => task.task_id === item.temp_task_id ? { ...task, task_id: realTaskId, started_at: startedAt, _local_submission: false } : task)
        saveCachedActiveTasks(next)
        return next
      })
    } else {
      updateTask(realTaskId, { status: 'processing', started_at: startedAt, _active: true })
    }
    const images = buildSubmissionImages(item.images)
    let imageUrls = []
    let localImageUrls = []
    let hasImages = false
    try {
      const uploaded = images.length > 0 ? await Promise.all(images.map(async img => {
        if (img.file) { const type = img.file.type || img.type || 'image/png'; return uploadAPI.upload(new File([img.file], normalizeUploadName(img.name || img.file.name, type), { type })) }
        if (img.url && img.url.startsWith('http')) return Promise.resolve({ data: { url: img.url, storage_name: img.url } })
        if (img.url) { const r = await fetch(img.url); if (!r.ok) throw new Error(`fetch ${r.status}`); const blob = await r.blob(); const type = blob.type || r.headers.get('content-type') || img.type || 'image/png'; return uploadAPI.upload(new File([blob], normalizeUploadName(img.name, type, img.url), { type })) }
        return { data: { url: '', storage_name: '' } }
      })) : []
      imageUrls = uploaded.map(r => r.data.url).filter(Boolean)
      localImageUrls = uploaded.map(r => r.data.storage_name || r.data.url).filter(Boolean)
      hasImages = imageUrls.length > 0
    } catch (e) {
      markSubmissionFailed({ ...item, real_task_id: realTaskId }, '图片上传失败: ' + (e?.message || '未知错误'))
      submissionProcessingRef.current.delete(submissionId)
      return
    }
    const requestParams = { ...baseParams, image_urls: imageUrls, local_image_urls: localImageUrls }
    try {
      const data = hasImages ? (await generateAPI.submitTextImage({ prompt, image_urls: imageUrls, size: baseParams?.size || 'auto', quality: baseParams?.quality || undefined, model_id: baseParams?.model_id, task_id: realTaskId, client_request_id: submissionId, share_to_square: !!item.shareToSquare, local_image_urls: localImageUrls })).data : (await generateAPI.submitText({ prompt, size: baseParams?.size || 'auto', quality: baseParams?.quality || undefined, model_id: baseParams?.model_id, task_id: realTaskId, client_request_id: submissionId, share_to_square: !!item.shareToSquare })).data
      const modelCost = baseParams?._points_cost || requestCost
      if (!item.points_consumed) {
        setPoints(p => Math.max(0, p - modelCost))
        const u = readUser()
        if (u) { u.points = Math.max(0, (u.points ?? 0) - modelCost); localStorage.setItem('user', JSON.stringify(u)) }
        window.dispatchEvent(new Event('points-updated'))
      }
      const finalTaskId = data.task_id || realTaskId
      setTasks(prev => {
        const next = prev.map(task => task.task_id === realTaskId || task.task_id === item.temp_task_id ? { ...task, task_id: finalTaskId, status: data.status || 'processing', params: requestParams, prompt, created_at: createdAt, started_at: startedAt, _active: data.status !== 'completed', _points_consumed: true } : task)
        saveCachedActiveTasks(next)
        return next
      })
      if (!item.points_consumed) finalizeSubmissionQueueItem(submissionId, current => current ? { ...current, real_task_id: finalTaskId, points_consumed: true, status: data.status || 'processing' } : null)
      syncPendingSubmissions(prev => prev.filter(queueItem => queueItem.client_request_id !== submissionId))
      if (data.status === 'completed') {
        updateTask(finalTaskId, { status: 'completed', result_urls: data.result_urls || [], params: requestParams, prompt, created_at: createdAt, started_at: startedAt, _active: false })
        if (data.result_urls?.length) {
          const newCards = data.result_urls.map((url, idx) => { const filename = url.split('/').pop(); return { _type: 'image', _raw: { filename, metadata: { prompt, task_id: finalTaskId, created_at: createdAt, started_at: startedAt, completed_at: formatLocalTime(new Date()), type: hasImages ? 'image' : 'text', size: baseParams?.size, input_urls: localImageUrls.length ? localImageUrls : imageUrls } }, id: `${finalTaskId}-${idx}`, prompt, fullUrl: `/api/images/file/${filename}`, filename, expired: false } })
          setDetailCards(prev => { const existing = new Set(prev.map(card => card.id)); const toAdd = newCards.filter(card => !existing.has(card.id)); return toAdd.length ? [...prev, ...toAdd] : prev })
        }
        if (!!item.shareToSquare && data.result_urls?.length) shareImageToSquare(data.result_urls[0].split('/').pop(), prompt, requestParams, hasImages, localImageUrls)
      } else {
        pollTask(finalTaskId, Date.now(), !!item.shareToSquare, prompt, requestParams, hasImages)
      }
    } catch (e) {
      const msg = e?.message || ''
      if (msg.includes('积分不足') || msg.includes('402')) {
        markSubmissionFailed({ ...item, real_task_id: realTaskId }, '积分不足，请先获取更多积分后重试')
        dialog.alert(msg.includes('积分不足') ? msg : '积分不足，请先获取更多积分后重试')
        refreshPointsOnFailed()
        submissionProcessingRef.current.delete(submissionId)
        return
      }
      const isTimeout = msg.includes('timeout') || msg.includes('超时')
      if (isTimeout) {
        try {
          const { data: st } = await taskAPI.get(realTaskId)
          syncPendingSubmissions(prev => prev.filter(queueItem => queueItem.client_request_id !== submissionId))
          if (st.status === 'completed') {
            updateTask(realTaskId, { ...st, params: requestParams, prompt, created_at: createdAt, started_at: startedAt, _active: false, _points_consumed: true })
            if (!!item.shareToSquare && st.result_urls?.length) shareImageToSquare(st.result_urls[0].split('/').pop(), prompt, requestParams, hasImages, localImageUrls)
          } else if (st.status === 'failed') {
            updateTask(realTaskId, { ...st, params: requestParams, prompt, created_at: createdAt, started_at: startedAt, _active: false, _points_consumed: true })
            refreshPointsOnFailed()
          } else {
            updateTask(realTaskId, { ...st, params: requestParams, prompt, created_at: createdAt, started_at: startedAt, _active: true, _points_consumed: true })
            pollTask(realTaskId, Date.now(), !!item.shareToSquare, prompt, requestParams, hasImages)
          }
          submissionProcessingRef.current.delete(submissionId)
          return
        } catch (se) {
          const sm = (se?.message || '').toLowerCase()
          if (sm.includes('404') || sm.includes('任务不存在') || sm.includes('not found')) {
            finalizeSubmissionQueueItem(submissionId, current => current ? { ...current, real_task_id: realTaskId, status: 'processing', started_at: startedAt } : null)
            submissionProcessingRef.current.delete(submissionId)
            setTimeout(() => {
              const latest = pendingSubmissions.find(queueItem => queueItem.client_request_id === submissionId)
              void processSubmission(latest || { ...item, real_task_id: realTaskId, started_at: startedAt })
            }, 1500)
            return
          }
        }
        syncPendingSubmissions(prev => prev.filter(queueItem => queueItem.client_request_id !== submissionId))
        pollTask(realTaskId, Date.now(), !!item.shareToSquare, prompt, requestParams, hasImages)
      } else {
        markSubmissionFailed({ ...item, real_task_id: realTaskId }, '提交失败: ' + msg)
      }
    }
    submissionProcessingRef.current.delete(submissionId)
  }, [finalizeSubmissionQueueItem, markSubmissionFailed, pendingSubmissions, pollTask, refreshPointsOnFailed, requestCost, saveCachedActiveTasks, shareImageToSquare, syncPendingSubmissions, updateTask])

  const handleSubmit = useCallback(async ({ prompt, images, params, shareToSquare, rollCount = 1, clearInput }) => {
    const batchCount = Math.min(5, Math.max(1, Number(rollCount) || 1))
    const modelCost = params?._points_cost || requestCost
    const totalCost = batchCount * modelCost
    if (points < totalCost) {
      dialog.alert(`积分不足，当前仅剩 ${points} 积分，本次需要 ${totalCost} 积分。`)
      return false
    }
    try {
      const { data } = await taskAPI.activeSummary()
      const activeCount = Math.max(0, Number(data?.active_count) || 0)
      const globalLimit = Math.max(1, Number(data?.global_limit) || 20)
      if (activeCount + batchCount > globalLimit) {
        dialog.alert(`当前全站正在生成 ${activeCount} 张，最多同时 ${globalLimit} 张。请稍后再试。`)
        return false
      }
    } catch (e) {
      dialog.alert(e?.message || '提交前检查失败，请稍后再试')
      return false
    }
    const submitMessage = batchCount > 1 ? `本次将提交 ${batchCount} 次生成，预计消耗 ${totalCost} 积分，是否继续？` : `本次将提交 1 次生成，预计消耗 ${modelCost} 积分，是否继续？`
    if (!await dialog.confirm(`${submitMessage}\n\n当前设置\n${formatSubmitSettings(params, shareToSquare, images?.length || 0)}`)) return false
    try {
      const now = formatLocalTime(new Date())
      const baseImages = buildSubmissionImages(images || [])
      const submissions = Array.from({ length: batchCount }, (_, index) => ({ client_request_id: makeTaskId(), temp_task_id: `pending-${Date.now()}-${index}-${Math.random().toString(16).slice(2, 8)}`, real_task_id: null, prompt, images: baseImages, params: { ...params, prompt, share_to_square: !!shareToSquare }, shareToSquare: !!shareToSquare, type: baseImages.length ? 'text_image' : 'text', status: 'processing', created_at: now, started_at: now, error: null }))
      const stagedTasks = submissions.map(buildPendingTaskFromSubmission)
      setTasks(prev => {
        const next = mergeTasksById([...prev, ...stagedTasks])
        saveCachedActiveTasks(next)
        return next
      })
      syncPendingSubmissions(prev => [...prev, ...submissions])
      clearInput?.()
      scroll()
      for (const submission of submissions) void processSubmission(submission)
      return 'cleared'
    } catch (e) {
      dialog.alert('提交失败: ' + (e?.message || '未知错误'))
      return false
    }
  }, [dialog, points, processSubmission, requestCost, saveCachedActiveTasks, scroll, syncPendingSubmissions])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await refreshTasks()
    setRefreshing(false)
  }, [refreshTasks])

  const handleRetry = useCallback(async (taskId) => {
    try {
      await taskAPI.retry(taskId)
      await refreshTasks()
    } catch (e) { dialog.alert(e.message || '重试失败') }
  }, [refreshTasks, dialog])

  // 刷新后自动恢复 processing 任务的轮询
  useEffect(() => {
    for (const t of tasks) {
      if (!String(t.task_id).startsWith('pending-') && ['pending', 'queued', 'processing', 'running', 'generating'].includes(t.status) && !t._active && !recoveringRef.current.has(t.task_id)) {
        recoveringRef.current.add(t.task_id)
        updateTask(t.task_id, { _active: true })
        const p = t.params || {}
        pollTask(t.task_id, Date.now(), !!p.share_to_square, p.prompt || '', p, t.type === 'text_image')
      }
    }
  }, [tasks, pollTask, updateTask])
  useEffect(() => {
    for (const item of pendingSubmissions) {
      if (!item?.client_request_id || item.status === 'failed' || item.status === 'completed') continue
      if (item.real_task_id && tasks.some(t => t.task_id === item.real_task_id && ['pending', 'queued', 'processing', 'running', 'generating'].includes(t.status) && t._active)) continue
      void processSubmission(item)
    }
  }, [pendingSubmissions, processSubmission, tasks])

  const allDetailCards = useMemo(() => {
    const result = []
    for (const task of visibleTasks) {
      if (!task.result_urls?.length) continue
      const cards = buildDetailCardsFromTask(task, expiryByFilenameMap, squareIdMapRef.current)
      for (const c of cards) {
        if (!c.expired) result.push(c)
      }
    }
    return result
  }, [visibleTasks, expiryByFilenameMap])

  const handleCardViewDetail = useCallback((taskId) => {
    const task = visibleTasks.find(t => t.task_id === taskId && t.result_urls?.length)
    if (!task) return
    const cards = buildDetailCardsFromTask(task, expiryByFilenameMap, squareIdMapRef.current)
    if (cards.every(c => c.expired)) return
    const firstNonExpired = cards.findIndex(c => !c.expired)
    let offset = 0
    for (const t of visibleTasks) {
      if (!t.result_urls?.length) continue
      const tc = buildDetailCardsFromTask(t, expiryByFilenameMap, squareIdMapRef.current)
      if (t.task_id === taskId) { offset += firstNonExpired; break }
      offset += tc.filter(c => !c.expired).length
    }
    setSelectedDetailTaskId(taskId)
    setSelectedCardIndex(offset)
  }, [visibleTasks, expiryByFilenameMap])

  const handleModalNavigate = useCallback((newIndex) => {
    setSelectedCardIndex(newIndex)
    let offset = 0
    for (const task of visibleTasks) {
      if (!task.result_urls?.length) continue
      const cards = buildDetailCardsFromTask(task, expiryByFilenameMap, squareIdMapRef.current)
      const count = cards.filter(c => !c.expired).length
      if (count === 0) continue
      if (newIndex < offset + count) {
        setSelectedDetailTaskId(task.task_id)
        return
      }
      offset += count
    }
  }, [visibleTasks, expiryByFilenameMap])
  useEffect(() => {
    if (!selectedDetailTaskId) return
    if (allDetailCards.length === 0) { setSelectedCardIndex(null); setSelectedDetailTaskId(null); return }
    if (selectedCardIndex === null) setSelectedCardIndex(0)
    else if (selectedCardIndex >= allDetailCards.length) setSelectedCardIndex(allDetailCards.length - 1)
  }, [allDetailCards, selectedDetailTaskId, selectedCardIndex])
  const handleDetailShare = useCallback(async (card) => {
    try {
      const { data } = await squareAPI.share({ filename: card.filename, prompt: card.prompt || '', metadata: { size: card?._raw?.metadata?.size, type: card?._raw?.metadata?.type || 'text', input_urls: card?._raw?.metadata?.input_urls } })
      markSquareShared(card.filename, data?.id)
      window.dispatchEvent(new Event('gallery-updated'))
    } catch (e) {
      dialog.alert(e?.response?.data?.detail || e.message || '分享失败')
    }
  }, [dialog, markSquareShared])
  const handleDetailUnshare = useCallback(async (card) => {
    let sid = card.square_image_id || squareIdMapRef.current[card.filename]
    if (!sid) {
      await refreshTasks()
      sid = squareIdMapRef.current[card.filename]
    }
    if (!sid) { dialog.alert('无法找到分享记录'); return }
    if (!await dialog.confirm('确定撤回该分享？')) return
    try {
      await squareAPI.unshare(sid)
      delete squareIdMapRef.current[card.filename]
      setDetailCards(prev => prev.map(c => c.filename === card.filename ? { ...c, square_image_id: null, is_permanent: false } : c))
      window.dispatchEvent(new Event('gallery-updated'))
    } catch (e) {
      dialog.alert(e?.response?.data?.detail || e.message || '撤回失败')
    }
  }, [dialog, refreshTasks])
  const handleExtendImages = useCallback(async (filenames) => {
    const uniq = [...new Set((filenames || []).filter(Boolean))]
    if (uniq.length === 0) { dialog.alert('没有可延长的图片'); return }
    try {
      const { data } = await imageAPI.extend(uniq)
      if (typeof data.points === 'number') {
        setPoints(data.points)
        const u = readUser()
        if (u) { u.points = data.points; localStorage.setItem('user', JSON.stringify(u)) }
        window.dispatchEvent(new Event('points-updated'))
      }
      await refreshTasks()
      const msg = `成功${data.success_count||0}，跳过${data.skipped_count||0}，失败${data.failed_count||0}${data.total_cost ? `，扣除${data.total_cost}积分` : ''}`
      dialog.alert(msg)
    } catch (e) {
      dialog.alert(e?.message || '延长失败')
    }
  }, [refreshTasks, dialog])
  const handleDetailExtend = useCallback(async (card) => {
    if (!await dialog.confirm(`确定延长3天？将扣除${extendCostPerImage}积分`)) return
    await handleExtendImages([card.filename])
  }, [handleExtendImages, dialog, extendCostPerImage])

  const toggleCheck = useCallback((taskId) => {
    setChecked(prev => { const next = new Set(prev); next.has(taskId) ? next.delete(taskId) : next.add(taskId); return next })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (checked.size === visibleTasks.length) setChecked(new Set())
    else setChecked(new Set(visibleTasks.map(t => t.task_id)))
  }, [checked.size, visibleTasks])

  const handleBatchDownload = useCallback(async () => {
    if (downloadLockRef.current || downloadProgress.open) return
    const files = []
    for (const task of visibleTasks) {
      if (!checked.has(task.task_id)) continue
      for (const url of (task.result_urls || [])) {
        const filename = url.split('/').pop()
        const apiUrl = `/api/images/file/${filename}`
        files.push({ url: apiUrl, name: filename })
      }
    }
    if (files.length === 0) return
    downloadLockRef.current = true
    const asZip = files.length > 1 ? await dialog.choose(`下载 ${files.length} 张图片`, [{ label: '打包 ZIP', value: 'zip' }, { label: '逐个 PNG', value: 'png' }]) === 'zip' : false
    if (asZip) {
      try {
        setDownloadProgress({ open: true, phase: 'zip', current: 0, total: files.length, percent: 10, filename: `${files.length} files` })
        const resp = await imageAPI.downloadBatch(files.map(file => file.name))
        setDownloadProgress(v => ({ ...v, phase: 'zip', current: files.length, total: files.length, percent: 95 }))
        const saved = await saveBlob(resp.data, getDownloadFilename(resp.headers, `images_${Date.now()}.zip`))
        if (!saved) return
        setDownloadProgress(v => ({ ...v, phase: 'done', current: files.length, total: files.length, percent: 100 }))
      } catch (e) {
        dialog.alert(e?.message || '打包下载失败')
      } finally {
        setTimeout(() => { setDownloadProgress({ open: false, phase: 'idle', current: 0, total: 0, percent: 0, filename: '' }); downloadLockRef.current = false }, 400)
      }
    } else {
      try {
        setDownloadProgress({ open: true, phase: 'single', current: 0, total: files.length, percent: 0, filename: '' })
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          setDownloadProgress(v => ({ ...v, phase: 'single', current: i, total: files.length, percent: Math.min(85, Math.round(i / files.length * 85)), filename: file.name }))
          const resp = await fetch(file.url)
          const blob = await resp.blob()
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = file.name
          document.body.appendChild(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(a.href)
          setDownloadProgress(v => ({ ...v, phase: 'single', current: i + 1, total: files.length, percent: Math.min(95, Math.round((i + 1) / files.length * 95)), filename: file.name }))
        }
        setDownloadProgress(v => ({ ...v, phase: 'done', current: files.length, total: files.length, percent: 100 }))
      } catch (e) {
        dialog.alert(e?.message || '下载失败')
      } finally {
        setTimeout(() => { setDownloadProgress({ open: false, phase: 'idle', current: 0, total: 0, percent: 0, filename: '' }); downloadLockRef.current = false }, 400)
      }
    }
  }, [checked, visibleTasks, dialog, downloadProgress.open])

  const handleBatchDelete = useCallback(async () => {
    if (!await dialog.confirm(`确定删除选中的 ${checked.size} 项？`)) return
    let failed = 0
    const deleted = new Set()
    const ids = [...checked]
    for (const taskId of ids) {
      try {
        if (taskId.startsWith('img-')) {
          const filename = taskId.replace('img-', '')
          await imageAPI.delete(filename)
        } else {
          await taskAPI.delete(taskId)
        }
        deleted.add(taskId)
      } catch (e) { console.error('删除失败:', taskId, e); failed += 1 }
    }
    setChecked(new Set()); setSelectMode(false)
    // 乐观更新：立即从本地移除已删除的项
    if (deleted.size > 0) {
      setTasks(prev => prev.filter(t => !deleted.has(t.task_id)))
    }
    try { await refreshTasks() } catch (e) { console.error('刷新任务列表失败:', e) }
    window.dispatchEvent(new Event('gallery-updated'))
    if (failed > 0) dialog.alert(`${failed} 项删除失败`)
  }, [checked, refreshTasks, dialog])
  const handleBatchExtend = useCallback(async () => {
    const filenames = []
    for (const task of visibleTasks) {
      if (!checked.has(task.task_id)) continue
      for (const url of (task.result_urls || [])) filenames.push(url.split('/').pop())
    }
    if (filenames.length === 0) return
    if (!await dialog.confirm(`确定延长选中的 ${filenames.length} 张图片3天？将扣除 ${filenames.length * extendCostPerImage} 积分`)) return
    await handleExtendImages(filenames)
  }, [checked, visibleTasks, handleExtendImages, dialog, extendCostPerImage])

  const exitSelectMode = useCallback(() => { setSelectMode(false); setChecked(new Set()) }, [])

  const handleDragEnter = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (selectMode) return
    if (e.dataTransfer.types.includes('Files')) {
      if (e.currentTarget.contains(e.relatedTarget)) return
      dragCounter.current++
      setDragging(true)
    }
  }, [selectMode])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (selectMode) return
    if (e.currentTarget.contains(e.relatedTarget)) return
    dragCounter.current--
    if (dragCounter.current === 0) setDragging(false)
  }, [selectMode])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setDragging(false)
    if (selectMode) return
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(png|jpe?g|webp)$/i.test(f.name))
    if (files.length > 0) inputRef.current?.addFiles(files)
  }, [selectMode])

  const dragProps = {
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  }
  const bottomDock = (
    <div className="lg:static fixed inset-x-0 z-20 flex-shrink-0" style={{ background: 'var(--bg-primary)', borderTop: `1px solid var(--border-color)`, bottom: 'env(keyboard-inset-height, 0px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {selectMode && checked.size > 0 && (
        <div className="px-4 py-3 flex items-center gap-3" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>已选 {checked.size} 项</span>
          <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
            {checked.size === visibleTasks.length ? '取消全选' : '全选'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={handleBatchExtend} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white" style={{ background: 'var(--color-info)' }}>延长3天</button>
            <button onClick={handleBatchDownload} disabled={downloadProgress.open} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}><Download size={14} /> {downloadProgress.open ? '处理中' : '下载'}</button>
            <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-4 py-2 rounded-2xl text-sm font-medium text-[var(--color-error)] hover:bg-[var(--color-error)]/10"><Trash2 size={14} /> 删除</button>
          </div>
        </div>
      )}
      <ChatInput ref={inputRef} onSubmit={handleSubmit} loading={loading} requestCost={requestCost} optimizeCost={optimizeCost} />
    </div>
  )

  return (
    <MainLayout dragProps={dragProps}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none" style={{ background: 'var(--bg-primary)', opacity: 0.92 }}>
          <div className="flex flex-col items-center gap-3">
            <div className="w-20 h-20 rounded-2xl border-2 border-dashed flex items-center justify-center" style={{ borderColor: 'var(--accent)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <p className="text-lg font-medium" style={{ color: 'var(--accent)' }}>拖放图片到此处上传</p>
          </div>
        </div>
      )}
      <div className="flex-shrink-0 px-4 pt-3 pb-1 overflow-visible">
      <div className="flex min-h-10 items-center gap-2 overflow-x-auto overflow-y-visible scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        <button onClick={() => navigate('/wallet')} className="flex h-8 flex-shrink-0 items-center gap-1.5 px-3 rounded-2xl text-sm font-semibold transition-all hover:scale-105" style={{ background: 'var(--accent)', color: '#fff' }}>
          <Coins size={15} />
          <span className="tabular-nums">{points}</span>
        </button>
        {isAdmin && userList.length > 0 && (
          <select
            value={selectedUserId || ''}
            onChange={e => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
            className="h-8 px-2 rounded-2xl text-xs border-0 outline-none"
            style={{ background: 'var(--border-color)', color: 'var(--text-primary)' }}
          >
            <option value="">全部用户</option>
            {userList.map(u => (
              <option key={u.id} value={u.id}>{u.nickname || u.username}</option>
            ))}
          </select>
        )}
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="搜索提示词..." />
        <button onClick={handleRefresh} disabled={refreshing}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl hover:bg-bg-hover transition-colors disabled:opacity-50"
          style={{ color: 'var(--text-secondary)' }}>
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <div ref={timeRangeMenuRef} className="relative flex-shrink-0">
          <button ref={timeRangeButtonRef} onClick={() => setTimeRangeOpen(v => !v)} className="flex h-8 items-center gap-1.5 rounded-2xl px-3 text-xs font-medium transition-colors hover:bg-bg-hover" style={{ background: 'var(--bg-active)', color: 'var(--text-primary)' }}>
            <span>{timeRangeOptions.find(v => v.k === timeRange)?.l || '近1天'}</span>
            <ChevronDown size={14} className={`transition-transform duration-200 ${timeRangeOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {selectMode ? (
          <button onClick={exitSelectMode} className="ml-auto flex h-8 items-center px-3 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
        ) : (
          <button onClick={() => setSelectMode(true)} className="ml-auto flex h-8 items-center px-3 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>选择</button>
        )}
      </div>
      </div>
      {loadError && <div className="mx-4 mt-2 px-3 py-2 rounded-2xl text-xs" style={{ background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: 'var(--color-warning)' }}>{loadError}</div>}
      {downloadProgress.open && <div className="fixed left-4 right-4 bottom-24 sm:left-auto sm:right-4 sm:bottom-6 sm:w-80 z-40 pointer-events-none"><div className="rounded-2xl p-4 border shadow-lg" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}><div className="flex items-center justify-between gap-3"><div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{downloadProgress.phase === 'zip' ? '正在打包 ZIP' : downloadProgress.phase === 'single' ? '正在逐个下载' : downloadProgress.phase === 'done' ? '处理完成' : '正在准备下载'}</div><div className="text-xs tabular-nums" style={{ color: 'var(--accent)' }}>{downloadProgress.percent}%</div></div><div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{downloadProgress.phase === 'zip' ? `已下载 ${downloadProgress.total}/${downloadProgress.total} 张，正在压缩` : `已处理 ${downloadProgress.current}/${downloadProgress.total} 张`}</div>{downloadProgress.filename && <div className="mt-1 text-[11px] truncate" style={{ color: 'var(--text-secondary)', opacity: 0.8 }}>{downloadProgress.filename}</div>}<div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--border-color)' }}><div className="h-full rounded-full transition-all duration-300" style={{ width: `${downloadProgress.percent}%`, background: 'var(--accent)' }} /></div></div></div>}
      <div ref={feedRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-56 lg:pb-6">
        {!loaded ? (
          <div className="pt-4"><CardGridSkeleton layoutMode={layoutMode} label="加载中..." /></div>
        ) : visibleTasks.length === 0 ? (
          showPortfolioEmptyState ? <div className="flex min-h-full items-center justify-center py-8 sm:py-12"><PortfolioShowcaseCard onUsePrompt={handleAddPrompt} /></div> : <div className="flex flex-col items-center justify-center h-full text-center py-20"><h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>当前筛选下没有记录</h2><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>换个时间范围，或者直接开始下一次生成</p></div>
        ) : (
          <div ref={cardGridRef} className={`${layoutMode === 'masonry' ? 'card-feed-masonry' : 'card-feed-grid'} pt-4`} style={{ position: 'relative' }}>
            {!feedLayoutReady && <div className="card-feed-loading-mask" />}
            {visibleTasks.map(task => <GenerationCard key={task.task_id} task={task} onAddImage={url => inputRef.current?.addImage(url)} onAddPrompt={handleAddPrompt} onAddToPromptLibrary={isAdmin?handleAddToPromptLibrary:undefined} onRetry={handleRetry} selectMode={selectMode} checked={checked.has(task.task_id) || dragSelected.has(String(task.task_id))} onToggleCheck={() => toggleCheck(task.task_id)} wasDraggedRef={wasDraggedRef} showUsername={isAdmin} username={task.username} thumbnailBlurred={!!thumbnailBlurMap[getThumbnailBlurItemKey(task)]} onToggleThumbnailBlur={() => { const k=getThumbnailBlurItemKey(task); setThumbnailBlurMap(prev => ({ ...prev, [k]: !prev[k] })) }} onViewDetail={() => handleCardViewDetail(task.task_id)} masonry={layoutMode === 'masonry'} nowTs={expiryNowTs} data-card-id={String(task.task_id)} />)}
            {selectionRect && selectionRect.width > 5 && selectionRect.height > 5 && (
              <div className="drag-selection-rect" style={{ position: 'fixed', left: selectionRect.left, top: selectionRect.top, width: selectionRect.width, height: selectionRect.height }} />
            )}
          </div>
        )}
      </div>
      {bottomDock}
      {timeRangeOpen && timeRangeMenuPos && createPortal(
        <div ref={timeRangePanelRef} className="fixed z-[120] rounded-2xl border p-1 shadow-lg" style={{ top: `${timeRangeMenuPos.top}px`, left: `${timeRangeMenuPos.left}px`, minWidth: `${timeRangeMenuPos.width}px`, transform: 'translateX(-100%)', background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
          {timeRangeOptions.map(({ k, l }) => (
            <button key={k} onClick={() => { setTimeRange(k); setTimeRangeOpen(false) }} className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${timeRange === k ? 'bg-[var(--bg-active)]' : 'hover:bg-bg-hover'}`} style={{ color: timeRange === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>
          ))}
        </div>,
        document.body
      )}

      {selectedCardIndex !== null && allDetailCards.length > 0 && allDetailCards[selectedCardIndex] && (() => {
        const currentCard = allDetailCards[selectedCardIndex]
        const currentShareId = currentCard?.square_image_id || squareIdMapRef.current[currentCard?.filename] || null
        const isShared = Boolean(currentShareId || currentCard?.is_permanent)
        return (
        <UnifiedDetailModal
          card={currentCard}
          cards={allDetailCards}
          currentIndex={selectedCardIndex}
          onNavigate={handleModalNavigate}
          onClose={() => { setSelectedCardIndex(null); setSelectedDetailTaskId(null) }}
          onUseImage={card => inputRef.current?.addImage(card.fullUrl)}
          onUsePrompt={handleAddPrompt}
          onAddToPromptLibrary={isAdmin ? handleAddToPromptLibrary : undefined}
          onShare={isShared ? undefined : handleDetailShare}
          onUnshare={isShared ? handleDetailUnshare : undefined}
          onExtend={handleDetailExtend}
          title="生成详情"
          allowMetadataEdit
          nowTs={expiryNowTs}
        />
        )
      })()}
      </div>
    </MainLayout>
  )
}

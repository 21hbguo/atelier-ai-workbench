import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Trash2, RefreshCw, Coins } from 'lucide-react'
import ChatInput from '../components/ChatInput'
import GenerationCard from '../components/GenerationCard'
import SearchInput from '../components/SearchInput'
import MainLayout from '../components/MainLayout'
import UnifiedDetailModal from '../components/UnifiedDetailModal'
import { useAppDialog } from '../components/AppDialogProvider'
import { useLayoutMode } from '../LayoutModeContext'
import { generateAPI, uploadAPI, taskAPI, imageAPI, squareAPI, adminAPI, pointsAPI, configAPI } from '../api'
import { readUser } from '../auth'

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
  const ts = Date.parse(String(value || '').replace(' ', 'T'))
  return Number.isNaN(ts) ? 0 : ts
}

export default function ChatPage() {
  const dialog = useAppDialog()
  const { layoutMode } = useLayoutMode()
  const [currentUser, setCurrentUser] = useState(() => readUser())
  const isAdmin = Boolean(currentUser?.is_admin)
  const activeStatuses = ['pending', 'queued', 'processing', 'running', 'generating']
  const activeCacheKey = currentUser?.id ? `active_tasks_${currentUser.id}` : 'active_tasks_guest'
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [timeRange, setTimeRange] = useState('1d')
  const [refreshing, setRefreshing] = useState(false)
  const [userList, setUserList] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [points, setPoints] = useState(currentUser?.points ?? 0)
  const [requestCost, setRequestCost] = useState(isAdmin ? 0 : 10)
  const [loadError, setLoadError] = useState('')
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [detailCards, setDetailCards] = useState([])
  const feedRef = useRef(null)
  const inputRef = useRef(null)
  const dragCounter = useRef(0)
  const recoveringRef = useRef(new Set())
  const squareIdMapRef = useRef({})
  const navigate = useNavigate()
  const timeRangeOptions = useMemo(() => ([{ k: '1d', l: '近1天' }, { k: '3d', l: '近3天' }, { k: '7d', l: '近7天' }, { k: 'all', l: '全部' }]), [])
  const visibleTasks = useMemo(() => {
    const now = Date.now()
    const limit = timeRange === 'all' ? 0 : timeRange === '1d' ? 24 * 60 * 60 * 1000 : timeRange === '3d' ? 3 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    return tasks.filter(t => {
      if (!limit) return true
      const ts = parseTaskTime(t.created_at)
      return ts > 0 ? now - ts <= limit : true
    })
  }, [tasks, timeRange])
  const loadCachedActiveTasks = useCallback(() => {
    try {
      const raw = localStorage.getItem(activeCacheKey)
      if (!raw) return []
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr)) return []
      return arr.filter(t => t?.task_id && !String(t.task_id).startsWith('pending-') && activeStatuses.includes(t.status))
    } catch {
      return []
    }
  }, [activeCacheKey])
  const saveCachedActiveTasks = useCallback((taskList) => {
    try {
      const arr = (Array.isArray(taskList) ? taskList : []).filter(t => t?.task_id && !String(t.task_id).startsWith('pending-') && activeStatuses.includes(t.status)).map(t => ({ task_id: t.task_id, status: t.status, progress: t.progress ?? 0, error: t.error || null, type: t.type || 'text', params: t.params || {}, prompt: t.prompt || '', created_at: t.created_at || '', started_at: t.started_at || '', completed_at: t.completed_at || null, result_urls: t.result_urls || [], _active: true }))
      localStorage.setItem(activeCacheKey, JSON.stringify(arr.slice(0, 100)))
    } catch {}
  }, [activeCacheKey])

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
    for (const s of myShares) {
      if (s?.filename && s?.id) latestMap[s.filename] = s.id
    }
    squareIdMapRef.current = { ...squareIdMapRef.current, ...latestMap }
    const taskImageFiles = new Set()
    for (const t of allTasks) {
      for (const u of (t.result_urls || [])) taskImageFiles.add(u.split('/').pop())
    }
    const expiryByFilename = Object.fromEntries(allImages.map(img => [img.filename, { expires_at: img.expires_at, is_permanent: !!img.is_permanent, days_left: img.days_left, expired: !!img.expired, width: img.width || null, height: img.height || null }]))
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
    }))
    if (q) {
      const lower = q.toLowerCase()
      orphans = orphans.filter(o => ((o.params?.prompt || '').toLowerCase().includes(lower)))
    }
    const merged = [...orphans, ...allTasks.map(t => { const fn = t.result_urls?.[0]?.split('/').pop(); const exp = getExpiryByFilename(expiryByFilename, fn); return { ...t, expires_at: exp.expires_at || t.expires_at, is_permanent: typeof exp.is_permanent === 'boolean' ? exp.is_permanent : t.is_permanent, days_left: typeof exp.days_left === 'number' ? exp.days_left : t.days_left, expired: typeof exp.expired === 'boolean' ? exp.expired : t.expired, width: exp.width || t.width || null, height: exp.height || t.height || null } })].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    setTasks(merged)
    const completedMerged = merged.filter(t => t.status === 'completed' && t.result_urls?.length)
    setDetailCards(completedMerged.flatMap(task => { const prompt = task.params?.prompt || task.prompt || ''; return task.result_urls.map((url, idx) => { const filename = url.split('/').pop(); const exp = getExpiryByFilename(expiryByFilename, filename); return { _type: 'image', _raw: { filename, metadata: { prompt, task_id: task.task_id, created_at: task.created_at, started_at: task.started_at, completed_at: task.completed_at, type: task.params?.image_urls?.length ? 'image' : 'text', size: task.params?.size, input_urls: task.params?.image_urls } }, id: `${task.task_id}-${idx}`, prompt, fullUrl: `/api/images/file/${filename}`, filename, expiresAt: exp.expires_at || task.expires_at || null, is_permanent: typeof exp.is_permanent === 'boolean' ? exp.is_permanent : !!task.is_permanent, daysLeft: typeof exp.days_left === 'number' ? exp.days_left : task.days_left, expired: typeof exp.expired === 'boolean' ? exp.expired : !!task.expired, square_image_id: squareIdMapRef.current[filename] || null } }) }))
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
    if (isAdmin) { setRequestCost(0); return }
    configAPI.get().then(res => setRequestCost(Math.max(0, Number(res.data?.points_cost_per_generation) || 10))).catch(() => setRequestCost(10))
  }, [isAdmin])

  useEffect(() => {
    if (loaded && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight
    }
  }, [loaded])

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

  const handleAddPrompt = useCallback((promptText) => {
    inputRef.current?.setPrompt(promptText)
  }, [])
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

  const shareImageToSquare = useCallback(async (filename, prompt, params, hasImages) => {
    try {
      const { data } = await squareAPI.share({
        filename,
        prompt,
        metadata: { size: params?.size, type: hasImages ? 'image' : 'text' },
      })
      markSquareShared(filename, data?.id)
    } catch {}
  }, [markSquareShared])
  const refreshPointsOnFailed = useCallback(() => {
    if (isAdmin) return
    pointsAPI.balance().then(res => {
      setPoints(res.data.points)
      const u = readUser()
      if (u) { u.points = res.data.points; localStorage.setItem('user', JSON.stringify(u)) }
      window.dispatchEvent(new Event('points-updated'))
    }).catch(() => {})
  }, [isAdmin])

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
          updateTask(taskId, { ...st, _active: false })
          if (shareToSquare && st.result_urls?.length) {
            shareImageToSquare(st.result_urls[0].split('/').pop(), prompt, params, hasImages)
          }
          return
        }
        if (st.status === 'failed') {
          updateTask(taskId, { ...st, _active: false })
          refreshPointsOnFailed()
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
            return
          }
        } else {
          errorCount += 1
          if (errorCount >= 5) {
            updateTask(taskId, { status: 'failed', error: '任务状态查询失败，请重试', _active: false })
            return
          }
        }
      }
    }
    updateTask(taskId, { status: 'failed', error: '生成超时（已等待15分钟）', _active: false })
    refreshPointsOnFailed()
  }, [updateTask, shareImageToSquare, refreshPointsOnFailed])

  const handleSubmit = useCallback(async ({ prompt, images, params, shareToSquare, rollCount = 1 }) => {
    const latestUser = readUser()
    const latestIsAdmin = Boolean(latestUser?.is_admin)
    const batchCount = Math.min(5, Math.max(1, Number(rollCount) || 1))
    if (batchCount > 1) {
      const cost = latestIsAdmin ? 0 : requestCost
      if (!await dialog.confirm(`本次将提交 ${batchCount} 次生成，预计消耗 ${batchCount * cost} 积分，是否继续？`)) return false
    }
    setLoading(true)
    try {
      const previewImages = images?.map(i => i.preview) || []
      const uploaded = images?.length > 0 ? await Promise.all(images.map(img => {
        if (img.file) return uploadAPI.upload(img.file)
        if (img.url && img.url.startsWith('http')) return Promise.resolve({ data: { url: img.url } })
        if (img.url) return fetch(img.url).then(r => { if (!r.ok) throw new Error(`fetch ${r.status}`); return r.blob() }).then(blob => uploadAPI.upload(new File([blob], img.name || 'ref.png', { type: blob.type || 'image/png' })))
        return Promise.resolve({ data: { url: '' } })
      })) : []
      const imageUrls = uploaded.map(r => r.data.url)
      const hasImages = imageUrls.length > 0
      const submitOne = async (index) => {
        const tempId = `pending-${Date.now()}-${index}`
        const tempTask = { task_id: tempId, status: 'processing', prompt, params: { prompt, size: params?.size || 'auto', share_to_square: !!shareToSquare }, previewImages, created_at: formatLocalTime(new Date()), started_at: formatLocalTime(new Date()), _active: true }
        setTasks(prev => { const next = [...prev, tempTask]; saveCachedActiveTasks(next); return next })
        scroll()
        const taskId = makeTaskId()
        try {
          const data = hasImages ? (await generateAPI.submitTextImage({ prompt, image_urls: imageUrls, size: params?.size || 'auto', model_id: params?.model_id, task_id: taskId, share_to_square: !!shareToSquare })).data : (await generateAPI.submitText({ prompt, size: params?.size || 'auto', model_id: params?.model_id, task_id: taskId, share_to_square: !!shareToSquare })).data
          if (!latestIsAdmin) {
            setPoints(p => Math.max(0, p - requestCost))
            const u = readUser()
            if (u) { u.points = Math.max(0, (u.points ?? 0) - requestCost); localStorage.setItem('user', JSON.stringify(u)) }
            window.dispatchEvent(new Event('points-updated'))
          }
          const realId = data.task_id
          setTasks(prev => { const next = prev.map(t => t.task_id === tempId ? { ...t, task_id: realId } : t); saveCachedActiveTasks(next); return next })
          if (data.status === 'completed') {
            updateTask(realId, { status: 'completed', result_urls: data.result_urls, _active: false })
            if (shareToSquare && data.result_urls?.length) shareImageToSquare(data.result_urls[0].split('/').pop(), prompt, params, hasImages)
            return { ok: true }
          }
          pollTask(realId, Date.now(), shareToSquare, prompt, params, hasImages)
          return { ok: true }
        } catch (e) {
          const msg = e.message || ''
          if (msg.includes('积分不足') || msg.includes('402')) {
            updateTask(tempId, { status: 'failed', error: '积分不足，请充值后重试', _active: false })
            return { ok: false, stop: true, message: '积分不足，请充值后重试' }
          }
          const isTimeout = msg.includes('timeout') || msg.includes('超时')
          if (isTimeout) {
            setTasks(prev => { const next = prev.map(t => t.task_id === tempId ? { ...t, task_id: taskId } : t); saveCachedActiveTasks(next); return next })
            try {
              const { data: st } = await taskAPI.get(taskId)
              if (st.status === 'completed') { updateTask(taskId, { ...st, _active: false }); if (shareToSquare && st.result_urls?.length) shareImageToSquare(st.result_urls[0].split('/').pop(), prompt, params, hasImages); return { ok: true } }
              if (st.status === 'failed') { updateTask(taskId, { ...st, _active: false }); refreshPointsOnFailed(); return { ok: false, message: st.error || '生成失败' } }
              updateTask(taskId, { ...st, _active: true }); pollTask(taskId, Date.now(), shareToSquare, prompt, params, hasImages); return { ok: true }
            } catch (se) {
              const sm = (se?.message || '').toLowerCase()
              if (sm.includes('404') || sm.includes('任务不存在') || sm.includes('not found')) { updateTask(taskId, { status: 'failed', error: '提交失败：后端未创建任务', _active: false }); return { ok: false, stop: true, message: '提交失败：后端未创建任务' } }
            }
            pollTask(taskId, Date.now(), shareToSquare, prompt, params, hasImages)
            return { ok: true }
          }
          updateTask(tempId, { status: 'failed', error: '提交失败: ' + msg, _active: false })
          return { ok: false, stop: false, message: msg }
        }
      }
      let success = 0
      let failed = 0
      for (let i = 0; i < batchCount; i++) {
        const r = await submitOne(i)
        if (r?.ok) success += 1
        else failed += 1
        if (r?.stop) break
      }
      if (batchCount > 1) dialog.alert(`已提交 ${success} 次${failed > 0 ? `，失败 ${failed} 次` : ''}`)
      return true
    } catch (e) {
      dialog.alert('上传失败: ' + (e?.message || '未知错误'))
      return false
    } finally {
      setLoading(false)
    }
  }, [dialog, pollTask, refreshPointsOnFailed, requestCost, scroll, shareImageToSquare, updateTask, saveCachedActiveTasks])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await refreshTasks()
    setRefreshing(false)
  }, [refreshTasks])

  const handleRetry = useCallback(async (taskId) => {
    try {
      await taskAPI.retry(taskId)
      refreshTasks()
    } catch {}
  }, [refreshTasks])

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

  const completedTasks = visibleTasks.filter(t => t.status === 'completed' && t.result_urls?.length)
  const visibleDetailCards = useMemo(() => {
    const ids = new Set(completedTasks.map(t => t.task_id))
    return detailCards.filter(c => ids.has(c?._raw?.metadata?.task_id))
  }, [completedTasks, detailCards])

  const handleCardViewDetail = useCallback((taskId) => {
    const idx = visibleDetailCards.findIndex(c => c?._raw?.metadata?.task_id === taskId)
    if (idx >= 0) setSelectedCardIndex(idx)
  }, [visibleDetailCards])

  const handleModalNavigate = useCallback((newIndex) => {
    setSelectedCardIndex(newIndex)
  }, [])
  const handleDetailShare = useCallback(async (card) => {
    try {
      const { data } = await squareAPI.share({ filename: card.filename, prompt: card.prompt || '', metadata: { size: card?._raw?.metadata?.size, type: card?._raw?.metadata?.type || 'text' } })
      markSquareShared(card.filename, data?.id)
      window.dispatchEvent(new Event('gallery-updated'))
    } catch (e) {
      dialog.alert(e?.response?.data?.detail || e.message || '分享失败')
    }
  }, [dialog, markSquareShared])
  const handleDetailUnshare = useCallback(async (card) => {
    const sid = card.square_image_id || squareIdMapRef.current[card.filename]
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
  }, [dialog])
  const handleExtendImages = useCallback(async (filenames) => {
    const uniq = [...new Set((filenames || []).filter(Boolean))]
    if (uniq.length === 0) { dialog.alert('没有可延长的图片'); return }
    try {
      const { data } = await imageAPI.extend(uniq)
      if (!isAdmin && typeof data.points === 'number') {
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
  }, [isAdmin, refreshTasks, dialog])
  const handleDetailExtend = useCallback(async (card) => {
    if (!await dialog.confirm('确定延长3天？将扣除2积分')) return
    await handleExtendImages([card.filename])
  }, [handleExtendImages, dialog])

  const toggleCheck = useCallback((taskId) => {
    setChecked(prev => { const next = new Set(prev); next.has(taskId) ? next.delete(taskId) : next.add(taskId); return next })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (checked.size === visibleTasks.length) setChecked(new Set())
    else setChecked(new Set(visibleTasks.map(t => t.task_id)))
  }, [checked.size, visibleTasks])

  const handleBatchDownload = useCallback(() => {
    for (const task of visibleTasks) {
      if (!checked.has(task.task_id)) continue
      for (const url of (task.result_urls || [])) {
        const a = document.createElement('a'); a.href = url; a.download = url.split('/').pop(); a.click()
      }
    }
  }, [checked, visibleTasks])

  const handleBatchDelete = useCallback(async () => {
      if (!await dialog.confirm(`确定删除选中的 ${checked.size} 项？`)) return
    let failed = 0
    for (const taskId of checked) {
      try {
        if (taskId.startsWith('img-')) {
          const filename = taskId.replace('img-', '')
          await imageAPI.delete(filename)
        } else {
          await taskAPI.delete(taskId)
        }
      } catch { failed += 1 }
    }
    setChecked(new Set()); setSelectMode(false)
    refreshTasks()
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
    if (!await dialog.confirm(`确定延长选中的 ${filenames.length} 张图片3天？将扣除 ${filenames.length * 2} 积分`)) return
    await handleExtendImages(filenames)
  }, [checked, visibleTasks, handleExtendImages, dialog])

  const exitSelectMode = useCallback(() => { setSelectMode(false); setChecked(new Set()) }, [])

  const handleDragEnter = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      dragCounter.current++
      setDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) setDragging(false)
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(png|jpe?g|webp)$/i.test(f.name))
    if (files.length > 0) inputRef.current?.addFiles(files)
  }, [])

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
          <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
            {checked.size === visibleTasks.length ? '取消全选' : '全选'}
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={handleBatchExtend} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--color-info)' }}>延长3天</button>
            <button onClick={handleBatchDownload} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Download size={14} /> 下载</button>
            <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-[var(--color-error)] hover:bg-[var(--color-error)]/10"><Trash2 size={14} /> 删除</button>
          </div>
        </div>
      )}
      <ChatInput ref={inputRef} onSubmit={handleSubmit} loading={loading} requestCost={requestCost} />
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
      <div className="flex-shrink-0 flex min-h-10 items-center gap-2 px-4 pt-3 pb-1 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        <button onClick={() => navigate('/wallet')} className="flex h-8 flex-shrink-0 items-center gap-1.5 px-3 rounded-lg text-sm font-semibold transition-all hover:scale-105" style={{ background: 'var(--accent)', color: '#fff' }}>
          <Coins size={15} />
          <span className="tabular-nums">{points}</span>
        </button>
        {isAdmin && userList.length > 0 && (
          <select
            value={selectedUserId || ''}
            onChange={e => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
            className="h-8 px-2 rounded-lg text-xs border-0 outline-none"
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
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
          style={{ color: 'var(--text-secondary)' }}>
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <div className="flex h-8 flex-shrink-0 items-center gap-1 rounded-lg p-0.5" style={{ background: 'var(--bg-active)' }}>
          {timeRangeOptions.map(({ k, l }) => (
            <button key={k} onClick={() => setTimeRange(k)} className={`flex h-7 items-center px-3 rounded-md text-xs font-medium transition-colors ${timeRange === k ? 'bg-[var(--bg-card)] shadow-sm' : ''}`} style={{ color: timeRange === k ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{l}</button>
          ))}
        </div>
        {selectMode ? (
          <button onClick={exitSelectMode} className="ml-auto flex h-8 items-center px-3 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>取消</button>
        ) : (
          <button onClick={() => setSelectMode(true)} className="ml-auto flex h-8 items-center px-3 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>选择</button>
        )}
      </div>
      {loadError && <div className="mx-4 mt-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: 'var(--color-warning)' }}>{loadError}</div>}
      <div ref={feedRef} className="flex-1 min-h-0 overflow-y-auto px-4 pb-56 lg:pb-6">
        {!loaded ? (
          <div className="flex justify-center items-center h-full"><div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
        ) : visibleTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>开始生成你的图像</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{tasks.length === 0 ? '输入提示词或上传参考图，AI 为你创作' : '当前时间筛选下没有记录'}</p>
          </div>
        ) : (
          <div className={`${layoutMode === 'masonry' ? 'card-feed-masonry' : 'card-feed-grid'} pt-4`}>
            {visibleTasks.map(task => <GenerationCard key={task.task_id} task={task} onAddImage={url => inputRef.current?.addImage(url)} onAddPrompt={handleAddPrompt} onRetry={handleRetry} selectMode={selectMode} checked={checked.has(task.task_id)} onToggleCheck={() => toggleCheck(task.task_id)} showUsername={isAdmin} username={task.username} onViewDetail={() => handleCardViewDetail(task.task_id)} masonry={layoutMode === 'masonry'} />)}
          </div>
        )}
      </div>
      {bottomDock}

      {selectedCardIndex !== null && visibleDetailCards.length > 0 && visibleDetailCards[selectedCardIndex] && (() => {
        const currentCard = visibleDetailCards[selectedCardIndex]
        const currentShareId = currentCard?.square_image_id || squareIdMapRef.current[currentCard?.filename] || null
        const isShared = Boolean(currentShareId || currentCard?.is_permanent)
        return (
        <UnifiedDetailModal
          card={currentCard}
          cards={visibleDetailCards}
          currentIndex={selectedCardIndex}
          onNavigate={handleModalNavigate}
          onClose={() => setSelectedCardIndex(null)}
          onUseImage={card => inputRef.current?.addImage(card.fullUrl)}
          onUsePrompt={handleAddPrompt}
          onShare={isShared ? undefined : handleDetailShare}
          onUnshare={isShared ? handleDetailUnshare : undefined}
          onExtend={handleDetailExtend}
          title="生成详情"
          allowMetadataEdit
        />
        )
      })()}
      </div>
    </MainLayout>
  )
}

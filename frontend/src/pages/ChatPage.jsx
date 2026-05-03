import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Trash2, RefreshCw, Coins } from 'lucide-react'
import ChatInput from '../components/ChatInput'
import GenerationCard from '../components/GenerationCard'
import SearchInput from '../components/SearchInput'
import MainLayout from '../components/MainLayout'
import UnifiedDetailModal from '../components/UnifiedDetailModal'
import { generateAPI, uploadAPI, taskAPI, imageAPI, squareAPI, adminAPI, pointsAPI } from '../api'
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

export default function ChatPage() {
  const user = readUser()
  const isAdmin = Boolean(user?.is_admin)
  const activeStatuses = ['pending', 'queued', 'processing', 'running', 'generating']
  const activeCacheKey = user?.id ? `active_tasks_${user.id}` : 'active_tasks_guest'
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [userList, setUserList] = useState([])
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [points, setPoints] = useState(user?.points ?? 0)
  const [loadError, setLoadError] = useState('')
  const [selectedCardIndex, setSelectedCardIndex] = useState(null)
  const [detailCards, setDetailCards] = useState([])
  const feedRef = useRef(null)
  const inputRef = useRef(null)
  const dragCounter = useRef(0)
  const recoveringRef = useRef(new Set())
  const navigate = useNavigate()
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
      const arr = (Array.isArray(taskList) ? taskList : []).filter(t => t?.task_id && activeStatuses.includes(t.status)).map(t => ({ task_id: t.task_id, status: t.status, progress: t.progress ?? 0, error: t.error || null, type: t.type || 'text', params: t.params || {}, prompt: t.prompt || '', created_at: t.created_at || '', started_at: t.started_at || '', completed_at: t.completed_at || null, result_urls: t.result_urls || [], _active: true }))
      localStorage.setItem(activeCacheKey, JSON.stringify(arr.slice(0, 100)))
    } catch {}
  }, [activeCacheKey])

  const refreshTasks = useCallback(async () => {
    const uid = isAdmin ? selectedUserId : undefined
    const q = searchQuery || undefined
    let allTasks
    let allImages
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
    const taskImageFiles = new Set()
    for (const t of allTasks) {
      for (const u of (t.result_urls || [])) taskImageFiles.add(u.split('/').pop())
    }
    const expiryByFilename = Object.fromEntries(allImages.map(img => [img.filename, { expires_at: img.expires_at, is_permanent: !!img.is_permanent, days_left: img.days_left, expired: !!img.expired }]))
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
    }))
    if (q) {
      const lower = q.toLowerCase()
      orphans = orphans.filter(o => ((o.params?.prompt || '').toLowerCase().includes(lower)))
    }
    const merged = [...orphans, ...allTasks.map(t => { const fn = t.result_urls?.[0]?.split('/').pop(); const exp = getExpiryByFilename(expiryByFilename, fn); return { ...t, expires_at: exp.expires_at || t.expires_at, is_permanent: typeof exp.is_permanent === 'boolean' ? exp.is_permanent : t.is_permanent, days_left: typeof exp.days_left === 'number' ? exp.days_left : t.days_left, expired: typeof exp.expired === 'boolean' ? exp.expired : t.expired } })].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    setTasks(merged)
    const completedMerged = merged.filter(t => t.status === 'completed' && t.result_urls?.length)
    setDetailCards(completedMerged.flatMap(task => { const prompt = task.params?.prompt || task.prompt || ''; return task.result_urls.map((url, idx) => { const filename = url.split('/').pop(); const exp = getExpiryByFilename(expiryByFilename, filename); return { _type: 'image', _raw: { filename, metadata: { prompt, task_id: task.task_id, created_at: task.created_at, started_at: task.started_at, completed_at: task.completed_at, type: task.params?.image_urls?.length ? 'image' : 'text', size: task.params?.size, input_urls: task.params?.image_urls } }, id: `${task.task_id}-${idx}`, prompt, fullUrl: `/api/images/file/${filename}`, filename, expiresAt: exp.expires_at || task.expires_at || null, is_permanent: typeof exp.is_permanent === 'boolean' ? exp.is_permanent : !!task.is_permanent, daysLeft: typeof exp.days_left === 'number' ? exp.days_left : task.days_left, expired: typeof exp.expired === 'boolean' ? exp.expired : !!task.expired } }) }))
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
    pointsAPI.balance().then(res => setPoints(res.data.points)).catch(() => {})
    const handleUpdate = () => {
      const u = readUser()
      if (u) setPoints(u.points ?? 0)
    }
    window.addEventListener('points-updated', handleUpdate)
    return () => window.removeEventListener('points-updated', handleUpdate)
  }, [])

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

  const scroll = useCallback(() => {
    const el = feedRef.current
    if (el) setTimeout(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }), 50)
  }, [])

  const handleAddPrompt = useCallback((promptText) => {
    inputRef.current?.setPrompt(promptText)
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
      await squareAPI.share({
        filename,
        prompt,
        metadata: { size: params?.size, type: hasImages ? 'image' : 'text' },
      })
    } catch {}
  }, [])
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

  const handleSubmit = useCallback(async ({ prompt, images, params, shareToSquare }) => {
    setLoading(true)
    const tempId = 'pending-' + Date.now()
    const previewImages = images?.map(i => i.preview) || []
    const tempTask = {
      task_id: tempId,
      status: 'processing',
      prompt,
      params: { prompt, size: params?.size || 'auto', share_to_square: !!shareToSquare },
      previewImages,
      created_at: new Date().toLocaleString('zh-CN'),
      started_at: formatLocalTime(new Date()),
      _active: true,
    }
    setTasks(prev => {
      const next = [...prev, tempTask]
      saveCachedActiveTasks(next)
      return next
    })
    scroll()

    let imageUrls = []
    if (images?.length > 0) {
      try {
        const results = await Promise.all(images.map(img =>
          img.url ? Promise.resolve({ data: { url: img.url } }) : uploadAPI.upload(img.file)
        ))
        imageUrls = results.map(r => r.data.url)
      } catch (e) {
        updateTask(tempId, { status: 'failed', error: '上传失败: ' + e.message, _active: false })
        setLoading(false)
        return
      }
    }

    const hasImages = imageUrls.length > 0
    const taskId = makeTaskId()

    try {
      const data = hasImages
        ? (await generateAPI.submitTextImage({ prompt, image_urls: imageUrls, size: params?.size || 'auto', task_id: taskId, share_to_square: !!shareToSquare })).data
        : (await generateAPI.submitText({ prompt, size: params?.size || 'auto', task_id: taskId, share_to_square: !!shareToSquare })).data

      if (!isAdmin) {
        setPoints(p => Math.max(0, p - 10))
        const u = readUser()
        if (u) { u.points = Math.max(0, (u.points ?? 0) - 10); localStorage.setItem('user', JSON.stringify(u)) }
        window.dispatchEvent(new Event('points-updated'))
      }

      const realId = data.task_id
      setTasks(prev => {
        const next = prev.map(t => t.task_id === tempId ? { ...t, task_id: realId } : t)
        saveCachedActiveTasks(next)
        return next
      })
      setLoading(false)

      if (data.status === 'completed') {
        updateTask(realId, { status: 'completed', result_urls: data.result_urls, _active: false })
        if (shareToSquare && data.result_urls?.length) {
          shareImageToSquare(data.result_urls[0].split('/').pop(), prompt, params, hasImages)
        }
        return
      }

      pollTask(realId, Date.now(), shareToSquare, prompt, params, hasImages)
    } catch (e) {
      if (e.message?.includes('积分不足') || e.message?.includes('402')) {
        updateTask(tempId, { status: 'failed', error: '积分不足，请充值后重试', _active: false })
        setLoading(false)
        return
      }
      const isTimeout = e.message?.includes('timeout') || e.message?.includes('超时')
      if (isTimeout) {
        setTasks(prev => {
          const next = prev.map(t => t.task_id === tempId ? { ...t, task_id: taskId } : t)
          saveCachedActiveTasks(next)
          return next
        })
        try {
          const { data: st } = await taskAPI.get(taskId)
          if (st.status === 'completed') {
            updateTask(taskId, { ...st, _active: false })
            if (shareToSquare && st.result_urls?.length) shareImageToSquare(st.result_urls[0].split('/').pop(), prompt, params, imageUrls.length > 0)
            setLoading(false)
            return
          }
          if (st.status === 'failed') {
            updateTask(taskId, { ...st, _active: false })
            refreshPointsOnFailed()
            setLoading(false)
            return
          }
          updateTask(taskId, { ...st, _active: true })
        } catch (se) {
          const sm = (se?.message || '').toLowerCase()
          if (sm.includes('404') || sm.includes('任务不存在') || sm.includes('not found')) {
            updateTask(taskId, { status: 'failed', error: '提交失败：后端未创建任务', _active: false })
            setLoading(false)
            return
          }
        }
        pollTask(taskId, Date.now(), shareToSquare, prompt, params, imageUrls.length > 0)
      } else {
        updateTask(tempId, { status: 'failed', error: '提交失败: ' + e.message, _active: false })
      }
      setLoading(false)
    }
  }, [scroll, updateTask, pollTask, shareImageToSquare, refreshPointsOnFailed, saveCachedActiveTasks])

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
      if (['pending', 'queued', 'processing', 'running', 'generating'].includes(t.status) && !t._active && !recoveringRef.current.has(t.task_id)) {
        recoveringRef.current.add(t.task_id)
        updateTask(t.task_id, { _active: true })
        const p = t.params || {}
        pollTask(t.task_id, Date.now(), !!p.share_to_square, p.prompt || '', p, t.type === 'text_image')
      }
    }
  }, [tasks, pollTask, updateTask])

  const filtered = tasks

  const completedTasks = filtered.filter(t => t.status === 'completed' && t.result_urls?.length)

  const handleCardViewDetail = useCallback((taskIndex) => {
    const completedIndex = completedTasks.findIndex(t => t.task_id === taskIndex)
    if (completedIndex >= 0) {
      let imageIndex = 0
      for (let i = 0; i < completedIndex; i++) {
        imageIndex += completedTasks[i].result_urls.length
      }
      setSelectedCardIndex(imageIndex)
    }
  }, [completedTasks])

  const handleModalNavigate = useCallback((newIndex) => {
    setSelectedCardIndex(newIndex)
  }, [])
  const handleDetailShare = useCallback(async (card) => {
    try {
      await squareAPI.share({ filename: card.filename, prompt: card.prompt || '', metadata: { size: card?._raw?.metadata?.size, type: card?._raw?.metadata?.type || 'text' } })
      await refreshTasks()
      window.dispatchEvent(new Event('gallery-updated'))
    } catch (e) {
      alert(e?.message || '分享失败')
    }
  }, [refreshTasks])
  const handleExtendImages = useCallback(async (filenames) => {
    const uniq = [...new Set((filenames || []).filter(Boolean))]
    if (uniq.length === 0) { alert('没有可延长的图片'); return }
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
      alert(msg)
    } catch (e) {
      alert(e?.message || '延长失败')
    }
  }, [isAdmin, refreshTasks])
  const handleDetailExtend = useCallback(async (card) => { await handleExtendImages([card.filename]) }, [handleExtendImages])

  const toggleCheck = useCallback((taskId) => {
    setChecked(prev => { const next = new Set(prev); next.has(taskId) ? next.delete(taskId) : next.add(taskId); return next })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (checked.size === filtered.length) setChecked(new Set())
    else setChecked(new Set(filtered.map(t => t.task_id)))
  }, [checked.size, filtered])

  const handleBatchDownload = useCallback(() => {
    for (const task of filtered) {
      if (!checked.has(task.task_id)) continue
      for (const url of (task.result_urls || [])) {
        const a = document.createElement('a'); a.href = url; a.download = url.split('/').pop(); a.click()
      }
    }
  }, [checked, filtered])

  const handleBatchDelete = useCallback(async () => {
    if (!confirm(`确定删除选中的 ${checked.size} 项？`)) return
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
    if (failed > 0) alert(`${failed} 项删除失败`)
  }, [checked, refreshTasks])
  const handleBatchExtend = useCallback(async () => {
    const filenames = []
    for (const task of filtered) {
      if (!checked.has(task.task_id)) continue
      for (const url of (task.result_urls || [])) filenames.push(url.split('/').pop())
    }
    await handleExtendImages(filenames)
  }, [checked, filtered, handleExtendImages])

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

  return (
    <MainLayout dragProps={dragProps}>
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
      <div className="flex items-center gap-2 px-4 pt-3 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
        <button onClick={() => navigate('/wallet')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all hover:scale-105" style={{ background: 'var(--accent)', color: 'white' }}>
          <Coins size={16} />
          <span>{points}</span>
        </button>
        {isAdmin && userList.length > 0 && (
          <select
            value={selectedUserId || ''}
            onChange={e => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
            className="px-2 py-1.5 rounded-lg text-xs border-0 outline-none"
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
          className="p-1.5 rounded-lg hover:bg-black/5 transition-colors disabled:opacity-50"
          style={{ color: 'var(--text-secondary)' }}>
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
        {selectMode ? (
          <button onClick={exitSelectMode} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
        ) : (
          <button onClick={() => setSelectMode(true)} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>选择</button>
        )}
      </div>
      {loadError && <div className="mx-4 mt-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(245,158,11,.12)', color: '#b45309' }}>{loadError}</div>}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 pb-6">
        {!loaded ? (
          <div className="flex justify-center items-center h-full"><div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>开始生成你的图像</h2>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>输入提示词或上传参考图，AI 为你创作</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pt-4">
            {filtered.map(task => <GenerationCard key={task.task_id} task={task} onAddImage={url => inputRef.current?.addImage(url)} onAddPrompt={handleAddPrompt} onRetry={handleRetry} selectMode={selectMode} checked={checked.has(task.task_id)} onToggleCheck={() => toggleCheck(task.task_id)} showUsername={isAdmin} username={task.username} onViewDetail={() => handleCardViewDetail(task.task_id)} />)}
          </div>
        )}
      </div>
      {selectMode && checked.size > 0 && (
        <div className="border-t px-4 py-3 flex items-center gap-3" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>已选 {checked.size} 项</span>
          <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>
            {checked.size === filtered.length ? '取消全选' : '全选'}
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={handleBatchExtend} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: '#2563eb' }}>延长3天</button>
            <button onClick={handleBatchDownload} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Download size={14} /> 下载</button>
            <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /> 删除</button>
          </div>
        </div>
      )}
      <ChatInput ref={inputRef} onSubmit={handleSubmit} loading={loading} />
      <div className="text-center text-[10px] -mt-1" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
        每次请求消耗10积分，失败将退还
      </div>

      {selectedCardIndex !== null && detailCards.length > 0 && detailCards[selectedCardIndex] && (
        <UnifiedDetailModal
          card={detailCards[selectedCardIndex]}
          cards={detailCards}
          currentIndex={selectedCardIndex}
          onNavigate={handleModalNavigate}
          onClose={() => setSelectedCardIndex(null)}
          onUseImage={card => inputRef.current?.addImage(card.fullUrl)}
          onUsePrompt={handleAddPrompt}
          onShare={handleDetailShare}
          onExtend={handleDetailExtend}
          title="生成详情"
          allowMetadataEdit
        />
      )}
    </MainLayout>
  )
}

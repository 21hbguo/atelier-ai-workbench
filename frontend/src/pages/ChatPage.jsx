import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Trash2, RefreshCw, Coins } from 'lucide-react'
import ChatInput from '../components/ChatInput'
import GenerationCard from '../components/GenerationCard'
import SearchInput from '../components/SearchInput'
import MainLayout from '../components/MainLayout'
import ImageDetailModal from '../components/ImageDetailModal'
import { generateAPI, uploadAPI, taskAPI, imageAPI, squareAPI, adminAPI, pointsAPI } from '../api'

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

export default function ChatPage() {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const isAdmin = Boolean(user?.is_admin)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
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
  const feedRef = useRef(null)
  const inputRef = useRef(null)
  const dragCounter = useRef(0)
  const navigate = useNavigate()

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
      if (!loaded) setTasks([])
      if (!loaded) setLoaded(true)
      return
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
    let orphans = allImages.filter(img => !taskImageFiles.has(img.filename)).map(img => ({
      task_id: 'img-' + img.filename,
      status: 'completed',
      result_urls: [img.url],
      params: img.metadata || {},
      created_at: img.created_at,
      started_at: img.created_at,
      completed_at: img.created_at,
      username: img.username || '',
    }))
    if (q) {
      const lower = q.toLowerCase()
      orphans = orphans.filter(o => ((o.params?.prompt || '').toLowerCase().includes(lower)))
    }
    const merged = [...orphans, ...allTasks].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    setTasks(merged)
    if (!loaded) setLoaded(true)
  }, [loaded, isAdmin, selectedUserId, searchQuery])

  useEffect(() => { refreshTasks() }, [refreshTasks])

  useEffect(() => {
    if (!isAdmin) return
    adminAPI.users(1, 100).then(({ data }) => setUserList(data.users || [])).catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    pointsAPI.balance().then(res => setPoints(res.data.points)).catch(() => {})
    const handleUpdate = () => {
      const u = JSON.parse(localStorage.getItem('user') || 'null')
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
    setTasks(prev => prev.map(t => t.task_id === taskId ? { ...t, ...updates } : t))
  }, [])

  const shareImageToSquare = useCallback(async (filename, prompt, params, hasImages) => {
    try {
      await squareAPI.share({
        filename,
        prompt,
        metadata: { size: params?.size, type: hasImages ? 'image' : 'text' },
      })
    } catch {}
  }, [])

  const pollTask = useCallback(async (taskId, startTime, shareToSquare, prompt, params, hasImages) => {
    const maxAttempts = 40
    const getDelay = (attempt) => Math.min(2000 + attempt * 500, 10000)

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, getDelay(attempt)))
      try {
        const { data: st } = await taskAPI.get(taskId)
        if (st.status === 'completed') {
          updateTask(taskId, { ...st, _active: false })
          if (shareToSquare && st.result_urls?.length) {
            shareImageToSquare(st.result_urls[0].split('/').pop(), prompt, params, hasImages)
          }
          return
        }
        if (st.status === 'failed') {
          updateTask(taskId, { ...st, _active: false })
          if (!isAdmin) {
            pointsAPI.balance().then(res => {
              setPoints(res.data.points)
              const u = JSON.parse(localStorage.getItem('user') || 'null')
              if (u) { u.points = res.data.points; localStorage.setItem('user', JSON.stringify(u)) }
              window.dispatchEvent(new Event('points-updated'))
            }).catch(() => {})
          }
          return
        }
        updateTask(taskId, st)
      } catch { continue }
    }
    updateTask(taskId, { status: 'failed', error: '生成超时', _active: false })
  }, [updateTask, shareImageToSquare])

  const handleSubmit = useCallback(async ({ prompt, images, params, shareToSquare }) => {
    setLoading(true)
    const tempId = 'pending-' + Date.now()
    const previewImages = images?.map(i => i.preview) || []
    const tempTask = {
      task_id: tempId,
      status: 'processing',
      prompt,
      params: { prompt, size: params?.size || 'auto' },
      previewImages,
      created_at: new Date().toLocaleString('zh-CN'),
      started_at: formatLocalTime(new Date()),
      _active: true,
    }
    setTasks(prev => [...prev, tempTask])
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
    const taskId = crypto.randomUUID()

    try {
      const data = hasImages
        ? (await generateAPI.submitTextImage({ prompt, image_urls: imageUrls, size: params?.size || 'auto', task_id: taskId })).data
        : (await generateAPI.submitText({ prompt, size: params?.size || 'auto', task_id: taskId })).data

      if (!isAdmin) {
        setPoints(p => Math.max(0, p - 10))
        const u = JSON.parse(localStorage.getItem('user') || 'null')
        if (u) { u.points = Math.max(0, (u.points ?? 0) - 10); localStorage.setItem('user', JSON.stringify(u)) }
        window.dispatchEvent(new Event('points-updated'))
      }

      const realId = data.task_id
      setTasks(prev => prev.map(t => t.task_id === tempId ? { ...t, task_id: realId } : t))
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
        setTasks(prev => prev.map(t => t.task_id === tempId ? { ...t, task_id: taskId } : t))
        pollTask(taskId, Date.now(), shareToSquare, prompt, params, imageUrls.length > 0)
      } else {
        updateTask(tempId, { status: 'failed', error: '提交失败: ' + e.message, _active: false })
      }
      setLoading(false)
    }
  }, [scroll, updateTask, pollTask, shareImageToSquare])

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

  const filtered = filter === 'all' ? tasks
    : filter === 'processing' ? tasks.filter(t => t.status === 'processing' || t.status === 'queued')
    : tasks.filter(t => t.status === filter)

  const completedTasks = filtered.filter(t => t.status === 'completed' && t.result_urls?.length)

  const allImages = completedTasks.flatMap(task => {
    const prompt = task.params?.prompt || task.prompt || ''
    return task.result_urls.map(url => ({
      url: `/api/images/file/${url.split('/').pop()}`,
      filename: url.split('/').pop(),
      metadata: {
        prompt,
        task_id: task.task_id,
        created_at: task.created_at,
        started_at: task.started_at,
        completed_at: task.completed_at,
        type: task.params?.image_urls?.length ? 'image' : 'text',
        size: task.params?.size,
        input_urls: task.params?.image_urls,
      },
    }))
  })

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
    for (const taskId of checked) {
      try {
        if (taskId.startsWith('img-')) {
          const filename = taskId.replace('img-', '')
          await imageAPI.delete(filename)
        } else {
          await taskAPI.delete(taskId)
        }
      } catch {}
    }
    setChecked(new Set()); setSelectMode(false)
    refreshTasks()
    window.dispatchEvent(new Event('gallery-updated'))
  }, [checked, refreshTasks])

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
      <div className="flex items-center gap-2 px-4 pt-3">
        {[{ k: 'all', l: '全部' }, { k: 'completed', l: '已完成' }, { k: 'processing', l: '生成中' }, { k: 'failed', l: '失败' }].map(({ k, l }) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === k ? 'bg-accent/10' : 'hover:bg-black/5'}`}
            style={{ color: filter === k ? 'var(--accent)' : 'var(--text-secondary)' }}>{l}</button>
        ))}
        {isAdmin && userList.length > 0 && (
          <select
            value={selectedUserId || ''}
            onChange={e => setSelectedUserId(e.target.value ? Number(e.target.value) : null)}
            className="ml-1 px-2 py-1.5 rounded-lg text-xs border-0 outline-none"
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
        <button onClick={() => navigate('/wallet')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5 transition-colors" style={{ color: 'var(--accent)' }}>
          <Coins size={14} />
          <span>{points}</span>
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
            <button onClick={handleBatchDownload} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}><Download size={14} /> 下载</button>
            <button onClick={handleBatchDelete} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={14} /> 删除</button>
          </div>
        </div>
      )}
      <div className="text-center text-xs pb-1" style={{ color: 'var(--text-secondary)' }}>
        每次请求消耗10积分，失败将退还
      </div>
      <ChatInput ref={inputRef} onSubmit={handleSubmit} loading={loading} />

      {selectedCardIndex !== null && allImages.length > 0 && (
        <ImageDetailModal
          image={allImages[selectedCardIndex]}
          images={allImages}
          currentIndex={selectedCardIndex}
          onNavigate={handleModalNavigate}
          onClose={() => setSelectedCardIndex(null)}
          onAddImage={url => inputRef.current?.addImage(url)}
          onAddPrompt={handleAddPrompt}
          title="生成详情"
        />
      )}
    </MainLayout>
  )
}

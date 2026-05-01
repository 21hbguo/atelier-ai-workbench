import { useState, useEffect, useRef, useCallback } from 'react'
import { Menu, Download, Trash2, Check } from 'lucide-react'
import ChatInput from '../components/ChatInput'
import GenerationCard from '../components/GenerationCard'
import Sidebar from '../components/Sidebar'
import { generateAPI, uploadAPI, taskAPI, imageAPI, squareAPI } from '../api'

function formatLocalTime(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState(new Set())
  const feedRef = useRef(null)
  const inputRef = useRef(null)
  const dragCounter = useRef(0)

  const refreshTasks = useCallback(async () => {
    try {
      const [taskRes, imgRes] = await Promise.all([taskAPI.list(50), imageAPI.list(1, 100)])
      const allTasks = taskRes.data
      const allImages = imgRes.data.images || []
      const taskImageFiles = new Set()
      for (const t of allTasks) {
        for (const u of (t.result_urls || [])) taskImageFiles.add(u.split('/').pop())
      }
      const orphans = allImages.filter(img => !taskImageFiles.has(img.filename)).map(img => ({
        task_id: 'img-' + img.filename,
        status: 'completed',
        result_urls: [img.url],
        params: img.metadata || {},
        created_at: img.created_at,
        started_at: img.created_at,
        completed_at: img.created_at,
      }))
      const merged = [...orphans, ...allTasks].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      setTasks(merged)
      if (!loaded) setLoaded(true)
    } catch {}
  }, [loaded])

  useEffect(() => { refreshTasks() }, [refreshTasks])

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

  const updateTask = useCallback((taskId, updates) => {
    setTasks(prev => prev.map(t => t.task_id === taskId ? { ...t, ...updates } : t))
  }, [])

  const pollTask = useCallback(async (taskId, startTime, shareToSquare, prompt, params, hasImages) => {
    const maxAttempts = 80
    await new Promise(r => setTimeout(r, 10000))

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const elapsed = (Date.now() - startTime) / 1000
      const delay = elapsed < 30 ? 10000 : elapsed < 60 ? 5000 : 3000
      await new Promise(r => setTimeout(r, delay))
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
          return
        }
        updateTask(taskId, st)
      } catch { continue }
    }
    updateTask(taskId, { status: 'failed', error: '生成超时', _active: false })
  }, [updateTask, shareImageToSquare])

  const shareImageToSquare = useCallback(async (filename, prompt, params, hasImages) => {
    try {
      await squareAPI.share({
        filename,
        prompt,
        metadata: { size: params?.size, type: hasImages ? 'image' : 'text' },
      })
    } catch {}
  }, [])

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

    try {
      const hasImages = imageUrls.length > 0
      const data = hasImages
        ? (await generateAPI.submitTextImage({ prompt, image_urls: imageUrls, size: params?.size || 'auto' })).data
        : (await generateAPI.submitText({ prompt, size: params?.size || 'auto' })).data

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
      updateTask(tempId, { status: 'failed', error: '提交失败: ' + e.message, _active: false })
      setLoading(false)
    }
  }, [scroll, updateTask, pollTask, shareImageToSquare])

  const handleRetry = useCallback(async (taskId) => {
    try {
      await taskAPI.retry(taskId)
      refreshTasks()
    } catch {}
  }, [refreshTasks])

  const filtered = filter === 'all' ? tasks
    : filter === 'processing' ? tasks.filter(t => t.status === 'processing' || t.status === 'queued')
    : tasks.filter(t => t.status === filter)

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

  return (
    <div className="flex h-screen overflow-hidden"
      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
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
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b lg:hidden" style={{ borderColor: 'var(--border-color)' }}>
          <button onClick={() => setSidebarOpen(true)} style={{ color: 'var(--text-primary)' }}><Menu size={20} /></button>
          <h1 className="font-medium" style={{ color: 'var(--text-primary)' }}>AI 图像生成</h1>
        </div>
        <div className="flex items-center gap-2 px-4 pt-3">
          {[{ k: 'all', l: '全部' }, { k: 'completed', l: '已完成' }, { k: 'processing', l: '生成中' }, { k: 'failed', l: '失败' }].map(({ k, l }) => (
            <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === k ? 'bg-accent/10' : 'hover:bg-black/5'}`}
              style={{ color: filter === k ? 'var(--accent)' : 'var(--text-secondary)' }}>{l}</button>
          ))}
          {selectMode ? (
            <button onClick={exitSelectMode} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>取消</button>
          ) : (
            <button onClick={() => setSelectMode(true)} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-black/5" style={{ color: 'var(--text-secondary)' }}>选择</button>
          )}
        </div>
        <div ref={feedRef} className="flex-1 overflow-y-auto px-4 pb-6">
          {!loaded ? (
            <div className="flex justify-center items-center h-full"><div className="w-8 h-8 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>开始生成你的图像</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>输入提示词或上传参考图，AI 为你创作</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 pt-4">
              {filtered.map(task => <GenerationCard key={task.task_id} task={task} onAddImage={url => inputRef.current?.addImage(url)} onRetry={handleRetry} selectMode={selectMode} checked={checked.has(task.task_id)} onToggleCheck={() => toggleCheck(task.task_id)} />)}
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
        <ChatInput ref={inputRef} onSubmit={handleSubmit} loading={loading} />
      </div>
    </div>
  )
}

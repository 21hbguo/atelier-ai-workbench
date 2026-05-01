import { useState, useRef, useCallback } from 'react'
import { Menu } from 'lucide-react'
import ChatInput from '../components/ChatInput'
import MessageBubble from '../components/MessageBubble'
import Sidebar from '../components/Sidebar'
import { generateAPI, uploadAPI, taskAPI, promptAPI } from '../api'
import { useTasks } from '../hooks'

export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { tasks, refresh: refreshTasks } = useTasks()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)

  const scroll = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const handleSubmit = useCallback(async ({ prompt, mode, images, params }) => {
    setLoading(true)
    let imageUrls = []

    if (images?.length > 0) {
      setMessages(prev => [...prev, { role: 'user', prompt, timestamp: new Date().toISOString(), images: images.map(i => i.preview) }])
      scroll()
      setMessages(prev => [...prev, { role: 'ai', statusText: '正在上传参考图...', timestamp: new Date().toISOString() }])
      scroll()
      try {
        const results = await Promise.all(images.map(img => uploadAPI.upload(img.file)))
        imageUrls = results.map(r => r.data.url)
      } catch (e) {
        setMessages(prev => [...prev, { role: 'ai', error: '上传失败: ' + e.message, timestamp: new Date().toISOString() }])
        scroll(); setLoading(false); return
      }
    } else {
      setMessages(prev => [...prev, { role: 'user', prompt, timestamp: new Date().toISOString() }])
      scroll()
    }

    const aiIdx = messages.length + (images?.length > 0 ? 1 : 0)
    const genStartTime = Date.now()
    setMessages(prev => [...prev, { role: 'ai', statusText: '正在生成...', progress: 0, timestamp: new Date().toISOString() }])
    scroll()

    try {
      const data = mode === 'text-image'
        ? (await generateAPI.submitTextImage({ prompt, image_urls: imageUrls, size: params?.size || 'auto' })).data
        : (await generateAPI.submitText({ prompt, size: params?.size || 'auto' })).data

      if (data.status === 'completed') {
        setMessages(prev => prev.map((m, i) => i === aiIdx ? { ...m, statusText: null, progress: null, resultImages: data.result_urls.map(u => `/generated_images/${u.split('/').pop()}`) } : m))
        scroll(); refreshTasks(); setLoading(false); return
      }

      const tid = data.task_id
      const updateProgress = () => {
        const elapsed = (Date.now() - genStartTime) / 1000
        const pct = Math.min(99 * (1 - Math.exp(-elapsed / 30)), 99)
        setMessages(prev => prev.map((m, i) => i === aiIdx ? { ...m, progress: pct } : m))
      }

      await new Promise(r => setTimeout(r, 15000))
      updateProgress()

      for (let attempt = 0; attempt < 80; attempt++) {
        const elapsed = (Date.now() - genStartTime) / 1000
        await new Promise(r => setTimeout(r, elapsed > 50 ? 3000 : 5000))
        updateProgress()
        try {
          const { data: st } = await taskAPI.get(tid)
          if (st.status === 'completed') {
            setMessages(prev => prev.map((m, i) => i === aiIdx ? { ...m, statusText: null, progress: 100, resultImages: (st.result_urls||[]).map(u => `/generated_images/${u.split('/').pop()}`) } : m))
            scroll(); refreshTasks(); setLoading(false); return
          } else if (st.status === 'failed') {
            setMessages(prev => prev.map((m, i) => i === aiIdx ? { ...m, statusText: null, progress: null, error: st.error || '生成失败' } : m))
            scroll(); setLoading(false); return
          }
          setMessages(prev => prev.map((m, i) => i === aiIdx ? { ...m, statusText: st.status === 'queued' ? '排队中...' : '生成中...' } : m))
        } catch { continue }
      }
      setMessages(prev => prev.map((m, i) => i === aiIdx ? { ...m, statusText: null, progress: null, error: '生成超时' } : m))
    } catch (e) {
      setMessages(prev => [...prev, { role: 'ai', error: '生成失败: ' + e.message, timestamp: new Date().toISOString() }])
    }
    scroll(); setLoading(false)
  }, [messages, refreshTasks, scroll])

  const handleSavePrompt = async (msg) => {
    try { await promptAPI.create({ name: msg.prompt.slice(0, 30), prompt: msg.prompt, tags: ['从对话保存'] }); alert('已保存！') }
    catch (e) { alert('失败: ' + e.message) }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b lg:hidden" style={{ borderColor: 'var(--border-color)' }}>
          <button onClick={() => setSidebarOpen(true)} style={{ color: 'var(--text-primary)' }}><Menu size={20} /></button>
          <h1 className="font-medium" style={{ color: 'var(--text-primary)' }}>AI 图像生成</h1>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-6" style={{ maxWidth: '768px', margin: '0 auto', width: '100%' }}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>开始生成你的图像</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>输入提示词或上传参考图，AI 为你创作</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg}
              onReusePrompt={() => handleSubmit({ prompt: msg.prompt, mode: 'text', images: [], params: msg.params })}
              onSavePrompt={() => handleSavePrompt(msg)}
              onRegenerate={() => handleSubmit({ prompt: msg.prompt, mode: 'text', images: [], params: msg.params })}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
        <ChatInput onSubmit={handleSubmit} loading={loading} />
      </div>
    </div>
  )
}

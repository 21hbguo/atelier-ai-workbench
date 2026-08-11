import { useState, useEffect, useRef, useCallback } from 'react'
import { MessageCircle, Plus, Trash2, Pencil, X, Send, Square, RefreshCw, Copy, ChevronLeft, Brain, AlertCircle } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import { useAppDialog } from '../components/AppDialogProvider'
import { chatAPI, pointsAPI } from '../api'
import { readUser } from '../auth'
import { mdToHtml } from '../utils/markdown'

// markdown 渲染结果（.md-body）的样式，沿用全站 CSS 变量体系
const MD_STYLES = `
.md-body{line-height:1.65;word-break:break-word}
.md-body p{margin:0 0 .6em}
.md-body p:last-child{margin-bottom:0}
.md-body h1,.md-body h2,.md-body h3,.md-body h4,.md-body h5,.md-body h6{margin:.7em 0 .4em;font-weight:600;line-height:1.3}
.md-body h1{font-size:1.25em}.md-body h2{font-size:1.15em}.md-body h3{font-size:1.05em}.md-body h4{font-size:.98em}.md-body h5{font-size:.92em}.md-body h6{font-size:.88em;color:var(--text-secondary)}
.md-body pre{background:color-mix(in srgb,var(--bg-primary) 72%,transparent);border:1px solid var(--border-color);border-radius:10px;padding:10px 12px;overflow-x:auto;margin:.5em 0;font-size:12.5px;line-height:1.6}
.md-body code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em;background:color-mix(in srgb,var(--bg-primary) 72%,transparent);padding:.15em .4em;border-radius:6px}
.md-body pre code{background:transparent;padding:0}
.md-body ul,.md-body ol{margin:.4em 0;padding-left:1.4em}
.md-body li{margin:.2em 0}
.md-body li > ul,.md-body li > ol{margin:.15em 0}
.md-body input[type=checkbox]{accent-color:var(--accent);margin-right:.35em;vertical-align:-1px;pointer-events:none}
.md-body blockquote{margin:.5em 0;padding:.4em .8em;border-left:3px solid var(--accent);border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--bg-primary) 55%,transparent);color:var(--text-secondary)}
.md-body a{color:var(--accent);text-decoration:underline;word-break:break-all}
.md-body img{max-width:100%;border-radius:10px;margin:.4em 0;display:block}
.md-body hr{border:none;border-top:1px solid var(--border-color);margin:.8em 0}
.md-body table{border-collapse:collapse;margin:.5em 0;width:100%;font-size:13px;display:block;overflow-x:auto}
.md-body th,.md-body td{border:1px solid var(--border-color);padding:6px 10px;text-align:left}
.md-body th{background:color-mix(in srgb,var(--accent) 8%,transparent);font-weight:600}
.md-body strong{font-weight:700}
`

function parseDate(s) {
  if (!s) return null
  const str = String(s)
  const iso = str.includes('T')
    ? (str.endsWith('Z') || str.includes('+') ? str : str + '+08:00')
    : str.replace(' ', 'T') + '+08:00'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

function formatTime(s) {
  const d = parseDate(s)
  if (!d) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch {}
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

// ============ 会话列表 ============
function SessionList({ sessions, activeId, loading, sending, renaming, renamingValue,
  onSelect, onCreate, onDelete, onStartRename, onRenamingChange, onRenamingCommit, onRenamingCancel }) {
  const renderActions = (s) => (
    <>
      <button onClick={(e) => { e.stopPropagation(); onStartRename(s) }}
        className="p-1 rounded-md hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }} title="重命名">
        <Pencil size={13} />
      </button>
      <button onClick={(e) => { e.stopPropagation(); onDelete(s.id) }}
        className="p-1 rounded-md hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }} title="删除">
        <Trash2 size={13} />
      </button>
    </>
  )
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 pb-2 border-b flex-shrink-0" style={{ borderColor: 'var(--border-color)' }}>
        <button onClick={onCreate} disabled={sending}
          className="w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
          style={{ background: 'var(--accent)' }}>
          <Plus size={16} /> 新建对话
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {loading && <div className="text-xs text-center py-8" style={{ color: 'var(--text-secondary)' }}>加载中…</div>}
        {!loading && sessions.length === 0 && (
          <div className="text-xs text-center py-8" style={{ color: 'var(--text-secondary)' }}>暂无会话，点击上方新建对话</div>
        )}
        {sessions.map(s => {
          const active = s.id === activeId
          const isRenaming = renaming && renaming.id === s.id
          return (
            <div key={s.id}
              className={`group relative rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${active ? '' : 'hover:bg-bg-hover'} ${sending ? 'opacity-60' : ''}`}
              style={{
                background: active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 25%, var(--border-color))' : 'transparent'}`,
              }}
              onClick={() => { if (!sending) onSelect(s.id) }}>
              {isRenaming ? (
                <input autoFocus value={renamingValue}
                  onChange={e => onRenamingChange(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); onRenamingCommit() }
                    else if (e.key === 'Escape') onRenamingCancel()
                  }}
                  onBlur={onRenamingCommit}
                  placeholder="输入新标题"
                  className="w-full text-sm rounded-lg px-2 py-1 outline-none"
                  style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--accent)' }} />
              ) : (
                <>
                  <div className="text-sm font-medium truncate pr-9" style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}>
                    {s.title || '新对话'}
                  </div>
                  <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {s.last_message || '暂无消息'}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {formatTime(s.updated_at || s.created_at)}
                  </div>
                  {/* 移动端常显操作按钮 */}
                  <div className="absolute right-1.5 top-1.5 flex gap-0.5 lg:hidden">{renderActions(s)}</div>
                  {/* 桌面端 hover 显示操作按钮 */}
                  <div className="absolute right-1.5 top-1.5 hidden lg:flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{renderActions(s)}</div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============ 消息气泡 ============
function MessageItem({ msg, onCopy }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 animate-fade-in-up group`}>
      <div className="relative max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3"
        style={{ background: isUser ? 'var(--bg-user-bubble)' : 'var(--bg-ai-bubble)', boxShadow: isUser ? 'none' : 'var(--shadow-md)' }}>
        {isUser ? (
          <div className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>{msg.content}</div>
        ) : msg.error ? (
          <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--color-error)' }}>
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span className="break-words">{msg.error}</span>
          </div>
        ) : (
          <div className="md-body text-sm" style={{ color: 'var(--text-primary)' }}
            dangerouslySetInnerHTML={{ __html: mdToHtml(msg.content) }} />
        )}
        <div className="text-xs mt-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{formatTime(msg.created_at)}</div>
        {!isUser && !msg.error && (
          <button onClick={() => onCopy(msg.content)}
            className="absolute -top-2.5 -right-2.5 hidden group-hover:flex p-1.5 rounded-lg"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
            title="复制">
            <Copy size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

// ============ 流式输出中的 AI 气泡 ============
function StreamBubble({ sending, onStop, onRetry }) {
  const hasText = sending.text.length > 0
  return (
    <div className="flex justify-start mb-4 animate-fade-in-up">
      <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3" style={{ background: 'var(--bg-ai-bubble)', boxShadow: 'var(--shadow-md)' }}>
        {hasText ? (
          <div className="md-body text-sm" style={{ color: 'var(--text-primary)' }}
            dangerouslySetInnerHTML={{ __html: mdToHtml(sending.text) }} />
        ) : (
          <div className="flex items-center gap-1.5 py-1">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-secondary)' }} />
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-secondary)', animationDelay: '0.15s' }} />
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-secondary)', animationDelay: '0.3s' }} />
            <span className="ml-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>正在输入…</span>
          </div>
        )}
        {sending.stopped ? (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs" style={{ color: 'var(--color-error)' }}>{sending.error || '已停止生成'}</span>
            <button onClick={onRetry}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors"
              style={{ color: 'var(--text-secondary)' }}>
              <RefreshCw size={13} /> 重试
            </button>
          </div>
        ) : (
          <div className="mt-2 flex justify-end">
            <button onClick={onStop}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors"
              style={{ color: 'var(--text-secondary)' }}>
              <Square size={12} /> 停止生成
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============ 空状态引导 ============
const EXAMPLES = [
  '帮我写一个提示词：一只在月光下奔跑的银色狐狸，水墨风格',
  '优化这段提示词：城市夜景，霓虹灯，赛博朋克',
  '帮我的作品起一个吸引人的标题',
]

function EmptyState({ onPick }) {
  return (
    <div className="flex flex-col items-center text-center pt-14 pb-10 px-4">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}>
        <MessageCircle size={26} style={{ color: 'var(--accent)' }} />
      </div>
      <h3 className="text-lg font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>和 AI 助手聊聊</h3>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>帮你写提示词、优化描述，让灵感更快落地</p>
      <div className="flex flex-col gap-2 w-full max-w-sm">
        {EXAMPLES.map(q => (
          <button key={q} onClick={() => onPick(q)}
            className="text-left text-sm px-4 py-3 rounded-2xl transition-colors hover:bg-bg-hover"
            style={{ border: '1px solid var(--border-color)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}>
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}

// ============ 底部输入区 ============
const EFFORT_LABELS = { auto: '自动', low: '低', medium: '中', high: '高', max: '最高', xhigh: '超高' }

function ChatInputBar({ inputRef, value, onChange, onSend, onStop, sending, cost, points, reasoningEffort, onReasoningEffort, efforts, modelLabel, pendingQueue, onEditPending, onRemovePending }) {
  const [effortOpen, setEffortOpen] = useState(false)
  const EFFORT_OPTIONS = (Array.isArray(efforts) && efforts.length ? efforts : ['auto', 'low', 'medium', 'high', 'max', 'xhigh'])
    .map(v => ({ value: v, label: EFFORT_LABELS[v] || v }))
  useEffect(() => {
    if (!value && inputRef.current) inputRef.current.style.height = 'auto'
  }, [value, inputRef])
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSend() // 生成中会自动进入排队
    }
  }
  return (
    <div className="lg:static fixed inset-x-0 z-20 flex-shrink-0"
      style={{ background: 'var(--bg-primary)', borderTop: '1px solid var(--border-color)', bottom: 'env(keyboard-inset-height, 0px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5 mb-1.5 px-1 flex-wrap">
          {modelLabel && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>
              {modelLabel}
            </span>
          )}
          <button onClick={() => setEffortOpen(v => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
            style={{
              background: reasoningEffort !== 'auto' ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-card)',
              borderColor: reasoningEffort !== 'auto' ? 'var(--accent)' : 'var(--border-color)',
              color: reasoningEffort !== 'auto' ? 'var(--accent)' : 'var(--text-secondary)',
            }}>
            <Brain size={13} />
            <span>思考：{EFFORT_OPTIONS.find(o => o.value === reasoningEffort)?.label || '自动'}</span>
          </button>
          {effortOpen && EFFORT_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => { onReasoningEffort(opt.value); setEffortOpen(false) }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
              style={{
                background: reasoningEffort === opt.value ? 'var(--accent)' : 'var(--bg-card)',
                borderColor: reasoningEffort === opt.value ? 'var(--accent)' : 'var(--border-color)',
                color: reasoningEffort === opt.value ? '#fff' : 'var(--text-secondary)',
              }}>
              {opt.label}
            </button>
          ))}
          <span className="ml-auto hidden sm:inline text-[11px]" style={{ color: 'var(--text-secondary)' }}>思考强度越高，回复越深入，耗时越长</span>
        </div>
        {/* 排队中的待发送消息 */}
        {pendingQueue.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {pendingQueue.map((item, i) => (
              <div key={item.id} className="flex items-center gap-2 rounded-xl px-3 py-2"
                style={{ background: 'var(--bg-ai-bubble)', border: '1px solid var(--border-color)' }}>
                <span className="text-[10px] font-medium flex-shrink-0" style={{ color: 'var(--accent)' }}>排队 {i + 1}</span>
                <span className="flex-1 min-w-0 truncate text-sm" style={{ color: 'var(--text-primary)' }}>{item.text}</span>
                <button onClick={() => onEditPending(item.id)} title="编辑"
                  className="p-1.5 rounded-md hover:bg-bg-hover transition-colors flex-shrink-0"
                  style={{ color: 'var(--text-secondary)' }}>
                  <Pencil size={13} />
                </button>
                <button onClick={() => onRemovePending(item.id)} title="删除"
                  className="p-1.5 rounded-md hover:bg-bg-hover transition-colors flex-shrink-0"
                  style={{ color: 'var(--text-secondary)' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* 与 AI 生图输入框一致的卡片式输入区 */}
        <div className="rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-md)' }}>
          <div className="px-2 pt-2">
            <textarea ref={inputRef} value={value} rows={1}
              placeholder={sending ? 'AI 正在回复…可继续输入，Enter 排队发送' : '输入消息，Enter 发送，Shift+Enter 换行'}
              onChange={e => {
                onChange(e.target.value)
                const t = e.target
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 80) + 'px'
              }}
              onKeyDown={handleKeyDown}
              className="block w-full resize-none bg-transparent outline-none"
              style={{ color: 'var(--text-primary)', minHeight: '40px', maxHeight: '80px', fontSize: '15px', paddingLeft: '10px' }} />
          </div>
          <div className="px-2 pb-2 flex items-center justify-between gap-3">
            <div className="flex items-center flex-shrink-0 whitespace-nowrap gap-0.5">
              {sending && (
                <button onClick={onStop} title="停止生成"
                  className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg hover:bg-bg-hover transition-colors"
                  style={{ color: 'var(--text-secondary)' }}>
                  <Square size={13} />
                  <span className="text-[11px] leading-none">停止</span>
                </button>
              )}
            </div>
            <div className="min-w-0 flex items-center justify-end gap-1 flex-1">
              {value.length > 0 && (
                <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{value.length}</span>
              )}
              <button
                onClick={() => { if (sending && !value.trim()) onStop(); else onSend() }}
                onMouseDown={e => e.preventDefault()}
                disabled={!sending && !value.trim()}
                title={sending ? (value.trim() ? '排队发送' : '停止生成') : '发送'}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-2xl transition-colors disabled:opacity-40 flex-shrink-0"
                style={{
                  background: (sending && !value.trim()) ? 'var(--bg-hover)' : (value.trim() ? 'var(--accent)' : 'var(--border-color)'),
                  color: (sending && !value.trim()) ? 'var(--text-secondary)' : '#fff',
                }}>
                {(sending && !value.trim()) ? <Square size={14} /> : <Send size={14} />}
              </button>
            </div>
          </div>
        </div>
        <div className="px-1 pt-1.5 flex items-center justify-between text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <span>本次消耗 {cost} 积分</span>
          <span>当前积分：{points}</span>
        </div>
      </div>
    </div>
  )
}

// ============ 页面 ============
export default function ChatAssistantPage() {
  const dialog = useAppDialog()
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(null) // { sessionId, content, text, stopped, error }
  const [cost, setCost] = useState(0)
  const [points, setPoints] = useState(() => readUser()?.points ?? 0)
  const [reasoningEffort, setReasoningEffort] = useState(() => localStorage.getItem('chat_reasoning_effort') || 'auto')
  const [modelInfo, setModelInfo] = useState(null) // { label, reasoning_efforts, ... }
  const [sessionListOpen, setSessionListOpen] = useState(false)
  const [renaming, setRenaming] = useState(null) // { id, title }
  const renamingRef = useRef(null)
  const abortRef = useRef(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const sendingRef = useRef(null) // 与 sending 同步，供事件/回调读取最新状态（也兼作发送锁）
  const pendingQueueRef = useRef([]) // 与 pendingQueue 同步
  const manualStopRef = useRef(false)
  const pointsRef = useRef(points)
  const activeIdRef = useRef(activeId)
  const effortRef = useRef(reasoningEffort)
  const [pendingQueue, setPendingQueue] = useState([])

  const activeSession = sessions.find(s => s.id === activeId) || null

  // latest-ref：每次渲染后同步，让异步回调能读到最新值
  useEffect(() => {
    pointsRef.current = points
    activeIdRef.current = activeId
    effortRef.current = reasoningEffort
  })

  // 初始加载：消耗积分、余额、会话列表、模型档案
  useEffect(() => {
    chatAPI.cost().then(res => setCost(Number(res.data?.cost_per_chat) || 0)).catch(() => {})
    chatAPI.model().then(res => {
      setModelInfo(res.data || null)
      const efforts = res.data?.reasoning_efforts
      if (Array.isArray(efforts) && efforts.length && !efforts.includes(reasoningEffort)) {
        const fb = res.data?.default_reasoning_effort || 'auto'
        setReasoningEffort(fb)
        try { localStorage.setItem('chat_reasoning_effort', fb) } catch {}
      }
    }).catch(() => {})
    pointsAPI.balance().then(res => setPoints(Number(res.data?.points) ?? 0)).catch(() => {})
    chatAPI.sessions().then(res => {
      const items = res.data?.items || []
      setSessions(items)
      if (items.length) setActiveId(items[0].id)
    }).catch(() => {}).finally(() => setSessionsLoading(false))
    const handlePoints = () => { const u = readUser(); if (u) setPoints(u.points ?? 0) }
    window.addEventListener('points-updated', handlePoints)
    return () => {
      window.removeEventListener('points-updated', handlePoints)
      abortRef.current?.abort()
    }
  }, [])

  // 切换会话时加载消息
  useEffect(() => {
    if (!activeId) { setMessages([]); return }
    let active = true
    setMessagesLoading(true)
    chatAPI.messages(activeId).then(res => {
      if (active) setMessages(res.data?.items || [])
    }).catch(err => {
      if (active) dialog.alert(err.message || '加载消息失败')
    }).finally(() => { if (active) setMessagesLoading(false) })
    return () => { active = false }
  }, [activeId, dialog])

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, messagesLoading, sending?.text, sending?.stopped])

  const refreshSessions = useCallback(() => {
    chatAPI.sessions().then(res => setSessions(res.data?.items || [])).catch(() => {})
  }, [])

  // 发送锁：防止 createSession 等异步间隙出现并发发送（占位 sessionId=null，startStream 会覆盖）
  const acquireSendLock = useCallback((content) => {
    if (sendingRef.current && !sendingRef.current.stopped) return false
    sendingRef.current = { sessionId: null, content, text: '', stopped: false, error: '', manual: false }
    return true
  }, [])
  const releaseSendLock = useCallback(() => { sendingRef.current = null }, [])

  const startStream = useCallback((sessionId, content, reasoningEffort = 'auto') => {
    const controller = new AbortController()
    abortRef.current = controller
    const st = { sessionId, content, text: '', stopped: false, error: '', manual: false }
    sendingRef.current = st
    setSending(st)
    chatAPI.sendStream(sessionId, content, {
      signal: controller.signal,
      reasoning_effort: reasoningEffort,
      onChunk: data => setSending(prev =>
        (prev && prev.sessionId === sessionId) ? { ...prev, text: (prev.text || '') + String(data.text || '') } : prev),
      onDone: data => {
        const full = String(data.text || '')
        manualStopRef.current = false
        setMessages(prev => [...prev, { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: full, created_at: new Date().toISOString() }])
        // 仅当仍是本次会话的流时才清理状态，避免并发时旧流清掉新流
        if (sendingRef.current?.sessionId === sessionId) {
          sendingRef.current = null
          setSending(null)
        }
        const bal = data.points_balance
        if (bal != null) {
          const num = Number(bal)
          setPoints(num)
          const u = readUser()
          if (u) { u.points = num; localStorage.setItem('user', JSON.stringify(u)) }
          window.dispatchEvent(new Event('points-updated'))
        }
        refreshSessions()
      },
      onError: msg => {
        const errMsg = msg || '生成失败'
        const isManual = manualStopRef.current
        manualStopRef.current = false
        if (isManual) {
          // 手动停止：保留错误气泡 + 重试按钮，不自动继续队列
          if (sendingRef.current?.sessionId === sessionId) {
            sendingRef.current = { ...sendingRef.current, stopped: true, error: errMsg, manual: true }
          }
          setSending(prev =>
            (prev && prev.sessionId === sessionId) ? { ...prev, stopped: true, error: errMsg, manual: true } : prev)
        } else {
          // 自动失败：错误追加为消息，清空状态让队列继续自动发送
          if (sendingRef.current?.sessionId === sessionId) sendingRef.current = null
          setSending(prev => (prev && prev.sessionId === sessionId) ? null : prev)
          setMessages(prev => [...prev, { id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: '', error: errMsg, created_at: new Date().toISOString() }])
        }
        if (/积分不足|余额不足/.test(errMsg)) {
          dialog.alert(errMsg)
          pointsAPI.balance().then(res => setPoints(Number(res.data?.points) ?? 0)).catch(() => {})
        }
      },
    }).finally(() => { if (abortRef.current === controller) abortRef.current = null })
  }, [dialog, refreshSessions])

  // ============ 排队队列操作 ============
  const MAX_PENDING = 10
  const enqueuePending = (text) => {
    const item = { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text }
    pendingQueueRef.current = [...pendingQueueRef.current, item]
    setPendingQueue(pendingQueueRef.current)
    return item
  }
  const removePending = (id) => {
    pendingQueueRef.current = pendingQueueRef.current.filter(item => item.id !== id)
    setPendingQueue(pendingQueueRef.current)
  }
  const editPending = (id) => {
    const item = pendingQueueRef.current.find(x => x.id === id)
    if (!item) return
    removePending(id)
    setInput(item.text)
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.focus()
      requestAnimationFrame(() => {
        if (inputRef.current) {
          const len = inputRef.current.value.length
          inputRef.current.setSelectionRange(len, len)
        }
      })
    }
  }
  const clearPending = useCallback(() => {
    pendingQueueRef.current = []
    setPendingQueue([])
  }, [])
  const focusInput = () => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length)
    }
  }

  const handleSend = async (raw) => {
    const text = String(raw ?? input).trim()
    if (!text) return
    // 正在生成中：进入排队队列，当前回复结束后自动发送
    if (sendingRef.current && !sendingRef.current.stopped) {
      if (pendingQueueRef.current.length >= MAX_PENDING) {
        dialog.alert(`排队消息最多 ${MAX_PENDING} 条，请等待发送或删除部分排队消息。`)
        focusInput()
        return
      }
      enqueuePending(text)
      setInput('')
      if (inputRef.current) inputRef.current.style.height = 'auto'
      focusInput()
      return
    }
    // 空闲（或上一条已停止/失败）：获取发送锁后直接发送
    if (!acquireSendLock(text)) return
    if (cost > 0 && pointsRef.current < cost) {
      releaseSendLock()
      dialog.alert(`积分不足，当前仅剩 ${pointsRef.current} 积分，本次对话需要 ${cost} 积分。`)
      return
    }
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    let sid = activeIdRef.current
    if (!sid) {
      try {
        const res = await chatAPI.createSession()
        const s = res.data
        setSessions(prev => [s, ...prev])
        sid = s.id
        activeIdRef.current = s.id
        setActiveId(s.id)
      } catch (err) {
        releaseSendLock()
        dialog.alert(err.message || '创建会话失败')
        return
      }
    }
    setMessages(prev => [...prev, { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: text, created_at: new Date().toISOString() }])
    startStream(sid, text, effortRef.current)
    focusInput()
  }

  // 生成完成后，自动发送排队中的下一条
  const sendQueuedNext = useCallback(async () => {
    if (!acquireSendLock('')) return
    const item = pendingQueueRef.current[0]
    if (!item) {
      releaseSendLock()
      return
    }
    pendingQueueRef.current = pendingQueueRef.current.slice(1)
    setPendingQueue(pendingQueueRef.current)
    if (cost > 0 && pointsRef.current < cost) {
      releaseSendLock()
      dialog.alert(`积分不足，当前仅剩 ${pointsRef.current} 积分，本次对话需要 ${cost} 积分。排队消息已取消，请补充积分后重新发送。`)
      clearPending()
      return
    }
    let sid = activeIdRef.current
    if (!sid) {
      try {
        const res = await chatAPI.createSession()
        const s = res.data
        setSessions(prev => [s, ...prev])
        sid = s.id
        activeIdRef.current = s.id
        setActiveId(s.id)
      } catch (err) {
        releaseSendLock()
        dialog.alert(err.message || '创建会话失败')
        clearPending()
        return
      }
    }
    setMessages(prev => [...prev, { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: item.text, created_at: new Date().toISOString() }])
    startStream(sid, item.text, effortRef.current)
  }, [dialog, cost, startStream, acquireSendLock, releaseSendLock, clearPending])

  // sending 变为空闲时自动发送排队中的下一条
  useEffect(() => {
    if (sending !== null) return
    sendQueuedNext()
  }, [sending, sendQueuedNext])

  const handleSelectSession = (id) => {
    if (id === activeId || sending) return
    manualStopRef.current = true
    abortRef.current?.abort()
    sendingRef.current = null
    setSending(null)
    clearPending()
    setActiveId(id)
    setSessionListOpen(false)
  }

  const handleCreateSession = async () => {
    if (sending) { dialog.alert('请先停止当前生成，再新建对话'); return }
    manualStopRef.current = true
    abortRef.current?.abort()
    sendingRef.current = null
    setSending(null)
    clearPending()
    try {
      const res = await chatAPI.createSession()
      const s = res.data
      setSessions(prev => [s, ...prev])
      setActiveId(s.id)
      setMessages([])
      setSessionListOpen(false)
    } catch (err) {
      dialog.alert(err.message || '创建会话失败')
    }
  }

  const handleDeleteSession = async (id) => {
    const ok = await dialog.confirm('确定删除该会话吗？删除后聊天记录将无法恢复。')
    if (!ok) return
    try {
      await chatAPI.deleteSession(id)
      const next = sessions.filter(s => s.id !== id)
      setSessions(next)
      if (activeId === id) {
        manualStopRef.current = true
        abortRef.current?.abort()
        sendingRef.current = null
        setSending(null)
        clearPending()
        if (next.length) setActiveId(next[0].id)
        else { setActiveId(null); setMessages([]) }
      }
    } catch (err) {
      dialog.alert(err.message || '删除会话失败')
    }
  }

  const handleStop = () => { manualStopRef.current = true; abortRef.current?.abort() }

  const handleReasoningEffort = (v) => {
    setReasoningEffort(v)
    try { localStorage.setItem('chat_reasoning_effort', v) } catch {}
  }

  const handleRetry = () => {
    if (!sending) return
    const { sessionId, content } = sending
    setSending(null)
    startStream(sessionId, content, effortRef.current)
  }

  const handleCopy = async (text) => {    const ok = await copyText(String(text || ''))
    dialog.alert(ok ? '已复制到剪贴板' : '复制失败')
  }

  const startRename = (s) => { const r = { id: s.id, title: s.title || '' }; renamingRef.current = r; setRenaming(r) }
  const changeRename = (v) => { const r = { ...renamingRef.current, title: v }; renamingRef.current = r; setRenaming(r) }
  const commitRename = () => {
    const r = renamingRef.current
    if (!r) return
    renamingRef.current = null
    setRenaming(null)
    const title = r.title.trim()
    if (!title) return
    chatAPI.renameSession(r.id, title).then(() => {
      setSessions(prev => prev.map(x => x.id === r.id ? { ...x, title } : x))
    }).catch(err => dialog.alert(err.message || '重命名失败'))
  }
  const cancelRename = () => { renamingRef.current = null; setRenaming(null) }

  return (
    <MainLayout>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 桌面端会话列表栏 */}
        <aside className="hidden lg:flex flex-col flex-shrink-0 w-56 min-h-0"
          style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-color)' }}>
          <SessionList
            sessions={sessions} activeId={activeId} loading={sessionsLoading} sending={!!sending}
            renaming={renaming} renamingValue={renaming?.title || ''}
            onSelect={handleSelectSession} onCreate={handleCreateSession} onDelete={handleDeleteSession}
            onStartRename={startRename} onRenamingChange={changeRename}
            onRenamingCommit={commitRename} onRenamingCancel={cancelRename} />
        </aside>

        {/* 移动端会话列表覆盖层 */}
        {sessionListOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSessionListOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] flex flex-col"
              style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-color)' }}>
              <div className="flex items-center justify-between px-3 h-11 border-b flex-shrink-0" style={{ borderColor: 'var(--border-color)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>会话列表</span>
                <button onClick={() => setSessionListOpen(false)} className="p-1.5 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <SessionList
                  sessions={sessions} activeId={activeId} loading={sessionsLoading} sending={!!sending}
                  renaming={renaming} renamingValue={renaming?.title || ''}
                  onSelect={handleSelectSession} onCreate={handleCreateSession} onDelete={handleDeleteSession}
                  onStartRename={startRename} onRenamingChange={changeRename}
                  onRenamingCommit={commitRename} onRenamingCancel={cancelRename} />
              </div>
            </div>
          </div>
        )}

        {/* 消息区 */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="mobile-topbar-shell flex-shrink-0" style={{ borderColor: 'var(--border-color)' }}>
            <div className="mobile-topbar-inner w-full px-3 lg:px-6">
              <button onClick={() => setSessionListOpen(true)}
                className="lg:hidden inline-flex items-center gap-0.5 h-8 px-1.5 -ml-1.5 rounded-xl text-sm font-medium hover:bg-bg-hover"
                style={{ color: 'var(--text-primary)' }}>
                <ChevronLeft size={16} /> 会话
              </button>
              <h2 className="flex-1 min-w-0 truncate text-sm font-semibold text-center lg:text-left"
                style={{ color: 'var(--text-primary)' }}>
                {activeSession?.title || 'AI 助手'}
              </h2>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-5 pb-40 lg:pb-8">
              {messagesLoading ? (
                <div className="text-center text-xs py-10" style={{ color: 'var(--text-secondary)' }}>加载中…</div>
              ) : messages.length === 0 && !sending ? (
                activeId ? (
                  <div className="text-center text-sm py-16" style={{ color: 'var(--text-secondary)' }}>
                    发送第一条消息，开始新的对话
                  </div>
                ) : (
                  <EmptyState onPick={handleSend} />
                )
              ) : (
                <>
                  {messages.map(msg => <MessageItem key={msg.id} msg={msg} onCopy={handleCopy} />)}
                  {sending && <StreamBubble sending={sending} onStop={handleStop} onRetry={handleRetry} />}
                </>
              )}
            </div>
          </div>

          <ChatInputBar inputRef={inputRef} value={input} onChange={setInput}
            onSend={handleSend} onStop={handleStop} sending={!!sending} cost={cost} points={points}
            reasoningEffort={reasoningEffort} onReasoningEffort={handleReasoningEffort}
            efforts={modelInfo?.reasoning_efforts} modelLabel={modelInfo?.label || modelInfo?.model_id}
            pendingQueue={pendingQueue} onEditPending={editPending} onRemovePending={removePending} />
        </div>
      </div>
      <style>{MD_STYLES}</style>
    </MainLayout>
  )
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { MessageCircle, Plus, Trash2, Pencil, X, Send, Square, RefreshCw, Copy, ChevronLeft, Brain, AlertCircle, CheckSquare, Cpu, ChevronDown, Check, Paperclip, FileText, Settings } from 'lucide-react'
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
  onSelect, onCreate, onDelete, onStartRename, onRenamingChange, onRenamingCommit, onRenamingCancel,
  batchMode, selectedIds, onEnterBatch, onSelectAll, onToggleSelect, onBatchDelete, onExitBatch }) {
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
        {batchMode ? (
          <div className="flex items-center gap-1.5">
            <span className="flex-1 min-w-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              已选 {selectedIds.length} 个
            </span>
            <button onClick={onSelectAll}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors"
              style={{ color: 'var(--text-secondary)' }}>
              <CheckSquare size={13} /> 全选
            </button>
            <button onClick={onBatchDelete} disabled={!selectedIds.length}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-40"
              style={{ background: 'var(--accent)' }}>
              <Trash2 size={13} /> 删除
            </button>
            <button onClick={onExitBatch}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors"
              style={{ color: 'var(--text-secondary)' }}>
              <X size={13} /> 取消
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button onClick={onCreate} disabled={sending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
              style={{ background: 'var(--accent)' }}>
              <Plus size={16} /> 新建对话
            </button>
            <button onClick={onEnterBatch} title="批量删除"
              className="flex-shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-xl transition-colors hover:bg-bg-hover"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {loading && <div className="text-xs text-center py-8" style={{ color: 'var(--text-secondary)' }}>加载中…</div>}
        {!loading && sessions.length === 0 && (
          <div className="text-xs text-center py-8" style={{ color: 'var(--text-secondary)' }}>
            {batchMode ? '没有可删除的会话' : '暂无会话，点击上方新建对话'}
          </div>
        )}
        {sessions.map(s => {
          const active = s.id === activeId
          const isRenaming = renaming && renaming.id === s.id
          const checked = selectedIds.includes(s.id)
          return (
            <div key={s.id}
              className={`group relative rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${active && !batchMode ? '' : 'hover:bg-bg-hover'} ${sending ? 'opacity-60' : ''}`}
              style={{
                background: (active && !batchMode) ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : (batchMode && checked ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent'),
                border: `1px solid ${batchMode && checked ? 'color-mix(in srgb, var(--accent) 45%, var(--border-color))' : (active && !batchMode ? 'color-mix(in srgb, var(--accent) 25%, var(--border-color))' : 'transparent')}`,
              }}
              onClick={() => {
                if (sending) return
                if (batchMode) onToggleSelect(s.id)
                else onSelect(s.id)
              }}>
              {isRenaming && !batchMode ? (
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
                  {batchMode && (
                    <span className="absolute left-2.5 top-2.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => onToggleSelect(s.id)}
                        className="w-3.5 h-3.5 cursor-pointer"
                        style={{ accentColor: 'var(--accent)' }} />
                    </span>
                  )}
                  <div className={`text-sm font-medium truncate ${batchMode ? 'pl-6' : 'pr-9'}`} style={{ color: (active && !batchMode) ? 'var(--accent)' : 'var(--text-primary)' }}>
                    {s.title || '新对话'}
                  </div>
                  <div className={`text-xs truncate mt-0.5 ${batchMode ? 'pl-6' : ''}`} style={{ color: 'var(--text-secondary)' }}>
                    {s.last_message || '暂无消息'}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${batchMode ? 'pl-6' : ''}`} style={{ color: 'var(--text-secondary)' }}>
                    {formatTime(s.updated_at || s.created_at)}
                  </div>
                  {!batchMode && (
                    <>
                      {/* 移动端常显操作按钮 */}
                      <div className="absolute right-1.5 top-1.5 flex gap-0.5 lg:hidden">{renderActions(s)}</div>
                      {/* 桌面端 hover 显示操作按钮 */}
                      <div className="absolute right-1.5 top-1.5 hidden lg:flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">{renderActions(s)}</div>
                    </>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============ 思考过程折叠块（默认折叠） ============
function ThinkingBlock({ text }) {
  const [open, setOpen] = useState(false)
  if (!text || !text.trim()) return null
  const lines = text.trim().split('\n')
  const firstLine = lines[0] || ''
  return (
    <div className="mb-2 rounded-xl border overflow-hidden"
      style={{ borderColor: 'var(--border-color)', background: 'color-mix(in srgb, var(--text-secondary) 4%, transparent)' }}>
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-xs transition-colors hover:bg-bg-hover"
        style={{ color: 'var(--text-secondary)' }}>
        <Brain size={13} style={{ color: 'var(--accent)' }} />
        <span className="font-medium flex-shrink-0">思考过程</span>
        {!open && (
          <span className="flex-1 min-w-0 text-left truncate opacity-70">{firstLine.slice(0, 40)}{firstLine.length > 40 ? '…' : ''}</span>
        )}
        <ChevronDown size={13} className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs whitespace-pre-wrap break-words max-h-72 overflow-y-auto"
          style={{ color: 'var(--text-secondary)' }}>{text}</div>
      )}
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
          <>
            {/* 用户消息关联的文件（会话上下文，后端 messages 接口返回 files） */}
            {msg.files?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {msg.files.map((f, i) => (
                  <span key={f.id || `${f.original_name}-${i}`} title={f.original_name || '文件'}
                    className="inline-flex items-center gap-1 max-w-full px-2 py-0.5 rounded-full text-[11px] font-medium border"
                    style={{
                      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--accent) 25%, var(--border-color))',
                      color: 'var(--accent)',
                    }}>
                    <Paperclip size={11} className="flex-shrink-0" />
                    <span className="min-w-0 truncate">{f.original_name || '文件'}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>{msg.content}</div>
          </>
        ) : msg.error ? (
          <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--color-error)' }}>
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span className="break-words">{msg.error}</span>
          </div>
        ) : (
          <>
            <ThinkingBlock text={msg.thinking} />
            <div className="md-body text-sm" style={{ color: 'var(--text-primary)' }}
              dangerouslySetInnerHTML={{ __html: mdToHtml(msg.content) }} />
          </>
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
        <ThinkingBlock text={sending.thinking} />
        {/* 工具调用状态（agent 模式：tool_status 事件，executing 显示加载中，done 时已清除） */}
        {sending.toolStatus && (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
            style={{
              background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border-color))',
              color: 'var(--text-secondary)',
            }}>
            <Settings size={13} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent)' }} />
            <span className="flex-shrink-0 font-medium" style={{ color: 'var(--accent)' }}>正在调用工具</span>
            <span className="min-w-0 truncate">{sending.toolStatus.name || '…'}</span>
          </div>
        )}
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
// 思考强度固定顺序（auto 最左、max 最右）：UI 展示不依赖模型档案/CSV 的原始顺序
const EFFORT_ORDER = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']

function ChatInputBar({ inputRef, value, onChange, onSend, onStop, sending, cost, points, reasoningEffort, onReasoningEffort, efforts, modelLabel, pendingQueue, onEditPending, onRemovePending, models, chatModelId, onSelectModel, onUploadClick, docs, onRemoveDoc, uploadingCount, uploadNote }) {
  const [effortOpen, setEffortOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const EFFORT_OPTIONS = (Array.isArray(efforts) && efforts.length ? efforts : ['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
    .map(v => ({ value: v, label: EFFORT_LABELS[v] || v }))
    .sort((a, b) => {
      const ia = EFFORT_ORDER.indexOf(a.value)
      const ib = EFFORT_ORDER.indexOf(b.value)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)  // 未知档位排最后
    })
  const activeModel = models.find(m => m.model_id === chatModelId) || null
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
      <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-2">
        <div className="flex items-center gap-1.5 mb-1.5 px-1 flex-wrap">
          {/* 模型选择 */}
          {models.length > 0 ? (
            <div className="relative">
              <button onClick={() => setModelOpen(v => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
                style={{
                  background: activeModel ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'color-mix(in srgb, var(--accent) 10%, transparent)',
                  borderColor: activeModel ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 25%, var(--border-color))',
                  color: 'var(--accent)',
                }}>
                <Cpu size={13} />
                <span>{activeModel?.label || modelLabel || '模型'}</span>
                <ChevronDown size={11} className={modelOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              {modelOpen && (
                <div className="absolute left-0 bottom-full mb-1.5 z-50 w-72 max-h-[45dvh] overflow-y-auto rounded-xl p-1 model-dropdown-scroll"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-md)' }}>
                  {models.map(m => (
                    <button key={m.model_id} onClick={() => { onSelectModel(m.model_id); setModelOpen(false) }}
                      className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-bg-hover transition-colors"
                      style={{ background: m.model_id === chatModelId ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent' }}>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-medium truncate" style={{ color: m.model_id === chatModelId ? 'var(--accent)' : 'var(--text-primary)' }}>
                          {m.label || m.model_id}
                        </span>
                        <span className="block text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
                          {m.model_id}{m.points_per_request != null && m.points_per_request > 0 ? ` · ${m.points_per_request} 积分/次` : ''}
                        </span>
                      </span>
                      {m.model_id === chatModelId && <Check size={13} style={{ color: 'var(--accent)' }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            modelLabel && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}>
                {modelLabel}
              </span>
            )
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
        {/* 卡片式输入区：布局对齐绘画页 ChatInput（设置|上传在左，发送在右） */}
        <div className="rounded-2xl border transition-all duration-300"
          style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-md)', position: 'relative' }}>
          {docs.length > 0 && (
            <div className="flex gap-2 p-3 pb-0 overflow-x-auto">
              {docs.map(doc => (
                <div key={doc.id}
                  className="relative w-16 h-14 flex-shrink-0 rounded-lg overflow-hidden group border flex flex-col items-center justify-center gap-0.5 px-1"
                  style={{
                    background: 'var(--bg-card)',
                    borderColor: doc.status === 'error'
                      ? 'var(--color-error)'
                      : doc.status === 'success'
                        ? 'color-mix(in srgb,var(--color-success) 45%,var(--border-color))'
                        : 'color-mix(in srgb,var(--accent) 28%,var(--border-color))',
                  }}
                  title={`${doc.name}${doc.char_count != null ? `（${doc.char_count} 字符）` : ''}${doc.error ? `：${doc.error}` : ''}`}>
                  {doc.status === 'uploading' || doc.status === 'pending' ? (
                    <>
                      <svg className="-rotate-90" width="28" height="28" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="15" fill="none" stroke="color-mix(in srgb,var(--accent) 20%,transparent)" strokeWidth="3" />
                        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
                          strokeDasharray={`${Math.max(0, Math.min(100, Number(doc.progress) || 0)) * 0.94} 100`} />
                      </svg>
                      <span className="text-[8px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{Math.round(Number(doc.progress) || 0)}%</span>
                    </>
                  ) : doc.status === 'error' ? (
                    <>
                      <AlertCircle size={14} style={{ color: 'var(--color-error)' }} />
                      <span className="text-[8px] leading-none" style={{ color: 'var(--color-error)' }}>上传失败</span>
                    </>
                  ) : (
                    <>
                      <FileText size={14} style={{ color: 'var(--accent)' }} />
                      <span className="text-[8px] leading-none uppercase" style={{ color: 'var(--text-secondary)' }}>{doc.ext}</span>
                    </>
                  )}
                  <span className="absolute left-1 bottom-0.5 right-1 text-[7px] truncate text-center" style={{ color: 'var(--text-secondary)' }}>{doc.name}</span>
                  <button onClick={(e) => { e.stopPropagation(); onRemoveDoc(doc.id) }}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="px-2 pt-2 pb-2">
            <textarea ref={inputRef} value={value} rows={1}
              placeholder={sending ? 'AI 正在回复…可继续输入，Enter 排队发送' : '输入消息，Enter 发送，Shift+Enter 换行'}
              onChange={e => {
                onChange(e.target.value)
                const t = e.target
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 80) + 'px'
              }}
              onKeyDown={handleKeyDown}
              className="block w-full resize-none bg-transparent outline-none py-2"
              style={{ color: 'var(--text-primary)', minHeight: '40px', maxHeight: '80px', fontSize: '15px', paddingLeft: '10px' }} />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center flex-shrink-0 whitespace-nowrap gap-0.5">
                <button type="button" onClick={onUploadClick}
                  title="上传文档/代码（txt/md/csv/pdf/docx/xlsx/pptx/py/js/ts/go/yaml 等 50+ 格式；一次最多 5 个，会话累计最多 20 个）"
                  className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg hover:bg-bg-hover transition-colors"
                  style={{ color: 'var(--text-secondary)' }}>
                  <Paperclip size={15} />
                  <span className="text-[11px] leading-none">{uploadingCount > 0 ? `上传中 ${uploadingCount}` : '上传'}</span>
                </button>
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
        </div>
        {uploadNote && (
          <div className="px-1 pt-1 text-[11px] truncate" style={{ color: 'var(--color-error)' }} title={uploadNote}>{uploadNote}</div>
        )}
        <div className="px-1 pt-1 flex items-center justify-between text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <span>本次消耗 {cost} 积分</span>
          <span>当前积分：{points}</span>
        </div>
      </div>
    </div>
  )
}

// ============ 页面 ============
// 聊天文档上传限制（与后端 backend/routers/chat.py 的 _MAX_FILES_PER_SESSION/MAX_FILE_SIZE 一致）
const MAX_DOCS = 20
const MAX_BATCH = 5 // 单次选择最多 5 个文件
// 与后端 document_parser._CODE_EXTS / chat.py _CHAT_DOC_EXTS 保持一致
const DOC_EXTS = new Set([
  'txt', 'md', 'csv', 'json', 'html', 'pdf', 'docx', 'xlsx', 'pptx',
  'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'java', 'go', 'rs',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'rb', 'swift', 'kt',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'lua', 'r', 'pl',
  'scala', 'dart', 'vue', 'svelte',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'xml', 'properties', 'env',
])
const DOC_ACCEPT = '.txt,.md,.csv,.json,.html,.pdf,.docx,.xlsx,.pptx,.py,.js,.mjs,.cjs,.jsx,.ts,.tsx,.java,.go,.rs,.c,.h,.cpp,.hpp,.cc,.cs,.php,.rb,.swift,.kt,.sh,.bash,.zsh,.fish,.ps1,.sql,.lua,.r,.pl,.scala,.dart,.vue,.svelte,.yaml,.yml,.toml,.ini,.conf,.cfg,.xml,.properties,.env'
const MAX_DOC_SIZE = 10 * 1024 * 1024

export default function ChatAssistantPage() {
  const dialog = useAppDialog()
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(null) // { sessionId, content, text, thinking, toolStatus, stopped, error, manual }
  const [cost, setCost] = useState(0)
  const [points, setPoints] = useState(() => readUser()?.points ?? 0)
  const [reasoningEffort, setReasoningEffort] = useState(() => localStorage.getItem('chat_reasoning_effort') || 'auto')
  const [modelInfo, setModelInfo] = useState(null) // { label, reasoning_efforts, ... }（激活模型档案）
  const [models, setModels] = useState([]) // 全部启用的模型档案
  const [chatModelId, setChatModelId] = useState(() => {
    try { return localStorage.getItem('chat_model_id') || '' } catch { return '' }
  }) // '' = 激活模型
  const [uploadNote, setUploadNote] = useState('')
  // 会话文档列表（对齐 AI 绘画参考图交互）：{id,name,ext,size,status,progress,error,file_id,char_count,file}
  const [docs, setDocs] = useState([])
  const fileRef = useRef(null)
  const docStartedRef = useRef(new Set())
  const docAbortRef = useRef(new Map())
  const [sessionListOpen, setSessionListOpen] = useState(false)
  const [renaming, setRenaming] = useState(null) // { id, title }
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
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
  const modelIdRef = useRef(chatModelId)
  const [pendingQueue, setPendingQueue] = useState([])

  const activeSession = sessions.find(s => s.id === activeId) || null
  // 当前选中的模型档案（未选或记忆无效 → 激活模型）
  const chatModel = models.find(m => m.model_id === chatModelId) || modelInfo
  // 可选模型：已配置接口（base_url/api_key 至少一个）的模型 + 激活模型（走全局配置，始终可选）
  const configuredModels = models.filter(m => m.base_url || m.api_key)
  const activeModelItem = modelInfo ? (models.find(m => m.model_id === modelInfo.model_id) || modelInfo) : null
  const selectableModels = [...configuredModels]
  if (activeModelItem && !selectableModels.some(m => m.model_id === activeModelItem.model_id)) {
    selectableModels.push(activeModelItem)
  }

  // latest-ref：每次渲染后同步，让异步回调能读到最新值
  useEffect(() => {
    pointsRef.current = points
    activeIdRef.current = activeId
    effortRef.current = reasoningEffort
    modelIdRef.current = chatModelId
  })

  // 初始加载：模型档案、余额、会话列表
  useEffect(() => {
    chatAPI.model().then(res => {
      setModelInfo(res.data || null)
    }).catch(() => {})
    chatAPI.models().then(res => {
      const items = (res.data?.items || []).filter(m => m.enabled)
      setModels(items)
      // 本地记忆的模型必须已配置接口（base_url/api_key 至少一个）；未配置或不存在时回退激活模型
      const saved = (() => { try { return localStorage.getItem('chat_model_id') || '' } catch { return '' } })()
      const usable = items.filter(m => m.base_url || m.api_key)
      const savedOk = saved && (usable.length ? usable.some(m => m.model_id === saved) : false)
      if (!savedOk) {
        setChatModelId('')
        try { localStorage.removeItem('chat_model_id') } catch {}
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

  // 单次消耗积分随所选模型变化（未定价模型后端回退全局配置）
  useEffect(() => {
    chatAPI.cost(chatModelId).then(res => setCost(Number(res.data?.cost_per_chat) || 0)).catch(() => {})
  }, [chatModelId])

  // 切换模型时校验思考档位：不在新模型档位内则回退其默认档位
  useEffect(() => {
    const efforts = chatModel?.reasoning_efforts
    if (Array.isArray(efforts) && efforts.length && !efforts.includes(reasoningEffort)) {
      const fb = chatModel?.default_reasoning_effort || 'auto'
      setReasoningEffort(fb) // eslint-disable-line react-hooks/set-state-in-effect -- 模型切换时同步档位是受控状态调整
      try { localStorage.setItem('chat_reasoning_effort', fb) } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatModel?.model_id, chatModelId])

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
    sendingRef.current = { sessionId: null, content, text: '', thinking: '', toolStatus: null, stopped: false, error: '', manual: false }
    return true
  }, [])
  const releaseSendLock = useCallback(() => { sendingRef.current = null }, [])

  // 打开文件选择器（对齐 AI 绘画 openFilePicker：优先原生 showPicker）
  const openFilePicker = useCallback(() => {
    const input = fileRef.current
    if (!input) return
    input.value = ''
    if (typeof input.showPicker === 'function') {
      try { input.showPicker(); return } catch { input.click(); return }
    }
    input.click()
  }, [])

  const updateDoc = useCallback((id, patch) => {
    setDocs(prev => prev.map(d => d.id === id
      ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d))
  }, [])

  // 选择文件：扩展名/大小校验 + 单次 5 个 + 会话 20 个上限截取
  const handleFilesSelected = useCallback(e => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const sid = activeIdRef.current
    if (!sid) { setUploadNote('请先创建/选择会话再上传文档'); return }
    let picked = files
    if (picked.length > MAX_BATCH) {
      setUploadNote(`一次最多上传 ${MAX_BATCH} 个文件，已自动截取前 ${MAX_BATCH} 个`)
      picked = picked.slice(0, MAX_BATCH)
    }
    const valid = []
    const errors = []
    for (const f of picked) {
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      if (!DOC_EXTS.has(ext)) { errors.push(`「${f.name}」格式不支持`); continue }
      if (f.size > MAX_DOC_SIZE) { errors.push(`「${f.name}」超过 10MB`); continue }
      valid.push(f)
    }
    if (errors.length) setUploadNote(errors.slice(0, 3).join('；'))
    setDocs(prev => {
      const remaining = MAX_DOCS - prev.length
      if (remaining <= 0) { setUploadNote(`最多只能上传 ${MAX_DOCS} 个文档`); return prev }
      if (valid.length > remaining) setUploadNote(`最多只能上传 ${MAX_DOCS} 个文档，已自动截取前 ${remaining} 个`)
      const items = valid.slice(0, Math.max(0, remaining)).map(f => ({
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        ext: (f.name.split('.').pop() || '').toLowerCase(),
        size: f.size,
        status: 'pending',
        progress: 0,
        error: '',
        file_id: null,
        char_count: null,
        file: f,
      }))
      return [...prev, ...items]
    })
  }, [])

  // 上传单个文档（进度/成功/失败状态，对齐绘画页 uploadItem）
  const startDocUpload = useCallback(async item => {
    const sid = activeIdRef.current
    if (!sid) { updateDoc(item.id, { status: 'error', error: '无会话' }); return }
    docStartedRef.current.add(item.id)
    const controller = new AbortController()
    docAbortRef.current.set(item.id, controller)
    updateDoc(item.id, { status: 'uploading', progress: 0, error: '' })
    try {
      const { data } = await chatAPI.uploadDoc(sid, item.file, {
        signal: controller.signal,
        onProgress: p => updateDoc(item.id, d => d && d.status !== 'success' ? { ...d, progress: p } : d),
      })
      if (controller.signal.aborted) return
      updateDoc(item.id, {
        status: 'success',
        progress: 100,
        file_id: data?.file_id,
        char_count: data?.char_count,
        file: null,
      })
    } catch (err) {
      if (controller.signal.aborted) return
      updateDoc(item.id, { status: 'error', error: err?.message || '上传失败', progress: 0 })
    } finally {
      docAbortRef.current.delete(item.id)
      docStartedRef.current.delete(item.id)
    }
  }, [updateDoc])

  useEffect(() => {
    for (const doc of docs) {
      if (doc.status === 'pending' && !docStartedRef.current.has(doc.id)) void startDocUpload(doc)
    }
  }, [docs, startDocUpload])

  // 移除文档标签（本地移除；服务器文件随会话删除级联清理，后端暂无单删接口）
  const removeDoc = useCallback(id => {
    docAbortRef.current.get(id)?.abort()
    setDocs(prev => prev.filter(d => d.id !== id))
  }, [])

  const startStream = useCallback((sessionId, content, reasoningEffort = 'auto') => {
    const controller = new AbortController()
    abortRef.current = controller
    const st = { sessionId, content, text: '', thinking: '', toolStatus: null, stopped: false, error: '', manual: false }
    sendingRef.current = st
    setSending(st)
    chatAPI.sendStream(sessionId, content, {
      signal: controller.signal,
      reasoning_effort: reasoningEffort,
      model_id: modelIdRef.current,
      onChunk: data => setSending(prev =>
        (prev && prev.sessionId === sessionId) ? { ...prev, text: (prev.text || '') + String(data.text || '') } : prev),
      onThinking: data => setSending(prev =>
        (prev && prev.sessionId === sessionId) ? { ...prev, thinking: (prev.thinking || '') + String(data.text || '') } : prev),
      onToolStatus: data => setSending(prev =>
        (prev && prev.sessionId === sessionId)
          ? { ...prev, toolStatus: data?.status === 'done' ? null : { name: data?.name || '', status: data?.status || 'executing' } }
          : prev),
      onDone: data => {
        const full = String(data.text || '')
        const thinking = String(data.thinking || '')
        manualStopRef.current = false
        setMessages(prev => [...prev, { id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: full, thinking, created_at: new Date().toISOString() }])
        // 发送成功：文件已上传为会话上下文，清空上传区（失败时保留 docs 便于重试）
        setDocs([])
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

  // ============ 批量删除 ============
  const handleEnterBatch = () => {
    cancelRename()
    setBatchMode(true)
    setSelectedIds([])
  }
  const handleToggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const handleSelectAll = () => {
    setSelectedIds(prev => prev.length === sessions.length ? [] : sessions.map(s => s.id))
  }
  const handleExitBatch = () => {
    setBatchMode(false)
    setSelectedIds([])
  }
  const handleBatchDelete = async () => {
    if (!selectedIds.length) return
    const ok = await dialog.confirm(`确定删除选中的 ${selectedIds.length} 个会话吗？删除后聊天记录将无法恢复。`)
    if (!ok) return
    try {
      const res = await chatAPI.batchDeleteSessions(selectedIds)
      const deleted = Number(res.data?.deleted) || 0
      const delSet = new Set(selectedIds)
      const next = sessions.filter(s => !delSet.has(s.id))
      setSessions(next)
      if (delSet.has(activeId)) {
        manualStopRef.current = true
        abortRef.current?.abort()
        sendingRef.current = null
        setSending(null)
        clearPending()
        if (next.length) {
          activeIdRef.current = next[0].id
          setActiveId(next[0].id)
        } else {
          activeIdRef.current = null
          setActiveId(null)
          setMessages([])
        }
      }
      setBatchMode(false)
      setSelectedIds([])
      dialog.alert(`已删除 ${deleted} 个会话`)
    } catch (err) {
      dialog.alert(err.message || '批量删除失败')
    }
  }

  const handleStop = () => { manualStopRef.current = true; abortRef.current?.abort() }

  const handleReasoningEffort = (v) => {
    setReasoningEffort(v)
    try { localStorage.setItem('chat_reasoning_effort', v) } catch {}
  }

  const handleSelectModel = (id) => {
    setChatModelId(id)
    try { localStorage.setItem('chat_model_id', id) } catch { /* 忽略 localStorage 异常 */ }
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
            onRenamingCommit={commitRename} onRenamingCancel={cancelRename}
            batchMode={batchMode} selectedIds={selectedIds}
            onEnterBatch={handleEnterBatch} onSelectAll={handleSelectAll}
            onToggleSelect={handleToggleSelect} onBatchDelete={handleBatchDelete}
            onExitBatch={handleExitBatch} />
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
                  onRenamingCommit={commitRename} onRenamingCancel={cancelRename}
                  batchMode={batchMode} selectedIds={selectedIds}
                  onEnterBatch={handleEnterBatch} onSelectAll={handleSelectAll}
                  onToggleSelect={handleToggleSelect} onBatchDelete={handleBatchDelete}
                  onExitBatch={handleExitBatch} />
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

          <input ref={fileRef} type="file" className="hidden" multiple
            accept={DOC_ACCEPT}
            onChange={handleFilesSelected} />
          <ChatInputBar inputRef={inputRef} value={input} onChange={setInput}
            onSend={handleSend} onStop={handleStop} sending={!!sending} cost={cost} points={points}
            reasoningEffort={reasoningEffort} onReasoningEffort={handleReasoningEffort}
            efforts={chatModel?.reasoning_efforts} modelLabel={chatModel?.label || modelInfo?.label || modelInfo?.model_id}
            pendingQueue={pendingQueue} onEditPending={editPending} onRemovePending={removePending}
            models={selectableModels} chatModelId={chatModelId} onSelectModel={handleSelectModel}
            onUploadClick={openFilePicker} docs={docs} onRemoveDoc={removeDoc}
            uploadingCount={docs.filter(d => d.status === 'uploading' || d.status === 'pending').length}
            uploadNote={uploadNote} />
        </div>
      </div>
      <style>{MD_STYLES}</style>
    </MainLayout>
  )
}

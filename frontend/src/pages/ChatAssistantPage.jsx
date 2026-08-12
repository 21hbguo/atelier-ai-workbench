import { useState, useEffect, useRef, useCallback } from 'react'
import { MessageCircle, Plus, Trash2, Pencil, X, Send, Square, RefreshCw, Copy, ChevronLeft, Brain, AlertCircle, CheckSquare, Cpu, ChevronDown, Check, Paperclip, FileText, Settings, Globe } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import { useAppDialog } from '../components/AppDialogProvider'
import { chatAPI, pointsAPI } from '../api'
import { readUser } from '../auth'
import { mdToHtml } from '../utils/markdown'
import WidgetViewer from '../components/WidgetViewer'

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
.chat-user-link{color:var(--accent);text-decoration:underline;word-break:break-all}
.md-body img{max-width:100%;border-radius:10px;margin:.4em 0;display:block}
.md-body hr{border:none;border-top:1px solid var(--border-color);margin:.8em 0}
.md-body table{border-collapse:collapse;margin:.5em 0;width:100%;font-size:13px;display:block;overflow-x:auto}
.md-body th,.md-body td{border:1px solid var(--border-color);padding:6px 10px;text-align:left}
.md-body th{background:color-mix(in srgb,var(--accent) 8%,transparent);font-weight:600}
.md-body strong{font-weight:700}
.md-body .katex-clickable{cursor:pointer;border-radius:6px;transition:background .15s,box-shadow .15s;padding:0 3px}
.md-body .katex-clickable:hover{background:color-mix(in srgb,var(--accent) 10%,transparent)}
.md-body .katex-clickable.katex-copied{box-shadow:0 0 0 1.5px var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent)}
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

// ============ 用户消息裸 URL 链接化（安全：先 HTML 转义再替换，防 XSS） ============
const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

// 在【已转义】文本上匹配裸 http(s) URL：转义后文本不含裸 < > " '，
// href 直接取转义片段（&amp; 等在属性值中合法），天然无法逃逸属性/注入脚本。
const USER_URL_RE = /(https?:\/\/[^\s<>"'）】。，；：！？、]+)/g
const URL_TRAIL_RE = /[),.:!?\]}>"'）】。，：！？、]+$/ // 去掉 URL 尾部常见标点
const linkifyUserText = (text) => escapeHtml(text).replace(USER_URL_RE, (m) => {
  const url = m.replace(URL_TRAIL_RE, '')
  return `<a class="chat-user-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
})

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
function ThinkingBlock({ text, isStreaming = false }) {
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
        {isStreaming && <span className="flex-shrink-0 text-[10px]" style={{ color: 'var(--accent)' }}>思考中 {text.length} 字…</span>}
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

// ============ 引用来源卡片（SSE citations 事件，最多显示 8 条；兼容 {url,title,snippet?}） ============
function CitationList({ citations = [] }) {
  if (!Array.isArray(citations) || citations.length === 0) return null
  const shown = citations.slice(0, 8)
  return (
    <div className="mt-2.5 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
      <div className="mb-1.5 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>来源</div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {shown.map((c, i) => {
          let host = ''
          try { host = c.url ? new URL(c.url).host : '' } catch { /* 非法 URL 不显示域名 */ }
          return (
            <a key={c.url || i} href={c.url} target="_blank" rel="noopener noreferrer"
              className="block min-w-0 rounded-lg border p-2 transition-colors hover:bg-bg-hover"
              style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
              <div className="flex items-center gap-1.5 min-w-0">
                {host && (
                  <img src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`} alt=""
                    className="w-4 h-4 flex-shrink-0 rounded-sm"
                    onError={e => { e.target.style.display = 'none' }} />
                )}
                <span className="min-w-0 truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  {c.title || host || c.url}
                </span>
              </div>
              {host && (
                <div className="mt-0.5 truncate text-[10px]" style={{ color: 'var(--text-secondary)' }}>{host}</div>
              )}
              {c.snippet && (
                <div className="mt-1 line-clamp-2 text-[10px] leading-snug" style={{ color: 'var(--text-secondary)' }}>{c.snippet}</div>
              )}
            </a>
          )
        })}
      </div>
    </div>
  )
}

// ============ 消息气泡 ============
function MessageItem({ msg, onCopy, onRegenerate }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-4 animate-fade-in-up group`}>
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
            <div className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}
              dangerouslySetInnerHTML={{ __html: linkifyUserText(msg.content) }} />
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
            <CitationList citations={msg.citations} />
            <WidgetViewer widgets={msg.widgets} />
          </>
        )}
        <div className="text-xs mt-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{formatTime(msg.created_at)}</div>
      </div>
      {/* 操作按钮：放在气泡下方，小图标 + hover 提示；移动端始终可见（不再依赖 hover 显示） */}
      {!isUser && !msg.error && (
        <div className="flex items-center gap-0.5 mt-1 ml-1">
          <button onClick={() => onCopy(msg.content)} title="复制"
            className="p-1 rounded-lg hover:bg-bg-hover transition-colors"
            style={{ color: 'var(--text-secondary)' }}>
            <Copy size={12} />
          </button>
          <button onClick={() => onRegenerate(msg)} title="重新回答"
            className="p-1 rounded-lg hover:bg-bg-hover transition-colors"
            style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

// ============ 排队中的待发送消息（对话区即时回显） ============
// 成功入队的消息立即在对话区显示「用户问题 + 等待动画」，轮到它时占位移除、
// 由 sendQueuedNext 正常进入流式（用户消息入 messages + StreamBubble）。
function PendingQueueBubbles({ items }) {
  return (
    <>
      {items.map(item => (
        <div key={item.id}>
          {/* 用户消息（已成功排队，立即回显；携带已上传文件引用） */}
          <div className="flex justify-end mb-4 animate-fade-in-up">
            <div className="relative max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3"
              style={{ background: 'var(--bg-user-bubble)' }}>
              {item.files?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {item.files.map(f => (
                    <span key={f.id || f.original_name} title={f.original_name || '文件'}
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
              <div className="text-sm whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}
                dangerouslySetInnerHTML={{ __html: linkifyUserText(item.text) }} />
            </div>
          </div>
          {/* 等待占位（模型思考动画） */}
          <div className="flex justify-start mb-4 animate-fade-in-up">
            <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3"
              style={{ background: 'var(--bg-ai-bubble)', boxShadow: 'var(--shadow-md)' }}>
              <div className="flex items-center gap-1.5 py-1">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-secondary)' }} />
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-secondary)', animationDelay: '0.15s' }} />
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-secondary)', animationDelay: '0.3s' }} />
                <span className="ml-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>已排队，等待前面的回复完成后开始…</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

// ============ 流式输出中的 AI 气泡 ============
function StreamBubble({ sending, onStop, onRetry }) {
  const hasText = sending.text.length > 0
  return (
    <div className="flex justify-start mb-4 animate-fade-in-up">
      <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3" style={{ background: 'var(--bg-ai-bubble)', boxShadow: 'var(--shadow-md)' }}>
        <ThinkingBlock text={sending.thinking} isStreaming={!sending.stopped} />
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
        <CitationList citations={sending.citations} />
        <WidgetViewer widgets={sending.widgets} />
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
          <button key={q} onClick={() => onPick(q)} title="点击立即发送这个问题"
            className="text-left text-sm px-4 py-3 rounded-2xl transition-colors hover:bg-bg-hover group flex items-center gap-2"
            style={{ border: '1px solid var(--border-color)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}>
            <span className="flex-1 min-w-0">{q}</span>
            <Send size={13} className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--accent)' }} />
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

function ChatInputBar({ inputRef, value, onChange, onSend, onStop, sending, cost, points, reasoningEffort, onReasoningEffort, efforts, modelLabel, pendingQueue, onEditPending, onRemovePending, models, chatModelId, onSelectModel, onUploadClick, docs, onRemoveDoc, uploadingCount, uploadNote, webSearch, onWebSearch, linkStatus, dragActive, dragHandlers }) {
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
          {/* 思考强度：点击弹出下拉面板（与模型选择同款交互，选项按 auto→max 上下排列） */}
          <div className="relative">
            <button onClick={() => setEffortOpen(v => !v)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors"
              style={{
                background: reasoningEffort !== 'auto' ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-card)',
                borderColor: reasoningEffort !== 'auto' ? 'var(--accent)' : 'var(--border-color)',
                color: reasoningEffort !== 'auto' ? 'var(--accent)' : 'var(--text-secondary)',
              }}>
              <Brain size={13} />
              <span>思考：{EFFORT_OPTIONS.find(o => o.value === reasoningEffort)?.label || '自动'}</span>
              <ChevronDown size={11} className={effortOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
            {effortOpen && (
              <div className="absolute left-0 bottom-full mb-1.5 z-50 w-60 max-h-[45dvh] overflow-y-auto rounded-xl p-1 model-dropdown-scroll"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-md)' }}>
                {EFFORT_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => { onReasoningEffort(opt.value); setEffortOpen(false) }}
                    className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-bg-hover transition-colors"
                    style={{ background: reasoningEffort === opt.value ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent' }}>
                    <span className="flex-1 min-w-0 text-xs font-medium" style={{ color: reasoningEffort === opt.value ? 'var(--accent)' : 'var(--text-primary)' }}>
                      {opt.label}
                    </span>
                    {reasoningEffort === opt.value && <Check size={13} style={{ color: 'var(--accent)' }} />}
                  </button>
                ))}
              </div>
            )}
          </div>
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
        {/* 链接访问状态（url_status 事件：fetching/ok/failed） */}
        {linkStatus && (
          <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] truncate animate-fade-in-up"
            style={{ color: linkStatus.status === 'failed' ? 'var(--color-error)' : linkStatus.status === 'ok' ? 'var(--color-success)' : 'var(--text-secondary)' }}>
            {linkStatus.status === 'fetching' && <Globe size={11} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent)' }} />}
            {linkStatus.status === 'fetching' && <span>正在访问链接{linkStatus.url ? `：${linkStatus.url}` : '…'}</span>}
            {linkStatus.status === 'ok' && <span>已获取链接内容</span>}
            {linkStatus.status === 'failed' && <span>链接访问失败：{linkStatus.error || '未知错误'}</span>}
          </div>
        )}
        {/* 卡片式输入区：布局对齐绘画页 ChatInput（设置|上传在左，发送在右） */}
        <div className="rounded-2xl border transition-all duration-300"
          style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-md)', position: 'relative' }}
          {...dragHandlers}>
          {/* 拖拽上传高亮覆盖层（pointer-events-none 保证 drop 落到本容器） */}
          {dragActive && (
            <div className="absolute inset-0 z-10 rounded-2xl flex items-center justify-center pointer-events-none"
              style={{ background: 'color-mix(in srgb, var(--bg-ai-bubble) 92%, transparent)', border: '2px dashed var(--accent)' }}>
              <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>松开鼠标上传文件</span>
            </div>
          )}
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
            {/* 粘贴链接轻提示：输入含 http(s):// 时实时显示 */}
            {/https?:\/\//i.test(value) && (
              <div className="px-2.5 pb-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>发送后将自动访问该链接内容</div>
            )}
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center flex-shrink-0 whitespace-nowrap gap-0.5">
                {/* 模型选择（与上传/联网搜索并排，样式统一） */}
                {models.length > 0 ? (
                  <div className="relative">
                    <button type="button" onClick={() => setModelOpen(v => !v)} title="选择模型"
                      className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg hover:bg-bg-hover transition-colors"
                      style={{ color: activeModel ? 'var(--accent)' : 'var(--text-secondary)' }}>
                      <Cpu size={15} />
                      <span className="text-[11px] leading-none max-w-[8.5rem] truncate">{activeModel?.label || modelLabel || '模型'}</span>
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
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-1 text-[11px] leading-none" style={{ color: 'var(--accent)' }}>
                      <Cpu size={15} />
                      {modelLabel}
                    </span>
                  )
                )}
                {/* 搜索开关（默认关闭；开启后回答会实时检索互联网） */}
                <button type="button" onClick={onWebSearch}
                  title={webSearch ? '联网已开启：模型会按需实时检索互联网' : '联网已关闭：模型不联网，仅凭知识回答'}
                  className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg transition-colors"
                  style={{
                    color: webSearch ? 'var(--accent)' : 'var(--text-secondary)',
                    background: webSearch ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  }}>
                  <Globe size={15} />
                  <span className="text-[11px] leading-none">搜索</span>
                </button>
                <button type="button" onClick={onUploadClick}
                  title="上传文档/代码（txt/md/csv/pdf/docx/xlsx/pptx/py/js/ts/go/yaml 等 50+ 格式；一次最多 5 个，会话累计最多 20 个）"
                  className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg hover:bg-bg-hover transition-colors"
                  style={{ color: 'var(--text-secondary)' }}>
                  <Paperclip size={15} />
                  <span className="text-[11px] leading-none">{uploadingCount > 0 ? `上传中 ${uploadingCount}` : '上传'}</span>
                </button>
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
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)
  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2000)
  }, [])
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current) }, [])
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(null) // { sessionId, content, text, thinking, toolStatus, stopped, error, manual }
  // 链接抓取状态（SSE url_status 事件）：{ status: 'fetching'|'ok'|'failed', url, error } | null
  const [linkStatus, setLinkStatus] = useState(null)
  const linkTimerRef = useRef(null)
  const clearLinkTimer = useCallback(() => {
    if (linkTimerRef.current) { clearTimeout(linkTimerRef.current); linkTimerRef.current = null }
  }, [])
  // fetching 持续显示；ok/failed 短暂显示后自动消失（ok 2.5s / failed 5s）
  const updateLinkStatus = useCallback((status, url, error) => {
    clearLinkTimer()
    if (status === 'fetching') { setLinkStatus({ status, url, error }); return }
    setLinkStatus({ status, url, error })
    linkTimerRef.current = setTimeout(() => setLinkStatus(null), status === 'ok' ? 2500 : 5000)
  }, [clearLinkTimer])
  useEffect(() => () => clearLinkTimer(), [clearLinkTimer])
  const [cost, setCost] = useState(0)
  const [points, setPoints] = useState(() => readUser()?.points ?? 0)
  const [reasoningEffort, setReasoningEffort] = useState(() => localStorage.getItem('chat_reasoning_effort') || 'auto')
  const [modelInfo, setModelInfo] = useState(null) // { label, reasoning_efforts, ... }（激活模型档案）
  const [models, setModels] = useState([]) // 全部启用的模型档案
  const [chatModelId, setChatModelId] = useState(() => {
    try { return localStorage.getItem('chat_model_id') || '' } catch { return '' }
  }) // '' = 激活模型
  // 联网开关（默认开启：模型自主判断是否需要联网；偏好持久化到 localStorage，显式关闭过才关）
  const [webSearch, setWebSearch] = useState(() => {
    try { return localStorage.getItem('chat_web_search') !== '0' } catch { return true }
  })
  const toggleWebSearch = useCallback(() => {
    setWebSearch(prev => {
      const next = !prev
      try { localStorage.setItem('chat_web_search', next ? '1' : '0') } catch {}
      return next
    })
  }, [])
  const webSearchRef = useRef(webSearch)
  webSearchRef.current = webSearch
  const [uploadNote, setUploadNote] = useState('')
  // 上传提示自动消失（timer 重置式：新提示重置计时，6 秒后清除）
  const uploadNoteTimerRef = useRef(null)
  const showUploadNote = useCallback((text) => {
    setUploadNote(text)
    if (uploadNoteTimerRef.current) clearTimeout(uploadNoteTimerRef.current)
    uploadNoteTimerRef.current = setTimeout(() => setUploadNote(''), 6000)
  }, [])
  // 会话文档列表（对齐 AI 绘画参考图交互）：{id,name,ext,size,status,progress,error,file_id,char_count,file}
  const [docs, setDocs] = useState([])
  const fileRef = useRef(null)
  // 拖拽上传：输入区高亮状态 + dragenter/dragleave 配对计数（防闪烁）
  const [dragActive, setDragActive] = useState(false)
  const dragCounterRef = useRef(0)
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
  // 新建会话后本地消息已就绪（handleSend/sendQueuedNext 已 setMessages），
  // 跳过 useEffect([activeId]) 的异步加载，避免「空列表覆盖本地用户消息」的竞态丢消息
  const skipMessagesLoadRef = useRef(null)
  const effortRef = useRef(reasoningEffort)
  const modelIdRef = useRef(chatModelId)
  // 流式渲染节流：chunk/thinking 高频到达时按帧合并 setState，
  // 避免 mdToHtml 全量重渲染导致 UI 卡顿（感知为「卡顿后一次性出大量文本」）
  const streamBufRef = useRef({ streamId: null, text: '', thinking: '' })
  const streamRafRef = useRef(null)
  // 本次流的引用来源累积（SSE citations 事件；按 url 去重，streamId 绑定防旧流迟到污染）
  const citationsRef = useRef({ streamId: null, items: [] })
  // 本次流的 widget 累积（SSE widget 事件；streamId 绑定防旧流迟到污染，模式同 citationsRef）
  const widgetsRef = useRef({ streamId: null, items: [] })
  const flushStreamBuf = useCallback(() => {
    streamRafRef.current = null
    const { streamId: sid, text, thinking } = streamBufRef.current
    setSending(prev => (prev && prev.streamId === sid) ? { ...prev, text, thinking } : prev)
  }, [])
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
    pointsAPI.balance().then(res => setPoints(Number(res.data?.points || 0))).catch(() => {})
    chatAPI.sessions().then(res => {
      const items = res.data?.items || []
      setSessions(items)
      // 不自动选中最近会话：每次进入页面显示引导页（快速新建会话），
      // 历史会话保留在侧边栏，点击后才进入；引导页直接对话时 handleSend 自动建新会话（无感）
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
    if (skipMessagesLoadRef.current === activeId) { skipMessagesLoadRef.current = null; return }
    skipMessagesLoadRef.current = null // 残留标记（如切换会话后）一并清掉
    let active = true
    setMessagesLoading(true)
    chatAPI.messages(activeId).then(res => {
      if (active) setMessages(res.data?.items || [])
    }).catch(err => {
      if (active) dialog.alert(err.message || '加载消息失败')
    }).finally(() => { if (active) setMessagesLoading(false) })
    return () => { active = false }
  }, [activeId, dialog])

  // 公式点击复制：dangerouslySetInnerHTML 注入的内容无法绑 React 事件，用全局事件委托
  useEffect(() => {
    const onClick = async (e) => {
      const el = e.target.closest?.('.katex-clickable')
      if (!el) return
      const latex = el.getAttribute('data-latex')
      if (latex == null) return
      e.preventDefault()
      e.stopPropagation()
      const ok = await copyText(latex)
      if (ok) {
        el.classList.add('katex-copied')
        el.title = '已复制'
        showToast('公式已复制')
        setTimeout(() => { el.classList.remove('katex-copied'); el.title = '点击复制公式' }, 1200)
      } else {
        showToast('复制失败', 'error')
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [showToast])

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, messagesLoading, sending?.text, sending?.stopped, pendingQueue])

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

  // 文件入队：扩展名/大小校验 + 单次 5 个 + 会话 20 个上限截取（文件选择器与拖拽上传共用）
  const addDocs = useCallback((files) => {
    if (!files || !files.length) return
    const sid = activeIdRef.current
    if (!sid) { showUploadNote('请先创建/选择会话再上传文档'); return }
    let picked = files
    if (picked.length > MAX_BATCH) {
      showUploadNote(`一次最多上传 ${MAX_BATCH} 个文件，已自动截取前 ${MAX_BATCH} 个`)
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
    if (errors.length) showUploadNote(errors.slice(0, 3).join('；'))
    setDocs(prev => {
      const remaining = MAX_DOCS - prev.length
      if (remaining <= 0) { showUploadNote(`最多只能上传 ${MAX_DOCS} 个文档`); return prev }
      if (valid.length > remaining) showUploadNote(`最多只能上传 ${MAX_DOCS} 个文档，已自动截取前 ${remaining} 个`)
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

  // 文件选择器选择：转交 addDocs 统一校验入队
  const handleFilesSelected = useCallback(e => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    addDocs(files)
  }, [addDocs])

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

  // 拖拽上传：window 级 dragover/drop 阻止浏览器直接打开文件
  // （仅拦截含文件的拖拽；文本/链接拖拽放行浏览器默认行为，如拖入输入框插入文本）
  useEffect(() => {
    const preventFileDefault = (e) => {
      if (e.dataTransfer?.types?.includes?.('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', preventFileDefault)
    window.addEventListener('drop', preventFileDefault)
    return () => {
      window.removeEventListener('dragover', preventFileDefault)
      window.removeEventListener('drop', preventFileDefault)
    }
  }, [])

  // 拖拽上传：输入区高亮 + drop 入队（复用 addDocs 校验链路，pending 由现有 effect 自动上传）
  const handleDragEnter = useCallback((e) => {
    e.preventDefault()
    if (!e.dataTransfer?.types?.includes?.('Files')) return // 非文件拖拽不拦截
    dragCounterRef.current += 1
    setDragActive(true)
  }, [])
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    if (!e.dataTransfer?.types?.includes?.('Files')) return
    e.dataTransfer.dropEffect = 'copy'
  }, [])
  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) setDragActive(false)
  }, [])
  const handleDropFiles = useCallback((e) => {
    const hasFiles = e.dataTransfer?.items
      ? Array.from(e.dataTransfer.items).some(it => it.kind === 'file')
      : (e.dataTransfer?.files?.length > 0)
    if (!hasFiles) return // 非文件拖拽（文本/链接）：放行浏览器默认行为
    e.preventDefault()
    dragCounterRef.current = 0
    setDragActive(false)
    addDocs(Array.from(e.dataTransfer.files || []))
  }, [addDocs])
  const dragHandlers = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDropFiles,
  }

  const startStream = useCallback((sessionId, content, reasoningEffort = 'auto', useWeb = null, localUserMsgId = null) => {
    const controller = new AbortController()
    abortRef.current = controller
    // 流的唯一身份：停止后立刻发新消息时，旧流的迟到回调不会误操作新流
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const st = { streamId, sessionId, content, text: '', thinking: '', toolStatus: null, citations: [], widgets: [], stopped: false, error: '', manual: false }
    sendingRef.current = st
    setSending(st)
    // 本次流开始：重置节流缓冲（避免残留上一流的未 flush 内容）
    streamBufRef.current = { streamId, text: '', thinking: '' }
    // 本次流开始：重置引用累积（避免上一流的 citations 残留）
    citationsRef.current = { streamId, items: [] }
    // 本次流开始：重置 widget 累积（避免上一流的 widgets 残留）
    widgetsRef.current = { streamId, items: [] }
    // 本次流开始：重置链接抓取状态（避免上一流的 url_status 残留）
    clearLinkTimer(); setLinkStatus(null)
    if (streamRafRef.current) { cancelAnimationFrame(streamRafRef.current); streamRafRef.current = null }
    chatAPI.sendStream(sessionId, content, {
      signal: controller.signal,
      reasoning_effort: reasoningEffort,
      model_id: modelIdRef.current,
      web_search: useWeb === null ? webSearchRef.current : useWeb,
      onUserMessageId: data => {
        const realId = data?.message_id
        if (!realId || !localUserMsgId) return
        // 精确替换本次发送的 user 消息临时 id（重新回答需定位数据库 id）；
        // 只替换本次消息，避免误伤历史残留的 local- 消息
        setMessages(prev => prev.map(m => (m.id === localUserMsgId ? { ...m, id: String(realId) } : m)))
      },
      onChunk: data => {
        const buf = streamBufRef.current
        if (buf.streamId !== streamId) return
        buf.text += String(data.text || '')
        if (!streamRafRef.current) streamRafRef.current = requestAnimationFrame(flushStreamBuf)
      },
      onThinking: data => {
        const buf = streamBufRef.current
        if (buf.streamId !== streamId) return
        buf.thinking += String(data.text || '')
        if (!streamRafRef.current) streamRafRef.current = requestAnimationFrame(flushStreamBuf)
      },
      onToolStatus: data => setSending(prev =>
        (prev && prev.streamId === streamId)
          ? { ...prev, toolStatus: data?.status === 'done' ? null : { name: data?.name || '', status: data?.status || 'executing' } }
          : prev),
      onUrlStatus: data => {
        // streamId 守卫（与 onToolStatus 一致）：旧流迟到的 url_status（抓取最长 10s）
        // 不得覆盖新流状态
        if (sendingRef.current?.streamId !== streamId) return
        updateLinkStatus(data?.status, data?.url, data?.error)
      },
      onCitations: data => {
        // streamId 守卫：旧流迟到的 citations 不得写入新流的累积
        const buf = citationsRef.current
        if (buf.streamId !== streamId) return
        const items = Array.isArray(data?.citations) ? data.citations : []
        for (const item of items) {
          if (!item || !item.url) continue
          if (!buf.items.some(x => x.url === item.url)) {
            buf.items.push({ url: item.url, title: item.title || '', snippet: item.snippet })
          }
        }
        // 同步发送中气泡：流式期间实时显示来源累积
        setSending(prev =>
          (prev && prev.streamId === streamId) ? { ...prev, citations: buf.items } : prev)
      },
      onWidget: data => {
        // streamId 守卫（与 onToolStatus/onCitations 一致）：旧流迟到的 widget 不得写入新流
        const buf = widgetsRef.current
        if (buf.streamId !== streamId) return
        const widget = data?.widget
        if (!widget || !widget.code) return
        buf.items.push(widget)
        // 同步发送中气泡：流式期间实时显示 widget 卡片
        setSending(prev =>
          (prev && prev.streamId === streamId) ? { ...prev, widgets: buf.items } : prev)
      },
      onDone: data => {
        const full = String(data.text || '')
        const thinking = String(data.thinking || '')
        manualStopRef.current = false
        // 优先用后端返回的数据库 id（重新回答/定位需要真实 id），缺失时回退本地临时 id
        const newId = data.message_id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        // 仅当仍是本次流时挂载累积的引用（旧流迟到 done 不污染新流消息）
        const citations = citationsRef.current.streamId === streamId ? citationsRef.current.items : []
        // 同上：widgets 仅当仍是本次流时挂载（取完再清理 sending，避免发送中状态已置 null 丢失）
        const widgets = widgetsRef.current.streamId === streamId ? widgetsRef.current.items : []
        setMessages(prev => [...prev, { id: newId, role: 'assistant', content: full, thinking, citations, widgets, created_at: new Date().toISOString() }])
        // 发送成功：文件已上传为会话上下文，清空上传区（失败时保留 docs 便于重试）
        setDocs([])
        // 流结束：若仍停留在 fetching（事件顺序异常），清除残留状态
        setLinkStatus(prev => prev?.status === 'fetching' ? null : prev)
        // 仅当仍是本次流时才清理状态（streamId 唯一身份，旧流迟到回调不影响新流）
        if (sendingRef.current?.streamId === streamId) {
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
        // 流异常结束（含手动停止）：若仍停留在 fetching，清除残留链接状态
        setLinkStatus(prev => prev?.status === 'fetching' ? null : prev)
        if (isManual) {
          // 手动停止：保留错误气泡 + 重试按钮，不自动继续队列
          if (sendingRef.current?.streamId === streamId) {
            sendingRef.current = { ...sendingRef.current, stopped: true, error: errMsg, manual: true }
          }
          setSending(prev =>
            (prev && prev.streamId === streamId) ? { ...prev, stopped: true, error: errMsg, manual: true } : prev)
        } else {
          // 自动失败：错误追加为消息，清空状态让队列继续自动发送
          if (sendingRef.current?.streamId === streamId) sendingRef.current = null
          setSending(prev => (prev && prev.streamId === streamId) ? null : prev)
          setMessages(prev => [...prev, { id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: '', error: errMsg, created_at: new Date().toISOString() }])
        }
        if (/积分不足|余额不足/.test(errMsg)) {
          dialog.alert(errMsg)
          pointsAPI.balance().then(res => setPoints(Number(res.data?.points || 0))).catch(() => {})
        }
      },
    }).finally(() => { if (abortRef.current === controller) abortRef.current = null })
  }, [dialog, refreshSessions, flushStreamBuf, clearLinkTimer, updateLinkStatus])

  // ============ 排队队列操作 ============
  const MAX_PENDING = 10
  const enqueuePending = (text, files = []) => {
    const item = { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, files }
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
    // 已成功上传的文件作为「引用」随消息发送（展示在对话区消息上，输入框标签立即移除）
    const successFiles = docs
      .filter(d => d.status === 'success' && d.file_id != null)
      .map(d => ({ id: d.file_id, original_name: d.name }))
    const clearSentDocs = () => setDocs(prev => prev.filter(d => d.status !== 'success'))
    // 正在生成中：进入排队队列，当前回复结束后自动发送
    if (sendingRef.current && !sendingRef.current.stopped) {
      if (pendingQueueRef.current.length >= MAX_PENDING) {
        dialog.alert(`排队消息最多 ${MAX_PENDING} 条，请等待发送或删除部分排队消息。`)
        focusInput()
        return
      }
      enqueuePending(text, successFiles)
      clearSentDocs()
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
        skipMessagesLoadRef.current = s.id // 本地消息已就绪，跳过首次加载
        setActiveId(s.id)
      } catch (err) {
        releaseSendLock()
        dialog.alert(err.message || '创建会话失败')
        return
      }
    }
    const userLocalId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setMessages(prev => [...prev, { id: userLocalId, role: 'user', content: text, files: successFiles, created_at: new Date().toISOString() }])
    clearSentDocs()
    startStream(sid, text, effortRef.current, null, userLocalId)
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
        skipMessagesLoadRef.current = s.id // 本地消息已就绪，跳过首次加载
        setActiveId(s.id)
      } catch (err) {
        releaseSendLock()
        dialog.alert(err.message || '创建会话失败')
        clearPending()
        return
      }
    }
    const userLocalId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setMessages(prev => [...prev, { id: userLocalId, role: 'user', content: item.text, files: item.files || [], created_at: new Date().toISOString() }])
    startStream(sid, item.text, effortRef.current, null, userLocalId)
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
    skipMessagesLoadRef.current = null // 切换会话不再跳过加载
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
      skipMessagesLoadRef.current = s.id // 新建会话消息为空，跳过首次加载避免竞态覆盖
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

  const handleStop = () => {
    manualStopRef.current = true
    abortRef.current?.abort()
    // 兜底：无论底层中断是否立即生效（abort 已释放/网络延迟），先把 UI 与发送锁
    // 切到「已停止」状态——杜绝「卡在思考中且停止无效」的假死（stopped 后即可发新消息）
    if (sendingRef.current && !sendingRef.current.stopped) {
      sendingRef.current = { ...sendingRef.current, stopped: true, error: '已停止生成', manual: true }
    }
    setSending(prev => (prev && !prev.stopped) ? { ...prev, stopped: true, error: '已停止生成' } : prev)
  }

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

  // 「重新回答」：删除该回答分支点（对应问题消息及之后全部），再复用 send_message
  // 链路重新发送同一问题 —— 扣费/退款/落库全部走现有逻辑，积分消耗与正常发送一致。
  const handleRegenerate = async (msg) => {
    if (!msg || msg.role !== 'assistant') return
    if (sendingRef.current && !sendingRef.current.stopped) {
      dialog.alert('请先停止当前生成，再重新回答')
      return
    }
    const sid = activeIdRef.current
    if (!sid) return
    const idx = messages.findIndex(m => m.id === msg.id)
    if (idx < 0) return
    // 往前找对应的用户问题消息
    let userMsg = null
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { userMsg = messages[i]; break }
    }
    if (!userMsg) { dialog.alert('找不到对应的问题消息'); return }
    if (/^(local-|err-)/.test(String(userMsg.id))) {
      dialog.alert('该问题尚未同步到服务器，请刷新后重试')
      return
    }
    const costText = cost > 0 ? `（消耗 ${cost} 积分）` : ''
    const ok = await dialog.confirm(`重新回答将删除本条回答及其后的对话${costText}，确定吗？`)
    if (!ok) return
    try {
      await chatAPI.deleteMessages(sid, userMsg.id)
    } catch (err) {
      dialog.alert(err.message || '操作失败，请重试')
      return
    }
    // 本地同步截断到问题消息之前，再重新插入该问题（新临时 id，流开始后由
    // user_message_id 事件替换为真实 id），然后重新发送
    const userLocalId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setMessages(prev => {
      const ui = prev.findIndex(m => m.id === userMsg.id)
      if (ui < 0) return prev
      return [...prev.slice(0, ui), { ...userMsg, id: userLocalId, created_at: new Date().toISOString() }]
    })
    startStream(sid, userMsg.content, effortRef.current, null, userLocalId)
  }

  const handleCopy = async (text) => {
    const ok = await copyText(String(text || ''))
    showToast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error')
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
                  {messages.map(msg => <MessageItem key={msg.id} msg={msg} onCopy={handleCopy} onRegenerate={handleRegenerate} />)}
                  {sending && <StreamBubble sending={sending} onStop={handleStop} onRetry={handleRetry} />}
                  {pendingQueue.length > 0 && <PendingQueueBubbles items={pendingQueue} />}
                </>
              )}
            </div>
          </div>

          <input ref={fileRef} type="file" className="hidden" multiple
            accept={DOC_ACCEPT}
            onChange={handleFilesSelected} />
          <ChatInputBar inputRef={inputRef} value={input} onChange={setInput}
            onSend={handleSend} onStop={handleStop} sending={!!sending && !sending?.stopped} cost={cost} points={points}
            reasoningEffort={reasoningEffort} onReasoningEffort={handleReasoningEffort}
            efforts={chatModel?.reasoning_efforts} modelLabel={chatModel?.label || modelInfo?.label || modelInfo?.model_id}
            pendingQueue={pendingQueue} onEditPending={editPending} onRemovePending={removePending}
            models={selectableModels} chatModelId={chatModelId} onSelectModel={handleSelectModel}
            onUploadClick={openFilePicker} docs={docs} onRemoveDoc={removeDoc}
            uploadingCount={docs.filter(d => d.status === 'uploading' || d.status === 'pending').length}
            uploadNote={uploadNote}
            webSearch={webSearch} onWebSearch={toggleWebSearch}
            linkStatus={linkStatus} dragActive={dragActive} dragHandlers={dragHandlers} />
        </div>
      </div>
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-20 z-50 pointer-events-none">
          <div className="px-3 py-1.5 rounded-lg text-xs font-medium animate-fade-in-up"
            style={{ background: toast.type === 'success' ? 'var(--color-success)' : 'var(--color-error)', color: '#fff', boxShadow: 'var(--shadow-md)' }}>
            {toast.message}
          </div>
        </div>
      )}
      <style>{MD_STYLES}</style>
    </MainLayout>
  )
}

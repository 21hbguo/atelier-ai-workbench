import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { Plus, Trash2, Pencil, X, Send, Square, RefreshCw, Copy, PanelLeftClose, PanelLeftOpen, Brain, AlertCircle, CheckSquare, Cpu, ChevronDown, Check, Paperclip, FileText, Settings, Globe, Image as ImageIcon, Search } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import GroupBuyBanner from '../components/GroupBuyBanner'
import { useAppDialog } from '../components/AppDialogProvider'
import { chatAPI, pointsAPI, subscriptionAPI, taskAPI } from '../api'
import { readUser } from '../auth'
import { mdToHtml } from '../utils/markdown'
import { saveBlob } from '../utils/download'
import WidgetViewer from '../components/WidgetViewer'
import FileCard from '../components/FileCard'
import { ModelLogo } from '../components/modelIcons'
import useDelayedQuotaRemaining from '../hooks/useDelayedQuotaRemaining'

// 模块级：assistant_message_id → task_id 映射缓存。
// 历史接口不返回 task_id（按契约），续传订阅时优先用此缓存匹配「同页面发送→切走→切回」；
// 缓存缺失时退化为轮询 messages 兜底（见 startResumePolling）。
const taskIdCache = new Map()
function rememberTaskId(assistantMessageId, taskId) {
  if (!assistantMessageId || !taskId) return
  taskIdCache.set(String(assistantMessageId), String(taskId))
  if (taskIdCache.size > 100) {
    const oldest = taskIdCache.keys().next().value
    if (oldest !== undefined) taskIdCache.delete(oldest)
  }
}
// 续传回放去重：续传订阅时后端会先快速回放已生成内容，而前端已用历史消息的 content
// 预填 sending.text。回放 chunk 累积文本若与预填文本前缀一致则跳过（防重复展示）；
// 一旦回放超出存量（进入实时增量），停用去重、返回增量文本。
// 返回 '' = 仍在回放存量内（丢弃）；返回 null = 不去重（正常追加）；返回字符串 = 追加该增量。
function replayDedup(guardRef, streamId, text) {
  const g = guardRef.current
  if (!g || g.streamId !== streamId || !g.base || !g.active) return null
  g.acc += text
  if (g.base.startsWith(g.acc)) return ''
  g.active = false // 回放结束：后续全部按增量追加
  let i = 0
  const max = Math.min(g.acc.length, g.base.length)
  while (i < max && g.acc[i] === g.base[i]) i++
  return g.acc.slice(i)
}

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
/* ============ 可见滚动条（macOS 默认隐藏；消息容器/思考区/代码块/表格） ============ */
.chat-scroll-area::-webkit-scrollbar,.thinking-scroll-area::-webkit-scrollbar,.md-body pre::-webkit-scrollbar,.md-body table::-webkit-scrollbar,.md-code-block code::-webkit-scrollbar{width:6px;height:6px}
.chat-scroll-area::-webkit-scrollbar-thumb,.thinking-scroll-area::-webkit-scrollbar-thumb,.md-body pre::-webkit-scrollbar-thumb,.md-body table::-webkit-scrollbar-thumb,.md-code-block code::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--text-secondary) 25%,transparent);border-radius:3px}
.chat-scroll-area::-webkit-scrollbar-thumb:hover,.thinking-scroll-area::-webkit-scrollbar-thumb:hover,.md-body pre::-webkit-scrollbar-thumb:hover,.md-body table::-webkit-scrollbar-thumb:hover,.md-code-block code::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--text-secondary) 45%,transparent)}
.chat-scroll-area::-webkit-scrollbar-track,.thinking-scroll-area::-webkit-scrollbar-track,.md-body pre::-webkit-scrollbar-track,.md-body table::-webkit-scrollbar-track,.md-code-block code::-webkit-scrollbar-track{background:transparent}
.chat-scroll-area,.thinking-scroll-area,.md-body pre,.md-body table,.md-code-block code{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--text-secondary) 25%,transparent) transparent}
/* ============ 代码块卡片（markdown.js 生成 .md-code-block） ============ */
.md-body pre.md-code-block{position:relative;margin:.6em 0;padding:0;overflow:hidden;background:#1e1e1e;border:1px solid rgba(255,255,255,.08);border-radius:10px}
.md-code-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.07)}
.md-code-lang{font-size:11px;line-height:1;color:rgba(255,255,255,.5);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.md-code-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
.md-copy-btn,.md-download-btn,.md-table-copy-btn,.md-table-download-btn{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:11px;line-height:1;border-radius:6px;cursor:pointer;color:rgba(255,255,255,.78);background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.12);opacity:0;transition:opacity .15s,background .15s,color .15s}
.md-code-block:hover .md-copy-btn,.md-code-block:hover .md-download-btn,.md-table-wrap:hover .md-table-copy-btn,.md-table-wrap:hover .md-table-download-btn{opacity:1}
.md-copy-btn:hover,.md-download-btn:hover,.md-table-copy-btn:hover,.md-table-download-btn:hover{color:#fff;background:rgba(255,255,255,.18)}
.md-code-block code.hljs{display:block;overflow-x:auto;padding:12px 14px;font-size:12.5px;line-height:1.6;background:transparent;color:#d4d4d4;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
/* 语法高亮 token 颜色（VSCode Dark+ 色板） */
.md-code-block .hljs-comment,.md-code-block .hljs-quote,.md-code-block .hljs-deletion{color:#6a9955}
.md-code-block .hljs-keyword,.md-code-block .hljs-selector-tag,.md-code-block .hljs-literal,.md-code-block .hljs-section,.md-code-block .hljs-link,.md-code-block .hljs-doctag,.md-code-block .hljs-meta .hljs-keyword{color:#c586c0}
.md-code-block .hljs-string,.md-code-block .hljs-regexp,.md-code-block .hljs-addition,.md-code-block .hljs-attribute{color:#ce9178}
.md-code-block .hljs-number,.md-code-block .hljs-meta{color:#b5cea8}
.md-code-block .hljs-title,.md-code-block .hljs-title.function_,.md-code-block .hljs-title.class_{color:#dcdcaa}
.md-code-block .hljs-attr,.md-code-block .hljs-variable,.md-code-block .hljs-template-variable,.md-code-block .hljs-selector-attr,.md-code-block .hljs-selector-class,.md-code-block .hljs-selector-id,.md-code-block .hljs-property{color:#9cdcfe}
.md-code-block .hljs-built_in,.md-code-block .hljs-type,.md-code-block .hljs-builtin-name{color:#4ec9b0}
.md-code-block .hljs-params,.md-code-block .hljs-operator,.md-code-block .hljs-punctuation{color:#d4d4d4}
.md-code-block .hljs-symbol,.md-code-block .hljs-bullet{color:#b5cea8}
/* ============ 表格（markdown.js 生成 .md-table-wrap） ============ */
.md-table-wrap{position:relative}
.md-table-actions{position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:3}
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

// 表格 DOM → CSV 文本：每行 <tr> 的 th/td 文本逗号连接，含逗号/引号/换行时双引号包裹转义
const tableToCsv = (table) => {
  const rows = [...table.querySelectorAll('tr')]
    .map(tr => [...tr.querySelectorAll('th,td')].map(cell => {
      const v = (cell.textContent || '').trim()
      return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    }).join(','))
  return rows.join('\n')
}

// ============ 会话列表 ============
function SessionList({ sessions, activeId, loading, sending, creating, renaming, renamingValue,
  onSelect, onCreate, onDelete, onStartRename, onRenamingChange, onRenamingCommit, onRenamingCancel,
  batchMode, selectedIds, onEnterBatch, onSelectAll, onToggleSelect, onBatchDelete, onExitBatch, onToggleCollapse }) {
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
  // 按最后问答时间倒序（最新在上），无消息时回退到会话更新时间/创建时间
  const sortedSessions = [...sessions].sort((a, b) => {
    const ta = parseDate(a.last_message_at || a.updated_at || a.created_at)?.getTime() || 0
    const tb = parseDate(b.last_message_at || b.updated_at || b.created_at)?.getTime() || 0
    return tb - ta
  })
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 pb-2 flex-shrink-0" style={{ borderColor: 'var(--border-color)' }}>
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
            <button onClick={onCreate} disabled={creating}
              className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
              style={{ background: 'var(--accent)' }}>
              <Plus size={16} /> {creating ? '创建中…' : '新建对话'}
            </button>
            <button onClick={onEnterBatch} title="批量删除"
              className="flex-shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-xl transition-colors hover:bg-bg-hover"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
              <Trash2 size={15} />
            </button>
            {onToggleCollapse && (
              <button onClick={onToggleCollapse} title="折叠会话列表"
                className="flex-shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-xl transition-colors hover:bg-bg-hover"
                style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
                <PanelLeftClose size={15} />
              </button>
            )}
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
        {sortedSessions.map(s => {
          const active = s.id === activeId
          const isRenaming = renaming && renaming.id === s.id
          const checked = selectedIds.includes(s.id)
          const isStreaming = sending && sending.sessionId === s.id && !sending.stopped // 该会话正在生成中（已停止/失败则不再显示旋转标记）
          return (
            <div key={s.id}
              className={`group relative rounded-xl px-3 py-2 cursor-pointer transition-colors ${active && !batchMode ? '' : 'hover:bg-bg-hover'} ${isStreaming ? 'opacity-80' : ''}`}
              style={{
                background: (active && !batchMode) ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : (batchMode && checked ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent'),
                border: `1px solid ${batchMode && checked ? 'color-mix(in srgb, var(--accent) 45%, var(--border-color))' : (active && !batchMode ? 'color-mix(in srgb, var(--accent) 25%, var(--border-color))' : 'transparent')}`,
              }}
              onClick={() => {
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
                  <div className={`flex items-center gap-1.5 ${batchMode ? 'pl-6' : 'pr-9'}`}>
                    <span className="text-sm font-medium truncate" style={{ color: (active && !batchMode) ? 'var(--accent)' : 'var(--text-primary)' }}>
                      {s.title || '新对话'}
                    </span>
                    {isStreaming && (
                      <RefreshCw size={12} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent)' }} title="回复生成中" />
                    )}
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
const ThinkingBlock = memo(function ThinkingBlock({ text, isStreaming = false }) {
  const [open, setOpen] = useState(false)
  const scrollRef = useRef(null)
  const stickRef = useRef(true)
  // 展开/思考追加时跟随底部；用户上滚（底部距离 > 40px）暂停跟随，滚回底部恢复
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [open, text])
  if (!text || !text.trim()) return null
  const lines = text.trim().split('\n')
  const firstLine = lines[0] || ''
  const handleThinkingScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 40
  }
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
        <div ref={scrollRef} onScroll={handleThinkingScroll} className="thinking-scroll-area px-3 pb-3 text-xs whitespace-pre-wrap break-words max-h-72 overflow-y-auto"
          style={{ color: 'var(--text-secondary)' }}>{text}</div>
      )}
    </div>
  )
})

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
// memo：历史消息的 props（msg/onCopy/onRegenerate）在流式期间稳定，避免每帧全列表重渲染；
// mdToHtml 用 useMemo 按 msg.content 缓存，历史消息只解析一次
const MessageItem = memo(function MessageItem({ msg, onCopy, onRegenerate }) {
  const isUser = msg.role === 'user'
  const mdHtml = useMemo(
    () => (isUser || msg.error ? null : mdToHtml(msg.content)),
    [msg.content, isUser, msg.error]
  )
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-4 animate-fade-in-up group`}>
      <div className="relative max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3"
        style={{ background: isUser ? 'var(--bg-user-bubble)' : 'var(--bg-ai-bubble)', boxShadow: isUser ? 'none' : 'var(--shadow-md)' }}>
        {isUser ? (
          <>
            {/* 用户消息关联的文件（会话上下文，后端 messages 接口返回 files；图片渲染缩略图） */}
            {msg.files?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {msg.files.map((f, i) => f.kind === 'image' && f.storage_name ? (
                  <a key={f.id || `img-${i}`} href={chatFileUrl(f.storage_name)} target="_blank" rel="noreferrer"
                    title={f.original_name || '图片'}>
                    <img src={chatFileUrl(f.storage_name)} alt={f.original_name || '图片'}
                      className="w-24 h-24 object-cover rounded-lg border"
                      style={{ borderColor: 'var(--border-color)' }} />
                  </a>
                ) : (
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
              dangerouslySetInnerHTML={{ __html: mdHtml }} />
            <CitationList citations={msg.citations} />
            <WidgetViewer widgets={msg.widgets} />
            <FileCard files={msg.sent_files} />
          </>
        )}
        {!isUser && !msg.error && (msg.status === 'stopped' || msg.status === 'failed') && (
          <div className="mt-1.5 flex items-center gap-1 text-xs" style={{ color: 'var(--color-error)' }}>
            <AlertCircle size={12} className="flex-shrink-0" />
            <span className="break-words">{msg.status === 'stopped' ? '已停止生成' : '生成失败'}</span>
          </div>
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
})

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
// memo：sending 引用变化（流式 flush/状态更新）时才重渲染；text 稳定后（停止/完成）不再被父组件其他状态变化波及
const StreamBubble = memo(function StreamBubble({ sending, onStop, onRetry }) {
  const hasText = sending.text.length > 0
  // 当前正在执行的工具（toolSteps 中最后一条 executing，用于耗时展示）
  // 不用 Array.findLast（ES2023，旧浏览器不兼容），逆序手找
  let executingStep = null
  const stepsArr = Array.isArray(sending.toolSteps) ? sending.toolSteps : []
  for (let i = stepsArr.length - 1; i >= 0; i--) {
    if (stepsArr[i].status === 'executing') { executingStep = stepsArr[i]; break }
  }
  const [nowTick, setNowTick] = useState(Date.now())
  // 有正在执行的工具时每秒刷新一次，让"已耗时 Ns"实时走动
  useEffect(() => {
    if (!executingStep) return
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [executingStep?.key])
  const executingElapsed = executingStep ? Math.max(1, Math.floor((nowTick - executingStep.startedAt) / 1000)) : 0
  return (
    <div className="flex justify-start mb-4 animate-fade-in-up">
      <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-3" style={{ background: 'var(--bg-ai-bubble)', boxShadow: 'var(--shadow-md)' }}>
        <ThinkingBlock text={sending.thinking} isStreaming={!sending.stopped} />
        {/* 工具调用轨迹（agent 模式：tool_status 事件累积；executing 显示加载中+已耗时，done 保留勾选标记） */}
        {/* image_gen 特化为图片占位卡片（骨架 shimmer），其他工具显示轨迹条目 */}
        {Array.isArray(sending.toolSteps) && sending.toolSteps.length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {sending.toolSteps.map(step => step.name === 'image_gen' ? (
              <div key={step.key} className="rounded-xl overflow-hidden"
                style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}>
                <div className="card-feed-skeleton-card" style={{ aspectRatio: '4 / 3' }}>
                  <div className="card-feed-skeleton-shimmer" />
                </div>
                <div className="flex items-center gap-1.5 px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {step.status === 'done'
                    ? <Check size={13} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
                    : <ImageIcon size={13} className="animate-pulse flex-shrink-0" style={{ color: 'var(--accent)' }} />}
                  <span className="font-medium" style={{ color: 'var(--accent)' }}>{step.status === 'done' ? '图片生成完成' : '正在生成图片…'}</span>
                  {step.status === 'executing' && <span className="tabular-nums">{executingStep?.key === step.key ? `${executingElapsed}s` : ''}</span>}
                </div>
              </div>
            ) : (
              <div key={step.key} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs"
                style={{
                  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border-color))',
                  color: 'var(--text-secondary)',
                }}>
                {step.status === 'done' ? (
                  <Check size={13} className="flex-shrink-0" style={{ color: 'var(--accent)' }} />
                ) : (
                  <Settings size={13} className="animate-spin flex-shrink-0" style={{ color: 'var(--accent)' }} />
                )}
                <span className="flex-shrink-0 font-medium" style={{ color: 'var(--accent)' }}>
                  {step.status === 'done' ? '已完成' : '正在调用工具'}
                </span>
                <span className="min-w-0 truncate">{step.name || '…'}</span>
                {step.status === 'executing' && executingStep?.key === step.key && (
                  <span className="tabular-nums flex-shrink-0">{executingElapsed}s</span>
                )}
              </div>
            ))}
          </div>
        )}
        {/* 工具等待超时后生图转入后台：image_task 事件到达，任务轮询中 */}
        {sending.pendingImage && (
          <div className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <ImageIcon size={13} className="animate-pulse flex-shrink-0" style={{ color: 'var(--accent)' }} />
            <span>图片正在后台生成，完成后将自动插入回复…</span>
          </div>
        )}
        {hasText ? (
          <div className="md-body text-sm" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {sending.text}
          </div>
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
        <FileCard files={sending.files} />
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
})

// ============ 空状态引导 ============
// 后台图片任务轮询参数（SSE image_task 事件触发，见 ChatAssistantPage 内轮询逻辑）
const IMAGE_POLL_INTERVAL_MS = 8000
const IMAGE_POLL_MAX = 120 // 约 16 分钟上限（任务要求最长 15 分钟/120 次）
const STREAM_RENDER_INTERVAL_MS = 100

// 建议提示：综合主题（参考临时/frontend 版 family-meta.ts 的 starters 写法，非仅提示词相关）
const EXAMPLES = [
  { label: '商业策划', prompt: '我准备推出一款面向 25-35 岁都市白领的轻食外卖品牌，请帮我从定位、差异化卖点、首月获客节奏、内容种草渠道四个维度给出可执行的上市方案。' },
  { label: '代码评审', prompt: '请帮我评审下面这段代码的可读性、性能与潜在 bug，并给出重构建议：\n\n```\n\n```' },
  { label: '产品文案', prompt: '帮我为一款主打通勤场景的降噪耳机写一组小红书种草笔记文案：标题要带 emoji 和话题标签，正文口语化、有场景感，突出「通勤路上瞬间安静」的体验，结尾加互动引导，3 条备选。' },
  { label: '中文写作', prompt: '请帮我写一篇 800 字以内的公众号短文，主题「普通人如何在 AI 时代保持稀缺性」，要求：开头不能套话、语言生动有画面感、结尾有钩子让读者评论。' },
]

// 品牌墙：始终展示的模型品牌（即使尚未接入；已接入的点击可选中对应模型）
const BRAND_CARDS = [
  { provider: 'gemini', label: 'Gemini' },
  { provider: 'openai', label: 'ChatGPT' },
  { provider: 'anthropic', label: 'Claude' },
  { provider: 'zhipu', label: 'GLM' },
  { provider: 'moonshot', label: 'Kimi' },
  { provider: 'meta', label: 'Llama' },
  { provider: 'mimo', label: 'MiMo' },
  { provider: 'minimax', label: 'MiniMax' },
  { provider: 'gemma', label: 'Gemma' },
  { provider: 'xai', label: 'Grok' },
  { provider: 'deepseek', label: 'DeepSeek' },
  { provider: 'qwen', label: 'Qwen' },
  { provider: 'doubao', label: '豆包' },
]

function EmptyState({ onPick, models = [], modelId = '', onSelectModel }) {
  return (
    <div className="flex flex-col items-center text-center pt-14 pb-10 px-4">
      {/* 指导性文字：参考临时/frontend 版 ChatWelcome 的大号渐变标题 + tagline */}
      <h3 className="text-3xl sm:text-4xl font-extrabold leading-none tracking-tight mb-2"
        style={{
          backgroundImage: 'linear-gradient(135deg, var(--text-primary) 30%, color-mix(in srgb, var(--accent) 65%, var(--text-primary)))',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}>
        和 AI 助手聊聊
      </h3>
      <h3 className="text-3xl sm:text-4xl font-extrabold leading-none tracking-tight mb-2"
        style={{
          backgroundImage: 'linear-gradient(135deg, var(--text-primary) 30%, color-mix(in srgb, var(--accent) 65%, var(--text-primary)))',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}>
        顶尖模型·一站聚合
      </h3>
      <p className="text-xs sm:text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>写提示词、写代码、做分析，万事可问</p>
      {/* 模型选择：品牌墙，始终展示（未接入的品牌置灰不可点） */}
      <div className="w-full max-w-2xl text-left">
        <div className="mb-2.5 flex items-center gap-3 px-1">
          <div className="h-px flex-1" style={{ background: 'linear-gradient(to left, color-mix(in srgb, var(--border-color) 90%, transparent), transparent)' }} />
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.22em] flex-shrink-0"
            style={{ color: 'var(--text-secondary)' }}>
            模型
          </h4>
          <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--border-color) 90%, transparent), transparent)' }} />
        </div>
        <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
          {BRAND_CARDS.map(({ provider, label }) => {
            const m = models.find(x => { const k = familyKeyOf(x); return k === provider || k.startsWith(provider) })
            return (
              <button
                key={provider}
                type="button"
                title={m ? label : `${label}（尚未接入）`}
                disabled
                onClick={() => m && onSelectModel && onSelectModel(m.model_id)}
                className="relative flex w-[68px] shrink-0 flex-col items-center gap-1 overflow-hidden rounded-xl border px-2 py-2.5 text-center transition-colors sm:w-[84px] sm:gap-1.5 sm:px-3 sm:py-3 disabled:cursor-not-allowed"
                style={{
                  borderColor: 'color-mix(in srgb, var(--border-color) 60%, transparent)',
                  background: 'color-mix(in srgb, var(--bg-card) 45%, transparent)',
                }}>
                <ModelLogo provider={provider} className="size-6 sm:size-7" />
                <span className="line-clamp-1 text-[10px] font-medium sm:text-[11px]"
                  style={{ color: 'var(--text-secondary)' }}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {/* 建议提示：参考临时/frontend 版 ChatWelcome 的竖排列表（序号 + 标题 + 描述 + hover 竖条/箭头） */}
      <div className="w-full max-w-2xl mt-6 text-left">
        <div className="mb-1 flex items-center gap-3 px-1">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.22em] flex-shrink-0"
            style={{ color: 'var(--text-secondary)' }}>
            建议提示
          </h4>
          <div className="h-px flex-1" style={{ background: 'linear-gradient(to right, color-mix(in srgb, var(--border-color) 90%, transparent), transparent)' }} />
          <span className="font-mono text-[10px] tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
            {String(EXAMPLES.length).padStart(2, '0')}
          </span>
        </div>
        <ul className="flex flex-col">
          {EXAMPLES.map((ex, i) => (
            <li key={ex.prompt}>
              <button
                type="button"
                onClick={() => onPick(ex.prompt)}
                title="点击立即发送这个问题"
                className="group relative flex w-full items-start gap-3 border-b px-1 py-3.5 text-left transition-colors duration-200 last:border-b-0 sm:gap-4 sm:py-4"
                style={{ borderColor: 'color-mix(in srgb, var(--border-color) 55%, transparent)' }}>
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/2 h-0 w-[2px] -translate-y-1/2 rounded-full transition-[height] duration-200 group-hover:h-[calc(100%-1.5rem)]"
                  style={{ background: 'var(--accent)' }} />
                <span className="mt-px flex-shrink-0 font-mono text-[11px] font-medium tabular-nums transition-colors duration-200 group-hover:text-[var(--accent)]"
                  style={{ color: 'color-mix(in srgb, var(--text-secondary) 60%, transparent)' }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-semibold tracking-tight transition-colors duration-200 group-hover:text-[var(--accent)]"
                      style={{ color: 'var(--text-primary)' }}>
                      {ex.label}
                    </span>
                    <Send size={13}
                      className="flex-shrink-0 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      style={{ color: 'color-mix(in srgb, var(--text-secondary) 45%, transparent)' }} />
                  </div>
                  <p className="line-clamp-2 text-[13px] leading-relaxed transition-colors duration-200 group-hover:text-[color-mix(in_srgb,var(--text-primary)_75%,transparent)]"
                    style={{ color: 'var(--text-secondary)' }}>
                    {ex.prompt.replace(/\s+/g, ' ').trim().slice(0, 140)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ============ 底部输入区 ============
const EFFORT_LABELS = { auto: '自动', low: '低', medium: '中', high: '高', max: '最高', xhigh: '超高' }
// 思考强度固定顺序（auto 最左、max 最右）：UI 展示不依赖模型档案/CSV 的原始顺序
const EFFORT_ORDER = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
// 模型族（provider → 展示名）：双列弹窗左侧栏分组
const MODEL_FAMILIES = [
  { key: 'anthropic', label: 'Claude' },
  { key: 'deepseek', label: 'DeepSeek' },
  { key: 'openai', label: 'OpenAI' },
  { key: 'moonshot', label: 'Kimi' },
  { key: 'qwen', label: '通义千问' },
  { key: 'minimax', label: 'MiniMax' },
  { key: 'xai', label: 'Grok' },
  { key: 'zhipu', label: '智谱 GLM' },
  { key: 'doubao', label: '豆包' },
  { key: 'hunyuan', label: '混元' },
  { key: 'google', label: 'Gemini' },
  { key: 'yi', label: '零一万物' },
  { key: 'mistral', label: 'Mistral' },
  { key: 'meta', label: 'Meta' },
  { key: 'stepfun', label: '阶跃星辰' },
  { key: 'spark', label: '讯飞星火' },
]
const familyKeyOf = (m) => String(m.provider || '').trim().toLowerCase()

function ChatInputBar({ inputRef, value, onChange, onSend, onStop, sending, cost, points, dailyTotal, dailyRemaining, isMember, reasoningEffort, onReasoningEffort, efforts, modelLabel, modelProvider, pendingQueue, onEditPending, onRemovePending, models, chatModelId, onSelectModel, onUploadClick, docs, onRemoveDoc, uploadingCount, uploadNote, webSearch, onWebSearch, linkStatus, dragActive, dragHandlers, onPasteFiles }) {
  const [effortOpen, setEffortOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [modelFamily, setModelFamily] = useState('')
  const EFFORT_OPTIONS = (Array.isArray(efforts) && efforts.length ? efforts : ['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
    .map(v => ({ value: v, label: EFFORT_LABELS[v] || v }))
    .sort((a, b) => {
      const ia = EFFORT_ORDER.indexOf(a.value)
      const ib = EFFORT_ORDER.indexOf(b.value)
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)  // 未知档位排最后
    })
  const activeModel = models.find(m => m.model_id === chatModelId) || null
  // 族列表（按 provider 分组，含计数）：用于双列弹窗左侧栏
  const families = useMemo(() => {
    const map = new Map()
    for (const m of models) {
      const k = familyKeyOf(m)
      if (!k) continue
      if (!map.has(k)) map.set(k, MODEL_FAMILIES.find(f => f.key === k) || { key: k, label: k })
    }
    return [...map.values()]
  }, [models])
  const countOf = (key) => models.filter(m => familyKeyOf(m) === key).length
  const filteredModels = useMemo(() => {
    let l = modelFamily ? models.filter(m => familyKeyOf(m) === modelFamily) : models
    const q = modelQuery.trim().toLowerCase()
    if (q) l = l.filter(m => `${m.label || ''} ${m.model_id || ''} ${m.provider || ''}`.toLowerCase().includes(q))
    return l
  }, [models, modelFamily, modelQuery])
  useEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    if (value) textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px'
  }, [value, inputRef])
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSend() // 生成中会自动进入排队
    }
  }
  const displayRemaining = useDelayedQuotaRemaining(dailyRemaining, { enabled: isMember })
  const quotaPct = dailyTotal > 0 ? Math.min(100, Math.round((Math.max(0, displayRemaining) / dailyTotal) * 100)) : 0
  const quotaColor = quotaPct <= 20 ? 'var(--color-error)' : 'var(--accent)'
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
          {(dailyTotal === null || dailyTotal > 0) && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ color: 'var(--text-secondary)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid var(--border-color)' }}
              title="今日 AI 助手用量（用完后将扣除积分）">
              {dailyTotal === null ? '今日不限量' : (
                <>
                  <span>今日额度</span>
                  <span className="w-10 h-1.5 rounded-full overflow-hidden shrink-0" style={{ background: 'color-mix(in srgb, var(--text-secondary) 20%, transparent)' }}>
                    <span className="block h-full rounded-full" style={{ width: `${quotaPct}%`, background: quotaColor }} />
                  </span>
                  <span className="tabular-nums" style={{ color: quotaColor }}>{quotaPct}%</span>
                </>
              )}
            </span>
          )}
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
                  title={`${doc.name}${doc.kind !== 'image' && doc.char_count != null ? `（${doc.char_count} 字符）` : ''}${doc.error ? `：${doc.error}` : ''}`}>
                  {doc.kind === 'image' && doc.preview ? (
                    <>
                      <img src={doc.preview} alt={doc.name} className="w-full h-full object-cover" draggable={false} />
                      {/* 上传中：半透明遮罩 + 进度圈；失败：红底红叉 */}
                      {doc.status === 'uploading' || doc.status === 'pending' ? (
                        <div className="absolute inset-0 flex items-center justify-center"
                          style={{ background: 'color-mix(in srgb, var(--bg-card) 55%, transparent)' }}>
                          <svg className="-rotate-90" width="30" height="30" viewBox="0 0 36 36">
                            <circle cx="18" cy="18" r="15" fill="none" stroke="color-mix(in srgb,var(--accent) 25%,transparent)" strokeWidth="3" />
                            <circle cx="18" cy="18" r="15" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
                              strokeDasharray={`${Math.max(0, Math.min(100, Number(doc.progress) || 0)) * 0.94} 100`} />
                          </svg>
                        </div>
                      ) : doc.status === 'error' ? (
                        <div className="absolute inset-0 flex items-center justify-center"
                          style={{ background: 'color-mix(in srgb, var(--color-error) 30%, transparent)' }}>
                          <AlertCircle size={16} style={{ color: 'var(--color-error)' }} />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
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
                t.style.height = Math.min(t.scrollHeight, 160) + 'px'
              }}
              onKeyDown={handleKeyDown}
              onPaste={onPasteFiles}
              className="block w-full resize-none bg-transparent outline-none py-2"
              style={{ color: 'var(--text-primary)', minHeight: '56px', maxHeight: '160px', overflowY: 'auto', fontSize: '15px', paddingLeft: '10px' }} />
            {/* 粘贴链接轻提示：输入含 http(s):// 时实时显示 */}
            {/https?:\/\//i.test(value) && (
              <div className="px-2.5 pb-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>发送后将自动访问该链接内容</div>
            )}
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center flex-shrink-0 whitespace-nowrap gap-0.5">
                {/* 模型选择（弹窗双列：左侧族列表 + 右侧搜索模型列表，与上传/联网搜索并排） */}
                {models.length > 0 ? (
                  <div className="relative flex items-center">
                    <button type="button" onClick={() => { setModelQuery(''); setModelOpen(v => !v) }} title="选择模型"
                      className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded-lg hover:bg-bg-hover transition-colors"
                      style={{ color: activeModel ? 'var(--accent)' : 'var(--text-secondary)' }}>
                      <ModelLogo provider={activeModel?.provider || modelProvider} size={15} />
                      <span className="text-[11px] leading-none max-w-[8.5rem] truncate">{activeModel?.label || modelLabel || '模型'}</span>
                      <ChevronDown size={11} className={modelOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                    </button>
                    {modelOpen && (
                      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" onClick={() => setModelOpen(false)}>
                        <div className="absolute inset-0 bg-black/50" />
                        <div
                          role="dialog"
                          aria-label="模型选择器"
                          className="relative flex h-[min(70dvh,520px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
                          style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)' }}
                          onClick={e => e.stopPropagation()}>
                          <button type="button" aria-label="关闭" title="关闭"
                            className="absolute right-2 top-2 z-10 rounded-lg p-1.5 transition-colors hover:bg-bg-hover"
                            style={{ color: 'var(--text-secondary)' }}
                            onClick={() => setModelOpen(false)}>
                            <X size={16} />
                          </button>
                          <div className="flex min-h-0 flex-1" style={{ paddingTop: 40 }}>
                            {/* 左侧族栏 */}
                            <aside className="flex w-fit min-w-32 max-w-38 shrink-0 flex-col"
                              style={{ borderRight: '1px solid var(--border-color)' }}>
                              <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2 model-dropdown-scroll">
                                <button type="button" onClick={() => setModelFamily('')}
                                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                                  style={{ background: !modelFamily ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent', color: !modelFamily ? 'var(--accent)' : 'var(--text-primary)' }}>
                                  <span className="truncate">全部模型</span>
                                  <span className="ml-auto shrink-0 text-xs" style={{ color: 'var(--text-secondary)' }}>{models.length}</span>
                                </button>
                                {families.map(f => {
                                  const active = modelFamily === f.key
                                  return (
                                    <button key={f.key} type="button" onClick={() => setModelFamily(f.key)}
                                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                                      style={{ background: active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-primary)' }}>
                                      <ModelLogo provider={f.key} className="shrink-0" size={18} />
                                      <span className="truncate">{f.label}</span>
                                      <span className="ml-auto shrink-0 text-xs" style={{ color: 'var(--text-secondary)' }}>{countOf(f.key)}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </aside>
                            {/* 右侧模型列表 */}
                            <div className="flex min-w-0 flex-1 flex-col">
                              <div className="px-2 pt-2">
                                <div className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5"
                                  style={{ borderColor: 'var(--border-color)', background: 'color-mix(in srgb, var(--bg-input) 50%, transparent)' }}>
                                  <Search size={14} className="shrink-0" style={{ color: 'var(--text-secondary)' }} />
                                  <input
                                    value={modelQuery}
                                    onChange={e => setModelQuery(e.target.value)}
                                    placeholder="搜索模型..."
                                    autoFocus={window.innerWidth >= 640}
                                    className="w-full bg-transparent text-xs outline-none"
                                    style={{ color: 'var(--text-primary)' }} />
                                </div>
                              </div>
                              <div className="min-h-0 flex-1 overflow-y-auto p-2 model-dropdown-scroll">
                                {filteredModels.length === 0 && (
                                  <p className="px-2 py-6 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>未找到模型</p>
                                )}
                                {filteredModels.map(m => (
                                  <button key={m.model_id} type="button"
                                    onClick={() => { onSelectModel(m.model_id); setModelOpen(false) }}
                                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-bg-hover"
                                    style={{ background: m.model_id === chatModelId ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent', color: m.model_id === chatModelId ? 'var(--accent)' : 'var(--text-primary)' }}>
                                    <ModelLogo provider={m.provider} className="shrink-0" size={20} />
                                    {/* 两行布局：模型名独占一行（truncate），能力标签换行到第二行，
                                        避免手机窄屏下标签把模型名挤没 */}
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate leading-snug">{m.label || m.model_id}</span>
                                      {(m.capabilities || []).length > 0 && (
                                        <span className="mt-1 flex flex-wrap items-center gap-1">
                                          {(m.capabilities || []).slice(0, 3).map(t => (
                                            <span key={t} className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                              style={{ background: 'color-mix(in srgb, var(--text-secondary) 10%, transparent)', color: 'var(--text-secondary)' }}>
                                              {t}
                                            </span>
                                          ))}
                                        </span>
                                      )}
                                    </span>
                                    {m.model_id === chatModelId && <Check size={14} className="shrink-0" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
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
                  <span className="text-[11px] leading-none">联网</span>
                </button>
                <button type="button" onClick={onUploadClick}
                  title="上传文档或图片（文档支持 txt/md/csv/pdf/docx/xlsx/pptx/py/js/ts/go/yaml 等 50+ 格式；图片支持 png/jpg/jpeg/webp/gif/bmp，单张 ≤10MB；一次最多 5 个，会话累计最多 20 个；也可以直接 Ctrl+V 粘贴图片）"
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
// 图片上传限制（与后端 backend/routers/chat.py 的 _CHAT_IMG_EXTS / 单消息最多 4 张一致）
const IMG_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])
const MAX_IMAGES = 4 // 后端 image_file_ids 硬上限（单条消息最多 4 张图）
// 会话文件访问 URL（storage_name 形如 uploads/xxxx.png）
const chatFileUrl = (storageName) => `/api/workspace/files/download?path=${encodeURIComponent(storageName)}`

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
  const [sending, setSending] = useState(null) // { sessionId, content, text, thinking, toolStatus, citations, widgets, files, pendingImage, stopped, error, manual }
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
  const [dailyTotal, setDailyTotal] = useState(0)
  const [dailyRemaining, setDailyRemaining] = useState(0)
  const [chatSubscription, setChatSubscription] = useState(null)
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
  // 会话文件列表（对齐 AI 绘画参考图交互；文档与图片共用）：{id,name,ext,size,status,progress,error,file_id,char_count,kind:'doc'|'image',preview,storage_name,file}
  const [docs, setDocs] = useState([])
  const fileRef = useRef(null)
  // 拖拽上传：输入区高亮状态 + dragenter/dragleave 配对计数（防闪烁）
  const [dragActive, setDragActive] = useState(false)
  const dragCounterRef = useRef(0)
  const docStartedRef = useRef(new Set())
  const docAbortRef = useRef(new Map())
  const [sessionListOpen, setSessionListOpen] = useState(false)
  const [chatListCollapsed, setChatListCollapsed] = useState(() => localStorage.getItem('chat-list-collapsed') === '1')
  const [renaming, setRenaming] = useState(null) // { id, title }
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const renamingRef = useRef(null)
  const abortRef = useRef(null)
  const scrollRef = useRef(null)
  // 自动滚动跟随标志（ref 而非 state，避免滚动产生重渲染）：
  // true=跟随贴底；用户上滚（底部距离 > 80px）置 false，滚回底部（≤ 80px）恢复 true
  const stickToBottomRef = useRef(true)
  const handleMessageScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80
  }, [])
  const inputRef = useRef(null)
  const sendingRef = useRef(null) // 与 sending 同步，供事件/回调读取最新状态（也兼作发送锁）
  const creatingRef = useRef(false) // 新建会话锁：createSession 异步期间拦截重复点击，保证只创建一个
  const [creatingSession, setCreatingSession] = useState(false)
  const pendingQueueRef = useRef([]) // 与 pendingQueue 同步
  const pointsRef = useRef(points)
  const dailyRemainingRef = useRef(dailyRemaining)
  const dailyTotalRef = useRef(dailyTotal)
  const activeIdRef = useRef(activeId)
  // 新建会话后本地消息已就绪（handleSend/sendQueuedNext 已 setMessages），
  // 跳过 useEffect([activeId]) 的异步加载，避免「空列表覆盖本地用户消息」的竞态丢消息
  const skipMessagesLoadRef = useRef(null)
  const effortRef = useRef(reasoningEffort)
  const modelIdRef = useRef(chatModelId)
  // 流式输出先以纯文本渐进展示，完成后再做完整 Markdown 渲染；
  // 高频 chunk/thinking 每 100ms 合并一次，避免持续占用主线程。
  const streamBufRef = useRef({ streamId: null, text: '', thinking: '' })
  const streamRenderTimerRef = useRef(null)
  // 本次流的引用来源累积（SSE citations 事件；按 url 去重，streamId 绑定防旧流迟到污染）
  const citationsRef = useRef({ streamId: null, items: [] })
  // 本次流的 widget 累积（SSE widget 事件；streamId 绑定防旧流迟到污染，模式同 citationsRef）
  const widgetsRef = useRef({ streamId: null, items: [] })
  // 本次流的文件累积（SSE file 事件；streamId 绑定防旧流迟到污染，模式同 widgetsRef）
  const filesRef = useRef({ streamId: null, items: [] })
  // 切回续看：已恢复订阅的 streaming 消息 id（防 messages 更新导致重复订阅）
  const resumeSubscribedRef = useRef(null)
  // 切回续看兜底：无 task_id 缓存时轮询 messages 的定时器（每 2s，直到消息进入终态）
  const resumePollTimerRef = useRef(null)
  // 续传回放去重守卫（见 replayDedup）：{ streamId, base, acc, active }
  const resumeGuardRef = useRef(null)
  // 兜底轮询中转 ref：subscribeTask 定义早于 startResumePolling，直接依赖会 TDZ，用 ref 转发
  const startResumePollingRef = useRef(null)
  const flushStreamBuf = useCallback(() => {
    streamRenderTimerRef.current = null
    const { streamId: sid, text, thinking } = streamBufRef.current
    setSending(prev => (prev && prev.streamId === sid) ? { ...prev, text, thinking } : prev)
  }, [])
  useEffect(() => () => {
    if (streamRenderTimerRef.current) clearTimeout(streamRenderTimerRef.current)
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
    dailyRemainingRef.current = dailyRemaining
    dailyTotalRef.current = dailyTotal
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
    pointsAPI.balance().then(res => {
      setPoints(Number(res.data?.points || 0))
      setDailyTotal(res.data?.ai_daily_total === null ? null : Number(res.data?.ai_daily_total || 0))
      setDailyRemaining(res.data?.ai_daily_remaining === null ? null : Number(res.data?.ai_daily_remaining || 0))
    }).catch(() => {})
    subscriptionAPI.me().then(res => { setChatSubscription(res.data) }).catch(() => {})
    chatAPI.sessions().then(res => {
      const items = res.data?.items || []
      setSessions(items)
      // 进入页面不自动恢复上次会话：始终显示欢迎页，方便用户直接开新会话或自行选择历史会话。
      // 会话选择/新建由用户操作触发（handleSelectSession/handleCreateSession）。
    }).catch(() => {}).finally(() => setSessionsLoading(false))
    const handlePoints = () => { const u = readUser(); if (u) setPoints(u.points ?? 0) }
    window.addEventListener('points-updated', handlePoints)
    return () => {
      window.removeEventListener('points-updated', handlePoints)
      // 仅断开订阅连接：后台任务继续，结果落库（任务制语义，无取消动作）
      abortRef.current?.abort()
      if (resumePollTimerRef.current) { clearInterval(resumePollTimerRef.current); resumePollTimerRef.current = null }
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

  // 当前会话 ID 持久化到 localStorage：刷新/重新进入页面后恢复上次会话
  // 注意：activeId 为 null 时不主动清除记忆——mount 首帧 activeId 必为 null，
  // 无条件 removeItem 会把待恢复的记忆清掉；清除由删除会话路径显式处理
  useEffect(() => {
    if (!activeId) return
    try { localStorage.setItem('chat_active_session_id', String(activeId)) } catch {}
  }, [activeId])

  // 切换会话时加载消息
  useEffect(() => {
    // 切换会话/首次加载：整个消息列表替换，重置为跟随贴底
    stickToBottomRef.current = true
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

  // 代码块/表格的复制与下载按钮：markdown.js 注入的 HTML 无法绑 React 事件，
  // 与 katex 委托同理用 document click 委托（独立 listener，避免互相干扰）
  useEffect(() => {
    const onClick = async (e) => {
      const btn = e.target.closest?.('button.md-copy-btn, button.md-download-btn, button.md-table-copy-btn, button.md-table-download-btn')
      if (!btn) return
      e.preventDefault()
      e.stopPropagation()
      try {
        if (btn.classList.contains('md-copy-btn') || btn.classList.contains('md-download-btn')) {
          const pre = btn.closest('pre.md-code-block')
          const text = pre?.querySelector('code')?.textContent || ''
          if (!text) return
          if (btn.classList.contains('md-copy-btn')) {
            const ok = await copyText(text)
            showToast(ok ? '代码已复制' : '复制失败', ok ? 'success' : 'error')
          } else {
            const lang = (pre?.querySelector('.md-code-lang')?.textContent || '').trim()
            const safe = (lang.replace(/[^\w-]+/g, '-') || 'code').slice(0, 32)
            const ok = await saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `code-${safe}.txt`)
            if (ok) showToast('代码已下载')
          }
        } else {
          const table = btn.closest('.md-table-wrap')?.querySelector('table')
          if (!table) return
          const csv = tableToCsv(table)
          if (!csv) return
          if (btn.classList.contains('md-table-copy-btn')) {
            const ok = await copyText(csv)
            showToast(ok ? '表格已复制' : '复制失败', ok ? 'success' : 'error')
          } else {
            // 带 BOM 防止 Excel 打开 CSV 中文乱码
            const ok = await saveBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'table.csv')
            if (ok) showToast('表格已下载')
          }
        }
      } catch {
        showToast('操作失败', 'error')
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [showToast])

  // 自动滚动到底部：仅当用户未上滚（stickToBottomRef=true）时才贴底；
  // 用户上滚回看历史时跳过赋值，滚回底部（≤80px）自动恢复跟随。
  // 依赖含 sending?.thinking：思考阶段 text 为空不变，若缺 thinking 依赖则气泡
  // 随思考增长超出视口时不贴底，出现「泡泡显示不全、要手动滚动才显示全」。
  // 只在「需要跟随」时写 scrollTop，避免每帧强制同步布局；直接赋值不 smooth（流式下 smooth 会卡）
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, messagesLoading, sending?.text, sending?.thinking, sending?.stopped, pendingQueue])

  const refreshSessions = useCallback(() => {
    chatAPI.sessions().then(res => {
      setSessions(res.data?.items || [])
      window.dispatchEvent(new Event('chat-sessions-updated'))
    }).catch(() => {})
  }, [])

  // 发送锁：防止 createSession 等异步间隙出现并发发送（占位 sessionId=null，startStream 会覆盖）
  const acquireSendLock = useCallback((content) => {
    if (sendingRef.current && !sendingRef.current.stopped) return false
    sendingRef.current = { sessionId: null, content, text: '', thinking: '', toolSteps: [], stopped: false, error: '', manual: false }
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

  // 文件入队：扩展名/大小校验 + 单次 5 个 + 会话 20 个上限截取（文件选择器与拖拽上传共用）。
  // 无激活会话时自动创建会话（上传即对话开始），创建成功后再入队上传。
  const addDocs = useCallback(async (files) => {
    if (!files || !files.length) return
    if (!activeIdRef.current) {
      showUploadNote('正在创建会话，稍候上传…')
      try {
        const res = await chatAPI.createSession()
        const s = res.data
        setSessions(prev => [s, ...prev.filter(p => p.id !== s.id)]) // 去重：后端可能复用已存在的空会话
        setActiveId(s.id)
        activeIdRef.current = s.id // 立即同步 ref（useEffect 同步在渲染后，await 返回时可能未更新）
        setMessages([])
      } catch (err) {
        dialog.alert(err.message || '创建会话失败')
        return
      }
    }
    let picked = files
    if (picked.length > MAX_BATCH) {
      showUploadNote(`一次最多上传 ${MAX_BATCH} 个文件，已自动截取前 ${MAX_BATCH} 个`)
      picked = picked.slice(0, MAX_BATCH)
    }
    const valid = []
    const errors = []
    for (const f of picked) {
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      if (!DOC_EXTS.has(ext) && !IMG_EXTS.has(ext)) {
        errors.push(`「${f.name}」格式不支持`)
        continue
      }
      if (f.size > MAX_DOC_SIZE) { errors.push(`「${f.name}」超过 10MB`); continue }
      valid.push(f)
    }
    if (errors.length) showUploadNote(errors.slice(0, 3).join('；'))
    setDocs(prev => {
      const remaining = MAX_DOCS - prev.length
      if (remaining <= 0) { showUploadNote(`最多只能上传 ${MAX_DOCS} 个文件`); return prev }
      if (valid.length > remaining) showUploadNote(`最多只能上传 ${MAX_DOCS} 个文件，已自动截取前 ${remaining} 个`)
      const items = valid.slice(0, Math.max(0, remaining)).map(f => {
        const ext = (f.name.split('.').pop() || '').toLowerCase()
        const isImage = IMG_EXTS.has(ext)
        return {
          id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: f.name,
          ext,
          size: f.size,
          status: 'pending',
          progress: 0,
          error: '',
          file_id: null,
          char_count: null,
          // 图片（粘贴/选择/拖拽）与文档共用上传链路；preview 为本地 blob 预览，上传成功后由 storage_name 访问
          kind: isImage ? 'image' : 'doc',
          preview: isImage ? URL.createObjectURL(f) : null,
          storage_name: null,
          file: f,
        }
      })
      return [...prev, ...items]
    })
  }, [])

  // 文件选择器选择：转交 addDocs 统一校验入队
  const handleFilesSelected = useCallback(e => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    void addDocs(files)
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
        // 图片与文档共用上传接口：storage_name 用于消息内图片访问 URL，kind 区分渲染
        storage_name: data?.storage_name,
        kind: data?.kind || item.kind,
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

  // 移除文件标签（本地移除；服务器文件随会话删除级联清理，后端暂无单删接口）
  const removeDoc = useCallback(id => {
    docAbortRef.current.get(id)?.abort()
    setDocs(prev => {
      const target = prev.find(d => d.id === id)
      if (target?.preview) URL.revokeObjectURL(target.preview)
      return prev.filter(d => d.id !== id)
    })
  }, [])

  // 粘贴图片：Ctrl+V 时从剪贴板提取图片文件，走与文件选择/拖拽相同的入队上传链路。
  // 无图片（纯文本/链接等）直接放行浏览器默认粘贴行为；图片与文本混合粘贴时只取图片。
  const handlePasteFiles = useCallback((e) => {
    const items = Array.from(e?.clipboardData?.items || [])
    const rawFiles = items
      .filter(it => it.kind === 'file' && String(it.type || '').startsWith('image/'))
      .map(it => it.getAsFile())
      .filter(Boolean)
    if (!rawFiles.length) return // 纯文本粘贴等：不拦截
    const extOfType = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/x-ms-bmp': 'bmp' }
    const ts = Date.now()
    const files = []
    const rejected = []
    rawFiles.forEach((f, i) => {
      const type = String(f.type || '').split(';')[0].trim().toLowerCase()
      const ext = extOfType[type]
      if (!ext) { rejected.push(`「${f.name || '图片'}」图片格式不支持（支持 png/jpg/jpeg/webp/gif/bmp）`); return }
      let name = String(f.name || '').trim()
      // 剪贴板 File 可能无名字或无扩展名：按 MIME 类型规范命名
      if (!name) name = `pasted-${ts}-${i}.${ext}`
      else if (!new RegExp(`\\.${ext}$`, 'i').test(name)) name = `${name}.${ext}`
      files.push(new File([f], name, { type: f.type || 'image/png' }))
    })
    if (rejected.length) showUploadNote(rejected.slice(0, 2).join('；'))
    if (!files.length) return // 图片全部被拒（如 svg/avif）：放行浏览器默认粘贴行为
    e.preventDefault()
    let picked = files
    if (picked.length > MAX_IMAGES) {
      showUploadNote(`一次最多粘贴 ${MAX_IMAGES} 张图片，已自动截取前 ${MAX_IMAGES} 张`)
      picked = picked.slice(0, MAX_IMAGES)
    }
    void addDocs(picked)
  }, [addDocs, showUploadNote])

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
    void addDocs(Array.from(e.dataTransfer.files || []))
  }, [addDocs])
  const dragHandlers = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDropFiles,
  }

  // ============ 后台图片任务轮询（SSE image_task 事件） ============
  // 工具等待超时后生图任务在后台继续，后端通过 image_task 下发任务 id；
  // 前端轮询任务状态，完成后把图片 markdown 补进对应对话气泡。
  // 状态独立于 sending 生命周期（done 后 sending 被清空，轮询仍可继续补图）。
  // 当前轮询中的后台图片任务：{ taskId, streamId } | null
  const pendingImageRef = useRef(null)
  const imagePollTimerRef = useRef(null)
  // 本流 done 时记录的 assistant 消息 id：轮询完成时把图片补进该消息（sending 已清空场景）
  const lastAssistantMsgIdRef = useRef(null)
  // 本流已追加的后台图片文本累积（streamId 绑定）：done 前追加进 sending 的文本
  // 会被后端完整文本覆盖，onDone 需将其合并进最终消息
  const pendingImageAppendRef = useRef({ streamId: null, text: '' })
  // 终止轮询（同时清除 sending 中的 pendingImage 展示状态）
  const stopImagePolling = useCallback(() => {
    if (imagePollTimerRef.current) { clearInterval(imagePollTimerRef.current); imagePollTimerRef.current = null }
    const pid = pendingImageRef.current
    pendingImageRef.current = null
    if (pid) {
      setSending(prev => (prev && prev.streamId === pid.streamId && prev.pendingImage) ? { ...prev, pendingImage: null } : prev)
    }
  }, [])
  // 把图片 markdown/失败提示追加到对应消息：sending 在 → sending.text；已清空 → messages 中按消息 id 匹配
  const appendImageMarkdown = useCallback((msgId, streamId, text) => {
    if (pendingImageAppendRef.current.streamId !== streamId) {
      pendingImageAppendRef.current = { streamId, text: '' }
    }
    pendingImageAppendRef.current.text += text
    if (sendingRef.current?.streamId === streamId) {
      // 流式未结束：直接追加 sending.text（同步 streamBuf 防节流 flush 覆盖）
      streamBufRef.current.text += text
      setSending(prev => (prev && prev.streamId === streamId) ? { ...prev, text: prev.text + text } : prev)
    } else if (msgId) {
      // done 后 sending 已清空：追加到 messages 中对应 assistant 消息
      setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, content: m.content + text } : m)))
    }
    // 找不到对应消息（如已被重新回答删除）：放弃本地追加，任务结果仍保留在后端
  }, [])
  // 单次查询任务状态：completed/failed 终止轮询并补文本，其余状态等待下一轮
  const pollImageOnce = useCallback(async (taskId, streamId) => {
    if (pendingImageRef.current?.streamId !== streamId) return
    let res
    try {
      res = await taskAPI.get(taskId)
    } catch {
      return // 查询失败：等下一轮（计时器驱动），不终止轮询
    }
    // 异步返回后再守卫：期间可能已被新任务/新流替换
    if (pendingImageRef.current?.streamId !== streamId) return
    const status = res.data?.status || ''
    const urls = Array.isArray(res.data?.result_urls) ? res.data.result_urls : []
    if (status === 'completed') {
      const file = urls.length ? String(urls[0]).split('/').pop() : ''
      if (file) {
        appendImageMarkdown(lastAssistantMsgIdRef.current, streamId, `\n\n![图片](/api/images/file/${file})`)
      }
      stopImagePolling()
    } else if (status === 'failed') {
      appendImageMarkdown(lastAssistantMsgIdRef.current, streamId, `\n\n图片生成失败:${res.data?.error || '未知错误'},积分已自动退还。`)
      stopImagePolling()
    } else {
      // processing/queued/pending：继续轮询，并同步展示状态（仅 sending 还在时可见）
      setSending(prev => (prev && prev.streamId === streamId) ? { ...prev, pendingImage: { taskId, status } } : prev)
    }
  }, [appendImageMarkdown, stopImagePolling])
  // 启动轮询：立即查一次 + 每 8s 一次，最多 IMAGE_POLL_MAX 次
  const startImagePolling = useCallback((taskId, streamId) => {
    stopImagePolling() // 上一任务的轮询（若在跑）立即终止，避免新旧任务叠加
    pendingImageRef.current = { taskId, streamId }
    let count = 0
    const tick = async () => {
      count += 1
      if (count > IMAGE_POLL_MAX) { stopImagePolling(); return }
      if (pendingImageRef.current?.streamId !== streamId) return
      await pollImageOnce(taskId, streamId)
    }
    tick() // 立即查一次（任务可能已完成，不必等首个 8s）
    imagePollTimerRef.current = setInterval(tick, IMAGE_POLL_INTERVAL_MS)
  }, [pollImageOnce, stopImagePolling])
  // 组件卸载：终止后台图片轮询
  useEffect(() => () => stopImagePolling(), [stopImagePolling])


  // ============ 任务订阅（SSE，仅订阅连接，不携带任务取消语义） ============
  // 订阅任务流：abort 只断开订阅连接；后台任务继续，结果落库。
  // st 为本次流的 sending 对象（含 streamId；resumed=true 表示切回续传，需回放去重）。
  const subscribeTask = useCallback((taskId, st) => {
    const controller = new AbortController()
    abortRef.current = controller
    const streamId = st.streamId
    chatAPI.streamTask(String(taskId), {
      signal: controller.signal,
      onChunk: data => {
        const buf = streamBufRef.current
        if (buf.streamId !== streamId) return
        let t = String(data.text || '')
        if (st.resumed) {
          const inc = replayDedup(resumeGuardRef, streamId, t)
          if (inc === '') return // 回放存量内：跳过（防重复展示）
          if (inc != null) t = inc // 回放结束：追加超出存量的增量
        }
        if (!t) return
        buf.text += t
        if (!streamRenderTimerRef.current) streamRenderTimerRef.current = setTimeout(flushStreamBuf, STREAM_RENDER_INTERVAL_MS)
      },
      onThinking: data => {
        const buf = streamBufRef.current
        if (buf.streamId !== streamId) return
        let t = String(data.text || '')
        if (st.resumed) {
          const inc = replayDedup(resumeGuardRef, streamId, t)
          if (inc === '') return
          if (inc != null) t = inc
        }
        if (!t) return
        buf.thinking += t
        if (!streamRenderTimerRef.current) streamRenderTimerRef.current = setTimeout(flushStreamBuf, STREAM_RENDER_INTERVAL_MS)
      },
      onToolStatus: data => setSending(prev => {
        if (!prev || prev.streamId !== streamId) return prev
        const name = data?.name || ''
        const status = data?.status || 'executing'
        const steps = Array.isArray(prev.toolSteps) ? [...prev.toolSteps] : []
        if (status === 'executing') {
          // 新工具开始执行：追加一条轨迹（同名工具可多次调用，用时间戳区分）
          steps.push({ key: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, status: 'executing', startedAt: Date.now() })
        } else {
          // 工具完成：把最后一条 executing 的同名轨迹标记为 done
          for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].name === name && steps[i].status === 'executing') {
              steps[i] = { ...steps[i], status: 'done' }
              break
            }
          }
        }
        return { ...prev, toolSteps: steps }
      }),
      onHeartbeat: () => {
        // 心跳确认工具仍在执行（后端 10s 粒度保活事件）。耗时展示由渲染端按
        // executingStep.startedAt 实时计算，无需在此更新 state（避免无谓重渲染）。
      },
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
      onFile: data => {
        // streamId 守卫（与 onWidget 一致）：旧流迟到的 file 不得写入新流
        const buf = filesRef.current
        if (buf.streamId !== streamId) return
        const file = data?.file
        if (!file || !file.filename || !file.url) return
        buf.items.push(file)
        // 同步发送中气泡：流式期间实时显示文件卡片
        setSending(prev =>
          (prev && prev.streamId === streamId) ? { ...prev, files: buf.items } : prev)
      },
      onImageTask: data => {
        // 工具等待超时后生图转入后台：拿到任务 id 启动轮询（每 8s 一次，最多 120 次）。
        // 轮询状态独立于 sending 生命周期（done 后 sending 清空仍可补图）。
        const taskId = data?.task_id
        if (!taskId || sendingRef.current?.streamId !== streamId) return
        startImagePolling(String(taskId), streamId)
        setSending(prev =>
          (prev && prev.streamId === streamId) ? { ...prev, pendingImage: { taskId: String(taskId), status: 'queued' } } : prev)
      },
      onStopped: () => {
        // 后端确认停止（stopMessage 生效或后端主动停）：置 stopped 保留气泡，断开订阅
        setLinkStatus(prev => prev?.status === 'fetching' ? null : prev)
        if (sendingRef.current?.streamId === streamId) {
          sendingRef.current = { ...sendingRef.current, stopped: true, error: sendingRef.current.error || '已停止生成', manual: false, status: 'stopped' }
        }
        setSending(prev =>
          (prev && prev.streamId === streamId) ? { ...prev, stopped: true, error: prev.error || '已停止生成', manual: false, status: 'stopped' } : prev)
        abortRef.current?.abort()
      },
      onDone: data => {
        const thinking = String(data.thinking || '')
        // 优先用后端返回的数据库 id（重新回答/定位需要真实 id），缺失时回退本地临时 id
        const newId = data.message_id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        // done 前已完成的后台图片追加（completed/failed 先于 done 到达时，追加文本已写入
        // sending.text，会被后端完整文本覆盖）→ 合并进最终消息文本，避免图片 markdown 丢失
        const appended = pendingImageAppendRef.current.streamId === streamId ? pendingImageAppendRef.current.text : ''
        const full = String(data.text || '') + appended
        // 记录本流消息 id：done 后到达的后台图片任务完成时，把 markdown 补进该消息
        lastAssistantMsgIdRef.current = newId
        // 仅当仍是本次流时挂载累积的引用（旧流迟到 done 不污染新流消息）
        const citations = citationsRef.current.streamId === streamId ? citationsRef.current.items : []
        // 同上：widgets 仅当仍是本次流时挂载（取完再清理 sending，避免发送中状态已置 null 丢失）
        const widgets = widgetsRef.current.streamId === streamId ? widgetsRef.current.items : []
        // 同上：files 仅当仍是本次流时挂载
        const files = filesRef.current.streamId === streamId ? filesRef.current.items : []
        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === newId)
          if (idx >= 0) {
            // 续传转正：更新已存在的历史 streaming 消息（清除 streaming/error 状态）
            const next = [...prev]
            next[idx] = { ...next[idx], content: full, thinking, citations, widgets, sent_files: files, status: undefined, error: undefined }
            return next
          }
          return [...prev, { id: newId, role: 'assistant', content: full, thinking, citations, widgets, sent_files: files, created_at: new Date().toISOString() }]
        })
        // 发送成功：文件已上传为会话上下文，清空上传区（失败时保留 docs 便于重试）
        setDocs([])
        // 流结束：若仍停留在 fetching（事件顺序异常），清除残留状态
        setLinkStatus(prev => prev?.status === 'fetching' ? null : prev)
        // 仅当仍是本次流时才清理状态（streamId 唯一身份，旧流迟到回调不影响新流）
        if (sendingRef.current?.streamId === streamId) {
          sendingRef.current = null
          setSending(null)
        }
        resumeGuardRef.current = null
        const bal = data.points_balance
        if (bal != null) {
          const num = Number(bal)
          setPoints(num)
          const u = readUser()
          if (u) { u.points = num; localStorage.setItem('user', JSON.stringify(u)) }
          window.dispatchEvent(new Event('points-updated'))
        }
        if (data.ai_daily_remaining != null) {
          const dailyLeft = Number(data.ai_daily_remaining)
          setDailyRemaining(dailyLeft)
          dailyRemainingRef.current = dailyLeft
        }
        refreshSessions()
      },
      onError: (msg, isNetwork) => {
        if (isNetwork) {
          // 订阅连接断开（非主动 abort）：任务仍在后台继续，结果落库；仅提示，不取消。
          // 断网期间转兜底轮询续看（每 2s 拉最新内容，消息终态自动停），避免气泡停在半成品
          showToast('连接已断开，生成将在后台继续，返回会话可继续查看', 'error')
          const cur = sendingRef.current
          if (cur && cur.streamId === streamId && !cur.stopped && cur.assistantMessageId && cur.sessionId) {
            startResumePollingRef.current?.(cur.sessionId, cur.assistantMessageId, streamId)
          }
          return
        }
        const errMsg = msg || '生成失败'
        // 后端 error 事件 = 任务失败（含积分不足/429 等）：若仍停留在 fetching，清除残留链接状态
        setLinkStatus(prev => prev?.status === 'fetching' ? null : prev)
        const cur = sendingRef.current
        if (cur && cur.streamId === streamId) {
          if (cur.resumed && cur.assistantMessageId) {
            // 续传场景：历史消息已存在 → 更新为失败态
            setMessages(prev => prev.map(m => (m.id === cur.assistantMessageId ? { ...m, status: 'failed', error: errMsg } : m)))
          } else {
            // 本页发送场景：错误追加为消息
            setMessages(prev => [...prev, { id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: '', error: errMsg, created_at: new Date().toISOString() }])
          }
          // 本流无成功消息：后台图片任务完成后无处可补，放弃本地补图
          // （任务结果仍保留在后端；lastAssistantMsgIdRef 残留旧值会补错消息）
          lastAssistantMsgIdRef.current = null
          sendingRef.current = null
        }
        setSending(prev => (prev && prev.streamId === streamId) ? null : prev)
        if (/积分不足|余额不足/.test(errMsg)) {
          dialog.alert(errMsg)
          pointsAPI.balance().then(res => {
            setPoints(Number(res.data?.points || 0))
            setDailyTotal(res.data?.ai_daily_total === null ? null : Number(res.data?.ai_daily_total || 0))
            setDailyRemaining(res.data?.ai_daily_remaining === null ? null : Number(res.data?.ai_daily_remaining || 0))
          }).catch(() => {})
        }
      },
    }).finally(() => { if (abortRef.current === controller) abortRef.current = null })
  }, [dialog, refreshSessions, flushStreamBuf, clearLinkTimer, updateLinkStatus, stopImagePolling, startImagePolling, showToast])

  // ============ 发送链路：POST 创建任务 → 替换本地用户消息 id → 初始化 sending → 订阅 ============
  // 替代旧 startStream：发送与订阅解耦。sending 的 text/thinking 从空开始（打字机），
  // taskId/assistantMessageId 由 sendMessage 返回后写入（停止按钮依赖 assistantMessageId）。
  const startChatTask = useCallback(async (sessionId, content, reasoningEffort = 'auto', useWeb = null, localUserMsgId = null, imageFileIds = []) => {
    // 新任务开始：终止上一流遗留的后台图片轮询（旧任务结果不再补进新流，防串流）
    stopImagePolling()
    // 流的唯一身份：旧流的迟到回调不会误操作新流
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const st = { streamId, sessionId, content, text: '', thinking: '', toolSteps: [], citations: [], widgets: [], files: [], pendingImage: null, stopped: false, error: '', manual: false, status: 'streaming', taskId: null, assistantMessageId: null, resumed: false }
    sendingRef.current = st
    setSending(st)
    // 本次流开始：重置节流缓冲（避免残留上一流的未 flush 内容）
    streamBufRef.current = { streamId, text: '', thinking: '' }
    // 本次流开始：重置引用累积（避免上一流的 citations 残留）
    citationsRef.current = { streamId, items: [] }
    // 本次流开始：重置 widget 累积（避免上一流的 widgets 残留）
    widgetsRef.current = { streamId, items: [] }
    // 本次流开始：重置文件累积（避免上一流的 files 残留）
    filesRef.current = { streamId, items: [] }
    // 本次流开始：重置链接抓取状态（避免上一流的 url_status 残留）
    clearLinkTimer(); setLinkStatus(null)
    if (streamRenderTimerRef.current) { clearTimeout(streamRenderTimerRef.current); streamRenderTimerRef.current = null }
    let res
    try {
      res = await chatAPI.sendMessage(sessionId, content, {
        reasoning_effort: reasoningEffort,
        model_id: modelIdRef.current,
        web_search: useWeb === null ? webSearchRef.current : useWeb,
        image_file_ids: imageFileIds,
      })
    } catch (err) {
      const errMsg = err?.message || '发送失败'
      // 发送失败（含 429 并发限制等，detail 已由 axios 拦截器翻译）：错误气泡 + 释放发送锁
      setMessages(prev => [...prev, { id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: '', error: errMsg, created_at: new Date().toISOString() }])
      lastAssistantMsgIdRef.current = null
      if (sendingRef.current?.streamId === streamId) sendingRef.current = null
      setSending(prev => (prev && prev.streamId === streamId) ? null : prev)
      if (/积分不足|余额不足/.test(errMsg)) {
        dialog.alert(errMsg)
        pointsAPI.balance().then(res => {
          setPoints(Number(res.data?.points || 0))
          setDailyTotal(res.data?.ai_daily_total === null ? null : Number(res.data?.ai_daily_total || 0))
          setDailyRemaining(res.data?.ai_daily_remaining === null ? null : Number(res.data?.ai_daily_remaining || 0))
        }).catch(() => {})
      }
      return
    }
    const taskId = res.data?.task_id
    const assistantMessageId = res.data?.assistant_message_id
    const userMessageId = res.data?.user_message_id
    // 用后端返回的真实 id 替换本地用户消息临时 id（重新回答定位数据库 id 依赖真实 id）
    if (userMessageId && localUserMsgId) {
      setMessages(prev => prev.map(m => (m.id === localUserMsgId ? { ...m, id: String(userMessageId) } : m)))
    }
    if (!taskId || !assistantMessageId) {
      // 契约保证返回；防御性兜底：不订阅，任务结果落库后刷新可见
      return
    }
    // 记录 task_id 缓存：切走再切回时续传订阅用（历史接口不返回 task_id）
    rememberTaskId(String(assistantMessageId), String(taskId))
    if (sendingRef.current?.streamId === streamId) {
      sendingRef.current = { ...sendingRef.current, taskId: String(taskId), assistantMessageId: String(assistantMessageId) }
    }
    setSending(prev =>
      (prev && prev.streamId === streamId)
        ? { ...prev, taskId: String(taskId), assistantMessageId: String(assistantMessageId) }
        : prev)
    subscribeTask(String(taskId), { ...st, taskId: String(taskId), assistantMessageId: String(assistantMessageId) })
  }, [subscribeTask, dialog, stopImagePolling, clearLinkTimer])

  // ============ 切回自动续看 ============
  // 无 task_id 缓存时的兜底：轮询 messages 每 2s，直到该 streaming 消息进入终态
  // （此时停止轮询并把最新 content/thinking 补进 sending/messages）。
  const stopResumePolling = useCallback(() => {
    if (resumePollTimerRef.current) { clearInterval(resumePollTimerRef.current); resumePollTimerRef.current = null }
  }, [])
  const startResumePolling = useCallback((sessionId, messageId, streamId) => {
    stopResumePolling()
    resumePollTimerRef.current = setInterval(async () => {
      let res
      try { res = await chatAPI.messages(sessionId) } catch { return } // 失败等下一轮
      const items = res.data?.items || []
      const msg = items.find(m => String(m.id) === String(messageId))
      if (!msg) { stopResumePolling(); return }
      const terminal = !!(msg.status && msg.status !== 'streaming')
      // 同步最新内容到本地（sending 还在时）
      if (sendingRef.current?.streamId === streamId) {
        const patch = { text: msg.content || '', thinking: msg.thinking || '' }
        sendingRef.current = { ...sendingRef.current, ...patch }
        setSending(prev => (prev && prev.streamId === streamId) ? { ...prev, ...patch } : prev)
      }
      setMessages(prev => prev.map(m => (String(m.id) === String(messageId)
        ? { ...m, content: msg.content ?? m.content, thinking: msg.thinking ?? m.thinking, status: msg.status, error: msg.error }
        : m)))
      if (terminal) {
        stopResumePolling()
        if (sendingRef.current?.streamId === streamId) {
          if (msg.status === 'stopped' || msg.status === 'failed') {
            // 终态 stopped/failed：保留气泡展示错误/已停止
            const errText = msg.error || (msg.status === 'stopped' ? '已停止生成' : '生成失败')
            sendingRef.current = { ...sendingRef.current, stopped: true, error: errText, manual: false, status: msg.status }
            setSending(prev => (prev && prev.streamId === streamId) ? { ...prev, stopped: true, error: errText, manual: false, status: msg.status } : prev)
          } else {
            // done：本页发送场景 messages 中无占位行 → 补进消息列表；
            // 续看（resumed）场景消息已在列表中，由上面的 map 更新过终态
            setMessages(prev => {
              const idx = prev.findIndex(m => String(m.id) === String(messageId))
              if (idx >= 0) return prev
              return [...prev, {
                id: messageId, role: 'assistant', content: msg.content || '',
                thinking: msg.thinking || '',
                citations: Array.isArray(msg.citations) ? msg.citations : [],
                widgets: Array.isArray(msg.widgets) ? msg.widgets : [],
                sent_files: Array.isArray(msg.sent_files) ? msg.sent_files : [],
                created_at: new Date().toISOString(),
              }]
            })
            sendingRef.current = null
            setSending(prev => (prev && prev.streamId === streamId) ? null : prev)
            refreshSessions()
          }
        }
      }
    }, 2000)
  }, [refreshSessions, stopResumePolling])
  startResumePollingRef.current = startResumePolling

  // 历史加载完成后扫描 streaming 消息并恢复生成状态：
  // 优先 task_id 缓存续传订阅（同页面发送→切走→切回）；缺失则退化轮询兜底。
  useEffect(() => {
    if (messagesLoading || !activeId || !messages.length) return
    if (resumePollTimerRef.current) return // 兜底轮询进行中
    const streamingMsg = messages.find(m => m.role === 'assistant' && m.status === 'streaming')
    if (!streamingMsg) return
    // 同页正在生成中（发送/续看）：不重复订阅
    if (sendingRef.current && !sendingRef.current.stopped && sendingRef.current.sessionId === activeId) return
    if (resumeSubscribedRef.current === streamingMsg.id) return
    resumeSubscribedRef.current = streamingMsg.id
    const streamId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // 回填重试内容：该 assistant 消息前最近的 user 消息
    let retryContent = ''
    for (let i = messages.indexOf(streamingMsg) - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { retryContent = messages[i].content || ''; break }
    }
    const cachedTaskId = taskIdCache.get(String(streamingMsg.id))
    const st = {
      streamId,
      sessionId: activeId,
      content: retryContent,
      text: streamingMsg.content || '',
      thinking: streamingMsg.thinking || '',
      toolSteps: [],
      citations: Array.isArray(streamingMsg.citations) ? streamingMsg.citations : [],
      widgets: Array.isArray(streamingMsg.widgets) ? streamingMsg.widgets : [],
      files: Array.isArray(streamingMsg.sent_files) ? streamingMsg.sent_files : [],
      pendingImage: null,
      stopped: false,
      error: '',
      manual: false,
      status: 'streaming',
      taskId: cachedTaskId || null,
      assistantMessageId: String(streamingMsg.id),
      resumed: true,
    }
    sendingRef.current = st
    setSending(st)
    // 节流缓冲/累积以历史内容为起点（回放去重按此基准跳过存量）
    streamBufRef.current = { streamId, text: streamingMsg.content || '', thinking: streamingMsg.thinking || '' }
    citationsRef.current = { streamId, items: [...st.citations] }
    widgetsRef.current = { streamId, items: [...st.widgets] }
    filesRef.current = { streamId, items: [...st.files] }
    clearLinkTimer(); setLinkStatus(null)
    if (streamRenderTimerRef.current) { clearTimeout(streamRenderTimerRef.current); streamRenderTimerRef.current = null }
    if (cachedTaskId) {
      resumeGuardRef.current = { streamId, base: st.text, acc: '', active: true }
      subscribeTask(String(cachedTaskId), st)
    } else {
      // 兜底：轮询 messages 直到终态
      startResumePolling(activeId, String(streamingMsg.id), streamId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, messagesLoading, activeId, subscribeTask, startResumePolling])

  // ============ 排队队列操作 ============
  const MAX_PENDING = 10
  const enqueuePending = (text, files = [], imageFileIds = []) => {
    const item = { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, files, imageFileIds }
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
  // 主动中止流（切换/新建/删除会话）时清空排队消息，队列随旧会话上下文一并丢弃，给出提示
  const clearPendingWithNotice = useCallback(() => {
    if (pendingQueueRef.current.length) showToast('排队消息已取消', 'error')
    clearPending()
  }, [showToast, clearPending])
  const focusInput = () => {
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length)
    }
  }

  const handleSend = async (raw) => {
    // 发送新消息：用户意图是看新回复，重置为跟随贴底
    stickToBottomRef.current = true
    const text = String(raw ?? input).trim()
    if (!text) return
    // 已成功上传的文件作为「引用」随消息发送（展示在对话区消息上，输入框标签立即移除）
    let successFiles = docs
      .filter(d => d.status === 'success' && d.file_id != null)
      .map(d => ({ id: d.file_id, original_name: d.name, storage_name: d.storage_name, kind: d.kind || 'doc' }))
    // 图片单消息最多 MAX_IMAGES 张（后端 image_file_ids 硬上限 4）：粘贴入口已截取，
    // 文件选择/拖拽路径一次可入 5 张，此处统一裁剪兜底，保证后端不 422（被裁图片已上传但随消息不发送）
    let imageFileIds = successFiles.filter(f => f.kind === 'image').map(f => f.id)
    if (imageFileIds.length > MAX_IMAGES) {
      const keptIds = new Set(imageFileIds.slice(0, MAX_IMAGES))
      showUploadNote(`一条消息最多发送 ${MAX_IMAGES} 张图片，已自动截取前 ${MAX_IMAGES} 张`)
      successFiles = successFiles.filter(f => f.kind !== 'image' || keptIds.has(f.id))
      imageFileIds = [...keptIds]
    }
    const clearSentDocs = () => setDocs(prev => {
      for (const d of prev) { if (d.status === 'success' && d.preview) URL.revokeObjectURL(d.preview) }
      return prev.filter(d => d.status !== 'success')
    })
    // 正在生成中：进入排队队列，当前回复结束后自动发送
    if (sendingRef.current && !sendingRef.current.stopped) {
      if (pendingQueueRef.current.length >= MAX_PENDING) {
        dialog.alert(`排队消息最多 ${MAX_PENDING} 条，请等待发送或删除部分排队消息。`)
        focusInput()
        return
      }
      enqueuePending(text, successFiles, imageFileIds)
      clearSentDocs()
      setInput('')
      if (inputRef.current) inputRef.current.style.height = 'auto'
      focusInput()
      return
    }
    // 空闲（或上一条已停止/失败）：获取发送锁后直接发送
    if (!acquireSendLock(text)) return
    if (cost > 0 && !((dailyTotalRef?.current === null) || (dailyRemainingRef?.current || 0) > 0) && pointsRef.current < cost) {
      releaseSendLock()
      dialog.alert(`钱包余额不足，当前仅剩 ${pointsRef.current} 积分，本次对话需要 ${cost} 积分。`)
      return
    }
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    let sid = activeIdRef.current
    if (!sid) {
      try {
        const res = await chatAPI.createSession()
        const s = res.data
        setSessions(prev => [s, ...prev.filter(p => p.id !== s.id)]) // 去重：后端可能复用已存在的空会话
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
    await startChatTask(sid, text, effortRef.current, null, userLocalId, imageFileIds)
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
    if (cost > 0 && !((dailyTotalRef?.current === null) || (dailyRemainingRef?.current || 0) > 0) && pointsRef.current < cost) {
      releaseSendLock()
      dialog.alert(`钱包余额不足，当前仅剩 ${pointsRef.current} 积分，本次对话需要 ${cost} 积分。排队消息已取消，请补充钱包余额后重新发送。`)
      clearPending()
      return
    }
    let sid = activeIdRef.current
    if (!sid) {
      try {
        const res = await chatAPI.createSession()
        const s = res.data
        setSessions(prev => [s, ...prev.filter(p => p.id !== s.id)]) // 去重：后端可能复用已存在的空会话
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
    startChatTask(sid, item.text, effortRef.current, null, userLocalId, item.imageFileIds || [])
  }, [dialog, cost, startChatTask, acquireSendLock, releaseSendLock, clearPending])

  // sending 变为空闲时自动发送排队中的下一条
  useEffect(() => {
    if (sending !== null) return
    sendQueuedNext()
  }, [sending, sendQueuedNext])

  const handleSelectSession = (id) => {
    if (id === activeId) return
    // 生成中也可切换：只断开订阅连接（后台任务继续，结果落库，绝无任务取消语义）。
    // 本地流状态直接丢弃；切回时由续看逻辑按 task_id 缓存恢复订阅。
    abortRef.current?.abort()
    sendingRef.current = null
    setSending(null)
    resumeGuardRef.current = null
    resumeSubscribedRef.current = null // 允许切回同一会话时重新续看
    stopResumePolling()
    stopImagePolling() // 切会话后旧会话的后台图片任务不再补图（消息列表已切换）
    clearPendingWithNotice()
    skipMessagesLoadRef.current = null // 切换会话不再跳过加载
    setActiveId(id)
    setSessionListOpen(false)
  }

  const handleCreateSession = async () => {
    if (creatingRef.current) return // 创建中：拦截重复点击，避免连续点击产生多个空会话
    creatingRef.current = true
    setCreatingSession(true)
    // 生成中也可新建：只断开订阅连接（后台任务继续，结果落库），本地流状态丢弃
    abortRef.current?.abort()
    sendingRef.current = null
    setSending(null)
    resumeGuardRef.current = null
    resumeSubscribedRef.current = null // 新建会话后旧会话不续看
    stopResumePolling()
    stopImagePolling() // 新建会话后旧会话的后台图片任务不再补图
    clearPendingWithNotice()
    try {
      const res = await chatAPI.createSession()
      const s = res.data
      setSessions(prev => [s, ...prev.filter(p => p.id !== s.id)]) // 去重：后端可能复用已存在的空会话
      skipMessagesLoadRef.current = s.id // 新建会话消息为空，跳过首次加载避免竞态覆盖
      setActiveId(s.id)
      setMessages([])
      setSessionListOpen(false)
      focusInput() // 新建后直接聚焦对话框，用户可直接输入
      return s // 供「无会话时上传文件自动建会话」复用
    } catch (err) {
      dialog.alert(err.message || '创建会话失败')
      return null
    } finally {
      creatingRef.current = false
      setCreatingSession(false)
    }
  }

  // 移动端侧边栏会话子导航事件：切换会话 / 新建会话
  useEffect(() => {
    const onSelectSession = () => {
      const id = localStorage.getItem('chat_active_session_id')
      if (id && id !== activeIdRef.current) handleSelectSession(id)
    }
    const onCreateSession = () => { handleCreateSession() }
    window.addEventListener('chat-session-selected', onSelectSession)
    window.addEventListener('chat-session-created', onCreateSession)
    return () => {
      window.removeEventListener('chat-session-selected', onSelectSession)
      window.removeEventListener('chat-session-created', onCreateSession)
    }
  }, [handleSelectSession, handleCreateSession])

  // 删除会话/删除消息前：终止该会话仍在后台生成的任务（fire-and-forget，后端负责退款）。
  // 当前会话的 streaming 消息可从 sending/messages 获知；非当前会话前端没有消息数据，
  // 由后端在删除会话时自行清理其后台任务。
  const stopSessionStreaming = useCallback((sessionId) => {
    if (activeIdRef.current !== sessionId) return
    const ids = []
    const cur = sendingRef.current
    if (cur && cur.assistantMessageId) ids.push(String(cur.assistantMessageId))
    for (const m of messages) {
      if (m.role === 'assistant' && m.status === 'streaming' && m.id) ids.push(String(m.id))
    }
    ids.forEach(mid => { chatAPI.stopMessage(mid).catch(() => {}) })
  }, [messages])

  const handleDeleteSession = async (id) => {
    const ok = await dialog.confirm('确定删除该会话吗？删除后聊天记录将无法恢复。')
    if (!ok) return
    // 若该会话正在生成：先显式停止后台任务（fire-and-forget）
    stopSessionStreaming(id)
    try {
      await chatAPI.deleteSession(id)
      const next = sessions.filter(s => s.id !== id)
      setSessions(next)
      if (activeId === id) {
        abortRef.current?.abort()
        sendingRef.current = null
        setSending(null)
        resumeGuardRef.current = null
        resumeSubscribedRef.current = null
        stopResumePolling()
        clearPendingWithNotice()
        try { localStorage.removeItem('chat_active_session_id') } catch {}
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
    // 若当前会话在选中列表中且正在生成：先显式停止后台任务（fire-and-forget）
    if (selectedIds.includes(activeId)) stopSessionStreaming(activeId)
    try {
      const res = await chatAPI.batchDeleteSessions(selectedIds)
      const deleted = Number(res.data?.deleted) || 0
      const delSet = new Set(selectedIds)
      const next = sessions.filter(s => !delSet.has(s.id))
      setSessions(next)
      if (delSet.has(activeId)) {
        abortRef.current?.abort()
        sendingRef.current = null
        setSending(null)
        resumeGuardRef.current = null
        resumeSubscribedRef.current = null
        stopResumePolling()
        clearPendingWithNotice()
        try { localStorage.removeItem('chat_active_session_id') } catch {}
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

  // useCallback：仅依赖 refs/setter，引用稳定 → StreamBubble memo 不因 onStop 变化失效
  const handleStop = useCallback(() => {
    const cur = sendingRef.current
    if (!cur || cur.stopped) return
    // 显式停止后端任务（后端负责退款，幂等）：fire-and-forget
    if (cur.assistantMessageId) {
      chatAPI.stopMessage(cur.assistantMessageId).catch(() => {})
    }
    // 本地立即置 stopped + 断开订阅连接（订阅断开不影响任务；任务由 stopMessage 终止）
    abortRef.current?.abort()
    if (sendingRef.current && !sendingRef.current.stopped) {
      sendingRef.current = { ...sendingRef.current, stopped: true, error: '已停止生成', manual: false, status: 'stopped' }
    }
    setSending(prev => (prev && !prev.stopped) ? { ...prev, stopped: true, error: '已停止生成', manual: false, status: 'stopped' } : prev)
  }, [])

  const handleReasoningEffort = (v) => {
    setReasoningEffort(v)
    try { localStorage.setItem('chat_reasoning_effort', v) } catch {}
  }

  const handleSelectModel = (id) => {
    setChatModelId(id)
    try { localStorage.setItem('chat_model_id', id) } catch { /* 忽略 localStorage 异常 */ }
  }

  // 用 sendingRef 读当前发送状态（与 sending state 同步），依赖仅 startChatTask → 引用稳定，
  // StreamBubble memo 不因 onRetry 变化失效
  const handleRetry = useCallback(() => {
    const cur = sendingRef.current
    if (!cur) return
    const { sessionId, content } = cur
    if (!content) { showToast('暂无可重试的原始问题', 'error'); return }
    setSending(null)
    startChatTask(sessionId, content, effortRef.current)
  }, [startChatTask, showToast])

  // 「重新回答」：删除该回答分支点（对应问题消息及之后全部），再复用 send_message
  // 链路重新发送同一问题 —— 扣费/退款/落库全部走现有逻辑，积分消耗与正常发送一致。
  // useCallback：稳定引用使 MessageItem memo 在流式期间（messages 不变）不失效
  const handleRegenerate = useCallback(async (msg) => {
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
    let userIdx = -1
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { userMsg = messages[i]; userIdx = i; break }
    }
    if (!userMsg) { dialog.alert('找不到对应的问题消息'); return }
    if (/^(local-|err-)/.test(String(userMsg.id))) {
      dialog.alert('该问题尚未同步到服务器，请刷新后重试')
      return
    }
    const costText = cost > 0 ? `（消耗 ${cost} 积分）` : ''
    const ok = await dialog.confirm(`重新回答将删除本条回答及其后的对话${costText}，确定吗？`)
    if (!ok) return
    // 分支点之后若有仍在后台生成的任务：先显式停止（fire-and-forget，后端退款）
    for (let i = userIdx + 1; i < messages.length; i++) {
      if (messages[i].role === 'assistant' && messages[i].status === 'streaming' && messages[i].id) {
        chatAPI.stopMessage(String(messages[i].id)).catch(() => {})
      }
    }
    try {
      await chatAPI.deleteMessages(sid, userMsg.id)
    } catch (err) {
      dialog.alert(err.message || '操作失败，请重试')
      return
    }
    // 本地同步截断到问题消息之前，再重新插入该问题（新临时 id，sendMessage 返回
    // user_message_id 后替换为真实 id），然后重新发送
    const userLocalId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setMessages(prev => {
      const ui = prev.findIndex(m => m.id === userMsg.id)
      if (ui < 0) return prev
      return [...prev.slice(0, ui), { ...userMsg, id: userLocalId, created_at: new Date().toISOString() }]
    })
    // 原问题携带的图片：文件属于会话（chat_files），删除消息不级联删文件，重新回答时随消息重发
    const retryImageIds = (userMsg.files || [])
      .filter(f => f.kind === 'image' && f.id != null)
      .map(f => Number(f.id))
    startChatTask(sid, userMsg.content, effortRef.current, null, userLocalId, retryImageIds)
  }, [dialog, messages, cost, startChatTask])

  const handleCopy = useCallback(async (text) => {
    const ok = await copyText(String(text || ''))
    showToast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error')
  }, [showToast])

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

  useEffect(() => {
    localStorage.setItem('chat-list-collapsed', chatListCollapsed ? '1' : '0')
  }, [chatListCollapsed])

  return (
    <MainLayout>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 桌面端会话列表栏 */}
        <aside className={`hidden lg:flex flex-col flex-shrink-0 min-h-0 overflow-hidden transition-all duration-200 ease-out ${chatListCollapsed ? 'w-0' : 'w-56'}`}
          style={{ background: 'var(--bg-sidebar)', borderRight: chatListCollapsed ? 'none' : '1px solid var(--border-color)' }}>
          {!chatListCollapsed && (
            <SessionList
              sessions={sessions} activeId={activeId} loading={sessionsLoading} sending={sending} creating={creatingSession}
              renaming={renaming} renamingValue={renaming?.title || ''}
              onSelect={handleSelectSession} onCreate={handleCreateSession} onDelete={handleDeleteSession}
              onStartRename={startRename} onRenamingChange={changeRename}
              onRenamingCommit={commitRename} onRenamingCancel={cancelRename}
              batchMode={batchMode} selectedIds={selectedIds}
              onEnterBatch={handleEnterBatch} onSelectAll={handleSelectAll}
              onToggleSelect={handleToggleSelect} onBatchDelete={handleBatchDelete}
              onExitBatch={handleExitBatch}
              onToggleCollapse={() => setChatListCollapsed(true)} />
          )}
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
                  sessions={sessions} activeId={activeId} loading={sessionsLoading} sending={sending} creating={creatingSession}
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
        <div className="flex-1 min-w-0 flex flex-col relative">
          {chatListCollapsed && (
            <button onClick={() => setChatListCollapsed(false)} title="展开会话列表"
              className="absolute top-2 left-2 z-10 p-1.5 rounded-lg hover:bg-bg-hover"
              style={{ color: 'var(--text-secondary)' }}>
              <PanelLeftOpen size={16} />
            </button>
          )}

          <div ref={scrollRef} onScroll={handleMessageScroll} className="chat-scroll-area flex-1 min-h-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-5 pb-40 lg:pb-8">
              {messagesLoading ? (
                <div className="text-center text-xs py-10" style={{ color: 'var(--text-secondary)' }}>加载中…</div>
              ) : messages.length === 0 && !sending ? (
                <>
                  <GroupBuyBanner />
                  <EmptyState onPick={t => { setInput(t); focusInput() }} models={selectableModels} modelId={chatModelId} onSelectModel={handleSelectModel} />
                </>
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
            accept={`${DOC_ACCEPT},${[...IMG_EXTS].map(e => `.${e}`).join(',')}`}
            onChange={handleFilesSelected} />
          <ChatInputBar inputRef={inputRef} value={input} onChange={setInput}
            onSend={handleSend} onStop={handleStop} sending={!!sending && !sending?.stopped} cost={cost} points={points}
            dailyTotal={dailyTotal} dailyRemaining={dailyRemaining} isMember={chatSubscription?.plan?.features?.package_type === 'membership'}
            reasoningEffort={reasoningEffort} onReasoningEffort={handleReasoningEffort}
            efforts={chatModel?.reasoning_efforts} modelLabel={chatModel?.label || modelInfo?.label || modelInfo?.model_id}
            modelProvider={chatModel?.provider || modelInfo?.provider || ''}
            pendingQueue={pendingQueue} onEditPending={editPending} onRemovePending={removePending}
            models={selectableModels} chatModelId={chatModelId} onSelectModel={handleSelectModel}
            onUploadClick={openFilePicker} docs={docs} onRemoveDoc={removeDoc}
            uploadingCount={docs.filter(d => d.status === 'uploading' || d.status === 'pending').length}
            uploadNote={uploadNote}
            webSearch={webSearch} onWebSearch={toggleWebSearch}
            linkStatus={linkStatus} dragActive={dragActive} dragHandlers={dragHandlers}
            onPasteFiles={handlePasteFiles} />
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

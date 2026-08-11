import { Eye, RefreshCw, Trash2, X } from 'lucide-react'
import SearchInput from '../../components/SearchInput'
import Pagination from '../../components/Pagination'

export default function AdminChatTab({
  chatTotal,
  chatQuery,
  setChatQuery,
  loading,
  sessions,
  chatPage,
  setChatPage,
  onRefresh,
  handleDeleteChatSession,
  openChatSession,
  viewSession,
  closeChatSession,
}) {
  const parseBeijing = (v) => {
    const s = String(v || '')
    const withTz = s.includes('T')
      ? (s.includes('+') || s.includes('Z') ? s : s + '+08:00')
      : s.replace(' ', 'T') + '+08:00'
    return new Date(withTz)
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {chatTotal} 条会话</span>
        <SearchInput value={chatQuery} onChange={setChatQuery} placeholder="搜索标题/用户/消息内容..." />
        <button
          onClick={onRefresh}
          className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-bg-hover"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}
          title="刷新"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin-slow"
            style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }}
          />
        </div>
      ) : (
        <>
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--bg-card)' }}>
                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>ID</th>
                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>标题</th>
                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>用户</th>
                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>消息数</th>
                    <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>最后消息</th>
                    <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>更新时间</th>
                    <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(item => (
                    <tr key={item.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-secondary)' }}>{item.id}</td>
                      <td className="px-3 py-2 truncate max-w-[180px]" style={{ color: 'var(--text-primary)' }} title={item.title || ''}>
                        {item.title || '（无标题）'}
                      </td>
                      <td className="px-3 py-2 truncate max-w-[140px]" style={{ color: 'var(--text-secondary)' }} title={`${item.username || ''} ${item.nickname || ''}`}>
                        {item.nickname || item.username || '-'}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums" style={{ color: 'var(--text-secondary)' }}>{item.message_count ?? 0}</td>
                      <td className="px-3 py-2 truncate max-w-[240px]" style={{ color: 'var(--text-secondary)' }} title={item.last_message || ''}>
                        {item.last_message || '-'}
                      </td>
                      <td className="px-3 py-2 text-center whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {item.updated_at || item.created_at || '-'}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => openChatSession(item)}
                          className="p-1.5 rounded-2xl hover:bg-bg-hover"
                          style={{ color: 'var(--accent)' }}
                          title="查看"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteChatSession(item.id)}
                          className="p-1.5 rounded-2xl hover:bg-[var(--color-error)]/10"
                          style={{ color: 'var(--color-error)' }}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {sessions.length === 0 && (
            <div className="text-center py-20" style={{ color: 'var(--text-secondary)' }}>暂无聊天记录</div>
          )}
          {chatTotal > 20 && (
            <Pagination
              page={chatPage}
              totalPages={Math.ceil(chatTotal / 20)}
              onPageChange={setChatPage}
            />
          )}
        </>
      )}

      {viewSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={closeChatSession}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative w-full max-w-2xl max-h-[85vh] rounded-2xl overflow-hidden flex flex-col"
            style={{ background: 'var(--bg-primary)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--border-color)' }}>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {viewSession.session?.title || `会话 #${viewSession.session?.id}`}
                </h3>
                <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                  {viewSession.session?.nickname || viewSession.session?.username || '-'}
                  {' · '}{viewSession.session?.message_count ?? 0} 条消息
                  {viewSession.session?.created_at ? ` · 创建于 ${viewSession.session.created_at}` : ''}
                </div>
              </div>
              <button onClick={closeChatSession} className="p-1.5 rounded-xl hover:bg-bg-hover flex-shrink-0" style={{ color: 'var(--text-secondary)' }} title="关闭">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {viewSession.loading ? (
                <div className="flex justify-center py-20">
                  <div
                    className="w-8 h-8 border-2 rounded-full animate-spin-slow"
                    style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }}
                  />
                </div>
              ) : viewSession.error ? (
                <div className="text-center py-16 text-xs" style={{ color: 'var(--color-error)' }}>
                  消息加载失败：{viewSession.error}
                </div>
              ) : !viewSession.messages || viewSession.messages.length === 0 ? (
                <div className="text-center py-16" style={{ color: 'var(--text-secondary)' }}>该会话暂无消息</div>
              ) : (
                viewSession.messages.map((m, idx) => {
                  const isUser = m.role === 'user'
                  return (
                    <div key={m.id != null ? m.id : `msg-${idx}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className="max-w-[85%] rounded-2xl px-3.5 py-2.5 border"
                        style={{
                          background: isUser ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-ai-bubble)',
                          borderColor: isUser ? 'color-mix(in srgb, var(--accent) 25%, var(--border-color))' : 'var(--border-color)',
                        }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[11px] font-medium" style={{ color: isUser ? 'var(--accent)' : 'var(--text-secondary)' }}>
                            {isUser ? '用户' : 'AI'}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                            {m.created_at ? (() => { const d = parseBeijing(m.created_at); return isNaN(d.getTime()) ? m.created_at : d.toLocaleString('zh-CN', { hour12: false }) })() : ''}
                          </span>
                        </div>
                        <div className="text-xs whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>
                          {m.content}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { Play, Loader2, RefreshCw, X } from 'lucide-react'
export default function AdminAiTaskListPanel({ mode, activeTasks, activeTotal, activePage, setActivePage, createType, setCreateType, taskLimit, setTaskLimit, categories, reviewCategory, setReviewCategory, reviewing, creating, onRefreshTasks, onCreate, onReview, onOpenDetail, showLiveLogs, setShowLiveLogs, liveTaskId, liveLogs, logEndRef, renderDebug }) {
  const totalPages = Math.ceil(activeTotal / 20)
  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{mode==='classification'?'AI 自动分类':'AI 内容审核'}</h3>
        <div className="flex gap-2 items-center flex-wrap">
          <select value={createType} onChange={e => setCreateType(e.target.value)} className="px-2 py-1.5 rounded-2xl text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            <option value="prompt">提示词</option>
            <option value="image">作品</option>
          </select>
          <select value={taskLimit} onChange={e=>setTaskLimit(Number(e.target.value)||200)} className="px-2 py-1.5 rounded-2xl text-xs border" style={{ borderColor:'var(--border-color)', background:'var(--bg-card)', color:'var(--text-primary)' }}>
            <option value={50}>50条</option>
            <option value={100}>100条</option>
            <option value={200}>200条</option>
            <option value={500}>500条</option>
          </select>
          <button onClick={onRefreshTasks} className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium hover:bg-bg-hover transition-colors" style={{ color: 'var(--text-secondary)' }}>
            <RefreshCw size={14} /> 刷新
          </button>
          <button onClick={onCreate} disabled={creating} className="flex items-center gap-1.5 px-4 py-1.5 rounded-2xl text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {creating ? '创建中...' : mode==='classification'?'开始新分类':'开始新审核'}
          </button>
          {mode==='classification'&&<div className="flex items-center gap-1.5">
            <select value={reviewCategory} onChange={e => setReviewCategory(e.target.value)} className="px-2 py-1.5 rounded-2xl text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
              <option value="all">全部分类</option>
              <option value="">选择具体分类...</option>
              {categories.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
            </select>
            <button onClick={onReview} disabled={!reviewCategory || reviewing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium text-white hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--color-warning)' }}>
              {reviewing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {reviewing ? '审查中...' : '重新审查'}
            </button>
          </div>}
        </div>
      </div>
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-ai-bubble)' }}>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>ID</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>类型</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>状态</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>总数</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>已处理</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>创建时间</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {activeTasks.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>暂无{mode==='classification'?'分类':'审核'}任务</td></tr>
            ) : activeTasks.map(t => (
              <tr key={t.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>#{t.id}</td>
                <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}>{t.item_type === 'image' ? '作品' : '提示词'}</span></td>
                <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: (t.status_color || 'var(--text-secondary)') + '20', color: t.status_color || 'var(--text-secondary)' }}>{t.status_label || t.status}</span></td>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{t.total_items}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{t.processed_items}</td>
                <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{t.created_at?.slice(0, 19)}</td>
                <td className="px-3 py-2"><button onClick={() => onOpenDetail(t.id)} className="text-xs font-medium hover:underline" style={{ color: 'var(--accent)' }}>查看详情</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && <div className="flex justify-center gap-2"><button onClick={() => setActivePage(Math.max(1, activePage - 1))} disabled={activePage === 1} className="px-3 py-1 rounded-lg text-xs" style={{ color: 'var(--text-secondary)' }}>上一页</button><span className="text-xs px-2 py-1" style={{ color: 'var(--text-secondary)' }}>{activePage}/{totalPages}</span><button onClick={() => setActivePage(Math.min(totalPages, activePage + 1))} disabled={activePage === totalPages} className="px-3 py-1 rounded-lg text-xs" style={{ color: 'var(--text-secondary)' }}>下一页</button></div>}
      {showLiveLogs && (
        <div className="rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>任务 #{liveTaskId} 实时输出</span>
              {liveLogs.some(l => l.type === 'complete') ? <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--color-success)20', color: 'var(--color-success)' }}>已完成</span> : <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}><Loader2 size={12} className="animate-spin" /> 处理中</span>}
            </div>
            <button onClick={() => setShowLiveLogs(false)} className="p-1 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}><X size={14} /></button>
          </div>
          <div className="p-3 text-xs font-mono overflow-auto max-h-80" style={{ color: 'var(--text-primary)', background: 'var(--bg-ai-bubble)' }}>
            {liveLogs.length === 0 ? <span style={{ color: 'var(--text-secondary)' }}>等待输出...</span> : liveLogs.map((log, i) => <div key={i} className="mb-1">{log.type === 'token' ? <span>{log.message}</span> : log.type === 'error' ? <span style={{ color: 'var(--color-error)' }}>[错误] {log.message}</span> : log.type === 'result' ? <span style={{ color: 'var(--color-success)' }}>[结果] {log.message}</span> : log.type === 'complete' ? <span style={{ color: 'var(--color-success)' }}>[完成] {log.message}</span> : <span style={{ color: 'var(--text-secondary)' }}>[信息] {log.message}</span>}</div>)}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
      {renderDebug}
    </>
  )
}

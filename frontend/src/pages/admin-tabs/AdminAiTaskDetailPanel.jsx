import { ArrowLeft, Check, X, Loader2 } from 'lucide-react'
export default function AdminAiTaskDetailPanel({ mode, activeDetail, statusInfo, resultFilter, setResultFilter, activeSelected, filteredResults, toggleSelectAll, handleApprove, handleReject, onBack, toggleSelect, renderSuggestion, renderRowActions, confidenceMap }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 text-sm hover:underline" style={{ color: 'var(--accent)' }}><ArrowLeft size={16} /> 返回列表</button>
        <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{mode==='classification'?'分类':'审核'}任务 #{activeDetail.id}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: statusInfo?.color + '20', color: statusInfo?.color }}>{statusInfo?.label || activeDetail.status}</span>
        {activeDetail.status === 'processing' && <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}><Loader2 size={14} className="animate-spin" /> {activeDetail.processed_items}/{activeDetail.total_items}</div>}
      </div>
      {activeDetail.status === 'processing' && <div className="w-full rounded-full h-2" style={{ background: 'var(--border-color)' }}><div className="h-2 rounded-full transition-all" style={{ width: `${(activeDetail.processed_items / activeDetail.total_items * 100)}%`, background: 'var(--accent)' }} /></div>}
      <div className="flex items-center gap-2 flex-wrap">
        {(mode==='classification'?['all', 'pending', 'applied', 'rejected', 'failed']:['all', 'pending', 'applied', 'rejected']).map(f => <button key={f} onClick={() => setResultFilter(f)} className="px-3 py-1 rounded-full text-xs font-medium transition-colors" style={{ background: resultFilter === f ? 'var(--accent)' : 'var(--bg-ai-bubble)', color: resultFilter === f ? '#fff' : 'var(--text-secondary)', border: '1px solid', borderColor: resultFilter === f ? 'var(--accent)' : 'var(--border-color)' }}>{f === 'all' ? '全部' : f === 'pending' ? '待审核' : f === 'applied' ? '已应用' : f === 'rejected' ? '已拒绝' : '分类失败'} ({f === 'all' ? activeDetail.results?.length || 0 : f === 'failed' ? (activeDetail.results?.filter(r => r.status === 'failed' || (r.status === 'pending' && r.suggested_category === '_error')).length || 0) : (activeDetail.results?.filter(r => r.status === f).length || 0)})</button>)}
      </div>
      {(activeDetail.status === 'pending_review' || activeDetail.status === 'processing') && <div className="flex items-center gap-2"><button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-2xl text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>{activeSelected.size === filteredResults.length ? '取消全选' : '全选'}</button>{activeSelected.size > 0 && <><button onClick={handleApprove} className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium bg-[var(--color-success)] text-white hover:opacity-90"><Check size={14} /> 通过 {activeSelected.size} 项</button><button onClick={handleReject} className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-xs font-medium bg-[var(--color-error)] text-white hover:opacity-90"><X size={14} /> 拒绝 {activeSelected.size} 项</button></>}</div>}
      <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-ai-bubble)' }}>
              {(activeDetail.status === 'pending_review' || activeDetail.status === 'processing') && <th className="px-3 py-2 w-8"></th>}
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>项目信息</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>{mode==='classification'?'当前分类':'当前分类/作者'}</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>{mode==='classification'?'建议分类':'风险建议'}</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>置信度</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>状态</th>
              {(activeDetail.status === 'pending_review' || activeDetail.status === 'processing') && <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>}
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 ? (
              <tr><td colSpan={(activeDetail.status === 'pending_review' || activeDetail.status === 'processing') ? 7 : 5} className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>暂无数据</td></tr>
            ) : filteredResults.map(r => (
              <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                {(activeDetail.status === 'pending_review' || activeDetail.status === 'processing') && <td className="px-3 py-2"><input type="checkbox" checked={activeSelected.has(r.id)} onChange={() => toggleSelect(r.id)} className="rounded" /></td>}
                <td className="px-3 py-2 max-w-xs">
                  <div className="flex items-center gap-2">
                    {mode==='audit'&&r.item_thumb_url&&<img src={r.item_thumb_url} alt="" className="w-10 h-10 rounded-lg object-cover border shrink-0" style={{ borderColor:'var(--border-color)' }} loading="lazy" />}
                    <div className="min-w-0">
                      <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.item_name || '(无标题)'}</div>
                      <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>{r.item_prompt?.slice(0, 80)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">{mode==='classification' ? (r.item_category ? <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}>{r.item_category}</span> : <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>无</span>) : <div className="space-y-1"><div>{r.item_category ? <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}>{r.item_category}</span> : <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>无分类</span>}</div><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.item_author || '-'}</div></div>}</td>
                <td className="px-3 py-2">{renderSuggestion(r)}</td>
                <td className="px-3 py-2"><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{confidenceMap[r.confidence] || '-'}</span></td>
                <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: r.display_status.color + '20', color: r.display_status.color }}>{r.display_status.label}</span></td>
                {(activeDetail.status === 'pending_review' || activeDetail.status === 'processing') && <td className="px-3 py-2">{renderRowActions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

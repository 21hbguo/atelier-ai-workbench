import { useState, useEffect, useCallback } from 'react'
import { Tags, Play, ArrowLeft, Check, X, Plus, Loader2, RefreshCw } from 'lucide-react'
import { adminAPI } from '../../api'

const STATUS_MAP = {
  processing: { label: '处理中', color: 'var(--accent)' },
  pending_review: { label: '待审核', color: 'var(--color-warning)' },
  completed: { label: '已完成', color: 'var(--color-success)' },
  error: { label: '错误', color: 'var(--color-error)' },
}
const RESULT_STATUS_MAP = {
  pending: { label: '待审核', color: 'var(--color-warning)' },
  applied: { label: '已应用', color: 'var(--color-success)' },
  rejected: { label: '已拒绝', color: 'var(--color-error)' },
}
const CONFIDENCE_MAP = { high: '高', medium: '中', low: '低' }

export default function AdminClassificationTab({
  tasks, total, page, setPage, detail, setDetail, selected, setSelected,
  onCreateTask, categories, onRefreshTasks,
}) {
  const [creating, setCreating] = useState(false)
  const [resultFilter, setResultFilter] = useState('all')
  const [processingIds, setProcessingIds] = useState(new Set())
  const [createType, setCreateType] = useState('prompt')

  useEffect(() => {
    if (detail?.status !== 'processing') return
    const timer = setInterval(async () => {
      try {
        const { data } = await adminAPI.getClassificationTask(detail.id)
        setDetail(data)
        if (data.status !== 'processing') {
          clearInterval(timer)
          onRefreshTasks()
        }
      } catch {}
    }, 2000)
    return () => clearInterval(timer)
  }, [detail?.id, detail?.status])

  const handleCreate = async () => {
    setCreating(true)
    try { await onCreateTask(createType) } catch {}
    setCreating(false)
  }

  const handleApprove = async () => {
    if (selected.size === 0) return
    try { await adminAPI.approveClassification(detail.id, [...selected]); setSelected(new Set()); setDetail(null) } catch {}
  }

  const handleReject = async () => {
    if (selected.size === 0) return
    try { await adminAPI.rejectClassification(detail.id, [...selected]); setSelected(new Set()); setDetail(null) } catch {}
  }

  const toggleSelect = id => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const toggleSelectAll = () => {
    const filtered = getFilteredResults()
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(r => r.id)))
  }

  const getFilteredResults = () => {
    if (!detail?.results) return []
    if (resultFilter === 'all') return detail.results
    return detail.results.filter(r => r.status === resultFilter)
  }

  const handleRemoveSuggestion = async resultId => {
    try {
      await adminAPI.updateClassificationResult(resultId, { suggested_category: '_removed', suggested_category_label: '已移除', is_new_category: false })
      const { data } = await adminAPI.getClassificationTask(detail.id)
      setDetail(data)
    } catch {}
  }

  const handleChangeCategory = async (resultId, slug, label, isNew) => {
    try {
      await adminAPI.updateClassificationResult(resultId, { suggested_category: slug, suggested_category_label: label, is_new_category: isNew })
      const { data } = await adminAPI.getClassificationTask(detail.id)
      setDetail(data)
    } catch {}
  }

  const handleApproveSingle = async resultId => {
    try {
      await adminAPI.approveClassification(detail.id, [resultId])
      const { data } = await adminAPI.getClassificationTask(detail.id)
      setDetail(data)
    } catch {}
  }

  const handleRejectSingle = async resultId => {
    try {
      await adminAPI.rejectClassification(detail.id, [resultId])
      const { data } = await adminAPI.getClassificationTask(detail.id)
      setDetail(data)
    } catch {}
  }

  if (!detail) {
    const totalPages = Math.ceil(total / 20)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>AI 自动分类</h3>
          <div className="flex gap-2 items-center">
            <select value={createType} onChange={e => setCreateType(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
              <option value="prompt">提示词</option>
              <option value="image">作品</option>
            </select>
            <button onClick={onRefreshTasks} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors" style={{ color: 'var(--text-secondary)' }}>
              <RefreshCw size={14} /> 刷新
            </button>
            <button onClick={handleCreate} disabled={creating} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50" style={{ background: 'var(--accent)' }}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {creating ? '创建中...' : '开始新分类'}
            </button>
          </div>
        </div>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
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
              {tasks.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>暂无分类任务</td></tr>
              ) : tasks.map(t => (
                <tr key={t.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>#{t.id}</td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}>
                      {t.item_type === 'image' ? '作品' : '提示词'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: STATUS_MAP[t.status]?.color + '20', color: STATUS_MAP[t.status]?.color }}>
                      {STATUS_MAP[t.status]?.label || t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{t.total_items}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{t.processed_items}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{t.created_at?.slice(0, 19)}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => { setDetail(null); adminAPI.getClassificationTask(t.id).then(r => setDetail(r.data)) }} className="text-xs font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                      查看详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex justify-center gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded text-xs" style={{ color: 'var(--text-secondary)' }}>上一页</button>
            <span className="text-xs px-2 py-1" style={{ color: 'var(--text-secondary)' }}>{page}/{totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="px-3 py-1 rounded text-xs" style={{ color: 'var(--text-secondary)' }}>下一页</button>
          </div>
        )}
      </div>
    )
  }

  const filteredResults = getFilteredResults()
  const statusInfo = STATUS_MAP[detail.status]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => { setDetail(null); setSelected(new Set()) }} className="flex items-center gap-1 text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={16} /> 返回列表
        </button>
        <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>任务 #{detail.id}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: statusInfo?.color + '20', color: statusInfo?.color }}>
          {statusInfo?.label || detail.status}
        </span>
        {detail.status === 'processing' && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Loader2 size={14} className="animate-spin" /> {detail.processed_items}/{detail.total_items}
          </div>
        )}
      </div>

      {detail.status === 'processing' && (
        <div className="w-full rounded-full h-2" style={{ background: 'var(--border-color)' }}>
          <div className="h-2 rounded-full transition-all" style={{ width: `${(detail.processed_items / detail.total_items * 100)}%`, background: 'var(--accent)' }} />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {['all', 'pending', 'applied', 'rejected'].map(f => (
          <button key={f} onClick={() => setResultFilter(f)} className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{ background: resultFilter === f ? 'var(--accent)' : 'var(--bg-ai-bubble)', color: resultFilter === f ? '#fff' : 'var(--text-secondary)', border: '1px solid', borderColor: resultFilter === f ? 'var(--accent)' : 'var(--border-color)' }}>
            {f === 'all' ? '全部' : RESULT_STATUS_MAP[f]?.label} ({f === 'all' ? detail.results?.length || 0 : (detail.results?.filter(r => r.status === f).length || 0)})
          </button>
        ))}
      </div>

      {detail.status === 'pending_review' && (
        <div className="flex items-center gap-2">
          <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
            {selected.size === filteredResults.length ? '取消全选' : '全选'}
          </button>
          {selected.size > 0 && (
            <>
              <button onClick={handleApprove} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-success)] text-white hover:opacity-90">
                <Check size={14} /> 通过 {selected.size} 项
              </button>
              <button onClick={handleReject} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-error)] text-white hover:opacity-90">
                <X size={14} /> 拒绝 {selected.size} 项
              </button>
            </>
          )}
        </div>
      )}

      <div className="rounded-lg border overflow-x-auto" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--bg-ai-bubble)' }}>
              {detail.status === 'pending_review' && <th className="px-3 py-2 w-8"></th>}
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>项目信息</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>当前分类</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>建议分类</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>置信度</th>
              <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>状态</th>
              {detail.status === 'pending_review' && <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>操作</th>}
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 ? (
              <tr><td colSpan={detail.status === 'pending_review' ? 7 : 5} className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>暂无数据</td></tr>
            ) : filteredResults.map(r => (
              <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                {detail.status === 'pending_review' && (
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} className="rounded" />
                  </td>
                )}
                <td className="px-3 py-2 max-w-xs">
                  <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.item_name || '(无标题)'}</div>
                  <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>{r.item_prompt?.slice(0, 80)}</div>
                </td>
                <td className="px-3 py-2">
                  {r.item_category ? (
                    <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}>{r.item_category}</span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>无</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.suggested_category && r.suggested_category !== '_error' && r.suggested_category !== '_removed' ? (
                    <CategorySuggestion
                      result={r}
                      categories={categories}
                      canEdit={detail.status === 'pending_review' && r.status === 'pending'}
                      onRemove={() => handleRemoveSuggestion(r.id)}
                      onChange={handleChangeCategory}
                    />
                  ) : r.suggested_category === '_removed' ? (
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>已移除</span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--color-error)' }}>分类失败</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{CONFIDENCE_MAP[r.confidence] || '-'}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: RESULT_STATUS_MAP[r.status]?.color + '20', color: RESULT_STATUS_MAP[r.status]?.color }}>
                    {RESULT_STATUS_MAP[r.status]?.label || r.status}
                  </span>
                </td>
                {detail.status === 'pending_review' && (
                  <td className="px-3 py-2">
                    {r.status === 'pending' && (
                      <div className="flex gap-1">
                        <button onClick={() => handleApproveSingle(r.id)} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--color-success)' }} title="通过">
                          <Check size={14} />
                        </button>
                        <button onClick={() => handleRejectSingle(r.id)} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--color-error)' }} title="拒绝">
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CategorySuggestion({ result, categories, canEdit, onRemove, onChange }) {
  const [showPicker, setShowPicker] = useState(false)
  const [customSlug, setCustomSlug] = useState('')
  const [customLabel, setCustomLabel] = useState('')

  if (!canEdit) {
    return (
      <div className="flex items-center gap-1">
        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: result.is_new_category ? 'var(--color-warning)' + '20' : 'var(--accent)' + '20', color: result.is_new_category ? 'var(--color-warning)' : 'var(--accent)' }}>
          {result.suggested_category_label || result.suggested_category}
          {result.is_new_category && ' (新)'}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1" style={{ background: result.is_new_category ? 'var(--color-warning)' + '20' : 'var(--accent)' + '20', color: result.is_new_category ? 'var(--color-warning)' : 'var(--accent)' }}>
          {result.suggested_category_label || result.suggested_category}
          {result.is_new_category && ' (新)'}
          <button onClick={onRemove} className="ml-0.5 hover:opacity-70"><X size={10} /></button>
        </span>
        <button onClick={() => setShowPicker(!showPicker)} className="p-0.5 rounded hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }} title="更改分类">
          <Plus size={12} />
        </button>
      </div>
      {showPicker && (
        <div className="flex flex-wrap gap-1 mt-1">
          {categories.filter(c => c.slug !== result.suggested_category).map(c => (
            <button key={c.slug} onClick={() => { onChange(result.id, c.slug, c.label, false); setShowPicker(false) }}
              className="px-2 py-0.5 rounded-full text-xs hover:opacity-80" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
              {c.label}
            </button>
          ))}
          <div className="flex gap-1 items-center">
            <input value={customSlug} onChange={e => setCustomSlug(e.target.value)} placeholder="slug" className="w-20 px-1.5 py-0.5 rounded text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            <input value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="名称" className="w-20 px-1.5 py-0.5 rounded text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }} />
            <button onClick={() => { if (customSlug && customLabel) { onChange(result.id, customSlug, customLabel, true); setShowPicker(false); setCustomSlug(''); setCustomLabel('') } }}
              className="px-2 py-0.5 rounded text-xs text-white" style={{ background: 'var(--accent)' }}>添加</button>
          </div>
        </div>
      )}
    </div>
  )
}

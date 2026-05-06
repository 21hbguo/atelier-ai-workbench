import { useState, useEffect, useCallback, useRef } from 'react'
import { Tags, Play, ArrowLeft, Check, X, Plus, Loader2, RefreshCw } from 'lucide-react'
import { adminAPI, promptAPI } from '../../api'

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
  failed: { label: '分类失败', color: 'var(--color-error)' },
}
const getResultDisplayStatus = (r) => {
  if (r.status === 'failed' || (r.status === 'pending' && r.suggested_category === '_error')) return RESULT_STATUS_MAP.failed
  return RESULT_STATUS_MAP[r.status] || { label: r.status, color: 'var(--text-secondary)' }
}
const CONFIDENCE_MAP = { high: '高', medium: '中', low: '低' }

export default function AdminClassificationTab({
  tasks, total, page, setPage, detail, setDetail, selected, setSelected,
  onCreateTask, categories, onRefreshTasks,auditTasks,auditTotal,auditPage,setAuditPage,auditDetail,setAuditDetail,auditSelected,setAuditSelected,onCreateAuditTask,onRefreshAuditTasks,
}) {
  const [mode,setMode]=useState('classification')
  const [creating, setCreating] = useState(false)
  const [resultFilter, setResultFilter] = useState('all')
  const [createType, setCreateType] = useState('prompt')
  const [liveLogs, setLiveLogs] = useState([])
  const [liveTaskId, setLiveTaskId] = useState(null)
  const [showLiveLogs, setShowLiveLogs] = useState(false)
  const [reviewCategory, setReviewCategory] = useState('all')
  const [reviewing, setReviewing] = useState(false)
  const [categoryDraft,setCategoryDraft]=useState({ id:null, slug:'', label:'' })
  const [savingCategory,setSavingCategory]=useState(false)
  const logEndRef = useRef(null)
  const eventSourceRef = useRef(null)
  const activeDetail=mode==='classification'?detail:auditDetail
  const activeTasks=mode==='classification'?tasks:auditTasks
  const activeTotal=mode==='classification'?total:auditTotal
  const activePage=mode==='classification'?page:auditPage
  const setActivePage=mode==='classification'?setPage:setAuditPage
  const activeSelected=mode==='classification'?selected:auditSelected
  const setActiveSelected=mode==='classification'?setSelected:setAuditSelected
  const setActiveDetail=mode==='classification'?setDetail:setAuditDetail

  useEffect(() => {
    if (mode!=='classification'||detail?.status !== 'processing') return
    const timer = setInterval(async () => {
      try {
        const { data } = await adminAPI.getClassificationTask(detail.id)
        setDetail(data)
        if (data.status !== 'processing') {
          clearInterval(timer)
          onRefreshTasks()
        }
      } catch {}
    }, 1200)
    return () => clearInterval(timer)
  }, [mode,detail?.id, detail?.status])
  useEffect(() => {
    if (mode!=='audit'||auditDetail?.status !== 'processing') return
    const timer = setInterval(async () => {
      try {
        const { data } = await adminAPI.getAuditTask(auditDetail.id)
        setAuditDetail(data)
        if (data.status !== 'processing') {
          clearInterval(timer)
          onRefreshAuditTasks()
        }
      } catch {}
    }, 1200)
    return () => clearInterval(timer)
  }, [mode,auditDetail?.id,auditDetail?.status])

  // 订阅任务日志
  const subscribeLogs = (taskId,taskMode=mode) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    setLiveLogs([])
    setLiveTaskId(taskId)
    setShowLiveLogs(true)

    const es = new EventSource(taskMode==='classification'?`/api/admin/classification/tasks/${taskId}/logs`:`/api/admin/audit/tasks/${taskId}/logs`)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      try {
        const log = JSON.parse(e.data)
        setLiveLogs(prev => [...prev, log])
        if (log.type === 'complete') {
          es.close()
          if (taskMode==='classification') onRefreshTasks()
          else onRefreshAuditTasks()
        }
      } catch {}
    }

    es.onerror = () => {
      es.close()
    }
  }

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    if (logEndRef.current && showLiveLogs) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [liveLogs, showLiveLogs])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const result = await onCreateTask(createType)
      if (result?.id) {
        subscribeLogs(result.id,'classification')
      }
    } catch {}
    setCreating(false)
  }
  const handleCreateAudit = async () => {
    setCreating(true)
    try {
      const result = await onCreateAuditTask(createType)
      if (result?.id) subscribeLogs(result.id,'audit')
    } catch {}
    setCreating(false)
  }

  const handleReview = async () => {
    if (!reviewCategory) return
    setReviewing(true)
    try {
      const { data } = await adminAPI.reviewClassification(createType, reviewCategory)
      if (data?.id) {
        subscribeLogs(data.id)
      }
      onRefreshTasks()
    } catch {}
    setReviewing(false)
  }

  const handleApprove = async () => {
    if (activeSelected.size === 0) return
    try {
      if (mode==='classification') {
        await adminAPI.approveClassification(detail.id, [...activeSelected])
        setSelected(new Set())
        const { data } = await adminAPI.getClassificationTask(detail.id)
        setDetail(data)
        onRefreshTasks()
      } else {
        await adminAPI.approveAudit(auditDetail.id, [...activeSelected])
        setAuditSelected(new Set())
        const { data } = await adminAPI.getAuditTask(auditDetail.id)
        setAuditDetail(data)
        onRefreshAuditTasks()
      }
    } catch {}
  }

  const handleReject = async () => {
    if (activeSelected.size === 0) return
    try {
      if (mode==='classification') {
        await adminAPI.rejectClassification(detail.id, [...activeSelected])
        setSelected(new Set())
        const { data } = await adminAPI.getClassificationTask(detail.id)
        setDetail(data)
        onRefreshTasks()
      } else {
        await adminAPI.rejectAudit(auditDetail.id, [...activeSelected])
        setAuditSelected(new Set())
        const { data } = await adminAPI.getAuditTask(auditDetail.id)
        setAuditDetail(data)
        onRefreshAuditTasks()
      }
    } catch {}
  }

  const toggleSelect = id => {
    setActiveSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  const toggleSelectAll = () => {
    const filtered = getFilteredResults()
    if (activeSelected.size === filtered.length) setActiveSelected(new Set())
    else setActiveSelected(new Set(filtered.map(r => r.id)))
  }

  const getFilteredResults = () => {
    const rows=activeDetail?.results||[]
    if (resultFilter === 'all') return rows
    if (mode==='classification') {
      if (resultFilter === 'failed') return rows.filter(r => r.status === 'failed' || (r.status === 'pending' && r.suggested_category === '_error'))
      return rows.filter(r => r.status === resultFilter)
    }
    return rows.filter(r => r.status === resultFilter)
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
      onRefreshTasks()
    } catch {}
  }

  const handleRejectSingle = async resultId => {
    try {
      await adminAPI.rejectClassification(detail.id, [resultId])
      const { data } = await adminAPI.getClassificationTask(detail.id)
      setDetail(data)
      onRefreshTasks()
    } catch {}
  }
  const refreshCategories = async () => {
    try {
      const { data } = await promptAPI.categories()
      const rows = data?.categories || data || []
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('admin-categories-updated',{ detail: rows }))
    } catch {}
  }
  const handleSaveCategory = async () => {
    const slug=String(categoryDraft.slug||'').trim()
    const label=String(categoryDraft.label||'').trim()
    if (!slug || !label) return
    setSavingCategory(true)
    try {
      if (categoryDraft.id) await promptAPI.updateCategory(categoryDraft.id,{ label })
      else await promptAPI.createCategory({ slug,label })
      setCategoryDraft({ id:null, slug:'', label:'' })
      await refreshCategories()
    } catch {}
    setSavingCategory(false)
  }
  const handleDeleteCategory = async id => {
    try {
      await promptAPI.deleteCategory(id)
      if (categoryDraft.id===id) setCategoryDraft({ id:null, slug:'', label:'' })
      await refreshCategories()
    } catch {}
  }

  if (!activeDetail) {
    const totalPages = Math.ceil(activeTotal / 20)
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {[{k:'classification',l:'分类任务'},{k:'audit',l:'内容审核'},{k:'categories',l:'分类管理'}].map(i=><button key={i.k} onClick={()=>setMode(i.k)} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={mode===i.k?{background:'var(--accent)',color:'#fff',borderColor:'var(--accent)'}:{borderColor:'var(--border-color)',color:'var(--text-secondary)'}}>{i.l}</button>)}
        </div>
        {mode==='categories'&&<div className="space-y-4"><div className="rounded-lg border p-4 space-y-3" style={{ borderColor:'var(--border-color)',background:'var(--bg-card)' }}><div className="text-sm font-medium" style={{ color:'var(--text-primary)' }}>{categoryDraft.id?'编辑分类':'新建分类'}</div><div className="grid grid-cols-1 sm:grid-cols-[12rem_minmax(0,1fr)_auto] gap-2"><input value={categoryDraft.slug} onChange={e=>setCategoryDraft(prev=>({...prev,slug:e.target.value}))} disabled={!!categoryDraft.id} placeholder="slug" className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor:'var(--border-color)',background:'var(--bg-primary)',color:'var(--text-primary)' }} /><input value={categoryDraft.label} onChange={e=>setCategoryDraft(prev=>({...prev,label:e.target.value}))} placeholder="分类名称" className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor:'var(--border-color)',background:'var(--bg-primary)',color:'var(--text-primary)' }} /><button onClick={handleSaveCategory} disabled={savingCategory||!categoryDraft.slug||!categoryDraft.label} className="px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50" style={{ background:'var(--accent)' }}>{savingCategory?'保存中...':categoryDraft.id?'保存':'新增'}</button></div>{categoryDraft.id&&<button onClick={()=>setCategoryDraft({ id:null, slug:'', label:'' })} className="text-xs" style={{ color:'var(--text-secondary)' }}>取消编辑</button>}</div><div className="rounded-lg border overflow-hidden" style={{ borderColor:'var(--border-color)',background:'var(--bg-card)' }}><table className="w-full text-sm"><thead><tr style={{ background:'var(--bg-ai-bubble)' }}><th className="px-3 py-2 text-left font-medium" style={{ color:'var(--text-secondary)' }}>ID</th><th className="px-3 py-2 text-left font-medium" style={{ color:'var(--text-secondary)' }}>Slug</th><th className="px-3 py-2 text-left font-medium" style={{ color:'var(--text-secondary)' }}>名称</th><th className="px-3 py-2 text-left font-medium" style={{ color:'var(--text-secondary)' }}>操作</th></tr></thead><tbody>{categories.length===0?<tr><td colSpan={4} className="px-3 py-8 text-center" style={{ color:'var(--text-secondary)' }}>暂无分类</td></tr>:categories.map(c=><tr key={c.id||c.slug} className="border-t" style={{ borderColor:'var(--border-color)' }}><td className="px-3 py-2" style={{ color:'var(--text-primary)' }}>{c.id||'-'}</td><td className="px-3 py-2" style={{ color:'var(--text-primary)' }}>{c.slug}</td><td className="px-3 py-2" style={{ color:'var(--text-primary)' }}>{c.label}</td><td className="px-3 py-2"><div className="flex items-center gap-2"><button onClick={()=>setCategoryDraft({ id:c.id, slug:c.slug, label:c.label })} className="text-xs font-medium hover:underline" style={{ color:'var(--accent)' }}>编辑</button><button onClick={()=>handleDeleteCategory(c.id)} className="text-xs font-medium hover:underline" style={{ color:'var(--color-error)' }}>删除</button></div></td></tr>)}</tbody></table></div></div>}
        {mode!=='categories'&&<>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{mode==='classification'?'AI 自动分类':'AI 内容审核'}</h3>
          <div className="flex gap-2 items-center flex-wrap">
            <select value={createType} onChange={e => setCreateType(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
              <option value="prompt">提示词</option>
              <option value="image">作品</option>
            </select>
            <button onClick={mode==='classification'?onRefreshTasks:onRefreshAuditTasks} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors" style={{ color: 'var(--text-secondary)' }}>
              <RefreshCw size={14} /> 刷新
            </button>
            <button onClick={mode==='classification'?handleCreate:handleCreateAudit} disabled={creating} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50" style={{ background: 'var(--accent)' }}>
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {creating ? '创建中...' : mode==='classification'?'开始新分类':'开始新审核'}
            </button>
            {mode==='classification'&&<div className="flex items-center gap-1.5">
              <select value={reviewCategory} onChange={e => setReviewCategory(e.target.value)} className="px-2 py-1.5 rounded-lg text-xs border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                <option value="all">全部分类</option>
                <option value="">选择具体分类...</option>
                {categories.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
              </select>
              <button onClick={handleReview} disabled={!reviewCategory || reviewing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--color-warning)' }}>
                {reviewing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {reviewing ? '审查中...' : '重新审查'}
              </button>
            </div>}
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
              {activeTasks.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center" style={{ color: 'var(--text-secondary)' }}>暂无{mode==='classification'?'分类':'审核'}任务</td></tr>
              ) : activeTasks.map(t => (
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
                    <button onClick={() => { setActiveDetail(null); (mode==='classification'?adminAPI.getClassificationTask(t.id):adminAPI.getAuditTask(t.id)).then(r => setActiveDetail(r.data)) }} className="text-xs font-medium hover:underline" style={{ color: 'var(--accent)' }}>
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
            <button onClick={() => setActivePage(Math.max(1, activePage - 1))} disabled={activePage === 1} className="px-3 py-1 rounded text-xs" style={{ color: 'var(--text-secondary)' }}>上一页</button>
            <span className="text-xs px-2 py-1" style={{ color: 'var(--text-secondary)' }}>{activePage}/{totalPages}</span>
            <button onClick={() => setActivePage(Math.min(totalPages, activePage + 1))} disabled={activePage === totalPages} className="px-3 py-1 rounded text-xs" style={{ color: 'var(--text-secondary)' }}>下一页</button>
          </div>
        )}

        {/* 实时日志区域 */}
        {showLiveLogs && (
          <div className="rounded-lg border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
            <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  任务 #{liveTaskId} 实时输出
                </span>
                {liveLogs.some(l => l.type === 'complete') ? (
                  <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--color-success)20', color: 'var(--color-success)' }}>已完成</span>
                ) : (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                    <Loader2 size={12} className="animate-spin" /> 处理中
                  </span>
                )}
              </div>
              <button onClick={() => setShowLiveLogs(false)} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
                <X size={14} />
              </button>
            </div>
            <div className="p-3 text-xs font-mono overflow-auto max-h-80" style={{ color: 'var(--text-primary)', background: 'var(--bg-ai-bubble)' }}>
              {liveLogs.length === 0 ? (
                <span style={{ color: 'var(--text-secondary)' }}>等待输出...</span>
              ) : liveLogs.map((log, i) => (
                <div key={i} className="mb-1">
                  {log.type === 'token' ? (
                    <span>{log.message}</span>
                  ) : log.type === 'error' ? (
                    <span style={{ color: 'var(--color-error)' }}>[错误] {log.message}</span>
                  ) : log.type === 'result' ? (
                    <span style={{ color: 'var(--color-success)' }}>[结果] {log.message}</span>
                  ) : log.type === 'complete' ? (
                    <span style={{ color: 'var(--color-success)' }}>[完成] {log.message}</span>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>[信息] {log.message}</span>
                  )}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* LLM 调试区域 */}
        {mode==='classification'&&<LLMDebugPanel createType={createType} />}
        </>}
      </div>
    )
  }

  const filteredResults = getFilteredResults()
  const statusInfo = STATUS_MAP[activeDetail.status]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {[{k:'classification',l:'分类任务'},{k:'audit',l:'内容审核'},{k:'categories',l:'分类管理'}].map(i=><button key={i.k} onClick={()=>{setMode(i.k);setSelected(new Set());setAuditSelected(new Set())}} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={mode===i.k?{background:'var(--accent)',color:'#fff',borderColor:'var(--accent)'}:{borderColor:'var(--border-color)',color:'var(--text-secondary)'}}>{i.l}</button>)}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => { setActiveDetail(null); setActiveSelected(new Set()) }} className="flex items-center gap-1 text-sm hover:underline" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={16} /> 返回列表
        </button>
        <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{mode==='classification'?'分类':'审核'}任务 #{activeDetail.id}</span>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: statusInfo?.color + '20', color: statusInfo?.color }}>
          {statusInfo?.label || activeDetail.status}
        </span>
        {activeDetail.status === 'processing' && (
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Loader2 size={14} className="animate-spin" /> {activeDetail.processed_items}/{activeDetail.total_items}
          </div>
        )}
      </div>

      {activeDetail.status === 'processing' && (
        <div className="w-full rounded-full h-2" style={{ background: 'var(--border-color)' }}>
          <div className="h-2 rounded-full transition-all" style={{ width: `${(activeDetail.processed_items / activeDetail.total_items * 100)}%`, background: 'var(--accent)' }} />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {(mode==='classification'?['all', 'pending', 'applied', 'rejected', 'failed']:['all', 'pending', 'applied', 'rejected']).map(f => (
          <button key={f} onClick={() => setResultFilter(f)} className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
            style={{ background: resultFilter === f ? 'var(--accent)' : 'var(--bg-ai-bubble)', color: resultFilter === f ? '#fff' : 'var(--text-secondary)', border: '1px solid', borderColor: resultFilter === f ? 'var(--accent)' : 'var(--border-color)' }}>
            {f === 'all' ? '全部' : RESULT_STATUS_MAP[f]?.label} ({f === 'all' ? activeDetail.results?.length || 0 : f === 'failed' ? (activeDetail.results?.filter(r => r.status === 'failed' || (r.status === 'pending' && r.suggested_category === '_error')).length || 0) : (activeDetail.results?.filter(r => r.status === f).length || 0)})
          </button>
        ))}
      </div>

      {(activeDetail.status === 'pending_review' || activeDetail.status === 'processing') && (
        <div className="flex items-center gap-2">
          <button onClick={toggleSelectAll} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
            {activeSelected.size === filteredResults.length ? '取消全选' : '全选'}
          </button>
          {activeSelected.size > 0 && (
            <>
              <button onClick={handleApprove} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-success)] text-white hover:opacity-90">
                <Check size={14} /> 通过 {activeSelected.size} 项
              </button>
              <button onClick={handleReject} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-error)] text-white hover:opacity-90">
                <X size={14} /> 拒绝 {activeSelected.size} 项
              </button>
            </>
          )}
        </div>
      )}

      <div className="rounded-lg border overflow-x-auto" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
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
                {(activeDetail.status === 'pending_review' || activeDetail.status === 'processing') && (
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={activeSelected.has(r.id)} onChange={() => toggleSelect(r.id)} className="rounded" />
                  </td>
                )}
                <td className="px-3 py-2 max-w-xs">
                  <div className="flex items-center gap-2">
                    {mode==='audit'&&r.item_thumb_url&&<img src={r.item_thumb_url} alt="" className="w-10 h-10 rounded object-cover border shrink-0" style={{ borderColor:'var(--border-color)' }} loading="lazy" />}
                    <div className="min-w-0">
                      <div className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.item_name || '(无标题)'}</div>
                      <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>{r.item_prompt?.slice(0, 80)}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  {mode==='classification' ? (r.item_category ? (
                    <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}>{r.item_category}</span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>无</span>
                  )) : <div className="space-y-1"><div>{r.item_category ? <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}>{r.item_category}</span> : <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>无分类</span>}</div><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{r.item_author || '-'}</div></div>}
                </td>
                <td className="px-3 py-2">
                  {mode==='classification' ? (r.suggested_category && r.suggested_category !== '_error' && r.suggested_category !== '_removed' && r.status !== 'failed' ? (
                    <CategorySuggestion
                      result={r}
                      categories={categories}
                      canEdit={activeDetail.status === 'pending_review' && r.status === 'pending' && r.suggested_category !== '_error'}
                      onRemove={() => handleRemoveSuggestion(r.id)}
                      onChange={handleChangeCategory}
                    />
                  ) : r.suggested_category === '_removed' ? (
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>已移除</span>
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--color-error)' }}>分类失败</span>
                  )):<AuditSuggestion result={r} canEdit={activeDetail.status==='pending_review'&&r.status==='pending'} onChange={async data=>{await adminAPI.updateAuditResult(r.id,data);const { data:next } = await adminAPI.getAuditTask(activeDetail.id);setAuditDetail(next)}}/>}
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{CONFIDENCE_MAP[r.confidence] || '-'}</span>
                </td>
                <td className="px-3 py-2">
                  {(() => { const s = getResultDisplayStatus(r); return (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: s.color + '20', color: s.color }}>
                      {s.label}
                    </span>
                  )})()}
                </td>
                {(activeDetail.status === 'pending_review' || activeDetail.status === 'processing') && (
                  <td className="px-3 py-2">
                    {mode==='classification'&&r.status === 'pending' && r.suggested_category !== '_error' && r.status !== 'failed' && (
                      <div className="flex gap-1">
                        <button onClick={() => handleApproveSingle(r.id)} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--color-success)' }} title="通过">
                          <Check size={14} />
                        </button>
                        <button onClick={() => handleRejectSingle(r.id)} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--color-error)' }} title="拒绝">
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    {mode==='classification'&&(r.status === 'failed' || (r.status === 'pending' && r.suggested_category === '_error')) && (
                      <button onClick={() => handleRejectSingle(r.id)} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--color-error)' }} title="移除">
                        <X size={14} />
                      </button>
                    )}
                    {mode==='audit'&&r.status==='pending'&&<div className="flex gap-1"><button onClick={async()=>{await adminAPI.approveAudit(activeDetail.id,[r.id]);const { data }=await adminAPI.getAuditTask(activeDetail.id);setAuditDetail(data);onRefreshAuditTasks()}} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--color-success)' }} title="执行建议"><Check size={14} /></button><button onClick={async()=>{await adminAPI.rejectAudit(activeDetail.id,[r.id]);const { data }=await adminAPI.getAuditTask(activeDetail.id);setAuditDetail(data);onRefreshAuditTasks()}} className="p-1 rounded hover:bg-bg-hover" style={{ color: 'var(--color-error)' }} title="忽略建议"><X size={14} /></button></div>}
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

function AuditSuggestion({ result, canEdit, onChange }) {
  const [draft,setDraft]=useState({risk_level:result.risk_level||'medium',confidence:result.confidence||'medium',suggested_action:result.suggested_action||'review',reason_summary:result.reason_summary||'',reason_detail:result.reason_detail||'',hit_rules:Array.isArray(result.hit_rules)?result.hit_rules.join('、'):(result.hit_rules||'')})
  if (!canEdit) return <div className="space-y-1"><div className="flex items-center gap-1 flex-wrap"><span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: (result.risk_level==='high'?'var(--color-error)':result.risk_level==='medium'?'var(--color-warning)':'var(--color-success)')+'20', color: result.risk_level==='high'?'var(--color-error)':result.risk_level==='medium'?'var(--color-warning)':'var(--color-success)' }}>{result.risk_level==='high'?'高风险':result.risk_level==='medium'?'中风险':'低风险'}</span><span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}>{result.suggested_action==='freeze'?'建议冻结':result.suggested_action==='delete'?'建议删除':result.suggested_action==='keep'?'建议保留':'建议复核'}</span></div><div className="text-xs" style={{ color:'var(--text-primary)' }}>{result.reason_summary||'-'}</div><div className="text-xs" style={{ color:'var(--text-secondary)' }}>{result.reason_detail||'-'}</div><div className="text-xs" style={{ color:'var(--text-secondary)' }}>{Array.isArray(result.hit_rules)&&result.hit_rules.length?`命中：${result.hit_rules.join('、')}`:'未命中规则'}</div></div>
  return <div className="space-y-1 min-w-[260px]"><div className="flex gap-1 flex-wrap"><select value={draft.risk_level} onChange={e=>setDraft(prev=>({...prev,risk_level:e.target.value}))} className="px-1.5 py-0.5 rounded text-xs border" style={{ borderColor:'var(--border-color)',background:'var(--bg-card)',color:'var(--text-primary)' }}><option value="high">高风险</option><option value="medium">中风险</option><option value="low">低风险</option></select><select value={draft.suggested_action} onChange={e=>setDraft(prev=>({...prev,suggested_action:e.target.value}))} className="px-1.5 py-0.5 rounded text-xs border" style={{ borderColor:'var(--border-color)',background:'var(--bg-card)',color:'var(--text-primary)' }}><option value="freeze">冻结</option><option value="delete">删除</option><option value="review">复核</option><option value="keep">保留</option></select></div><input value={draft.reason_summary} onChange={e=>setDraft(prev=>({...prev,reason_summary:e.target.value}))} placeholder="摘要" className="w-full px-1.5 py-0.5 rounded text-xs border" style={{ borderColor:'var(--border-color)',background:'var(--bg-card)',color:'var(--text-primary)' }}/><input value={draft.reason_detail} onChange={e=>setDraft(prev=>({...prev,reason_detail:e.target.value}))} placeholder="原因" className="w-full px-1.5 py-0.5 rounded text-xs border" style={{ borderColor:'var(--border-color)',background:'var(--bg-card)',color:'var(--text-primary)' }}/><input value={draft.hit_rules} onChange={e=>setDraft(prev=>({...prev,hit_rules:e.target.value}))} placeholder="命中词，用、分隔" className="w-full px-1.5 py-0.5 rounded text-xs border" style={{ borderColor:'var(--border-color)',background:'var(--bg-card)',color:'var(--text-primary)' }}/><button onClick={()=>onChange({...draft,hit_rules:String(draft.hit_rules||'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean)})} className="px-2 py-0.5 rounded text-xs text-white" style={{ background:'var(--accent)' }}>保存</button></div>
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

function LLMDebugPanel({ createType }) {
  const [output, setOutput] = useState('')
  const [testing, setTesting] = useState(false)
  const [useStream, setUseStream] = useState(true)
  const outputRef = useRef(null)

  const handleTest = async () => {
    setTesting(true)
    setOutput('')

    try {
      if (useStream) {
        const resp = await fetch('/api/admin/classification/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stream: true, item_type: createType }),
        })

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let fullText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === 'token') {
                  fullText += data.text
                  setOutput(fullText)
                } else if (data.type === 'done') {
                  fullText = data.full_text || fullText
                  setOutput(fullText)
                } else if (data.type === 'error') {
                  setOutput(prev => prev + '\n[错误] ' + data.message)
                }
              } catch {}
            }
          }
        }
      } else {
        const resp = await fetch('/api/admin/classification/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stream: false, item_type: createType }),
        })
        const data = await resp.json()
        if (data.type === 'done') {
          setOutput(data.full_text)
        } else if (data.type === 'error') {
          setOutput('[错误] ' + data.message)
        }
      }
    } catch (e) {
      setOutput('[请求失败] ' + e.message)
    }
    setTesting(false)
  }

  const handleClear = () => setOutput('')

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>LLM 调试</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={useStream} onChange={e => setUseStream(e.target.checked)} className="rounded" />
            流式
          </label>
          <button onClick={handleClear} disabled={testing} className="px-2 py-1 rounded text-xs hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>
            清空
          </button>
          <button onClick={handleTest} disabled={testing} className="flex items-center gap-1 px-3 py-1 rounded text-xs font-medium text-white hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {testing ? '测试中...' : '测试调用'}
          </button>
        </div>
      </div>
      <div ref={outputRef} className="p-3 text-xs font-mono overflow-auto max-h-60" style={{ color: 'var(--text-primary)', background: 'var(--bg-ai-bubble)' }}>
        {output || <span style={{ color: 'var(--text-secondary)' }}>点击"测试调用"查看 LLM 输出...</span>}
      </div>
    </div>
  )
}

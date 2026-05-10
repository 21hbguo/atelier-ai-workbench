import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, X } from 'lucide-react'
import { adminAPI, promptAPI } from '../../api'
import AdminTitleManagePanel from './AdminTitleManagePanel'
import AdminCategoryManagePanel from './AdminCategoryManagePanel'
import AdminClassificationModeTabs from './AdminClassificationModeTabs'
import AdminAiTaskListPanel from './AdminAiTaskListPanel'
import AdminAiTaskDetailPanel from './AdminAiTaskDetailPanel'
import AdminAuditSuggestion from './AdminAuditSuggestion'
import AdminCategorySuggestion from './AdminCategorySuggestion'
import AdminClassificationDebugPanel from './AdminClassificationDebugPanel'

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
  const [taskLimit,setTaskLimit]=useState(200)
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
      const result = await onCreateTask(createType, taskLimit)
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
      const { data } = await adminAPI.reviewClassification(createType, reviewCategory, taskLimit)
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
  const handleAuditSuggestionChange = async (resultId, data) => {
    await adminAPI.updateAuditResult(resultId, data)
    const { data: next } = await adminAPI.getAuditTask(activeDetail.id)
    setAuditDetail(next)
  }
  const handleApproveAuditSingle = async resultId => {
    await adminAPI.approveAudit(activeDetail.id, [resultId])
    const { data } = await adminAPI.getAuditTask(activeDetail.id)
    setAuditDetail(data)
    onRefreshAuditTasks()
  }
  const handleRejectAuditSingle = async resultId => {
    await adminAPI.rejectAudit(activeDetail.id, [resultId])
    const { data } = await adminAPI.getAuditTask(activeDetail.id)
    setAuditDetail(data)
    onRefreshAuditTasks()
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
  const switchMode=k=>{
    setMode(k)
    setSelected(new Set())
    setAuditSelected(new Set())
    if (k !== 'classification') setDetail(null)
    if (k !== 'audit') setAuditDetail(null)
  }
  const modeTabs=[
    { k: 'classification', l: '分类任务' },
    { k: 'audit', l: '内容审核' },
    { k: 'title', l: '标题生成' },
    { k: 'categories', l: '分类管理' },
  ]

  if (!activeDetail) {
    const decoratedTasks=activeTasks.map(t=>({ ...t, status_label: STATUS_MAP[t.status]?.label || t.status, status_color: STATUS_MAP[t.status]?.color }))
    return (
      <div className="space-y-4">
        <AdminClassificationModeTabs mode={mode} modeTabs={modeTabs} onSwitch={switchMode} />
        {mode === 'title' && <AdminTitleManagePanel />}
        {mode === 'categories' && <AdminCategoryManagePanel categories={categories} categoryDraft={categoryDraft} setCategoryDraft={setCategoryDraft} savingCategory={savingCategory} handleSaveCategory={handleSaveCategory} handleDeleteCategory={handleDeleteCategory} />}
        {(mode==='classification'||mode==='audit')&&<AdminAiTaskListPanel mode={mode} activeTasks={decoratedTasks} activeTotal={activeTotal} activePage={activePage} setActivePage={setActivePage} createType={createType} setCreateType={setCreateType} taskLimit={taskLimit} setTaskLimit={setTaskLimit} categories={categories} reviewCategory={reviewCategory} setReviewCategory={setReviewCategory} reviewing={reviewing} creating={creating} onRefreshTasks={mode==='classification'?onRefreshTasks:onRefreshAuditTasks} onCreate={mode==='classification'?handleCreate:handleCreateAudit} onReview={handleReview} onOpenDetail={async taskId=>{setActiveDetail(null);const resp=mode==='classification'?await adminAPI.getClassificationTask(taskId):await adminAPI.getAuditTask(taskId);setActiveDetail(resp.data)}} showLiveLogs={showLiveLogs} setShowLiveLogs={setShowLiveLogs} liveTaskId={liveTaskId} liveLogs={liveLogs} logEndRef={logEndRef} renderDebug={mode==='classification'&&<AdminClassificationDebugPanel createType={createType} />} />}
      </div>
    )
  }
  if (mode === 'title' || mode === 'categories') {
    return (
      <div className="space-y-4">
        <AdminClassificationModeTabs mode={mode} modeTabs={modeTabs} onSwitch={switchMode} />
        {mode === 'title' ? <AdminTitleManagePanel /> : <AdminCategoryManagePanel categories={categories} categoryDraft={categoryDraft} setCategoryDraft={setCategoryDraft} savingCategory={savingCategory} handleSaveCategory={handleSaveCategory} handleDeleteCategory={handleDeleteCategory} />}
      </div>
    )
  }

  const filteredResults = getFilteredResults().map(r=>({ ...r, display_status: getResultDisplayStatus(r) }))
  const statusInfo = STATUS_MAP[activeDetail.status]

  return (
    <div className="space-y-4">
      <AdminClassificationModeTabs mode={mode} modeTabs={modeTabs} onSwitch={switchMode} />
      <AdminAiTaskDetailPanel mode={mode} activeDetail={activeDetail} statusInfo={statusInfo} resultFilter={resultFilter} setResultFilter={setResultFilter} activeSelected={activeSelected} filteredResults={filteredResults} toggleSelectAll={toggleSelectAll} handleApprove={handleApprove} handleReject={handleReject} onBack={() => { setActiveDetail(null); setActiveSelected(new Set()) }} toggleSelect={toggleSelect} renderSuggestion={r=>mode==='classification' ? (r.suggested_category && r.suggested_category !== '_error' && r.suggested_category !== '_removed' && r.status !== 'failed' ? <AdminCategorySuggestion result={r} categories={categories} canEdit={activeDetail.status === 'pending_review' && r.status === 'pending' && r.suggested_category !== '_error'} onRemove={() => handleRemoveSuggestion(r.id)} onChange={handleChangeCategory} /> : r.suggested_category === '_removed' ? <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>已移除</span> : <span className="text-xs" style={{ color: 'var(--color-error)' }}>分类失败</span>) : <AdminAuditSuggestion result={r} canEdit={activeDetail.status==='pending_review'&&r.status==='pending'} onChange={data=>handleAuditSuggestionChange(r.id,data)} />} renderRowActions={r=>{if(mode==='classification'&&r.status === 'pending' && r.suggested_category !== '_error' && r.status !== 'failed') return <div className="flex gap-1"><button onClick={() => handleApproveSingle(r.id)} className="p-1 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--color-success)' }} title="通过"><Check size={14} /></button><button onClick={() => handleRejectSingle(r.id)} className="p-1 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--color-error)' }} title="拒绝"><X size={14} /></button></div>;if(mode==='classification'&&(r.status === 'failed' || (r.status === 'pending' && r.suggested_category === '_error'))) return <button onClick={() => handleRejectSingle(r.id)} className="p-1 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--color-error)' }} title="移除"><X size={14} /></button>;if(mode === 'audit' && r.status === 'pending') return <div className="flex gap-1"><button onClick={() => handleApproveAuditSingle(r.id)} className="p-1 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--color-success)' }} title="执行建议"><Check size={14} /></button><button onClick={() => handleRejectAuditSingle(r.id)} className="p-1 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--color-error)' }} title="忽略建议"><X size={14} /></button></div>;return null}} confidenceMap={CONFIDENCE_MAP} />
    </div>
  )
}

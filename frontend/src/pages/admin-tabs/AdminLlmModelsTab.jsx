import { useState } from 'react'
import { Plus, Trash2, Pencil, X, RefreshCw, Search, ChevronRight, ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'

const EFFORT_LABELS = { auto: '自动', low: '低', medium: '中', high: '高', max: '最高', xhigh: '超高' }
const THINKING_LABELS = { enabled: '默认思考', disabled: '默认不思考', always: '始终思考' }

const EMPTY_DRAFT = {
  model_id: '', label: '', provider: '', protocol: 'openai',
  base_url: '', api_key: '',
  max_input_tokens: 1000000, max_output_tokens: 128000,
  reasoning_efforts_text: 'auto,low,medium,high,xhigh,max',
  default_reasoning_effort: 'auto', thinking_default: 'enabled',
  context_budget_chars: 256000,
  input_price_per_million: '', output_price_per_million: '', cache_read_price_per_million: '', price_currency: 'usd',
  input_points_per_million: '', output_points_per_million: '', points_per_request: '',
  capabilities_text: '', source: '', deprecation_date: '',
  enabled: true, notes: '',
}

// 表头列定义：sortable 列点击表头排序；其余列（档位/默认/思考/能力/操作）不参与排序
const COLUMNS = [
  { header: '模型 ID', key: 'model_id', sortable: true },
  { header: '显示名', key: 'label', sortable: true },
  { header: '供应商', key: 'provider', sortable: true },
  { header: '协议', key: 'protocol', sortable: true },
  { header: '最大输入', key: 'max_input_tokens', sortable: true },
  { header: '最大输出', key: 'max_output_tokens', sortable: true },
  { header: '输入价', key: 'input_price_per_million', sortable: true },
  { header: '输出价', key: 'output_price_per_million', sortable: true },
  { header: '缓存价', key: 'cache_read_price_per_million', sortable: true },
  { header: '输入积分', key: 'input_points_per_million', sortable: true },
  { header: '输出积分', key: 'output_points_per_million', sortable: true },
  { header: '单次积分', key: 'points_per_request', sortable: true },
  { header: '档位', key: null, sortable: false },
  { header: '默认', key: null, sortable: false },
  { header: '思考', key: null, sortable: false },
  { header: '能力', key: null, sortable: false },
  { header: '预算', key: 'context_budget_chars', sortable: true },
  { header: '状态', key: 'enabled', sortable: true },
  { header: '操作', key: null, sortable: false },
]

export default function AdminLlmModelsTab({ items, loading, globalModelId = '', onRefresh, onSave, onBatchSave, onBatchUpdate, onDelete, onTest, dialog }) {
  const [editing, setEditing] = useState(null) // null | { isNew, draft }
  const [batchDraft, setBatchDraft] = useState(null)
  const [batchEditing, setBatchEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [batchSaving, setBatchSaving] = useState(false)
  const [batchUpdating, setBatchUpdating] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // null | { ok, text, error, latency_ms }
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('model_id')
  const [sortDir, setSortDir] = useState('asc') // 'asc' | 'desc'
  const [collapsedGroups, setCollapsedGroups] = useState({ disabled: true }) // 未启用组默认折叠
  const [selectedIds, setSelectedIds] = useState([])

  const openNew = () => { setEditing({ isNew: true, draft: { ...EMPTY_DRAFT } }); setTestResult(null) }
  const openBatch = () => setBatchDraft({
    model_ids: '', provider: '', protocol: 'openai', base_url: '', api_key: '',
    max_input_tokens: 1000000, max_output_tokens: 128000,
    reasoning_efforts_text: 'auto,low,medium,high,xhigh,max', default_reasoning_effort: 'auto',
    thinking_default: 'enabled', context_budget_chars: 256000,
    capabilities_text: '', enabled: true,
  })
  const openBatchEdit = () => setBatchEditing({
    apply: {}, provider: '', protocol: 'openai', base_url: '', api_key: '',
    max_input_tokens: '', max_output_tokens: '', reasoning_efforts_text: '', default_reasoning_effort: 'auto',
    thinking_default: 'enabled', context_budget_chars: '', capabilities_text: '', enabled: true,
  })
  const openEdit = (m) => { setEditing({
    isNew: false,
    draft: {
      ...m,
      reasoning_efforts_text: (m.reasoning_efforts || []).join(','),
      capabilities_text: (m.capabilities || []).join(','),
    },
  }); setTestResult(null) }
  const setDraft = (patch) => setEditing(prev => ({ ...prev, draft: { ...prev.draft, ...patch } }))

  const handleSave = async () => {
    const d = editing.draft
    if (!d.model_id?.trim()) { dialog.alert('模型 ID 不能为空'); return }
    if (!d.label?.trim()) { dialog.alert('显示名不能为空'); return }
    const efforts = (d.reasoning_efforts_text || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
    if (!efforts.length) { dialog.alert('思考档位至少填一个'); return }
    setSaving(true)
    try {
      await onSave({
        model_id: d.model_id.trim(),
        label: d.label.trim(),
        provider: d.provider?.trim() || '',
        protocol: d.protocol,
        base_url: d.base_url?.trim() || '',
        api_key: d.api_key?.trim() || '',
        max_input_tokens: Number(d.max_input_tokens) || 1000000,
        max_output_tokens: Number(d.max_output_tokens) || 128000,
        input_price_per_million: Number(d.input_price_per_million) || null,
        output_price_per_million: Number(d.output_price_per_million) || null,
        cache_read_price_per_million: Number(d.cache_read_price_per_million) || null,
        price_currency: d.price_currency || 'usd',
        input_points_per_million: Number(d.input_points_per_million) || null,
        output_points_per_million: Number(d.output_points_per_million) || null,
        points_per_request: Number(d.points_per_request) || null,
        reasoning_efforts: efforts,
        default_reasoning_effort: d.default_reasoning_effort,
        thinking_default: d.thinking_default,
        context_budget_chars: Number(d.context_budget_chars) || 256000,
        capabilities: (d.capabilities_text || '').split(/[,，;；\s]+/).map(s => s.trim()).filter(Boolean),
        enabled: !!d.enabled,
        deprecation_date: d.deprecation_date || '',
        source: d.source || '',
        notes: d.notes || '',
      })
      setEditing(null)
    } catch (e) { dialog.alert(e.message || '保存失败') } finally { setSaving(false) }
  }

  const handleBatchSave = async () => {
    const d = batchDraft
    const rows = (d.model_ids || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [modelId, ...labelParts] = line.split('|')
      return { model_id: modelId.trim(), label: labelParts.join('|').trim() || modelId.trim() }
    })
    if (!rows.length) { dialog.alert('请至少填写一个模型 ID'); return }
    if (rows.some(row => !row.model_id)) { dialog.alert('模型 ID 不能为空'); return }
    const duplicates = rows.filter((row, index) => rows.findIndex(item => item.model_id === row.model_id) !== index).map(row => row.model_id)
    if (duplicates.length) { dialog.alert(`模型 ID 重复：${[...new Set(duplicates)].join('、')}`); return }
    const efforts = (d.reasoning_efforts_text || '').split(/[,，\s]+/).map(item => item.trim()).filter(Boolean)
    if (!efforts.length) { dialog.alert('思考档位至少填一个'); return }
    setBatchSaving(true)
    try {
      await onBatchSave(rows.map(row => ({
        ...row,
        provider: d.provider.trim(), protocol: d.protocol, base_url: d.base_url.trim(), api_key: d.api_key.trim(),
        max_input_tokens: Number(d.max_input_tokens) || 1000000,
        max_output_tokens: Number(d.max_output_tokens) || 128000,
        reasoning_efforts: efforts, default_reasoning_effort: d.default_reasoning_effort,
        thinking_default: d.thinking_default, context_budget_chars: Number(d.context_budget_chars) || 256000,
        capabilities: (d.capabilities_text || '').split(/[,，;；\s]+/).map(item => item.trim()).filter(Boolean),
        enabled: !!d.enabled,
      })))
      setBatchDraft(null)
    } catch (e) { dialog.alert(e.message || '批量添加失败') } finally { setBatchSaving(false) }
  }

  const toggleSelected = (modelId) => setSelectedIds(prev => prev.includes(modelId) ? prev.filter(id => id !== modelId) : [...prev, modelId])
  const toggleRowsSelected = (rows) => {
    const ids = rows.map(row => row.model_id)
    setSelectedIds(prev => ids.every(id => prev.includes(id)) ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])])
  }
  const handleBatchUpdate = async () => {
    const d = batchEditing
    const data = {}
    const fields = ['provider', 'protocol', 'base_url', 'api_key', 'max_input_tokens', 'max_output_tokens', 'reasoning_efforts', 'default_reasoning_effort', 'thinking_default', 'context_budget_chars', 'capabilities', 'enabled']
    for (const field of fields) {
      if (!d.apply[field]) continue
      if (field === 'reasoning_efforts') {
        const efforts = d.reasoning_efforts_text.split(/[,，\s]+/).map(item => item.trim()).filter(Boolean)
        if (!efforts.length) { dialog.alert('思考档位至少填一个'); return }
        data[field] = efforts
      } else if (field === 'capabilities') {
        data[field] = d.capabilities_text.split(/[,，;；\s]+/).map(item => item.trim()).filter(Boolean)
      } else if (field === 'max_input_tokens' || field === 'max_output_tokens' || field === 'context_budget_chars') {
        const value = Number(d[field])
        if (!value) { dialog.alert('数值字段必须大于 0'); return }
        data[field] = value
      } else {
        data[field] = d[field]
      }
    }
    if (!Object.keys(data).length) { dialog.alert('请勾选至少一个要更新的字段'); return }
    setBatchUpdating(true)
    try {
      await onBatchUpdate(selectedIds, data)
      setSelectedIds([])
      setBatchEditing(null)
    } catch (e) { dialog.alert(e.message || '批量编辑失败') } finally { setBatchUpdating(false) }
  }

  // 测试连接：用表单当前值（可未保存）调后端最小请求，验证配置可用性并捕捉错误
  const handleTest = async () => {
    const d = editing.draft
    if (!d.model_id?.trim()) { dialog.alert('请先填写模型 ID'); return }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await onTest({
        model_id: d.model_id.trim(),
        base_url: d.base_url?.trim() || '',
        api_key: d.api_key?.trim() || '',
        protocol: d.protocol,
      })
      setTestResult(res || { ok: false, error: '无响应' })
    } catch (e) {
      setTestResult({ ok: false, error: e.message || '测试请求失败' })
    } finally { setTesting(false) }
  }

  // 分组：已填 Base URL 或 API Key，或为全局激活模型（走 .env 全局配置），且 enabled === true 视为已启用；其余归到未启用
  const isConfigured = (m) => m.enabled === true && (!!(m.base_url || '').trim() || !!(m.api_key || '').trim() || m.model_id === globalModelId)

  // 搜索：按 model_id/label/provider/protocol 模糊匹配（不区分大小写）
  const q = search.trim().toLowerCase()
  const matchSearch = (m) => !q || [m.model_id, m.label, m.provider, m.protocol]
    .some(v => String(v || '').toLowerCase().includes(q))

  // 排序
  const numericKeys = ['max_input_tokens','max_output_tokens','input_price_per_million','output_price_per_million','cache_read_price_per_million','input_points_per_million','output_points_per_million','points_per_request','context_budget_chars']
  const sortItems = (arr) => {
    const sorted = [...arr].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (numericKeys.includes(sortKey)) {
        av = Number(av) || 0; bv = Number(bv) || 0
      } else {
        av = String(av || '').toLowerCase(); bv = String(bv || '').toLowerCase()
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key); setSortDir('asc')
    }
  }

  // 计算两组（搜索过滤 + 排序）
  const configured = sortItems(items.filter(m => isConfigured(m) && matchSearch(m)))
  const unconfigured = sortItems(items.filter(m => !isConfigured(m) && matchSearch(m)))

  const toggleGroup = (key) => setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }))

  // 表格渲染：两组共用，表头可排序列带方向图标
  const renderTable = (rows) => (
    <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ background: 'var(--bg-card)' }}>
            <th className="px-3 py-2.5">
              <input type="checkbox" checked={rows.length > 0 && rows.every(row => selectedIds.includes(row.model_id))} onChange={() => toggleRowsSelected(rows)} aria-label="选择当前分组全部模型" className="w-3.5 h-3.5 accent-[var(--accent)]" />
            </th>
            {COLUMNS.map(col => {
              const isActive = col.sortable && sortKey === col.key
              return (
                <th
                  key={col.header}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  className={`px-3 py-2.5 text-left font-medium whitespace-nowrap ${col.sortable ? 'cursor-pointer select-none' : ''}`}
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && (
                      isActive ? (
                        sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                      ) : (
                        <ChevronsUpDown size={12} style={{ opacity: 0.3 }} />
                      )
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(m => (
            <tr key={m.model_id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
              <td className="px-3 py-2.5"><input type="checkbox" checked={selectedIds.includes(m.model_id)} onChange={() => toggleSelected(m.model_id)} aria-label={`选择 ${m.model_id}`} className="w-3.5 h-3.5 accent-[var(--accent)]" /></td>
              <td className="px-3 py-2.5 font-mono whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{m.model_id}</td>
              <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{m.label}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">{m.provider || '—'}</td>
              <td className="px-3 py-2.5">{m.protocol}</td>
              <td className="px-3 py-2.5 tabular-nums">{m.max_input_tokens >= 1000000 ? `${(m.max_input_tokens / 1000000).toFixed(2).replace(/\.?0+$/, '')}M` : m.max_input_tokens}</td>
              <td className="px-3 py-2.5 tabular-nums">{m.max_output_tokens >= 1000 ? `${Math.round(m.max_output_tokens / 1000)}K` : m.max_output_tokens}</td>
              <td className="px-3 py-2.5 tabular-nums">{m.input_price_per_million != null ? `${m.input_price_per_million}${m.price_currency === 'cny' ? '元' : '$'}` : '—'}</td>
              <td className="px-3 py-2.5 tabular-nums">{m.output_price_per_million != null ? `${m.output_price_per_million}${m.price_currency === 'cny' ? '元' : '$'}` : '—'}</td>
              <td className="px-3 py-2.5 tabular-nums">{m.cache_read_price_per_million != null ? `${m.cache_read_price_per_million}${m.price_currency === 'cny' ? '元' : '$'}` : '—'}</td>
              <td className="px-3 py-2.5 tabular-nums">{m.input_points_per_million != null ? m.input_points_per_million : '—'}</td>
              <td className="px-3 py-2.5 tabular-nums">{m.output_points_per_million != null ? m.output_points_per_million : '—'}</td>
              <td className="px-3 py-2.5 tabular-nums">{m.points_per_request != null ? m.points_per_request : '—'}</td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1 max-w-[260px]">
                  {(m.reasoning_efforts || []).map(e => (
                    <span key={e} className="px-1.5 py-0.5 rounded-md text-[10px]" style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--text-secondary)' }}>{EFFORT_LABELS[e] || e}</span>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2.5">{EFFORT_LABELS[m.default_reasoning_effort] || m.default_reasoning_effort}</td>
              <td className="px-3 py-2.5">{THINKING_LABELS[m.thinking_default] || m.thinking_default}</td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1 max-w-[180px]">
                  {(m.capabilities || []).slice(0, 4).map(c => (
                    <span key={c} className="px-1.5 py-0.5 rounded-md text-[10px]" style={{ background: 'color-mix(in srgb, var(--bg-hover) 80%, transparent)', color: 'var(--text-secondary)' }}>{c}</span>
                  ))}
                  {(m.capabilities || []).length > 4 && <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>+{(m.capabilities || []).length - 4}</span>}
                </div>
              </td>
              <td className="px-3 py-2.5 tabular-nums">{m.context_budget_chars}</td>
              <td className="px-3 py-2.5">
                <span className="px-1.5 py-0.5 rounded-md text-[10px]" style={{ background: m.enabled ? 'color-mix(in srgb, var(--color-success) 15%, transparent)' : 'color-mix(in srgb, var(--color-error) 15%, transparent)', color: m.enabled ? 'var(--color-success)' : 'var(--color-error)' }}>
                  {m.enabled ? '启用' : '停用'}
                </span>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(m)} title="编辑" className="p-1.5 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}><Pencil size={13} /></button>
                  <button onClick={async () => {
                    if (!await dialog.confirm(`确定删除模型档案「${m.model_id}」？`)) return
                    try { await onDelete(m.model_id) } catch (e) { dialog.alert(e.message || '删除失败') }
                  }} title="删除" className="p-1.5 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--color-error)' }}><Trash2 size={13} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  // 分组 section：可折叠标题栏 + 表格
  const renderSection = (key, title, rows, isPositive) => {
    const collapsed = !!collapsedGroups[key]
    const badgeColor = isPositive ? 'var(--color-success)' : 'var(--text-secondary)'
    const badgeBg = isPositive
      ? 'color-mix(in srgb, var(--color-success) 15%, transparent)'
      : 'color-mix(in srgb, var(--text-secondary) 10%, transparent)'
    return (
      <section>
        <div
          onClick={() => toggleGroup(key)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer select-none transition-colors hover:bg-bg-hover"
          style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
        >
          {collapsed
            ? <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
            : <ChevronDown size={14} style={{ color: 'var(--text-secondary)' }} />}
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium" style={{ background: badgeBg, color: badgeColor }}>{rows.length}</span>
        </div>
        {!collapsed && (
          <div className="mt-2">{renderTable(rows)}</div>
        )}
      </section>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
            共 {configured.length + unconfigured.length} 个模型档案
            <span className="ml-1.5 text-xs">（已启用 {configured.length} / 未启用 {unconfigured.length}）</span>
          </span>
          <button onClick={onRefresh} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={13} /> 刷新
          </button>
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-secondary)' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索 ID / 名称 / 供应商 / 协议"
              className="w-full pl-7 pr-3 py-1.5 rounded-xl text-xs border outline-none"
              style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            />
          </div>
          <button onClick={openNew} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-white transition-colors ml-auto" style={{ background: 'var(--accent)' }}>
            <Plus size={13} /> 新增模型
          </button>
          <button onClick={openBatch} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            <Plus size={13} /> 批量添加
          </button>
          {selectedIds.length > 0 && <button onClick={openBatchEdit} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-white transition-colors" style={{ background: 'var(--accent)' }}>
            <Pencil size={13} /> 批量编辑（{selectedIds.length}）
          </button>}
        </div>
        <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          已启用：已填 API Key 或 Base URL，或为全局激活模型（走全局配置）且开启 · 未启用：未填 Key/Base URL 且非激活模型，或已停用 · 点击表头排序 · 点击分组标题折叠/展开
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--text-secondary)' }}>暂无模型档案</div>
      ) : configured.length === 0 && unconfigured.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--text-secondary)' }}>未找到匹配的模型档案</div>
      ) : (
        <div className="space-y-4">
          {configured.length > 0 && renderSection('enabled', '已启用', configured, true)}
          {unconfigured.length > 0 && renderSection('disabled', '未启用', unconfigured, false)}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{editing.isNew ? '新增模型档案' : `编辑：${editing.draft.model_id}`}</h3>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}><X size={15} /></button>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[65vh] overflow-y-auto">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>模型 ID *</label>
                <input value={editing.draft.model_id} disabled={!editing.isNew} onChange={e => setDraft({ model_id: e.target.value })}
                  placeholder="如 deepseek-v4-flash" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none disabled:opacity-50 font-mono"
                  style={{ borderColor: 'var(--border-color)', background: editing.isNew ? 'var(--bg-primary)' : 'var(--bg-card)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>显示名 *</label>
                <input value={editing.draft.label} onChange={e => setDraft({ label: e.target.value })} placeholder="如 DeepSeek V4 Flash"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>供应商</label>
                <input value={editing.draft.provider || ''} onChange={e => setDraft({ provider: e.target.value })} placeholder="如 deepseek/openai/moonshot"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>协议</label>
                <select value={editing.draft.protocol} onChange={e => setDraft({ protocol: e.target.value })} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API 地址（留空用全局 LLM_BASE_URL）</label>
                <input value={editing.draft.base_url || ''} onChange={e => setDraft({ base_url: e.target.value })} placeholder="如 https://api.deepseek.com/v1"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API Key（留空用全局 LLM_API_KEY；支持 env:变量名）</label>
                <input type="password" value={editing.draft.api_key || ''} onChange={e => setDraft({ api_key: e.target.value })} placeholder="sk-xxx 或 env:DEEPSEEK_API_KEY"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>最大输入（tokens）</label>
                <input type="number" value={editing.draft.max_input_tokens} onChange={e => setDraft({ max_input_tokens: e.target.value })}
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>输入价/百万 tokens</label>
                <input type="number" step="0.01" min="0" value={editing.draft.input_price_per_million ?? ''} onChange={e => setDraft({ input_price_per_million: e.target.value })} placeholder="留空表示未知"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>输出价/百万 tokens</label>
                <input type="number" step="0.01" min="0" value={editing.draft.output_price_per_million ?? ''} onChange={e => setDraft({ output_price_per_million: e.target.value })} placeholder="留空表示未知"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>缓存命中输入价/百万</label>
                <input type="number" step="0.01" min="0" value={editing.draft.cache_read_price_per_million ?? ''} onChange={e => setDraft({ cache_read_price_per_million: e.target.value })} placeholder="留空表示未知"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>输入积分/百万 tokens</label>
                <input type="number" step="0.01" min="0" value={editing.draft.input_points_per_million ?? ''} onChange={e => setDraft({ input_points_per_million: e.target.value })} placeholder="留空表示未定价"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>输出积分/百万 tokens</label>
                <input type="number" step="0.01" min="0" value={editing.draft.output_points_per_million ?? ''} onChange={e => setDraft({ output_points_per_million: e.target.value })} placeholder="留空表示未定价"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>单次请求积分</label>
                <input type="number" step="0.01" min="0" value={editing.draft.points_per_request ?? ''} onChange={e => setDraft({ points_per_request: e.target.value })} placeholder="留空表示未定价"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>价格币种</label>
                <select value={editing.draft.price_currency} onChange={e => setDraft({ price_currency: e.target.value })} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  <option value="usd">USD（美元）</option>
                  <option value="cny">CNY（人民币）</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>最大输出（tokens）</label>
                <input type="number" value={editing.draft.max_output_tokens} onChange={e => setDraft({ max_output_tokens: e.target.value })}
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>思考档位（逗号分隔）</label>
                <input value={editing.draft.reasoning_efforts_text} onChange={e => setDraft({ reasoning_efforts_text: e.target.value })} placeholder="auto,low,medium,high,xhigh,max"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>默认思考档位</label>
                <select value={editing.draft.default_reasoning_effort} onChange={e => setDraft({ default_reasoning_effort: e.target.value })} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  {(editing.draft.reasoning_efforts_text || '').split(/[,，\s]+/).filter(Boolean).map(v => (
                    <option key={v} value={v}>{EFFORT_LABELS[v] || v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>思考模式</label>
                <select value={editing.draft.thinking_default} onChange={e => setDraft({ thinking_default: e.target.value })} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none"
                  style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                  <option value="enabled">默认思考（可关闭）</option>
                  <option value="disabled">默认不思考</option>
                  <option value="always">始终思考</option>
                </select>
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>上下文预算（字符）</label>
                <input type="number" value={editing.draft.context_budget_chars} onChange={e => setDraft({ context_budget_chars: e.target.value })}
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
                  <input type="checkbox" checked={!!editing.draft.enabled} onChange={e => setDraft({ enabled: e.target.checked })} className="w-4 h-4 accent-[var(--accent)]" />
                  启用该模型
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>能力标签（逗号/分号分隔）</label>
                <input value={editing.draft.capabilities_text || ''} onChange={e => setDraft({ capabilities_text: e.target.value })} placeholder="reasoning,vision,function_calling,caching,json_mode,streaming"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>数据来源 URL</label>
                <input value={editing.draft.source || ''} onChange={e => setDraft({ source: e.target.value })} placeholder="官方价格文档链接"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>弃用日期</label>
                <input value={editing.draft.deprecation_date || ''} onChange={e => setDraft({ deprecation_date: e.target.value })} placeholder="YYYY-MM-DD，可留空"
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>备注</label>
                <textarea value={editing.draft.notes || ''} onChange={e => setDraft({ notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 rounded-2xl text-sm border outline-none resize-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setEditing(null)} className="flex-1 py-2 rounded-2xl text-xs font-medium border transition-colors" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={handleTest} disabled={testing || saving}
                className="flex-1 py-2 rounded-2xl text-xs font-medium border transition-colors disabled:opacity-40"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              <button onClick={handleSave} disabled={saving || testing} className="flex-1 py-2 rounded-2xl text-xs font-medium text-white transition-colors disabled:opacity-40" style={{ background: 'var(--accent)' }}>{saving ? '保存中...' : '保存'}</button>
            </div>
            {testResult && (
              <div className="px-4 py-2.5 border-t text-xs break-words" style={{ borderColor: 'var(--border-color)', color: testResult.ok ? 'var(--color-success)' : 'var(--color-error)', background: 'color-mix(in srgb, ' + (testResult.ok ? 'var(--color-success)' : 'var(--color-error)') + ' 6%, transparent)' }}>
                {testResult.ok
                  ? <>✓ 连接成功（{testResult.latency_ms != null ? `${testResult.latency_ms}ms` : '耗时未知'}）：{testResult.text || '模型已响应'}</>
                  : <>✗ 连接失败：{testResult.error || '未知错误'}{testResult.latency_ms != null ? `（${testResult.latency_ms}ms）` : ''}</>}
              </div>
            )}
          </div>
        </div>
      )}
      {batchDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setBatchDraft(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-2xl rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>批量添加模型</h3>
              <button onClick={() => setBatchDraft(null)} className="p-1.5 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}><X size={15} /></button>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[65vh] overflow-y-auto">
              <div className="sm:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>模型 ID *</label>
                <textarea value={batchDraft.model_ids} onChange={e => setBatchDraft(prev => ({ ...prev, model_ids: e.target.value }))} rows={6} placeholder={'每行一个模型 ID，可用 | 指定显示名\n例如：\ngpt-5.6 | GPT-5.6\ngpt-5.6-mini'} className="w-full px-3 py-2 rounded-xl text-sm border outline-none resize-y font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>供应商</label>
                <input value={batchDraft.provider} onChange={e => setBatchDraft(prev => ({ ...prev, provider: e.target.value }))} placeholder="如 openai / deepseek" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>协议</label>
                <select value={batchDraft.protocol} onChange={e => setBatchDraft(prev => ({ ...prev, protocol: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}><option value="openai">openai</option><option value="anthropic">anthropic</option></select>
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API 地址</label>
                <input value={batchDraft.base_url} onChange={e => setBatchDraft(prev => ({ ...prev, base_url: e.target.value }))} placeholder="留空用全局 LLM_BASE_URL" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>API Key</label>
                <input type="password" value={batchDraft.api_key} onChange={e => setBatchDraft(prev => ({ ...prev, api_key: e.target.value }))} placeholder="留空用全局 LLM_API_KEY" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>最大输入</label>
                <input type="number" value={batchDraft.max_input_tokens} onChange={e => setBatchDraft(prev => ({ ...prev, max_input_tokens: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>最大输出</label>
                <input type="number" value={batchDraft.max_output_tokens} onChange={e => setBatchDraft(prev => ({ ...prev, max_output_tokens: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>思考档位</label>
                <input value={batchDraft.reasoning_efforts_text} onChange={e => setBatchDraft(prev => ({ ...prev, reasoning_efforts_text: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>默认思考档位</label>
                <select value={batchDraft.default_reasoning_effort} onChange={e => setBatchDraft(prev => ({ ...prev, default_reasoning_effort: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>{batchDraft.reasoning_efforts_text.split(/[,，\s]+/).filter(Boolean).map(value => <option key={value} value={value}>{EFFORT_LABELS[value] || value}</option>)}</select>
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>上下文预算</label>
                <input type="number" value={batchDraft.context_budget_chars} onChange={e => setBatchDraft(prev => ({ ...prev, context_budget_chars: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>能力标签</label>
                <input value={batchDraft.capabilities_text} onChange={e => setBatchDraft(prev => ({ ...prev, capabilities_text: e.target.value }))} placeholder="reasoning,vision,function_calling,streaming" className="w-full px-3 py-2 rounded-2xl text-sm border outline-none font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}><input type="checkbox" checked={batchDraft.enabled} onChange={e => setBatchDraft(prev => ({ ...prev, enabled: e.target.checked }))} className="w-4 h-4 accent-[var(--accent)]" /> 启用这些模型</label>
              </div>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setBatchDraft(null)} disabled={batchSaving} className="flex-1 py-2 rounded-2xl text-xs font-medium border transition-colors" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={handleBatchSave} disabled={batchSaving} className="flex-1 py-2 rounded-2xl text-xs font-medium text-white transition-colors disabled:opacity-40" style={{ background: 'var(--accent)' }}>{batchSaving ? '添加中...' : '批量添加'}</button>
            </div>
          </div>
        </div>
      )}
      {batchEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setBatchEditing(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-2xl rounded-2xl overflow-hidden" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>批量编辑 {selectedIds.length} 个模型</h3>
              <button onClick={() => setBatchEditing(null)} className="p-1.5 rounded-lg hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}><X size={15} /></button>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[65vh] overflow-y-auto">
              {[
                ['provider', '供应商', '如 openai / deepseek'], ['base_url', 'API 地址', '留空可清空现有地址'], ['api_key', 'API Key', '留空可清空现有 Key'],
                ['max_input_tokens', '最大输入', ''], ['max_output_tokens', '最大输出', ''], ['reasoning_efforts', '思考档位', 'auto,low,medium,high'],
                ['context_budget_chars', '上下文预算', ''], ['capabilities', '能力标签', 'reasoning,vision,function_calling'],
              ].map(([field, label, placeholder]) => {
                const key = field === 'reasoning_efforts' ? 'reasoning_efforts_text' : field === 'capabilities' ? 'capabilities_text' : field
                const numeric = ['max_input_tokens', 'max_output_tokens', 'context_budget_chars'].includes(field)
                return <div key={field}>
                  <label className="flex items-center gap-2 text-xs mb-1.5 cursor-pointer" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={!!batchEditing.apply[field]} onChange={e => setBatchEditing(prev => ({ ...prev, apply: { ...prev.apply, [field]: e.target.checked } }))} className="w-3.5 h-3.5 accent-[var(--accent)]" /> {label}</label>
                  <input type={numeric ? 'number' : field === 'api_key' ? 'password' : 'text'} disabled={!batchEditing.apply[field]} value={batchEditing[key]} onChange={e => setBatchEditing(prev => ({ ...prev, [key]: e.target.value }))} placeholder={placeholder} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none disabled:opacity-40 font-mono" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                </div>
              })}
              <div>
                <label className="flex items-center gap-2 text-xs mb-1.5 cursor-pointer" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={!!batchEditing.apply.protocol} onChange={e => setBatchEditing(prev => ({ ...prev, apply: { ...prev.apply, protocol: e.target.checked } }))} className="w-3.5 h-3.5 accent-[var(--accent)]" /> 协议</label>
                <select disabled={!batchEditing.apply.protocol} value={batchEditing.protocol} onChange={e => setBatchEditing(prev => ({ ...prev, protocol: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none disabled:opacity-40" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}><option value="openai">openai</option><option value="anthropic">anthropic</option></select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs mb-1.5 cursor-pointer" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={!!batchEditing.apply.default_reasoning_effort} onChange={e => setBatchEditing(prev => ({ ...prev, apply: { ...prev.apply, default_reasoning_effort: e.target.checked } }))} className="w-3.5 h-3.5 accent-[var(--accent)]" /> 默认思考档位</label>
                <select disabled={!batchEditing.apply.default_reasoning_effort} value={batchEditing.default_reasoning_effort} onChange={e => setBatchEditing(prev => ({ ...prev, default_reasoning_effort: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none disabled:opacity-40" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}><option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="max">最高</option><option value="xhigh">超高</option></select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs mb-1.5 cursor-pointer" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={!!batchEditing.apply.thinking_default} onChange={e => setBatchEditing(prev => ({ ...prev, apply: { ...prev.apply, thinking_default: e.target.checked } }))} className="w-3.5 h-3.5 accent-[var(--accent)]" /> 思考模式</label>
                <select disabled={!batchEditing.apply.thinking_default} value={batchEditing.thinking_default} onChange={e => setBatchEditing(prev => ({ ...prev, thinking_default: e.target.value }))} className="w-full px-3 py-2 rounded-2xl text-sm border outline-none disabled:opacity-40" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}><option value="enabled">默认思考</option><option value="disabled">默认不思考</option><option value="always">始终思考</option></select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs mb-1.5 cursor-pointer" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={!!batchEditing.apply.enabled} onChange={e => setBatchEditing(prev => ({ ...prev, apply: { ...prev.apply, enabled: e.target.checked } }))} className="w-3.5 h-3.5 accent-[var(--accent)]" /> 启用状态</label>
                <label className={`flex items-center gap-2 h-9 text-sm ${batchEditing.apply.enabled ? 'cursor-pointer' : 'opacity-40'}`} style={{ color: 'var(--text-primary)' }}><input type="checkbox" disabled={!batchEditing.apply.enabled} checked={batchEditing.enabled} onChange={e => setBatchEditing(prev => ({ ...prev, enabled: e.target.checked }))} className="w-4 h-4 accent-[var(--accent)]" /> 启用选中模型</label>
              </div>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
              <button onClick={() => setBatchEditing(null)} disabled={batchUpdating} className="flex-1 py-2 rounded-2xl text-xs font-medium border transition-colors" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>取消</button>
              <button onClick={handleBatchUpdate} disabled={batchUpdating} className="flex-1 py-2 rounded-2xl text-xs font-medium text-white transition-colors disabled:opacity-40" style={{ background: 'var(--accent)' }}>{batchUpdating ? '保存中...' : '应用到选中模型'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { Plus, Trash2, Pencil, X, RefreshCw } from 'lucide-react'

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

export default function AdminLlmModelsTab({ items, loading, onRefresh, onSave, onDelete, dialog }) {
  const [editing, setEditing] = useState(null) // null | { isNew, draft }
  const [saving, setSaving] = useState(false)

  const openNew = () => setEditing({ isNew: true, draft: { ...EMPTY_DRAFT } })
  const openEdit = (m) => setEditing({
    isNew: false,
    draft: {
      ...m,
      reasoning_efforts_text: (m.reasoning_efforts || []).join(','),
      capabilities_text: (m.capabilities || []).join(','),
    },
  })
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

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>共 {items.length} 个模型档案</span>
        <button onClick={onRefresh} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-colors" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={13} /> 刷新
        </button>
        <button onClick={openNew} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-white transition-colors ml-auto" style={{ background: 'var(--accent)' }}>
          <Plus size={13} /> 新增模型
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--text-secondary)' }}>暂无模型档案</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border" style={{ borderColor: 'var(--border-color)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'var(--bg-card)' }}>
                {['模型 ID', '显示名', '供应商', '协议', '最大输入', '最大输出', '输入价', '输出价', '缓存价', '输入积分', '输出积分', '单次积分', '档位', '默认', '思考', '能力', '预算', '状态', '操作'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left font-medium whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(m => (
                <tr key={m.model_id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
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
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 rounded-2xl text-xs font-medium text-white transition-colors disabled:opacity-40" style={{ background: 'var(--accent)' }}>{saving ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { adminAPI, configAPI } from '../../api'

const FEATURE_DEFAULTS = { web_search: true, file_upload: true, file_write: true, max_chat_sessions: 100, max_chat_files: 20 }

const emptyPlan = { code: '', name: '', description: '', price_rmb: 0, cycle_days: 30, grant_points: 0, features: { ...FEATURE_DEFAULTS, package_type: 'membership', daily_quota: null, original_price_rmb: '' }, allowed_models: [], max_concurrent_requests: 1, enabled: true, is_free: false, sort_order: 0 }

const inputCls = 'w-full px-3 py-2 rounded-2xl text-xs border outline-none'
const inputStyle = { borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }

const num = (v, def) => (v === '' || v == null ? def : Number(v))

export default function AdminSubscriptionTab() {
  const [plans, setPlans] = useState([])
  const [orders, setOrders] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [usage, setUsage] = useState(null)
  const [prices, setPrices] = useState([])
  const [draft, setDraft] = useState(emptyPlan)
  const [editingId, setEditingId] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [freeDailyQuota, setFreeDailyQuota] = useState(5) // 全局配置：AI 助手每日免费次数
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [p, o, s, u, m, c] = await Promise.all([adminAPI.subscriptionPlans(), adminAPI.subscriptionOrders(), adminAPI.subscriptions(), adminAPI.subscriptionUsage(), adminAPI.modelPrices(), configAPI.admin()])
      setPlans(p.data?.items || [])
      setOrders(o.data?.items || [])
      setSubscriptions(s.data?.items || [])
      setUsage(u.data)
      setPrices(m.data?.items || [])
      setFreeDailyQuota(Number(c.data?.ai_daily_free_quota ?? 5))
    } finally { setLoading(false) }
  }
  useEffect(() => { Promise.resolve().then(load) }, [])

  const buildPayload = () => {
    const f = { ...(draft.features || {}) }
    delete f.max_tool_calls // 工具调用次数不再做套餐限制
    return {
      ...draft,
      price_rmb: num(draft.price_rmb, 0),
      cycle_days: num(draft.cycle_days, 30),
      grant_points: num(draft.grant_points, 0),
      max_concurrent_requests: num(draft.max_concurrent_requests, 1),
      sort_order: num(draft.sort_order, 0),
      allowed_models: String(draft.allowed_models || '').split(/[\s,]+/).filter(Boolean),
      features: {
        ...FEATURE_DEFAULTS,
        ...f,
        web_search: Boolean(f.web_search),
        file_upload: Boolean(f.file_upload),
        file_write: Boolean(f.file_write),
        max_chat_sessions: num(f.max_chat_sessions, FEATURE_DEFAULTS.max_chat_sessions),
        max_chat_files: num(f.max_chat_files, FEATURE_DEFAULTS.max_chat_files),
        daily_quota: f.daily_quota === '' || f.daily_quota == null ? null : Number(f.daily_quota),
        package_type: f.package_type || 'membership',
        original_price_rmb: f.original_price_rmb || '',
      },
    }
  }
  const savePlan = async () => {
    const data = buildPayload()
    if (editingId) await adminAPI.updateSubscriptionPlan(editingId, data)
    else await adminAPI.createSubscriptionPlan(data)
    setDraft(emptyPlan); setEditingId(null); setEditOpen(false); load()
  }
  const openEdit = plan => {
    setEditingId(plan.id)
    setDraft({ ...plan, allowed_models: (plan.allowed_models || []).join(',') })
    setEditOpen(true)
  }
  const closeEdit = () => { setEditOpen(false); setEditingId(null); setDraft(emptyPlan) }

  const review = async (order, action) => {
    const review_note = window.prompt(action === 'approve' ? '审核备注（可选）' : '处理原因') || ''
    if (action !== 'approve' && !review_note) return
    if (action === 'approve') await adminAPI.approveSubscriptionOrder(order.id, { review_note })
    if (action === 'reject') await adminAPI.rejectSubscriptionOrder(order.id, { review_note })
    if (action === 'refund') await adminAPI.refundSubscriptionOrder(order.id, { review_note })
    load()
  }
  const operate = async (item, action) => {
    const amount = window.prompt(action === 'grant' ? '补发积分' : '续期天数')
    const reason = window.prompt('操作原因') || ''
    if (!reason || !amount) return
    if (action === 'grant') await adminAPI.grantSubscription(item.user_id, { points: Number(amount), reason })
    else await adminAPI.extendSubscription(item.user_id, { days: Number(amount), reason })
    load()
  }
  if (loading) return <div className="py-16 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>加载中...</div>
  return <div className="space-y-4">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[
        ['请求数', usage?.summary?.requests ?? 0], ['实际扣除', usage?.summary?.charged_points ?? 0],
        ['Token 成本', usage?.summary?.calculated_cost_points ?? 0], ['缺失用量', usage?.summary?.usage_missing_requests ?? 0],
      ].map(([label, value]) => <div key={label} className="p-3 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div><div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div></div>)}
    </div>
    {!editOpen && (
      <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
        <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>新增套餐</div>
        <PlanForm draft={draft} setDraft={setDraft} freeDailyQuota={freeDailyQuota} />
        <div className="flex justify-end mt-3">
          <button onClick={savePlan} className="px-3 py-1.5 rounded-2xl text-xs text-white" style={{ background: 'var(--accent)' }}>新增</button>
        </div>
      </div>
    )}
    <Section title="套餐管理"><Table headers={['名称', '类型', '价格', '原价', '积分', '次数/权益', '状态', '操作']} rows={plans.map(plan => [plan.name, plan.features?.package_type === 'credits' ? '积分包' : (plan.features?.package_type === 'membership' ? '会员' : '其他'), `¥${plan.price_rmb}`, plan.features?.original_price_rmb ? `¥${plan.features.original_price_rmb}` : '-', plan.grant_points, <RightsCell key="rights" plan={plan} freeDailyQuota={freeDailyQuota} />, <span key="status" style={{ color: plan.enabled ? 'var(--color-success)' : 'var(--color-warning)' }}>{plan.enabled ? '在售' : '暂售罄'}</span>, <div className="flex gap-2" key="ops"><button onClick={() => openEdit(plan)}>编辑</button>{plan.enabled ? <button onClick={() => adminAPI.disableSubscriptionPlan(plan.id).then(load)}>下架</button> : <button onClick={() => adminAPI.updateSubscriptionPlan(plan.id, { enabled: true }).then(load)}>上架</button>}</div>])} /></Section>
    <Section title="订阅订单"><Table headers={['订单', '用户', '套餐', '金额', '状态', '操作']} rows={orders.map(order => [order.order_no, order.username || order.user_id, order.plan_name, `¥${order.amount_rmb}`, order.status, <div className="flex gap-2" key="ops">{order.status === 'pending' && <><button onClick={() => review(order, 'approve')}>通过</button><button onClick={() => review(order, 'reject')}>驳回</button></>} {order.status === 'approved' && <button onClick={() => review(order, 'refund')}>退款</button>}</div>])} /></Section>
    <Section title="用户订阅"><Table headers={['用户', '套餐', '周期积分', '到期', '状态', '操作']} rows={subscriptions.map(item => [item.username || item.user_id, item.plan_name, `${item.remaining_points ?? 0} / ${item.granted_points ?? 0}`, item.plan_package_type === 'credits' ? '永久' : (item.period_end ? new Date(item.period_end).toLocaleString('zh-CN') : '-'), item.status, <div className="flex gap-2" key="ops"><button onClick={() => operate(item, 'grant')}>补发</button><button onClick={() => operate(item, 'extend')}>续期</button></div>])} /></Section>
    <Section title="模型价格"><Table headers={['模型', '输入积分/千 Token', '输出积分/千 Token', '版本数']} rows={prices.map(item => [item.model_id, item.points_per_1k?.input ?? '-', item.points_per_1k?.output ?? '-', item.versions?.length ?? 0])} /></Section>
    {editOpen && (
      <div className="fixed inset-0 z-[93] flex items-center justify-center p-4" onClick={closeEdit}>
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl flex flex-col" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
            <div className="min-w-0">
              <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>编辑套餐</h2>
              <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{draft.name || draft.code}</p>
            </div>
            <button onClick={closeEdit} aria-label="关闭" className="p-1.5 rounded-lg hover:bg-bg-hover shrink-0" style={{ color: 'var(--text-secondary)' }}><X size={18} /></button>
          </div>
          <div className="overflow-y-auto p-5">
            <PlanForm draft={draft} setDraft={setDraft} freeDailyQuota={freeDailyQuota} />
          </div>
          <div className="flex justify-end gap-2 px-5 py-4 border-t shrink-0" style={{ borderColor: 'var(--border-color)' }}>
            <button onClick={closeEdit} className="px-4 py-1.5 rounded-2xl text-xs" style={{ color: 'var(--text-secondary)' }}>取消</button>
            <button onClick={savePlan} className="px-4 py-1.5 rounded-2xl text-xs text-white" style={{ background: 'var(--accent)' }}>保存</button>
          </div>
        </div>
      </div>
    )}
  </div>
}

// 套餐次数/权益展示（表格权益列）
function RightsCell({ plan, freeDailyQuota }) {
  const f = plan.features || {}
  const items = []
  if (plan.is_free) items.push(`每日对话 ${freeDailyQuota ?? 0} 次（全局配置）`)
  else if (f.package_type === 'membership') items.push(`每日对话 ${f.daily_quota == null ? '不限' : `${Number(f.daily_quota).toLocaleString()} 次`}`)
  else items.push('按积分消耗')
  items.push(`会话 ${f.max_chat_sessions ?? '-'}`)
  items.push(`文件 ${f.max_chat_files ?? '-'}/会话`)
  if (f.web_search) items.push('联网')
  if (f.file_upload) items.push('上传')
  if (f.file_write) items.push('写文件')
  return <span className="whitespace-normal">{items.join(' · ')}</span>
}

// 带 label 的表单（字段名显示在输入框外，不占用输入框内容）
function PlanForm({ draft, setDraft, freeDailyQuota }) {
  const set = (key, value) => setDraft(v => ({ ...v, [key]: value }))
  const setFeature = (key, value) => setDraft(v => ({ ...v, features: { ...v.features, [key]: value } }))
  const f = draft.features || {}
  return (
    <div className="grid gap-2 md:grid-cols-4">
      <Field label="标识" hint="唯一 code，创建后不建议改"><input value={draft.code ?? ''} onChange={e => set('code', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <Field label="名称"><input value={draft.name ?? ''} onChange={e => set('name', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <Field label="价格（元）"><input type="number" min="0" step="0.01" value={draft.price_rmb ?? ''} onChange={e => set('price_rmb', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <Field label="原价（元）" hint="划线价，留空则不显示"><input type="number" min="0" step="0.01" value={f.original_price_rmb ?? ''} onChange={e => setFeature('original_price_rmb', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <Field label="周期（天）" hint="积分包填 36500 即永久"><input type="number" min="1" value={draft.cycle_days ?? ''} onChange={e => set('cycle_days', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <Field label="套餐类型">
        <select value={f.package_type || 'membership'} onChange={e => setFeature('package_type', e.target.value)} className={inputCls} style={inputStyle}>
          <option value="membership">会员订阅</option>
          <option value="credits">积分包</option>
          <option value="">其他</option>
        </select>
      </Field>
      <Field label="周期积分" hint="开通赠送或包内积分"><input type="number" min="0" value={draft.grant_points ?? ''} onChange={e => set('grant_points', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      {draft.is_free ? (
        <Field label="每日对话次数" hint="免费套餐由全局配置控制"><div className={`${inputCls} opacity-60`} style={inputStyle}>全局配置 {freeDailyQuota ?? 0} 次/天（在系统设置中修改）</div></Field>
      ) : (
        <Field label="每日对话次数" hint="空 = 不限，积分包按积分消耗"><input type="number" min="0" value={f.daily_quota ?? ''} onChange={e => setFeature('daily_quota', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      )}
      <Field label="会话数上限" hint="聊天会话数"><input type="number" min="0" value={f.max_chat_sessions ?? ''} onChange={e => setFeature('max_chat_sessions', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <Field label="文件数上限" hint="单个会话可上传文件数"><input type="number" min="0" value={f.max_chat_files ?? ''} onChange={e => setFeature('max_chat_files', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <Field label="并发数" hint="同时进行的对话请求数"><input type="number" min="1" value={draft.max_concurrent_requests ?? ''} onChange={e => set('max_concurrent_requests', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <Field label="排序" hint="数值小的靠前"><input type="number" value={draft.sort_order ?? ''} onChange={e => set('sort_order', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <Field label="在售状态" hint="取消勾选 = 用户端显示暂售罄"><label className="flex h-[38px] items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={Boolean(draft.enabled)} onChange={e => set('enabled', e.target.checked)} /> 在售</label></Field>
      <Field label="允许模型" hint="逗号分隔，空 = 全部可用"><input value={draft.allowed_models ?? ''} onChange={e => set('allowed_models', e.target.value)} className={inputCls} style={inputStyle} /></Field>
      <div className="md:col-span-4 flex flex-wrap gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {[['web_search', '联网搜索'], ['file_upload', '文件上传'], ['file_write', '文件写入']].map(([key, label]) => <label key={key} className="flex items-center gap-1.5"><input type="checkbox" checked={Boolean(f[key])} onChange={e => setFeature(key, e.target.checked)} /> {label}</label>)}
      </div>
      <Field wide label="说明"><textarea rows="2" value={draft.description ?? ''} onChange={e => set('description', e.target.value)} className={`${inputCls} resize-none`} style={inputStyle} /></Field>
    </div>
  )
}

function Field({ label, hint, wide, children }) {
  return <label className={`block min-w-0 ${wide ? 'md:col-span-4' : 'md:col-span-1'}`}>
    <span className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>{label}{hint && <span className="ml-1 opacity-60">（{hint}）</span>}</span>
    {children}
  </label>
}

function Section({ title, children }) { return <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}><div className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--text-primary)', background: 'var(--bg-ai-bubble)' }}>{title}</div>{children}</div> }
function Table({ headers, rows }) { return <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: 'var(--bg-card)' }}>{headers.map(h => <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>{row.map((cell, j) => <td key={j} className="px-3 py-2">{cell}</td>)}</tr>)}</tbody></table></div> }

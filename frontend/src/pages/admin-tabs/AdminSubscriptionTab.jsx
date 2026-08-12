import { useEffect, useState } from 'react'
import { adminAPI } from '../../api'

const emptyPlan = { code: '', name: '', description: '', price_rmb: 0, cycle_days: 30, grant_points: 0, features: { web_search: true, file_upload: true, file_write: true, max_tool_calls: 10, max_chat_sessions: 100, max_chat_files: 20 }, allowed_models: [], max_concurrent_requests: 1, enabled: true, is_free: false, sort_order: 0 }

export default function AdminSubscriptionTab() {
  const [plans, setPlans] = useState([])
  const [orders, setOrders] = useState([])
  const [subscriptions, setSubscriptions] = useState([])
  const [usage, setUsage] = useState(null)
  const [prices, setPrices] = useState([])
  const [draft, setDraft] = useState(emptyPlan)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [p, o, s, u, m] = await Promise.all([adminAPI.subscriptionPlans(), adminAPI.subscriptionOrders(), adminAPI.subscriptions(), adminAPI.subscriptionUsage(), adminAPI.modelPrices()])
      setPlans(p.data?.items || [])
      setOrders(o.data?.items || [])
      setSubscriptions(s.data?.items || [])
      setUsage(u.data)
      setPrices(m.data?.items || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { Promise.resolve().then(load) }, [])
  const savePlan = async () => {
    const data = { ...draft, allowed_models: String(draft.allowed_models || '').split(/[\s,]+/).filter(Boolean) }
    if (editingId) await adminAPI.updateSubscriptionPlan(editingId, data)
    else await adminAPI.createSubscriptionPlan(data)
    setDraft(emptyPlan); setEditingId(null); load()
  }
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
    <div className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
      <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{editingId ? '编辑套餐' : '新增套餐'}</div>
      <div className="grid gap-2 md:grid-cols-4">
        {[['code', '标识'], ['name', '名称'], ['price_rmb', '价格'], ['grant_points', '周期积分'], ['cycle_days', '周期天数'], ['max_concurrent_requests', '并发数'], ['allowed_models', '允许模型（逗号分隔）']].map(([key, placeholder]) => <input key={key} value={draft[key]} placeholder={placeholder} onChange={e => setDraft(v => ({ ...v, [key]: e.target.value }))} className="px-3 py-2 rounded-2xl text-xs border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />)}
        <input value={draft.description} placeholder="说明" onChange={e => setDraft(v => ({ ...v, description: e.target.value }))} className="px-3 py-2 rounded-2xl text-xs border outline-none md:col-span-2" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
      </div>
      <div className="flex gap-3 mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {[['web_search', '联网'], ['file_upload', '上传'], ['file_write', '写文件']].map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(draft.features?.[key])} onChange={e => setDraft(v => ({ ...v, features: { ...v.features, [key]: e.target.checked } }))} /> {label}</label>)}
        <button onClick={savePlan} className="ml-auto px-3 py-1.5 rounded-2xl text-white" style={{ background: 'var(--accent)' }}>{editingId ? '保存' : '新增'}</button>
      </div>
    </div>
    <Section title="套餐管理"><Table headers={['名称', '价格', '积分', '权益', '操作']} rows={plans.map(plan => [plan.name, `¥${plan.price_rmb}`, plan.grant_points, [plan.features?.web_search && '联网', plan.features?.file_upload && '上传', plan.features?.file_write && '写文件'].filter(Boolean).join(' / ') || '-', <div className="flex gap-2" key="ops"><button onClick={() => { setEditingId(plan.id); setDraft({ ...plan, allowed_models: (plan.allowed_models || []).join(',') }) }}>编辑</button><button onClick={() => adminAPI.disableSubscriptionPlan(plan.id).then(load)}>下架</button></div>])} /></Section>
    <Section title="订阅订单"><Table headers={['订单', '用户', '套餐', '金额', '状态', '操作']} rows={orders.map(order => [order.order_no, order.username || order.user_id, order.plan_name, `¥${order.amount_rmb}`, order.status, <div className="flex gap-2" key="ops">{order.status === 'pending' && <><button onClick={() => review(order, 'approve')}>通过</button><button onClick={() => review(order, 'reject')}>驳回</button></>} {order.status === 'approved' && <button onClick={() => review(order, 'refund')}>退款</button>}</div>])} /></Section>
    <Section title="用户订阅"><Table headers={['用户', '套餐', '周期积分', '到期', '状态', '操作']} rows={subscriptions.map(item => [item.username || item.user_id, item.plan_name, `${item.remaining_points ?? 0} / ${item.granted_points ?? 0}`, item.period_end ? new Date(item.period_end).toLocaleString('zh-CN') : '-', item.status, <div className="flex gap-2" key="ops"><button onClick={() => operate(item, 'grant')}>补发</button><button onClick={() => operate(item, 'extend')}>续期</button></div>])} /></Section>
    <Section title="模型价格"><Table headers={['模型', '输入积分/千 Token', '输出积分/千 Token', '版本数']} rows={prices.map(item => [item.model_id, item.points_per_1k?.input ?? '-', item.points_per_1k?.output ?? '-', item.versions?.length ?? 0])} /></Section>
  </div>
}

function Section({ title, children }) { return <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}><div className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--text-primary)', background: 'var(--bg-ai-bubble)' }}>{title}</div>{children}</div> }
function Table({ headers, rows }) { return <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ background: 'var(--bg-card)' }}>{headers.map(h => <th key={h} className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>{row.map((cell, j) => <td key={j} className="px-3 py-2 whitespace-nowrap">{cell}</td>)}</tr>)}</tbody></table></div> }

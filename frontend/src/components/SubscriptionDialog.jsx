import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { configAPI, pointsAPI, subscriptionAPI } from '../api'
import { readUser } from '../auth'
import { useAppDialog } from './AppDialogProvider'
import RechargePayModal from './RechargePayModal'

const channelLabel = { alipay: '支付宝', wechat: '微信' }

const formatDate = ts => {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const formatPoints = n => (Number(n) ?? 0).toLocaleString()

export default function SubscriptionDialog({ open, onClose }) {
  const dialog = useAppDialog()
  const navigate = useNavigate()
  const [plans, setPlans] = useState([])
  const [subscription, setSubscription] = useState(null)
  const [loading, setLoading] = useState(false)
  // 支付（复用积分支持的支付交互：渠道 + 二维码 + 倒计时 + 轮询）
  const [payConfig, setPayConfig] = useState({ alipay_pay_qr_url: '', wechat_pay_qr_url: '' })
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [channel, setChannel] = useState('alipay')
  const [creatingPay, setCreatingPay] = useState(false)
  const [payRequest, setPayRequest] = useState(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setSelectedPlan(null)
    setPayRequest(null)
    configAPI.get().then(({ data }) => {
      setPayConfig({
        alipay_pay_qr_url: data.alipay_pay_qr_url || '',
        wechat_pay_qr_url: data.wechat_pay_qr_url || '',
      })
    }).catch(() => {})
    Promise.allSettled([subscriptionAPI.plans(), subscriptionAPI.me()]).then(([p, m]) => {
      setPlans(p.status === 'fulfilled' ? (p.value.data?.items || []) : [])
      setSubscription(m.status === 'fulfilled' ? (m.value.data || null) : null)
    }).finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const hasPlan = subscription?.plan && !subscription.plan.is_free

  const refreshMe = () => subscriptionAPI.me().then(res => setSubscription(res.data)).catch(() => {})

  const startPay = plan => {
    if (!readUser()) {
      dialog.alert('请先登录')
      onClose()
      navigate('/login')
      return
    }
    if (plan.is_free) {
      dialog.alert('当前已在使用免费套餐，无需购买。')
      onClose()
      return
    }
    // 默认选中已配置收款码的渠道
    if (!payConfig.alipay_pay_qr_url && payConfig.wechat_pay_qr_url) setChannel('wechat')
    else setChannel('alipay')
    setSelectedPlan(plan)
  }

  const submitPay = async () => {
    if (!selectedPlan) return
    const qrUrl = channel === 'alipay' ? payConfig.alipay_pay_qr_url : payConfig.wechat_pay_qr_url
    if (!qrUrl) {
      dialog.alert(`${channelLabel[channel]}收款码未配置，请切换支付方式`)
      return
    }
    setCreatingPay(true)
    try {
      // 复用积分支持的支付流程：创建充值请求并绑定套餐，支付卡片弹窗 + 自动轮询到账
      const { data } = await pointsAPI.createRechargeRequest({
        channel,
        plan_id: selectedPlan.id,
        amount: Number(selectedPlan.price_rmb),
        points: Number(selectedPlan.grant_points || 0),
        invite_code: '',
      })
      setPayRequest({ ...data, channel })
    } catch (e) {
      dialog.alert(e.message || '创建支付请求失败')
    } finally {
      setCreatingPay(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[93] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedPlan ? '套餐支付' : '选择套餐'}</h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
              {selectedPlan
                ? `应付 ¥${selectedPlan.price_rmb} · ${selectedPlan.name}`
                : hasPlan
                  ? `当前套餐：${subscription.plan.name}${subscription.cycle?.period_end ? ` · 周期至 ${formatDate(subscription.cycle.period_end)}` : ''}`
                  : '当前为免费套餐，升级解锁更多权益'}
            </p>
          </div>
          <button onClick={onClose} aria-label="关闭" className="p-1.5 rounded-lg hover:bg-bg-hover shrink-0" style={{ color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>
        {/* 内容 */}
        <div className="overflow-y-auto p-5">
          {selectedPlan ? (
            /* 支付卡片前置步骤：复用积分支持的交互（渠道 + 收款码 + 确认支付） */
            <div className="max-w-sm mx-auto">
              <button
                type="button"
                onClick={() => setSelectedPlan(null)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs hover:bg-bg-hover"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ArrowLeft size={14} /> 返回套餐
              </button>
              <div className="mt-3 rounded-2xl border p-5 text-center" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                <div className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>{selectedPlan.name}</div>
                <div className="text-3xl font-bold leading-none tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  <span className="text-base font-semibold mr-0.5" style={{ color: 'var(--text-secondary)' }}>¥</span>{selectedPlan.price_rmb}
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                {['alipay', 'wechat'].map(c => {
                  const configured = c === 'alipay' ? payConfig.alipay_pay_qr_url : payConfig.wechat_pay_qr_url
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setChannel(c)}
                      disabled={!configured}
                      className={`flex-1 px-3 py-2 rounded-2xl text-xs font-medium transition-all disabled:opacity-40 ${channel === c ? 'text-white' : 'hover:bg-bg-hover'}`}
                      style={channel === c ? { background: 'var(--accent)' } : { border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    >
                      {channelLabel[c]}{!configured ? '（未配置）' : ''}
                    </button>
                  )
                })}
              </div>
              {payConfig[`${channel}_pay_qr_url`] ? (
                <div className="mt-4 text-center">
                  <img src={payConfig[`${channel}_pay_qr_url`]} alt="收款二维码" className="mx-auto w-36 h-36 object-contain rounded-xl border" style={{ borderColor: 'var(--border-color)' }} />
                  <div className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>请使用{channelLabel[channel]}扫码支付 ¥{selectedPlan.price_rmb}</div>
                </div>
              ) : (
                <div className="mt-4 text-center text-xs" style={{ color: 'var(--color-warning)' }}>{channelLabel[channel]}收款码未配置，请切换其他支付方式</div>
              )}
              <button
                type="button"
                disabled={creatingPay}
                onClick={submitPay}
                className="mt-4 w-full px-4 py-2.5 rounded-2xl text-sm font-medium text-white transition-all disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {creatingPay ? '提交中...' : `提交并获取支付二维码（¥${selectedPlan.price_rmb}）`}
              </button>
              <div className="mt-3 text-center text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>
                支付完成后系统会自动更新到账状态，审核通过后套餐即时生效。
              </div>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
            </div>
          ) : plans.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--text-secondary)' }}>当前暂无可购买的套餐</div>
          ) : (
            <div className="space-y-7">
              {[
                { id: 'member', eyebrow: 'Membership', title: '会员订阅', subtitle: '按周期付费，每日高额对话 + 完整功能', plans: plans.filter(p => !p.is_free && (p.features?.package_type || 'membership') !== 'credits') },
                { id: 'credits', eyebrow: 'Credits', title: '积分充值', subtitle: '一次购买，按需使用', plans: plans.filter(p => !p.is_free && p.features?.package_type === 'credits') },
              ].map(section => section.plans.length > 0 && (
                <div key={section.id}>
                  <div className="mb-3 flex flex-wrap items-baseline gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.2em]" style={{ color: 'var(--text-secondary)' }}>{section.eyebrow}</span>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{section.title}</h3>
                    <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{section.subtitle}</span>
                  </div>
                  <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                    {section.plans.map(plan => {
                      const isCurrent = hasPlan && plan.id === subscription.plan.id
                      const orig = Number(plan.features?.original_price_rmb)
                      const price = Number(plan.price_rmb)
                      const showOrig = Number.isFinite(orig) && orig > price
                      const discount = showOrig ? `${((price / orig) * 10).toFixed(1).replace(/\.0$/, '')}折` : null
                      const isCredit = plan.features?.package_type === 'credits'
                      return (
                        <div key={plan.id} className="flex flex-col p-4 rounded-2xl border" style={{ borderColor: isCurrent ? 'var(--accent)' : 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{plan.name}</span>
                            {discount && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>{discount}</span>}
                          </div>
                          <div className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>{plan.description || '按周期发放积分和功能权益'}</div>
                          <div className="mt-2 flex flex-wrap items-baseline gap-1.5">
                            {plan.is_free ? (
                              <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>免费</span>
                            ) : (
                              <>
                                <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>¥</span>
                                <span className="text-xl font-bold leading-none tabular-nums" style={{ color: 'var(--text-primary)' }}>{price}</span>
                                {showOrig && <span className="text-[10px] tabular-nums line-through" style={{ color: 'var(--text-secondary)' }}>¥{orig}</span>}
                              </>
                            )}
                          </div>
                          {!plan.is_free && (
                            <div className="mt-2 text-[11px] leading-5" style={{ color: 'var(--text-primary)' }}>
                              {isCredit ? (
                                <span><span className="tabular-nums font-semibold">{formatPoints(plan.grant_points)}</span> 积分</span>
                              ) : (
                                <>
                                  <span>每日对话 <span className="tabular-nums font-semibold">{plan.features?.daily_quota == null ? '不限' : `${Number(plan.features.daily_quota).toLocaleString()} 次`}</span></span>
                                  <span className="mx-1.5" style={{ color: 'var(--text-secondary)' }}>·</span>
                                  <span>{plan.cycle_days >= 36500 ? '长期有效' : `${plan.cycle_days} 天有效`}</span>
                                </>
                              )}
                            </div>
                          )}
                          <div className="mt-1 text-[11px] flex-1" style={{ color: 'var(--text-secondary)' }}>
                            {[plan.features?.web_search && '联网搜索', plan.features?.file_upload && '文件上传', plan.features?.file_write && '文件写入'].filter(Boolean).join(' · ') || '基础功能'}
                          </div>
                          <button
                            type="button"
                            onClick={() => startPay(plan)}
                            className={`mt-4 w-full flex items-center justify-center px-3 py-2 rounded-2xl text-sm font-medium transition-all ${isCurrent ? 'opacity-60' : 'text-white'}`}
                            style={isCurrent ? { border: '1px solid var(--border-color)', color: 'var(--text-secondary)', background: 'transparent' } : { background: 'var(--accent)' }}
                          >
                            {plan.is_free ? '免费使用' : isCurrent ? '当前套餐' : '购买 / 续费'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {!selectedPlan && (
          <div className="px-5 py-3 border-t text-xs" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            选择套餐后进入支付，支付到账后套餐即时生效。
          </div>
        )}
      </div>
      {/* 支付卡片：复用积分支持的支付交互（倒计时 + 二维码 + 订单号 + 轮询到账） */}
      <RechargePayModal
        open={!!payRequest}
        onClose={() => setPayRequest(null)}
        request={payRequest}
        payConfig={payConfig}
        mode="subscription"
        planName={selectedPlan?.name || ''}
        onRenew={submitPay}
        onSuccess={refreshMe}
      />
    </div>
  )
}

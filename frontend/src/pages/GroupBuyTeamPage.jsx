import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Users, CheckCircle, Clock, Share2, AlertCircle, LogIn } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import { useAppDialog } from '../components/AppDialogProvider'
import RechargePayModal from '../components/RechargePayModal'
import { configAPI, groupBuyAPI } from '../api'
import { readUser } from '../auth'

const channelLabel = { alipay: '支付宝', wechat: '微信' }

const statusMeta = {
  0: { label: '拼团中', color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 14%, transparent)' },
  1: { label: '已成团', color: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 14%, transparent)' },
  2: { label: '已过期', color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 14%, transparent)' },
}

// 兼容 ISO 与 'YYYY-MM-DD HH:mm:ss'（视为 +08:00）两种时间格式
function parseTime(s) {
  if (!s) return 0
  const withTz = s.includes('T')
    ? (s.includes('+') || s.includes('Z') ? s : `${s}+08:00`)
    : `${s.replace(' ', 'T')}+08:00`
  const t = new Date(withTz).getTime()
  return Number.isFinite(t) ? t : 0
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export default function GroupBuyTeamPage() {
  const { teamId } = useParams()
  const navigate = useNavigate()
  const dialog = useAppDialog()
  const user = readUser()
  const [team, setTeam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [payConfig, setPayConfig] = useState({ alipay_pay_qr_url: '', wechat_pay_qr_url: '' })
  // 支付前置弹窗（确认 + 渠道选择），复用积分支持的支付交互
  const [payAction, setPayAction] = useState(null) // { type: 'join' | 'upgrade', channel }
  const [creatingPay, setCreatingPay] = useState(false)
  const [payRequest, setPayRequest] = useState(null)
  const timerRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await groupBuyAPI.team(teamId)
      setTeam(data)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
      setTeam(null)
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => {
    configAPI.get().then(({ data }) => {
      setPayConfig({
        alipay_pay_qr_url: data.alipay_pay_qr_url || '',
        wechat_pay_qr_url: data.wechat_pay_qr_url || '',
      })
    }).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // 拼团中：每秒刷新倒计时，结束时自动刷新接口拿最新状态
  useEffect(() => {
    if (!team || Number(team.status) !== 0) return
    setNow(Date.now())
    timerRef.current = setInterval(() => {
      const remain = parseTime(team.expire_at) - Date.now()
      if (remain <= 0) {
        clearInterval(timerRef.current)
        load()
      } else {
        setNow(Date.now())
      }
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [team, load])

  const handlePaySuccess = useCallback(() => {
    setPayRequest(null)
    load() // 刷新团队数据（my_paid 等）
    window.dispatchEvent(new Event('subscriptions-updated'))
  }, [load])

  const submitPay = async () => {
    if (!payAction) return
    const qrUrl = payAction.channel === 'alipay' ? payConfig.alipay_pay_qr_url : payConfig.wechat_pay_qr_url
    if (!qrUrl) {
      dialog.alert(`${channelLabel[payAction.channel]}收款码未配置，请切换支付方式`)
      return
    }
    setCreatingPay(true)
    try {
      // 复用积分支持的支付流程：创建支付请求（拼团参团 / 补差价升级）→ 支付卡片弹窗 + 自动轮询到账
      const { data } = payAction.type === 'join'
        ? await groupBuyAPI.createTeamAndPay(team.group_buy_id, { channel: payAction.channel })
        : await groupBuyAPI.upgrade(team.id, { channel: payAction.channel })
      setPayRequest({
        id: data.request_id,
        channel: payAction.channel,
        amount: Number(data.amount) || 0,
        remaining_seconds: Number(data.remaining_seconds) || 600,
        points: 0,
        tx_no: data.tx_no || '',
        discount: Number(data.discount) || 0,
      })
      setPayAction(null)
    } catch (e) {
      dialog.alert(e.message || '创建支付请求失败')
    } finally {
      setCreatingPay(false)
    }
  }

  const invite = async () => {
    const url = `${window.location.origin}/group-buy/team/${team.id}`
    const text = `我在「${team.package_name}」发起拼团，拼团价 ¥${team.group_price}，还差 ${Math.max(0, team.group_size - team.paid_count)} 人成团，一起来拼吧！`
    if (navigator.share) {
      try {
        await navigator.share({ title: `${team.package_name}拼团`, text, url })
        return
      } catch (e) { if (e?.name === 'AbortError') return }
    }
    try {
      await navigator.clipboard.writeText(url)
      dialog.alert('团队链接已复制，快分享给好友一起拼团吧')
    } catch {
      dialog.alert('复制失败，请手动复制页面链接发送给好友')
    }
  }

  const goLogin = () => navigate(`/login?redirect=${encodeURIComponent(`/group-buy/team/${teamId}`)}`)

  const renderMember = (m) => {
    const isVirtual = Boolean(m.is_virtual)
    const isCreator = Boolean(m.is_creator)
    const isSelf = Boolean(m.is_self)
    const name = isVirtual ? (m.virtual_nickname || '虚位以待') : (m.virtual_nickname || m.nickname || '成员')
    return (
      <div key={m.id ?? m.user_id ?? name} className="flex flex-col items-center gap-1.5">
        <div className="relative">
          <div
            className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-base font-semibold ${isVirtual ? 'border-2 border-dashed' : 'border'}`}
            style={{
              borderColor: isSelf ? 'var(--accent)' : 'var(--border-color)',
              background: isVirtual ? 'transparent' : 'color-mix(in srgb, var(--accent) 12%, var(--bg-card))',
              color: isVirtual ? 'var(--text-secondary)' : 'var(--text-primary)',
              boxShadow: isSelf ? '0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent)' : 'none',
            }}
          >
            {m.virtual_avatar ? <img src={m.virtual_avatar} alt="" className="h-full w-full object-cover" /> : (isVirtual ? '🧩' : String(name).slice(0, 1))}
          </div>
          {isCreator && <span className="absolute -right-1.5 -top-1.5 text-sm" title="团长">👑</span>}
          {isSelf && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-px text-[9px] font-semibold text-white" style={{ background: 'var(--accent)' }}>我</span>
          )}
        </div>
        <span className="max-w-[76px] truncate text-[11px]" style={{ color: isSelf ? 'var(--accent)' : 'var(--text-secondary)' }}>{name}</span>
      </div>
    )
  }

  const renderActions = () => {
    if (!user) {
      return (
        <button
          type="button"
          onClick={goLogin}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium text-white transition-all hover:brightness-105 active:scale-[0.99]"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}
        >
          <LogIn size={16} /> 登录后加入
        </button>
      )
    }
    const status = Number(team.status)
    if (status === 1) {
      return (
        <button
          type="button"
          onClick={() => navigate('/chat')}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium text-white transition-all hover:brightness-105 active:scale-[0.99]"
          style={{ background: 'var(--color-success)' }}
        >
          <CheckCircle size={16} /> 去使用
        </button>
      )
    }
    if (status === 0) {
      if (team.my_paid) {
        return (
          <button
            type="button"
            onClick={invite}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium text-white transition-all hover:brightness-105 active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}
          >
            <Share2 size={16} /> 邀请好友拼团
          </button>
        )
      }
      return (
        <button
          type="button"
          onClick={() => setPayAction({ type: 'join', channel: payConfig.alipay_pay_qr_url ? 'alipay' : 'wechat' })}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium text-white transition-all hover:brightness-105 active:scale-[0.99]"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}
        >
          <Users size={16} /> 立即加入拼团 ¥{team.group_price}
        </button>
      )
    }
    // status === 2 已过期
    if (team.my_paid) {
      const diff = Math.max(0, Number(team.original_price) - Number(team.group_price))
      return (
        <button
          type="button"
          onClick={() => setPayAction({ type: 'upgrade', channel: payConfig.alipay_pay_qr_url ? 'alipay' : 'wechat' })}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium text-white transition-all hover:brightness-105 active:scale-[0.99]"
          style={{ background: 'linear-gradient(135deg, var(--color-warning), var(--color-warning))' }}
        >
          <AlertCircle size={16} /> 补差价升级 ¥{diff}
        </button>
      )
    }
    return (
      <div className="rounded-2xl border px-4 py-3 text-center text-xs" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', background: 'var(--bg-ai-bubble)' }}>
        该团已过期，未成团不扣费，欢迎参加其他进行中的拼团。
      </div>
    )
  }

  if (loading && !team) {
    return (
      <MainLayout>
        <div className="flex min-h-[50vh] items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>加载中...</div>
      </MainLayout>
    )
  }

  if (loadFailed || !team) {
    return (
      <MainLayout>
        <div className="mx-auto max-w-xl px-4 py-20 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <div className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>拼团不存在或已结束</div>
          <div className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>该拼团链接可能已失效，去看看其他进行中的拼团吧</div>
          <button
            type="button"
            onClick={() => navigate('/chat')}
            className="rounded-2xl px-5 py-2.5 text-sm font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            返回聊天
          </button>
        </div>
      </MainLayout>
    )
  }

  const status = Number(team.status)
  const meta = statusMeta[status] || statusMeta[2]
  const remain = Math.max(0, Number(team.group_size) - Number(team.paid_count))
  const percent = Math.min(100, Math.round((Number(team.paid_count) / Math.max(1, Number(team.group_size))) * 100))
  const memberCount = Array.isArray(team.members) ? team.members.length : 0
  const emptySlots = Math.max(0, Number(team.group_size) - memberCount)
  const expireAt = parseTime(team.expire_at)
  const remainMs = expireAt - now
  const countdownText = status === 0 && remainMs > 0 ? formatCountdown(remainMs) : '00:00'

  return (
    <MainLayout>
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* 返回 */}
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs hover:bg-bg-hover"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={14} /> 返回
        </button>

        {/* 顶部：套餐名 + 状态徽章 + 倒计时 */}
        <div className="mt-3 rounded-2xl border p-5" style={{ borderColor: 'var(--border-color)', background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, var(--bg-card)), var(--bg-card) 65%)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{team.package_name}拼团</h1>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
            {status === 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums" style={{ background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)', color: 'var(--color-warning)' }}>
                <Clock size={11} /> 剩余 {countdownText}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="flex items-baseline gap-1">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>拼团价</span>
              <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>¥</span>
              <span className="text-3xl font-bold leading-none tabular-nums" style={{ color: 'var(--accent)' }}>{team.group_price}</span>
            </span>
            <span className="text-xs tabular-nums line-through" style={{ color: 'var(--text-secondary)' }}>原价 ¥{team.original_price}</span>
            {Number(team.original_price) > Number(team.group_price) && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
                立省 ¥{Math.max(0, Number(team.original_price) - Number(team.group_price))}
              </span>
            )}
          </div>

          {/* 成团进度 */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span style={{ color: 'var(--text-secondary)' }}>成团进度</span>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {team.paid_count}/{team.group_size} 人
                {remain > 0 && <span style={{ color: 'var(--accent)' }}> · 还差 {remain} 人成团</span>}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-hover)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${percent}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent-hover))' }} />
            </div>
          </div>

          {/* 成员网格 */}
          <div className="mt-5">
            <div className="mb-2.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <Users size={13} style={{ color: 'var(--accent)' }} /> 团队成员
            </div>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6">
              {(team.members || []).map(renderMember)}
              {Array.from({ length: emptySlots }).map((_, i) => (
                <div key={`slot-${i}`} className="flex flex-col items-center gap-1.5">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed text-lg opacity-60" style={{ borderColor: 'var(--border-color)' }}>
                    <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>?</span>
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>虚位以待</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 操作区 */}
        <div className="mt-4">{renderActions()}</div>

        {/* 拼团规则 + FAQ */}
        <div className="mt-6 rounded-2xl border p-5" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
          <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>拼团规则</div>
          <ul className="space-y-2 text-xs leading-6" style={{ color: 'var(--text-secondary)' }}>
            <li>· 拼团价：活动期间可按拼团优惠价参团，成团后套餐权益即时生效。</li>
            <li>· 成团时限：拼团需在倒计时结束前凑齐人数，超时未成团则本团结束。</li>
            <li>· 未成团补差价：拼团结束后，已参团用户可补差价（原价 − 拼团价）升级为直接购买，权益立即生效；不升级的用户可联系客服处理退款。</li>
            <li>· 每位用户同一拼团活动仅可参与一个团队；拼团成功后不可重复参团。</li>
          </ul>
          <div className="mt-4 text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>常见问题</div>
          <ul className="space-y-2 text-xs leading-6" style={{ color: 'var(--text-secondary)' }}>
            <li><span className="font-medium" style={{ color: 'var(--text-primary)' }}>Q：拼团需要我做什么？</span><br />A：点击「立即加入拼团」完成支付即参团成功，邀请好友加入同一团队，人数凑齐即成团。</li>
            <li><span className="font-medium" style={{ color: 'var(--text-primary)' }}>Q：成团后如何生效？</span><br />A：成团后套餐权益立即发放，可在聊天页直接使用。</li>
            <li><span className="font-medium" style={{ color: 'var(--text-primary)' }}>Q：没拼成功怎么办？</span><br />A：已支付的用户可补差价升级为直接购买，权益立即生效；也可联系客服处理退款。</li>
            <li><span className="font-medium" style={{ color: 'var(--text-primary)' }}>Q：虚拟成员是什么？</span><br />A：为提升成团效率，平台会加入虚拟成员协助凑团，不影响你的实际权益。</li>
          </ul>
        </div>
      </div>

      {/* 支付前置弹窗：确认 + 渠道选择（复用积分支持的支付交互） */}
      {payAction && (
        <div className="fixed inset-0 z-[93] flex items-center justify-center p-4" onClick={() => { if (!creatingPay) setPayAction(null) }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
          <div
            className="relative w-full max-w-sm rounded-2xl border p-5"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {payAction.type === 'join' ? '确认加入拼团' : '补差价升级'}
            </div>
            <div className="mt-2 rounded-2xl border p-4 text-center" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, var(--bg-card)), var(--bg-card))', borderColor: 'color-mix(in srgb, var(--accent) 25%, var(--border-color))' }}>
              <div className="text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>{team.package_name} · {payAction.type === 'join' ? '拼团价' : '补差价'}</div>
              <div className="text-3xl font-bold leading-none tabular-nums" style={{ color: 'var(--text-primary)' }}>
                <span className="text-base font-semibold mr-0.5" style={{ color: 'var(--text-secondary)' }}>¥</span>
                {payAction.type === 'join' ? team.group_price : Math.max(0, Number(team.original_price) - Number(team.group_price))}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              {['alipay', 'wechat'].map(c => {
                const configured = c === 'alipay' ? payConfig.alipay_pay_qr_url : payConfig.wechat_pay_qr_url
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPayAction(a => ({ ...a, channel: c }))}
                    disabled={!configured}
                    className={`flex-1 px-3 py-2 rounded-2xl text-xs font-medium transition-all disabled:opacity-40 ${payAction.channel === c ? 'text-white' : 'hover:bg-bg-hover'}`}
                    style={payAction.channel === c ? { background: 'var(--accent)' } : { border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    {channelLabel[c]}{!configured ? '（未配置）' : ''}
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              disabled={creatingPay}
              onClick={submitPay}
              className="mt-4 w-full px-4 py-2.5 rounded-2xl text-sm font-medium text-white transition-all disabled:opacity-50"
              style={{ background: 'var(--accent)' }}
            >
              {creatingPay ? '提交中...' : '提交并获取支付二维码'}
            </button>
            <div className="mt-3 text-center text-[11px] leading-5" style={{ color: 'var(--text-secondary)' }}>
              支付完成后系统会自动更新参团状态，成团后套餐即时生效。
            </div>
          </div>
        </div>
      )}

      {/* 支付卡片：复用积分支持的支付交互（倒计时 + 二维码 + 订单号 + 轮询到账） */}
      <RechargePayModal
        open={!!payRequest}
        onClose={() => setPayRequest(null)}
        request={payRequest}
        payConfig={payConfig}
        mode="subscription"
        planName={`${team.package_name}拼团`}
        onRenew={submitPay}
        onSuccess={handlePaySuccess}
      />
    </MainLayout>
  )
}

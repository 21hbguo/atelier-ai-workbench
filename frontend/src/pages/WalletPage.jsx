import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Coins, ArrowUpCircle, ArrowDownCircle, RefreshCw, User, Mail,
  Gift, Wallet, KeyRound, HeartHandshake, X, CheckCircle
} from 'lucide-react'
import MainLayout from '../components/MainLayout'
import Pagination from '../components/Pagination'
import { useAppDialog } from '../components/AppDialogProvider'
import api, { pointsAPI, accountAPI, chatAPI, configAPI, subscriptionAPI } from '../api'
import { readUser } from '../auth'

const typeMap = {
  register_bonus: { label: '注册赠送', color: 'var(--accent)' },
  daily_checkin: { label: '每日签到', color: 'var(--accent)' },
  generate_consume: { label: '生成消耗', color: 'var(--color-error)' },
  prompt_optimize: { label: '简单优化', color: 'var(--color-error)' },
  prompt_optimize_refine: { label: '精细优化', color: 'var(--color-error)' },
  image_expire_extend: { label: '延长有效期', color: 'var(--color-error)' },
  generate_refund: { label: '生成退还', color: 'var(--color-success)' },
  chat_token_adjust: { label: '对话补差', color: 'var(--color-error)' },
  chat_refund: { label: '对话退还', color: 'var(--color-success)' },
  optimize_refund: { label: '优化退还', color: 'var(--color-success)' },
  redeem_code: { label: '积分发放', color: 'var(--accent)' },
  admin_grant: { label: '管理员调整', color: '#8B7BA8' },
  migration: { label: '历史补偿', color: 'var(--accent)' },
  migration_bonus: { label: '历史补偿', color: 'var(--accent)' },
  recharge_pending: { label: '捐赠待审核', color: 'var(--color-warning)' },
  recharge_refund: { label: '回退发放', color: 'var(--color-error)' },
  invite_register_reward: { label: '邀请注册奖励', color: 'var(--color-success)' },
  invite_recharge_bonus: { label: '支持加赠', color: 'var(--color-success)' },
  invite_recharge_rebate: { label: '邀请奖励', color: 'var(--color-success)' },
}

const defaultRechargePackages = [
  { amount: 10, points: 100, label: '轻量支持' },
  { amount: 30, points: 300, label: '常用支持' },
  { amount: 50, points: 500, label: '高频支持' },
]

const channelLabel = { wechat: '微信', alipay: '支付宝' }

const statusMap = {
  pending: { label: '待审核', color: 'var(--color-warning)' },
  approved: { label: '已发放', color: 'var(--color-success)' },
  rejected: { label: '未通过', color: 'var(--color-error)' },
  refunded: { label: '已回退发放', color: 'var(--color-error)' },
  expired: { label: '已过期', color: 'var(--text-secondary)' },
}
function formatCountdown(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const min = Math.floor(safe / 60)
  const sec = String(safe % 60).padStart(2, '0')
  return `${min}:${sec}`
}
function getCountdownTone(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  if (safe <= 30) return 'danger'
  if (safe <= 120) return 'warn'
  return 'safe'
}

const tabList = [
  { key: 'subscription', label: '套餐与用量' },
  { key: 'records', label: '积分记录' },
  { key: 'donate', label: '捐赠支持' },
  { key: 'invite', label: '邀请中心' },
  { key: 'redeem', label: '兑换码' },
]

const formatTime = value => {
  const s = String(value || '')
  const withTz = s.includes('T')
    ? (s.includes('+') || s.includes('Z') ? s : s + '+08:00')
    : s ? s.replace(' ', 'T') + '+08:00' : ''
  return withTz ? new Date(withTz).toLocaleString('zh-CN') : '-'
}

const formatPoints = value => {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(4).replace(/\.?(0+)$/, '') : '0'
}

export default function WalletPage() {
  const dialog = useAppDialog()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = readUser()
  const [tab, setTab] = useState('records')
  const [points, setPoints] = useState(user?.points ?? 0)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const size = 15
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemLoading, setRedeemLoading] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState(null)
  const [payConfig, setPayConfig] = useState({
    wechat_pay_qr_url: '',
    alipay_pay_qr_url: '',
    donation_contact: '',
    manual_recharge_notice: '',
  })
  const [inviteConfig, setInviteConfig] = useState({
    invite_enabled: true,
    invite_register_reward_points: 20,
    invite_recharge_bonus_percent: 10,
    invite_recharge_rebate_percent: 10,
  })
  const [inviteConfigLoaded, setInviteConfigLoaded] = useState(false)
  const [rechargePackages, setRechargePackages] = useState(defaultRechargePackages)
  const [rechargeChannel, setRechargeChannel] = useState('alipay')
  const [packageIdx, setPackageIdx] = useState(0)
  const [rechargeAmount, setRechargeAmount] = useState(defaultRechargePackages[0].amount)
  const [rechargePoints, setRechargePoints] = useState(defaultRechargePackages[0].points)
  const [inviteCode, setInviteCode] = useState('')
  const [inviteInfo, setInviteInfo] = useState({
    invite_code: '',
    inviter_name: '',
    register_invite_code: '',
    summary: {
      invited_register_count: 0,
      total_rebate_points: 0,
      total_recharge_amount: 0,
      risk_hit_count: 0,
    },
  })
  const [inviteHistory, setInviteHistory] = useState([])
  const [inviteHistoryTotal, setInviteHistoryTotal] = useState(0)
  const [inviteGenerating, setInviteGenerating] = useState(false)
  const [submittingRecharge, setSubmittingRecharge] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  const [activeRequest, setActiveRequest] = useState(null)
  const [pollingStatus, setPollingStatus] = useState(null)
  const [successPayload, setSuccessPayload] = useState(null)
  const [countdown, setCountdown] = useState(0)
  const countdownRef = useRef(null)
  const pollingStartedRef = useRef(null)
  const [checkedInToday, setCheckedInToday] = useState(null)
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [rechargeMsg, setRechargeMsg] = useState(null)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const [modelLabelMap, setModelLabelMap] = useState({})
  const [inviteRuleSeen, setInviteRuleSeen] = useState(false)
  const [subscription, setSubscription] = useState(null)
  const [subscriptionUsage, setSubscriptionUsage] = useState(null)
  const [subscriptionPlans, setSubscriptionPlans] = useState([])
  const [subscriptionOrders, setSubscriptionOrders] = useState([])
  const [subscriptionPrices, setSubscriptionPrices] = useState([])
  const [subscriptionChannel, setSubscriptionChannel] = useState('alipay')
  const [subscriptionSubmitting, setSubscriptionSubmitting] = useState(false)
  const [subscriptionPayerName, setSubscriptionPayerName] = useState('')
  const [subscriptionTxNo, setSubscriptionTxNo] = useState('')
  const [subscriptionProofUrl, setSubscriptionProofUrl] = useState('')

  useEffect(() => {
    const requestedTab = searchParams.get('tab')
    if (tabList.some(item => item.key === requestedTab)) setTab(requestedTab)
  }, [searchParams])

  const selectTab = key => {
    setTab(key)
    setSearchParams(key === 'records' ? {} : { tab: key })
  }

  const fetchSubscription = async () => {
    try {
      const [me, usage, plans, orders, prices] = await Promise.all([
        subscriptionAPI.me(), subscriptionAPI.usage(), subscriptionAPI.plans(), subscriptionAPI.orders(), subscriptionAPI.modelPrices(),
      ])
      setSubscription(me.data)
      setSubscriptionUsage(usage.data)
      setSubscriptionPlans(plans.data?.items || [])
      setSubscriptionOrders(orders.data?.items || [])
      setSubscriptionPrices(prices.data?.items || [])
    } catch {}
  }

  const fetchData = async (p = 1) => {
    setLoading(true)
    try {
      const [balRes, txRes] = await Promise.all([
        pointsAPI.balance(),
        pointsAPI.transactions(p, size),
      ])
      setPoints(balRes.data.points)
      setTransactions(txRes.data.items || [])
      setTotal(txRes.data.total || 0)
      const u = readUser()
      if (u) {
        u.points = balRes.data.points
        localStorage.setItem('user', JSON.stringify(u))
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchData(page) }, [page])
  useEffect(() => { fetchSubscription() }, [])

  const handleSubscriptionOrder = async plan => {
    setSubscriptionSubmitting(true)
    try {
      await subscriptionAPI.createOrder({ plan_id: plan.id, channel: subscriptionChannel, payer_name: subscriptionPayerName, tx_no: subscriptionTxNo, proof_url: subscriptionProofUrl })
      await fetchSubscription()
      dialog.alert('订阅订单已创建，请按所选方式完成支付并上传凭证。')
    } catch (e) {
      dialog.alert(e.message || '创建订阅订单失败')
    } finally {
      setSubscriptionSubmitting(false)
    }
  }

  useEffect(() => {
    api.get('/config').then(({ data }) => {
      const packages = Array.isArray(data.recharge_packages) && data.recharge_packages.length
        ? data.recharge_packages
        : defaultRechargePackages
      setPayConfig({
        wechat_pay_qr_url: data.wechat_pay_qr_url || '',
        alipay_pay_qr_url: data.alipay_pay_qr_url || '',
        donation_contact: data.donation_contact || '',
        manual_recharge_notice: data.manual_recharge_notice || '支持 Atelier 持续承担模型、图床与服务器成本。你可自愿捐赠支持平台运行，审核通过后按页面公示档位赠送对应感谢积分。请备注账号并上传支付凭证，发放完成后不支持回退。',
      })
      setInviteConfig({
        invite_enabled: data?.invite_enabled !== false,
        invite_register_reward_points: Number(data?.invite_register_reward_points ?? 20),
        invite_recharge_bonus_percent: Number(data?.invite_recharge_bonus_percent ?? 10),
        invite_recharge_rebate_percent: Number(data?.invite_recharge_rebate_percent ?? 10),
      })
      setRechargePackages(packages)
      setPackageIdx(0)
      setRechargeAmount(Number(packages[0]?.amount || defaultRechargePackages[0].amount))
      setRechargePoints(Number(packages[0]?.points || defaultRechargePackages[0].points))
      setInviteConfigLoaded(true)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    pointsAPI.inviteInfo().then(({ data }) => {
      setInviteInfo(data || {})
      if (data?.invite_code) {
        const u = readUser()
        if (u) {
          u.invite_code = data.invite_code
          localStorage.setItem('user', JSON.stringify(u))
        }
      }
    }).catch(() => {})
    pointsAPI.inviteHistory(1, 20).then(({ data }) => {
      setInviteHistory(data?.items || [])
      setInviteHistoryTotal(data?.total || 0)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    pointsAPI.checkinStatus().then(({ data }) => {
      setCheckedInToday(data.checked_in_today)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    configAPI.models().then(({ data }) => {
      const rows = data?.models || []
      const m = {}
      for (const r of rows) m[r.model_id] = r.label || r.model_id
      setModelLabelMap(m)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    chatAPI.models().then(({ data }) => {
      const rows = data?.items || []
      const m = {}
      for (const r of rows) m[r.model_id] = r.label || r.model_id
      setModelLabelMap(prev => ({ ...prev, ...m }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const handleUpdate = () => {
      const u = readUser()
      if (u) setPoints(u.points ?? 0)
    }
    window.addEventListener('points-updated', handleUpdate)
    return () => window.removeEventListener('points-updated', handleUpdate)
  }, [])

  useEffect(() => {
    if (tab !== 'invite') {
      setInviteRuleSeen(false)
      return
    }
    if (!inviteConfigLoaded || inviteRuleSeen) return
    const registerReward = Math.max(0, Number(inviteConfig?.invite_register_reward_points || 0))
    const bonusPercent = Math.max(0, Number(inviteConfig?.invite_recharge_bonus_percent || 0))
    const rebatePercent = Math.max(0, Number(inviteConfig?.invite_recharge_rebate_percent || 0))
    dialog.alert(
      inviteConfig?.invite_enabled === false
        ? '邀请功能暂未开启，请以后再看这里的奖励说明。'
        : `邀请规则\n捐赠时填写邀请码：好友捐赠通过后，好友额外加赠 ${bonusPercent}% 对应积分，邀请人再得 ${rebatePercent}% 邀请奖励\n邀请码不再用于注册流程\n同IP近30天会拦截相关奖励`
    )
    setInviteRuleSeen(true)
  }, [tab, inviteRuleSeen, inviteConfig, inviteConfigLoaded, dialog])

  const handleRedeem = async () => {
    if (!redeemCode.trim()) return
    setRedeemLoading(true)
    setRedeemMsg(null)
    try {
      const res = await pointsAPI.redeem(redeemCode.trim())
      setPoints(res.data.balance)
      setRedeemMsg({ type: 'success', text: `领取成功！+${res.data.points_awarded} 积分` })
      setRedeemCode('')
      const u = readUser()
      if (u) {
        u.points = res.data.balance
        localStorage.setItem('user', JSON.stringify(u))
      }
      window.dispatchEvent(new Event('points-updated'))
      fetchData(page)
    } catch (e) {
      setRedeemMsg({ type: 'error', text: e.message })
    } finally {
      setRedeemLoading(false)
    }
  }

  const handleCheckIn = async () => {
    setCheckinLoading(true)
    try {
      const res = await pointsAPI.checkin()
      setPoints(res.data.points)
      setCheckedInToday(true)
      const u = readUser()
      if (u) {
        u.points = res.data.points
        localStorage.setItem('user', JSON.stringify(u))
      }
      window.dispatchEvent(new Event('points-updated'))
      fetchData(page)
    } catch (e) {
      dialog.alert(e.message || '签到失败')
    } finally {
      setCheckinLoading(false)
    }
  }

  const handlePickPackage = idx => {
    const pkg = rechargePackages[idx]
    if (!pkg) return
    setPackageIdx(idx)
    setRechargeAmount(Number(pkg.amount || 0))
    setRechargePoints(Number(pkg.points || 0))
  }

  const handleGenerateInviteCode = async () => {
    setInviteGenerating(true)
    try {
      const { data } = await pointsAPI.generateInviteCode()
      setInviteInfo(v => ({ ...v, invite_code: data.invite_code || '' }))
      const u = readUser()
      if (u) {
        u.invite_code = data.invite_code || ''
        localStorage.setItem('user', JSON.stringify(u))
      }
    } catch (e) {
      dialog.alert(e.message || '生成失败')
    } finally {
      setInviteGenerating(false)
    }
  }

  const handleCopyInviteCode = async () => {
    if (!inviteInfo?.invite_code) return
    try {
      if (navigator?.clipboard?.writeText)
        await navigator.clipboard.writeText(inviteInfo.invite_code)
      else {
        const input = document.createElement('input')
        input.value = inviteInfo.invite_code
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        document.body.removeChild(input)
      }
      dialog.alert('邀请码已复制')
    } catch {
      dialog.alert('复制失败，请手动复制')
    }
  }

  const handleSubmitRecharge = async () => {
    setSubmittingRecharge(true)
    setRechargeMsg(null)
    try {
      const { data } = await pointsAPI.createRechargeRequest({
        channel: rechargeChannel,
        amount: rechargeAmount,
        points: rechargePoints,
        invite_code: inviteCode,
      })
      const nextRequest = {
        id: data.id,
        channel: rechargeChannel,
        amount: data.amount,
        discount: data.discount,
        points: rechargePoints,
        tx_no: data.tx_no,
      }
      setActiveRequest(nextRequest)
      setShowQrModal(true)
      setPollingStatus('active')
      setSuccessPayload(null)
      setInviteCode('')
      pollingStartedRef.current = null
      startCountdown(data.remaining_seconds || 600)
      startPolling(nextRequest.id, true, nextRequest)
    } catch (err) {
      setRechargeMsg({ type: 'error', text: err.message || '提交失败' })
    } finally {
      setSubmittingRecharge(false)
    }
  }

  const handleConfirmRecharge = async () => {
    if (!activeRequest) return
    if (pollingStatus === 'expired') {
      setRechargeMsg({ type: 'error', text: '当前金额已失效，请重新生成金额后再支付' })
      return
    }
    try {
      await pointsAPI.confirmRechargeRequest(activeRequest.id)
      if (pollingStatus !== 'verifying') setPollingStatus('verifying')
      startPolling(activeRequest.id, true, activeRequest)
    } catch (err) {
      try {
        const { data } = await pointsAPI.getRechargeRequest(activeRequest.id)
        if (data.status === 'approved') {
          if (countdownRef.current) clearInterval(countdownRef.current)
          setPollingStatus('success')
          setRechargeMsg(null)
          setSuccessPayload({
            points: Number(data.points || activeRequest?.points || 0),
            amount: Number(data.amount || activeRequest?.amount || 0),
            channel: data.channel || activeRequest?.channel,
          })
          fetchData(page)
          return
        }
        if (data.status === 'expired') {
          setPollingStatus('expired')
          setCountdown(0)
          setRechargeMsg({ type: 'error', text: '当前订单已过期，请重新生成金额' })
          return
        }
      } catch {}
      setRechargeMsg({ type: 'error', text: err.message || '确认失败' })
    }
  }

  const pollingRef = useRef(null)

  const startPolling = (requestId, force = false, requestMeta = null) => {
    if (!requestId) return
    if (!force && pollingStartedRef.current === requestId) return
    pollingStartedRef.current = requestId
    if (pollingRef.current) clearTimeout(pollingRef.current)
    let count = 0
    const maxCount = 200
    const baseRequest = requestMeta || activeRequest
    const poll = async () => {
      count++
      try {
        const { data } = await pointsAPI.getRechargeRequest(requestId)
        if (typeof data.remaining_seconds === 'number') setCountdown(Math.max(0, Number(data.remaining_seconds) || 0))
        if (data.status === 'approved') {
          if (countdownRef.current) clearInterval(countdownRef.current)
          setPollingStatus('success')
          setRechargeMsg(null)
          setSuccessPayload({
            points: Number(data.points || baseRequest?.points || 0),
            amount: Number(data.amount || baseRequest?.amount || 0),
            channel: data.channel || baseRequest?.channel,
          })
          fetchData(page)
          return
        }
        if (data.status === 'expired') {
          if (countdownRef.current) clearInterval(countdownRef.current)
          setCountdown(0)
          setPollingStatus('expired')
          setRechargeMsg({ type: 'error', text: '当前金额已失效，请勿继续支付旧金额' })
          return
        }
      } catch {}
      if (count >= maxCount) {
        setPollingStatus('timeout')
        return
      }
      pollingRef.current = setTimeout(poll, 3000)
    }
    poll()
  }

  const handleCloseQrModal = () => {
    setShowQrModal(false)
    setPollingStatus(null)
    setSuccessPayload(null)
    setCountdown(0)
    setRechargeMsg(null)
    pollingStartedRef.current = null
    if (pollingRef.current) clearTimeout(pollingRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }

  const startCountdown = seconds => {
    setCountdown(seconds)
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current)
          setPollingStatus(current => {
            if (current === 'success') return current
            setRechargeMsg({ type: 'error', text: '当前金额已失效，请重新生成金额' })
            return 'expired'
          })
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }
  const handleRenewRecharge = async () => {
    if (submittingRecharge) return
    await handleSubmitRecharge()
  }

  useEffect(() => {
    if (showQrModal && activeRequest?.id && ['active', 'verifying'].includes(pollingStatus))
      startPolling(activeRequest.id, false, activeRequest)
  }, [showQrModal, activeRequest?.id, pollingStatus])

  useEffect(() => () => {
    if (pollingRef.current) clearTimeout(pollingRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) return
    setPasswordSubmitting(true)
    try {
      await accountAPI.changePassword({ old_password: oldPassword, new_password: newPassword })
      setOldPassword('')
      setNewPassword('')
      dialog.alert('密码修改成功')
    } catch (e) {
      dialog.alert(e.message || '修改失败')
    }
    setPasswordSubmitting(false)
  }

  const totalPages = Math.ceil(total / size)
  const countdownTone = getCountdownTone(countdown)

  const inviteBonusPreview = inviteConfig?.invite_enabled && inviteInfo?.register_invite_code
    ? Math.max(0, Math.round(rechargePoints * Number(inviteConfig?.invite_recharge_bonus_percent || 0) / 100))
    : 0

  return (
    <>
      <MainLayout>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid gap-4 mb-6 xl:grid-cols-2">
            <div className="p-5 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)', color: '#fff' }}>
                  <User size={24} />
                </div>
                <div>
                  <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>积分详情</h1>
                  <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {user?.nickname || user?.account || user?.username}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    <Mail size={12} />
                    <span>{user?.account || user?.username}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 p-4 rounded-2xl" style={{ background: 'var(--bg-primary)' }}>
                <Coins size={20} style={{ color: 'var(--accent)' }} />
                <div className="flex-1">
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>当前积分</p>
                  <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>{formatPoints(points)}</p>
                </div>
                {checkedInToday !== null && (
                  <button
                    onClick={handleCheckIn}
                    disabled={checkedInToday || checkinLoading}
                    className="px-3 py-1.5 rounded-2xl text-xs font-medium transition-colors"
                    style={{
                      background: checkedInToday ? 'var(--color-success)' : 'var(--accent)',
                      color: '#fff',
                      opacity: checkedInToday ? 0.7 : 1,
                    }}
                  >
                    {checkinLoading ? '签到中...' : checkedInToday ? '已签到 ✓' : '签到'}
                  </button>
                )}
              </div>
            </div>
            <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center gap-2 mb-3">
                <KeyRound size={16} style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>修改密码</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <input
                  type="password"
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  placeholder="当前密码"
                  className="px-3 py-2 rounded-2xl text-sm border outline-none"
                  style={{
                    background: 'var(--bg-primary)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="新密码（至少6位）"
                  className="px-3 py-2 rounded-2xl text-sm border outline-none"
                  style={{
                    background: 'var(--bg-primary)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <button
                onClick={handleChangePassword}
                disabled={passwordSubmitting || !oldPassword || newPassword.length < 6}
                className="mt-3 px-4 py-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {passwordSubmitting ? '提交中...' : '确认修改'}
              </button>
            </div>
          </div>

          {subscription && (
            <div className="mb-5 p-4 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{subscription.plan?.name || '免费套餐'}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>当前周期至 {formatTime(subscription.cycle?.period_end)}</div>
                </div>
                <button onClick={() => selectTab('subscription')} className="px-3 py-1.5 rounded-2xl text-xs text-white" style={{ background: 'var(--accent)' }}>管理套餐</button>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div><div className="text-lg font-semibold" style={{ color: 'var(--accent)' }}>{formatPoints(subscription.cycle?.remaining_points ?? 0)}</div><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>周期积分</div></div>
                <div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{formatPoints(subscription.permanent_points ?? 0)}</div><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>永久积分</div></div>
                <div><div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{formatPoints(subscription.total_points ?? points)}</div><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>总积分</div></div>
              </div>
            </div>
          )}

          <div className="mb-4 flex flex-wrap gap-2">
            {tabList.map(item => (
              <button
                key={item.key}
                onClick={() => selectTab(item.key)}
                className={`px-4 py-2 rounded-2xl text-sm font-medium border ${tab === item.key ? 'text-white' : ''}`}
                style={
                  tab === item.key
                    ? { background: 'var(--accent)', borderColor: 'var(--accent)' }
                    : { background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'records' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>积分记录</h3>
                <button
                  onClick={() => fetchData(page)}
                  disabled={loading}
                  className="p-1.5 rounded-2xl hover:bg-bg-hover transition-colors disabled:opacity-50"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
              {loading ? (
                <div className="flex justify-center py-10">
                  <div
                    className="w-6 h-6 border-2 rounded-full animate-spin-slow"
                    style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }}
                  />
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-10 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  暂无记录
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ background: 'var(--bg-card)' }}>
                            <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>类型</th>
                            <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>模型</th>
                            <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>说明</th>
                            <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>积分变动</th>
                            <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>余额</th>
                            <th className="text-center px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>渠道</th>
                            <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>单号</th>
                            <th className="text-center px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>状态</th>
                            <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>审核备注</th>
                            <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {transactions.map(tx => {
                            const info = typeMap[tx.display_type || tx.type] || { label: tx.display_type || tx.type, color: 'var(--text-secondary)' }
                            const isPositive = tx.amount > 0
                            const rechargeStatusMeta = tx.recharge_status
                              ? (statusMap[tx.recharge_status] || null)
                              : null
                            const modelName = tx.model_name
                              ? (modelLabelMap[tx.model_name] || tx.model_name)
                              : '-'
                            return (
                              <tr key={tx.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                                <td className="px-4 py-2.5">
                                  <span
                                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                                    style={{ background: info.color + '18', color: info.color }}
                                  >
                                    {isPositive ? <ArrowUpCircle size={12} /> : <ArrowDownCircle size={12} />}
                                    {info.label}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                                  {modelName}
                                </td>
                                <td className="px-4 py-2.5 truncate max-w-[220px]" style={{ color: 'var(--text-primary)' }}>
                                  {tx.type === 'redeem_code' && tx.recharge_request_id
                                    ? `捐赠审核通过，发放 ${formatPoints(tx.amount)} 积分`
                                    : tx.description || '-'}
                                </td>
                                <td
                                  className="px-4 py-2.5 text-right font-medium tabular-nums"
                                  style={{ color: isPositive ? 'var(--color-success)' : 'var(--color-error)' }}
                                >
                                  {isPositive ? '+' : ''}{formatPoints(tx.amount)}
                                </td>
                                <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                                  {formatPoints(tx.balance_after)}
                                </td>
                                <td className="px-4 py-2.5 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                                  {tx.channel ? channelLabel[tx.channel] || tx.channel : '-'}
                                </td>
                                <td className="px-4 py-2.5 text-left text-xs truncate max-w-[120px]" style={{ color: 'var(--text-secondary)' }}>
                                  {tx.tx_no || '-'}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  {rechargeStatusMeta ? (
                                    <span
                                      className="px-2 py-0.5 rounded-full text-xs"
                                      style={{ color: rechargeStatusMeta.color, background: rechargeStatusMeta.color + '1A' }}
                                    >
                                      {rechargeStatusMeta.label}
                                    </span>
                                  ) : '-'}
                                </td>
                                <td className="px-4 py-2.5 text-left text-xs truncate max-w-[140px]" style={{ color: 'var(--text-secondary)' }}>
                                  {tx.review_note || '-'}
                                </td>
                                <td className="px-4 py-2.5 text-right whitespace-nowrap text-xs" style={{ color: 'var(--text-secondary)' }}>
                                  {formatTime(tx.created_at)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                </>
              )}
            </div>
          )}

          {tab === 'subscription' && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ['本周期扣除', subscriptionUsage?.summary?.charged_points ?? 0],
                  ['输入 / 输出 Token', `${subscriptionUsage?.summary?.input_tokens ?? 0} / ${subscriptionUsage?.summary?.output_tokens ?? 0}`],
                  ['用量缺失请求', subscriptionUsage?.summary?.usage_missing_requests ?? 0],
                ].map(([label, value]) => <div key={label} className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}><div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</div><div className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</div></div>)}
              </div>
              <div className="flex gap-2 items-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>支付方式</span>
                <button onClick={() => setSubscriptionChannel('alipay')} className="px-2 py-1 rounded-full border" style={{ borderColor: subscriptionChannel === 'alipay' ? 'var(--accent)' : 'var(--border-color)', color: subscriptionChannel === 'alipay' ? 'var(--accent)' : 'var(--text-secondary)' }}>支付宝</button>
                <button onClick={() => setSubscriptionChannel('wechat')} className="px-2 py-1 rounded-full border" style={{ borderColor: subscriptionChannel === 'wechat' ? 'var(--accent)' : 'var(--border-color)', color: subscriptionChannel === 'wechat' ? 'var(--accent)' : 'var(--text-secondary)' }}>微信</button>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <input value={subscriptionPayerName} onChange={e => setSubscriptionPayerName(e.target.value)} placeholder="付款人姓名（可选）" className="px-3 py-2 rounded-2xl text-xs border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                <input value={subscriptionTxNo} onChange={e => setSubscriptionTxNo(e.target.value)} placeholder="交易号（可选）" className="px-3 py-2 rounded-2xl text-xs border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                <input value={subscriptionProofUrl} onChange={e => setSubscriptionProofUrl(e.target.value)} placeholder="支付凭证链接（可选）" className="px-3 py-2 rounded-2xl text-xs border outline-none" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
              </div>
              {payConfig[`${subscriptionChannel}_pay_qr_url`] && <img src={payConfig[`${subscriptionChannel}_pay_qr_url`]} alt="支付二维码" className="w-28 h-28 object-contain rounded-xl border" style={{ borderColor: 'var(--border-color)' }} />}
              <div className="grid gap-3 lg:grid-cols-3">
                {subscriptionPlans.map(plan => <div key={plan.id} className="p-4 rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)' }}>
                  <div className="flex items-start justify-between gap-2"><div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{plan.name}</div><div className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>¥{plan.price_rmb}</div></div>
                  <div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{plan.description || '按周期发放积分和功能权益'}</div>
                  <div className="mt-3 text-sm" style={{ color: 'var(--text-primary)' }}>{formatPoints(plan.grant_points)} 积分 / {plan.cycle_days} 天</div>
                  <div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{plan.features?.web_search ? '联网搜索 ' : ''}{plan.features?.file_upload ? '文件上传 ' : ''}{plan.features?.file_write ? '文件写入' : ''}</div>
                  {!plan.is_free && <button disabled={subscriptionSubmitting} onClick={() => handleSubscriptionOrder(plan)} className="mt-4 w-full px-3 py-2 rounded-2xl text-sm text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>{subscriptionSubmitting ? '提交中...' : '购买 / 续费'}</button>}
                </div>)}
              </div>
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)' }}>订阅订单</div>
                {subscriptionOrders.map(order => <div key={order.id} className="flex items-center justify-between gap-3 px-4 py-3 border-t text-sm" style={{ borderColor: 'var(--border-color)' }}><div><div style={{ color: 'var(--text-primary)' }}>{order.order_no}</div><div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>¥{order.amount_rmb} · {formatTime(order.created_at)}</div></div><span className="text-xs" style={{ color: order.status === 'approved' ? 'var(--color-success)' : 'var(--color-warning)' }}>{statusMap[order.status]?.label || order.status}</span></div>)}
                {!subscriptionOrders.length && <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>暂无订阅订单</div>}
              </div>
              <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <div className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--text-primary)', background: 'var(--bg-card)' }}>模型价格</div>
                {subscriptionPrices.map(model => <div key={model.model_id} className="flex items-center justify-between gap-3 px-4 py-3 border-t text-xs" style={{ borderColor: 'var(--border-color)' }}><span style={{ color: 'var(--text-primary)' }}>{model.label}</span><span style={{ color: 'var(--text-secondary)' }}>输入 {model.points_per_1k?.input == null ? '-' : formatPoints(model.points_per_1k.input)} / 输出 {model.points_per_1k?.output == null ? '-' : formatPoints(model.points_per_1k.output)} 积分 / 千 Token</span></div>)}
                {!subscriptionPrices.length && <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>暂无已配置的模型价格</div>}
              </div>
            </div>
          )}

          {tab === 'donate' && (
            <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
              <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Wallet size={16} style={{ color: 'var(--accent)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>捐赠支持</span>
                </div>
                <p className="text-xs mb-3 leading-6" style={{ color: 'var(--text-secondary)' }}>
                  {payConfig.manual_recharge_notice}
                </p>
                <div className="grid sm:grid-cols-2 gap-3 mb-3">
                  <div className="p-3 rounded-2xl border" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>积分用途</div>
                    <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      用于 AI 生图、提示词优化、图片续期等平台资源消耗
                    </div>
                  </div>
                  <div className="p-3 rounded-2xl border" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}>
                    <div className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>支持说明</div>
                    <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      轻度使用建议优先签到领积分；短期高频生成可按需捐赠支持
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                  {rechargePackages.map((pkg, idx) => (
                    <button
                      key={`${pkg.label}-${idx}`}
                      onClick={() => handlePickPackage(idx)}
                      className={`px-2 py-2 rounded-2xl text-xs font-medium ${packageIdx === idx ? 'text-white' : 'hover:bg-bg-hover'}`}
                      style={{
                        background: packageIdx === idx ? 'var(--accent)' : 'var(--bg-primary)',
                        color: packageIdx === idx ? '#fff' : 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      <div>{pkg.label}</div>
                      <div className="mt-0.5">¥{pkg.amount} / {pkg.points}积分</div>
                    </button>
                  ))}
                </div>
                {!inviteInfo?.inviter_user_id && (
                  <div className="mb-2">
                    <input
                      type="text"
                      value={inviteCode}
                      onChange={e => setInviteCode(e.target.value.toUpperCase())}
                      placeholder="支持邀请码（未绑定时可选填）"
                      className="w-full px-3 py-2 rounded-2xl text-sm outline-none transition-colors"
                      style={{
                        background: 'var(--bg-primary)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </div>
                )}
                {inviteInfo?.inviter_user_id && (
                  <div className="mb-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    当前捐赠将沿用已绑定邀请码{inviteInfo?.register_invite_code ? `：${inviteInfo.register_invite_code}` : ''}
                  </div>
                )}
                <div className="mb-2 text-xs" style={{ color: 'var(--color-success)' }}>
                  {inviteConfig?.invite_enabled
                    ? `使用邀请码后，本次预计额外加赠 ${inviteBonusPreview} 积分，邀请奖励将在审核通过后发放；若不是注册时填写的邀请码，不会补发注册邀请积分`
                    : '邀请码系统当前已关闭'}
                </div>
                <div className="flex gap-2 mb-3">
                  {['alipay', 'wechat'].map(c => {
                    const configured = c === 'alipay' ? payConfig.alipay_pay_qr_url : payConfig.wechat_pay_qr_url
                    return (
                      <button
                        key={c}
                        onClick={() => setRechargeChannel(c)}
                        className={`px-3 py-1.5 rounded-2xl text-xs font-medium ${rechargeChannel === c ? 'text-white' : 'hover:bg-bg-hover'} ${!configured ? 'opacity-50' : ''}`}
                        style={{
                          background: rechargeChannel === c ? 'var(--accent)' : 'var(--bg-primary)',
                          color: rechargeChannel === c ? '#fff' : 'var(--text-primary)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        {channelLabel[c]}{!configured ? ' (未配置)' : ''}
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={handleSubmitRecharge}
                  disabled={submittingRecharge || !(rechargeChannel === 'alipay' ? payConfig.alipay_pay_qr_url : payConfig.wechat_pay_qr_url)}
                  className="w-full px-4 py-2 rounded-2xl text-sm font-medium text-white transition-colors disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {submittingRecharge
                    ? '提交中...'
                    : !(rechargeChannel === 'alipay' ? payConfig.alipay_pay_qr_url : payConfig.wechat_pay_qr_url)
                      ? `${channelLabel[rechargeChannel]}捐赠码未配置`
                      : `提交并获取捐赠二维码（¥${rechargeAmount} / ${rechargePoints}积分）`}
                </button>
                {rechargeMsg && (
                  <div
                    className={`mt-2 px-3 py-2 rounded-2xl text-xs ${rechargeMsg.type === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}
                    style={{ background: rechargeMsg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}
                  >
                    {rechargeMsg.text}
                  </div>
                )}
                {['active', 'verifying'].includes(pollingStatus) && (
                  <div className="mt-2 px-3 py-2 rounded-2xl text-xs text-[var(--color-warning)]" style={{ background: 'rgba(234,179,8,0.1)' }}>
                    正在等待到账确认...
                  </div>
                )}
                {pollingStatus === 'success' && (
                  <div className="mt-2 px-3 py-2 rounded-2xl text-xs text-[var(--color-success)]" style={{ background: 'rgba(34,197,94,0.1)' }}>
                    捐赠成功，积分已到账！
                  </div>
                )}
                {pollingStatus === 'expired' && (
                  <div className="mt-2 px-3 py-2 rounded-2xl text-xs text-[var(--color-error)]" style={{ background: 'rgba(239,68,68,0.1)' }}>
                    当前金额已失效，请重新生成金额，勿继续支付旧金额
                  </div>
                )}
                {pollingStatus === 'timeout' && (
                  <div className="mt-2 px-3 py-2 rounded-2xl text-xs text-[var(--color-error)]" style={{ background: 'rgba(239,68,68,0.1)' }}>
                    未检测到到账，请确认是否支付成功
                  </div>
                )}
              </div>
              <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <HeartHandshake size={16} style={{ color: 'var(--accent)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>捐赠说明</span>
                </div>
                <div className="space-y-3 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                  <p>你的捐赠是对 Atelier 持续运行的支持，平台会按当前档位赠送对应积分。</p>
                  <p>积分仅用于站内功能消耗，不可提现、不可转让、不可跨账号转移。</p>
                  <p>AI 生图结果具有随机性，如生成失败、优化失败或审核拦截，系统只会退还对应消耗积分。</p>
                  <p>捐赠属于个人自愿支持行为，不构成商品购买或预付储值，发放完成后不支持回退，请按需理性支持。</p>
                </div>
              </div>
            </div>
          )}

          {tab === 'invite' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                <div className="mb-4">
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>邀请中心</div>
                  <div className="text-xs mt-1 leading-6" style={{ color: 'var(--text-secondary)' }}>
                    捐赠时可填写邀请码；好友完成捐赠支持后可获得额外加赠积分，你也可获得邀请奖励，同IP近30天会拦截相关奖励
                  </div>
                </div>
                <div
                  className="mb-4 p-4 rounded-[24px] border"
                  style={{
                    background: 'linear-gradient(135deg,color-mix(in srgb,var(--accent) 16%,var(--bg-primary)) 0%,var(--bg-primary) 100%)',
                    borderColor: 'color-mix(in srgb,var(--accent) 38%,var(--border-color))',
                    boxShadow: '0 12px 30px rgba(0,0,0,0.08)',
                  }}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-[11px] tracking-[0.24em] uppercase mb-2" style={{ color: 'var(--accent)' }}>
                        你的邀请码
                      </div>
                      {inviteInfo?.invite_code ? (
                        <div
                          className="text-3xl sm:text-4xl font-mono font-semibold tracking-[0.28em] break-all"
                          style={{ color: 'var(--text-primary)', lineHeight: 1.1 }}
                        >
                          {inviteInfo.invite_code}
                        </div>
                      ) : (
                        <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                          还没有邀请码，生成后会显示在这里
                        </div>
                      )}
                      <div className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                        把这个码发给好友，对方捐赠时填写即可生效
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      {inviteInfo?.invite_code ? (
                        <>
                          <button
                            type="button"
                            onClick={handleCopyInviteCode}
                            className="px-4 py-2 rounded-2xl text-sm font-medium text-white"
                            style={{ background: 'var(--accent)' }}
                          >
                            复制邀请码
                          </button>
                          <button
                            type="button"
                            onClick={handleGenerateInviteCode}
                            disabled={inviteGenerating}
                            className="px-4 py-2 rounded-2xl text-sm font-medium disabled:opacity-50"
                            style={{
                              background: 'var(--bg-primary)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-color)',
                            }}
                          >
                            {inviteGenerating ? '生成中...' : '重新生成'}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handleGenerateInviteCode}
                          disabled={inviteGenerating}
                          className="px-4 py-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
                          style={{ background: 'var(--accent)' }}
                        >
                          {inviteGenerating ? '生成中...' : '立即生成邀请码'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid sm:grid-cols-4 gap-2 mb-3">
                  {[
                    { l: '邀请注册', v: inviteInfo?.summary?.invited_register_count || 0 },
                    { l: '累计邀请奖励', v: inviteInfo?.summary?.total_rebate_points || 0 },
                    { l: '带来捐赠支持', v: `¥${Number(inviteInfo?.summary?.total_recharge_amount || 0).toFixed(2)}` },
                    { l: '风险拦截', v: inviteInfo?.summary?.risk_hit_count || 0 },
                  ].map(item => (
                    <div
                      key={item.l}
                      className="p-3 rounded-2xl border"
                      style={{ borderColor: 'var(--border-color)', background: 'var(--bg-primary)' }}
                    >
                      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{item.l}</div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.v}</div>
                    </div>
                  ))}
                </div>
                <div className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                  {inviteInfo?.inviter_name
                    ? `已绑定邀请人：${inviteInfo.inviter_name}`
                    : '当前未绑定邀请人'}
                  {inviteInfo?.register_invite_code ? `，绑定邀请码：${inviteInfo.register_invite_code}` : ''}
                </div>
                <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr style={{ background: 'var(--bg-primary)' }}>
                          <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>类型</th>
                          <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-secondary)' }}>对象</th>
                          <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>奖励积分</th>
                          <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>支持金额</th>
                          <th className="px-3 py-2 text-center font-medium" style={{ color: 'var(--text-secondary)' }}>状态</th>
                          <th className="px-3 py-2 text-right font-medium" style={{ color: 'var(--text-secondary)' }}>时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inviteHistory.map(item => (
                          <tr key={item.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                            <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                              {item.event_type === 'register'
                                ? '注册邀请'
                                : item.event_type === 'recharge_bonus'
                                  ? '支持加赠'
                                  : item.event_type === 'recharge_rebate'
                                    ? '邀请奖励'
                                    : '支持记录'}
                            </td>
                            <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                              {item.invitee_nickname || item.invitee_username || item.inviter_nickname || item.inviter_username || '-'}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {item.reward_points || 0}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                              {item.recharge_amount ? `¥${Number(item.recharge_amount).toFixed(2)}` : '-'}
                            </td>
                            <td
                              className="px-3 py-2 text-center"
                              style={{ color: item.same_ip_hit ? 'var(--color-error)' : 'var(--text-secondary)' }}
                            >
                              {item.status === 'blocked_same_ip'
                                ? '同IP拦截'
                                : item.status === 'rewarded'
                                  ? '已发放'
                                  : '已记录'}
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                              {formatTime(item.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {inviteHistoryTotal === 0 && (
                  <div className="text-center py-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    暂无邀请记录
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'redeem' && (
            <div className="max-w-xl">
              <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Gift size={16} style={{ color: 'var(--accent)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>兑换码</span>
                </div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                  输入已发放的兑换码，领取对应积分。
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={redeemCode}
                    onChange={e => setRedeemCode(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === 'Enter' && handleRedeem()}
                    placeholder="输入兑换码"
                    className="flex-1 px-3 py-2 rounded-2xl text-sm font-mono outline-none transition-colors"
                    style={{
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-color)',
                    }}
                  />
                  <button
                    onClick={handleRedeem}
                    disabled={redeemLoading || !redeemCode.trim()}
                    className="px-4 py-2 rounded-2xl text-sm font-medium text-white transition-colors disabled:opacity-50"
                    style={{ background: 'var(--accent)' }}
                  >
                    {redeemLoading ? '领取中...' : '领取'}
                  </button>
                </div>
                {redeemMsg && (
                  <div
                    className={`mt-2 px-3 py-2 rounded-2xl text-xs ${redeemMsg.type === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}
                    style={{ background: redeemMsg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}
                  >
                    {redeemMsg.text}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </MainLayout>

      {showQrModal && activeRequest && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={handleCloseQrModal}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl text-center max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
            style={{ background: 'var(--bg-card)' }}
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={handleCloseQrModal}
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
            >
              <X size={16} />
            </button>
            <div className="shrink-0 border-b px-6 pt-6 pb-4 text-left" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
              {pollingStatus === 'success' ? (
                <div className="rounded-2xl border px-4 py-3" style={{ background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.2)' }}>
                  <div className="text-sm font-semibold mb-1" style={{ color: 'var(--color-success)' }}>支付已确认</div>
                  <div className="text-xs leading-6" style={{ color: 'var(--text-primary)' }}>积分已经到账，本次捐赠处理完成。</div>
                </div>
              ) : pollingStatus === 'expired' ? (
                <div className="rounded-2xl border px-4 py-3" style={{ background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.2)' }}>
                  <div className="text-sm font-semibold mb-1" style={{ color: 'var(--color-error)' }}>支付时间已到</div>
                  <div className="text-xs leading-6" style={{ color: 'var(--text-primary)' }}>请不要继续支付旧金额，必须重新生成后再支付。</div>
                </div>
              ) : (
                <div className="rounded-[1.25rem] border px-4 py-4 text-center" style={{ background: countdownTone === 'danger' ? 'linear-gradient(180deg,rgba(239,68,68,0.10),rgba(239,68,68,0.03))' : countdownTone === 'warn' ? 'linear-gradient(180deg,rgba(245,158,11,0.10),rgba(245,158,11,0.03))' : 'var(--bg-primary)', borderColor: countdownTone === 'danger' ? 'rgba(239,68,68,0.20)' : countdownTone === 'warn' ? 'rgba(245,158,11,0.20)' : 'var(--border-color)' }}>
                  <div className="text-xs mb-1" style={{ color: countdownTone === 'danger' ? 'var(--color-error)' : countdownTone === 'warn' ? 'var(--color-warning)' : 'var(--text-secondary)' }}>剩余支付时间</div>
                  <div className="text-3xl font-semibold tabular-nums leading-none" style={{ color: countdownTone === 'danger' ? 'var(--color-error)' : countdownTone === 'warn' ? 'var(--color-warning)' : 'var(--color-success)' }}>
                    {formatCountdown(countdown)}
                  </div>
                  <div className="mt-2 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                    {countdownTone === 'danger'
                      ? '金额即将失效，请立即完成支付；若超时，请重新生成金额。'
                      : countdownTone === 'warn'
                        ? '请尽快支付当前精确金额，超时后旧金额将自动失效。'
                        : '请支付上方显示的精确金额，到账后系统会自动更新。'}
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
              {pollingStatus === 'success' && successPayload ? (
                <>
                <div className="text-4xl mb-3">🎉🎆</div>
                <div className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  捐赠成功，感谢支持
                </div>
                <div className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
                  你的支持已到账，平台会继续努力把体验做好
                </div>
                <div
                  className="mx-auto mb-3 px-4 py-3 rounded-2xl inline-flex flex-col items-center"
                  style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--color-success)' }}
                >
                  <div className="text-xs mb-1">本次获得积分</div>
                  <div className="text-3xl font-bold leading-none">+{successPayload.points}</div>
                </div>
                <div className="text-xs mb-5" style={{ color: 'var(--text-secondary)' }}>
                  已通过{channelLabel[successPayload.channel] || '当前渠道'}收到 ¥{successPayload.amount.toFixed(2)}，感谢你的捐赠支持 💖
                </div>
                <button
                  onClick={handleCloseQrModal}
                  className="w-full px-4 py-2.5 rounded-2xl text-sm font-medium text-white"
                  style={{ background: 'var(--color-success)' }}
                >
                  收下这份感谢
                </button>
              </>
            ) : pollingStatus === 'expired' ? (
              <>
                <div className="mx-auto mb-4 flex h-18 w-18 items-center justify-center rounded-full text-4xl" style={{ background: 'rgba(239,68,68,0.12)' }}>⌛</div>
                <div className="mb-3 rounded-[1.75rem] border px-4 py-4 text-left" style={{ background: 'linear-gradient(180deg,rgba(239,68,68,0.12),rgba(239,68,68,0.04))', borderColor: 'rgba(239,68,68,0.22)' }}>
                  <div className="text-lg font-semibold mb-1" style={{ color: 'var(--color-error)' }}>
                    当前支付金额已失效
                  </div>
                  <div className="text-sm leading-6" style={{ color: 'var(--text-primary)' }}>
                    上一个金额和订单号已经失效，请不要继续支付旧金额，否则系统无法自动到账。
                  </div>
                </div>
                {activeRequest.tx_no ? (
                  <div className="mb-3 rounded-2xl px-4 py-3 text-left" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                    <div className="text-[11px] mb-1" style={{ color: 'var(--text-secondary)' }}>旧订单号</div>
                    <div className="text-sm font-mono break-all" style={{ color: 'var(--text-primary)' }}>{activeRequest.tx_no}</div>
                  </div>
                ) : null}
                <div className="mb-4 rounded-2xl px-4 py-3 text-sm text-left" style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--color-error)' }}>
                  若你已经按旧金额完成支付，请保留上方订单号并联系管理员人工核单。
                </div>
                {rechargeMsg ? (
                  <div
                    className={`mb-3 px-3 py-2 rounded-2xl text-xs ${rechargeMsg.type === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}
                    style={{ background: rechargeMsg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}
                  >
                    {rechargeMsg.text}
                  </div>
                ) : null}
                <button
                  onClick={handleRenewRecharge}
                  className="w-full px-4 py-2.5 rounded-2xl text-sm font-medium text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  重新生成金额
                </button>
              </>
            ) : (
              <>
                {activeRequest.discount > 0 && (
                  <div
                    className="mb-2 px-3 py-1.5 rounded-full text-xs font-medium inline-block"
                    style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--color-success)' }}
                  >
                    恭喜获得随机减免 ¥{activeRequest.discount.toFixed(2)}
                  </div>
                )}
                <div className="text-4xl font-bold mb-3 tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  ¥{activeRequest.amount.toFixed(2)}
                </div>
                <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  {channelLabel[activeRequest.channel]}扫码支付 · {activeRequest.points}积分
                </div>
                {activeRequest.tx_no && (
                  <div className="text-xs mb-4 font-mono" style={{ color: 'var(--text-secondary)' }}>
                    订单号：{activeRequest.tx_no}
                  </div>
                )}
                {countdown > 0 && pollingStatus !== 'success' && pollingStatus === 'verifying' && (
                  <div className="text-xs mb-3" style={{ color: 'var(--color-success)' }}>
                    已刷新到账状态，系统正在继续确认
                  </div>
                )}
                {(activeRequest.channel === 'alipay' ? payConfig.alipay_pay_qr_url : payConfig.wechat_pay_qr_url) ? (
                  <img
                    src={activeRequest.channel === 'alipay' ? payConfig.alipay_pay_qr_url : payConfig.wechat_pay_qr_url}
                    alt="捐赠二维码"
                    className="w-48 h-48 object-contain rounded-2xl mx-auto mb-4"
                  />
                ) : (
                  <div
                    className="w-48 h-48 flex items-center justify-center rounded-2xl mx-auto mb-4"
                    style={{ background: 'var(--bg-primary)' }}
                  >
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>捐赠二维码未配置</span>
                  </div>
                )}
                {pollingStatus === 'timeout' && (
                  <div className="mb-3 px-3 py-2 rounded-2xl text-xs text-[var(--color-error)]" style={{ background: 'rgba(239,68,68,0.1)' }}>
                    暂未检测到到账，请确认是否支付成功后继续等待或手动刷新
                  </div>
                )}
                {rechargeMsg && (
                  <div
                    className={`mb-3 px-3 py-2 rounded-2xl text-xs ${rechargeMsg.type === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}
                    style={{ background: rechargeMsg.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}
                  >
                    {rechargeMsg.text}
                  </div>
                )}
                <button
                  onClick={handleConfirmRecharge}
                  disabled={pollingStatus === 'expired'}
                  className="w-full px-4 py-2.5 rounded-2xl text-sm font-medium text-white"
                  style={{ background: 'var(--color-success)', opacity: pollingStatus === 'expired' ? 0.5 : 1 }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle size={16} />我已支付，立即刷新一次
                  </span>
                </button>
                <p className="text-sm font-bold mt-3" style={{ color: 'var(--text-primary)' }}>
                  请支付上方显示的精确金额，支付成功后会自动更新到账状态
                </p>
                <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>
                  支付成功后会自动更新到账状态，无需重复操作
                </p>
              </>
            )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

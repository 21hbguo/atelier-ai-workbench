import { useEffect, useRef, useState } from 'react'
import { CheckCircle, X } from 'lucide-react'
import { pointsAPI } from '../api'

const channelLabel = { alipay: '支付宝', wechat: '微信' }

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
  return 'normal'
}

/**
 * 通用支付卡片（复用积分支持的支付交互：倒计时 + 二维码 + 订单号 + 轮询到账）
 * mode: 'recharge' 捐赠充值 / 'subscription' 套餐购买
 */
export default function RechargePayModal({ open, onClose, request, payConfig, mode = 'recharge', planName = '', onRenew, onSuccess }) {
  const [countdown, setCountdown] = useState(0)
  const [pollingStatus, setPollingStatus] = useState(null) // active / verifying / success / expired / timeout
  const [rechargeMsg, setRechargeMsg] = useState(null)
  const [successPayload, setSuccessPayload] = useState(null)
  const countdownRef = useRef(null)
  const pollingRef = useRef(null)
  const pollingStartedRef = useRef(null)

  const channel = request?.channel
  const amount = Number(request?.amount || 0)
  const discount = Number(request?.discount || 0)
  const txNo = request?.tx_no
  const points = Number(request?.points || 0)
  const qrUrl = channel === 'alipay' ? payConfig?.alipay_pay_qr_url : payConfig?.wechat_pay_qr_url
  const countdownTone = getCountdownTone(countdown)

  useEffect(() => {
    if (open && request) {
      setPollingStatus('active')
      setRechargeMsg(null)
      setSuccessPayload(null)
      pollingStartedRef.current = null
      setCountdown(Math.max(0, Number(request.remaining_seconds ?? 600) || 0))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request?.id])

  useEffect(() => () => {
    if (pollingRef.current) clearTimeout(pollingRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  const startPolling = (force = false) => {
    const requestId = request?.id
    if (!requestId) return
    if (!force && pollingStartedRef.current === requestId) return
    pollingStartedRef.current = requestId
    if (pollingRef.current) clearTimeout(pollingRef.current)
    let count = 0
    const maxCount = 200
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
            points: Number(data.points || points || 0),
            amount: Number(data.amount || amount || 0),
            channel: data.channel || channel,
          })
          onSuccess?.()
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

  useEffect(() => {
    if (open && request?.id && ['active', 'verifying'].includes(pollingStatus)) startPolling(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request?.id, pollingStatus])

  if (!open || !request) return null

  const handleConfirm = async () => {
    if (pollingStatus === 'expired') {
      setRechargeMsg({ type: 'error', text: '当前金额已失效，请重新生成金额后再支付' })
      return
    }
    try {
      await pointsAPI.confirmRechargeRequest(request.id)
      if (pollingStatus !== 'verifying') setPollingStatus('verifying')
      startPolling(true)
    } catch (err) {
      try {
        const { data } = await pointsAPI.getRechargeRequest(request.id)
        if (data.status === 'approved') {
          if (countdownRef.current) clearInterval(countdownRef.current)
          setPollingStatus('success')
          setRechargeMsg(null)
          setSuccessPayload({
            points: Number(data.points || points || 0),
            amount: Number(data.amount || amount || 0),
            channel: data.channel || channel,
          })
          onSuccess?.()
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

  const handleClose = () => {
    if (pollingRef.current) clearTimeout(pollingRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)
    pollingStartedRef.current = null
    onClose()
  }

  const isSub = mode === 'subscription'
  const successTitle = isSub ? '套餐已生效' : '充值成功，感谢支持'
  const successDesc = isSub
    ? `你的「${planName || '套餐'}」已激活，周期权益与积分已发放`
    : '你的支持已到账，平台会继续努力把体验做好'

  return (
    <div className="fixed inset-0 bg-black/80 z-[94] flex items-center justify-center p-4" onClick={handleClose}>
      <div
        className="relative w-full max-w-sm rounded-2xl text-center max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-card)' }}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center z-10"
          style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
          aria-label="关闭"
        >
          <X size={16} />
        </button>
        <div className="shrink-0 border-b px-6 pt-6 pb-4 text-left" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
          {pollingStatus === 'success' ? (
            <div className="rounded-2xl border px-4 py-3" style={{ background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.2)' }}>
              <div className="text-sm font-semibold mb-1" style={{ color: 'var(--color-success)' }}>{successTitle}</div>
              <div className="text-xs leading-6" style={{ color: 'var(--text-primary)' }}>
                {isSub ? '套餐权益已生效，可直接使用。' : '积分已经到账，本次充值处理完成。'}
              </div>
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
              <div className="text-4xl mb-3">{isSub ? '🎉' : '🎉🎆'}</div>
              <div className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{successTitle}</div>
              <div className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>{successDesc}</div>
              <div
                className="mx-auto mb-3 px-4 py-3 rounded-2xl inline-flex flex-col items-center"
                style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--color-success)' }}
              >
                <div className="text-xs mb-1">{isSub ? '套餐' : '本次获得积分'}</div>
                <div className="text-3xl font-bold leading-none">{isSub ? (planName || '已生效') : `+${successPayload.points}`}</div>
              </div>
              <div className="text-xs mb-5" style={{ color: 'var(--text-secondary)' }}>
                已通过{channelLabel[successPayload.channel] || '当前渠道'}收到 ¥{Number(successPayload.amount).toFixed(2)}
              </div>
              <button
                onClick={handleClose}
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
              {txNo ? (
                <div className="mb-3 rounded-2xl px-4 py-3 text-left" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                  <div className="text-[11px] mb-1" style={{ color: 'var(--text-secondary)' }}>旧订单号</div>
                  <div className="text-sm font-mono break-all" style={{ color: 'var(--text-primary)' }}>{txNo}</div>
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
                onClick={() => { handleClose(); onRenew?.() }}
                className="w-full px-4 py-2.5 rounded-2xl text-sm font-medium text-white"
                style={{ background: 'var(--accent)' }}
              >
                重新生成金额
              </button>
            </>
          ) : (
            <>
              {discount > 0 && (
                <div
                  className="mb-2 px-3 py-1.5 rounded-full text-xs font-medium inline-block"
                  style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--color-success)' }}
                >
                  恭喜获得随机减免 ¥{discount.toFixed(2)}
                </div>
              )}
              <div className="text-4xl font-bold mb-3 tracking-tight" style={{ color: 'var(--text-primary)' }}>
                ¥{amount.toFixed(2)}
              </div>
              <div className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                {channelLabel[channel] || ''}扫码支付{isSub ? ` · ${planName || '套餐'}` : points > 0 ? ` · ${points}积分` : ''}
              </div>
              {txNo && (
                <div className="text-xs mb-4 font-mono" style={{ color: 'var(--text-secondary)' }}>
                  订单号：{txNo}
                </div>
              )}
              {countdown > 0 && pollingStatus !== 'success' && pollingStatus === 'verifying' && (
                <div className="text-xs mb-3" style={{ color: 'var(--color-success)' }}>
                  已刷新到账状态，系统正在继续确认
                </div>
              )}
              {qrUrl ? (
                <img src={qrUrl} alt="支付二维码" className="w-48 h-48 object-contain rounded-2xl mx-auto mb-4" />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center rounded-2xl mx-auto mb-4" style={{ background: 'var(--bg-primary)' }}>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>收款二维码未配置</span>
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
                onClick={handleConfirm}
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
  )
}

import { useEffect, useState } from 'react'
import { Gift, X } from 'lucide-react'
import { pointsAPI } from '../api'
import { readUser } from '../auth'

const formatPoints = value => {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(4).replace(/\.?(0+)$/, '') : '0'
}

export default function RedeemModal({ open, onClose }) {
  const [redeemCode, setRedeemCode] = useState('')
  const [redeemLoading, setRedeemLoading] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState(null)
  const [points, setPoints] = useState(null)

  // 打开时加载当前余额
  useEffect(() => {
    if (!open) return
    setRedeemMsg(null)
    pointsAPI.balance().then(({ data }) => {
      setPoints(data.points)
    }).catch(() => {})
  }, [open])

  if (!open) return null

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
    } catch (e) {
      setRedeemMsg({ type: 'error', text: e.message })
    } finally {
      setRedeemLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[93] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-md max-h-[85vh] overflow-hidden rounded-2xl flex flex-col"
        style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 4%, var(--bg-primary)), var(--bg-primary) 180px)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
          <div className="min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>兑换码</h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>输入已发放的兑换码，领取对应积分</p>
          </div>
          <button onClick={onClose} aria-label="关闭" className="p-1.5 rounded-lg hover:bg-bg-hover shrink-0" style={{ color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>
        {/* 内容：兑换码输入 + 领取按钮 + 结果提示 */}
        <div className="overflow-y-auto p-5">
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
          {points !== null && (
            <div className="mt-3 px-4 py-3 rounded-2xl border text-center" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}>
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>当前积分</div>
              <div className="text-xl font-bold mt-0.5 tabular-nums" style={{ color: 'var(--accent)' }}>{formatPoints(points)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

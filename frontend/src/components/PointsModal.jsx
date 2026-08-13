import { useEffect, useState } from 'react'
import { Coins, User, Mail, X } from 'lucide-react'
import { pointsAPI } from '../api'
import { readUser } from '../auth'

const formatPoints = value => {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(4).replace(/\.?(0+)$/, '') : '0'
}

export default function PointsModal({ open, onClose }) {
  const user = readUser()
  const [points, setPoints] = useState(user?.points ?? 0)
  const [checkedInToday, setCheckedInToday] = useState(null)
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const fetchBalance = () => {
    pointsAPI.balance().then(({ data }) => {
      setPoints(data.points)
      const u = readUser()
      if (u) {
        u.points = data.points
        localStorage.setItem('user', JSON.stringify(u))
      }
    }).catch(() => {})
  }

  // 打开时加载余额 + 签到状态
  useEffect(() => {
    if (!open) return
    setErrorMsg(null)
    Promise.all([pointsAPI.balance(), pointsAPI.checkinStatus()]).then(([balRes, statusRes]) => {
      setPoints(balRes.data.points)
      setCheckedInToday(statusRes.data.checked_in_today)
    }).catch(() => {})
  }, [open])

  // 其他入口（签到/兑换/充值）成功后会广播 points-updated，这里同步刷新余额
  useEffect(() => {
    const handleUpdate = () => {
      const u = readUser()
      if (u) setPoints(u.points ?? 0)
    }
    window.addEventListener('points-updated', handleUpdate)
    return () => window.removeEventListener('points-updated', handleUpdate)
  }, [])

  if (!open) return null

  const handleCheckIn = async () => {
    setCheckinLoading(true)
    setErrorMsg(null)
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
      fetchBalance()
    } catch (e) {
      setErrorMsg(e.message || '签到失败')
    } finally {
      setCheckinLoading(false)
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
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>我的积分</h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>每日签到可得积分，余额可用于生成与优化</p>
          </div>
          <button onClick={onClose} aria-label="关闭" className="p-1.5 rounded-lg hover:bg-bg-hover shrink-0" style={{ color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>
        {/* 内容：积分详情卡（余额/头像/签到按钮） */}
        <div className="overflow-y-auto p-5">
          <div className="p-5 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)', color: '#fff' }}>
                <User size={24} />
              </div>
              <div>
                <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>积分详情</div>
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
            {errorMsg && (
              <div className="mt-3 px-3 py-2 rounded-2xl text-xs text-[var(--color-error)]" style={{ background: 'rgba(239,68,68,0.1)' }}>
                {errorMsg}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

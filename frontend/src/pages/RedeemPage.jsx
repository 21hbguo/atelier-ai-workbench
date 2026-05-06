import { useState, useEffect } from 'react'
import { Coins } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import { pointsAPI } from '../api'
import { readUser } from '../auth'

export default function RedeemPage() {
  const user = readUser()
  const [code, setCode] = useState('')
  const [points, setPoints] = useState(user?.points ?? 0)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    pointsAPI.balance().then(res => setPoints(res.data.points)).catch(() => {})
  }, [])

  const handleRedeem = async () => {
    if (!code.trim()) return
    setLoading(true)
    setMessage(null)
    try {
      const res = await pointsAPI.redeem(code.trim())
      setPoints(res.data.balance)
      setMessage({ type: 'success', text: `兑换成功！+${res.data.points_awarded} 积分，当前余额 ${res.data.balance}` })
      setCode('')
      const u = readUser()
      if (u) { u.points = res.data.balance; localStorage.setItem('user', JSON.stringify(u)) }
      window.dispatchEvent(new Event('points-updated'))
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <MainLayout>
      <div className="max-w-md mx-auto py-16 px-4">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent)', color: '#fff' }}>
            <Coins size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>兑换码领积分</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>输入兑换码领取已发放积分</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl mb-6" style={{ background: 'var(--bg-card)' }}>
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>当前积分余额</span>
          <div className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>{points}</div>
        </div>

        <div className="space-y-4">
          <div>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleRedeem()}
              placeholder="请输入兑换码"
              className="w-full px-4 py-3 rounded-2xl text-sm font-mono outline-none transition-colors"
              style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            />
          </div>
          <button
            onClick={handleRedeem}
            disabled={loading || !code.trim()}
            className="w-full py-3 rounded-2xl text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >{loading ? '兑换中...' : '兑换'}</button>
        </div>

        {message && (
          <div className={`mt-4 p-3 rounded-2xl text-sm ${message.type === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}
            style={{ background: message.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)' }}>
            {message.text}
          </div>
        )}
      </div>
    </MainLayout>
  )
}

import { useState, useEffect } from 'react'
import { Coins, ArrowUpCircle, ArrowDownCircle, RefreshCw, User, Mail } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import { pointsAPI } from '../api'

const typeMap = {
  register_bonus: { label: '注册赠送', color: 'var(--accent)' },
  daily_checkin: { label: '每日签到', color: 'var(--accent)' },
  generate_consume: { label: '生成消耗', color: '#ef4444' },
  generate_refund: { label: '生成退款', color: '#22c55e' },
  redeem_code: { label: '兑换码兑换', color: 'var(--accent)' },
  admin_grant: { label: '管理员调整', color: '#8b5cf6' },
  migration_bonus: { label: '历史补偿', color: 'var(--accent)' },
}

export default function WalletPage() {
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const [points, setPoints] = useState(user?.points ?? 0)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const size = 15

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
      const u = JSON.parse(localStorage.getItem('user') || 'null')
      if (u) { u.points = balRes.data.points; localStorage.setItem('user', JSON.stringify(u)) }
    } catch {}
    setLoading(false)
  }

  useEffect(() => { fetchData(page) }, [page])

  useEffect(() => {
    const handleUpdate = () => {
      const u = JSON.parse(localStorage.getItem('user') || 'null')
      if (u) setPoints(u.points ?? 0)
    }
    window.addEventListener('points-updated', handleUpdate)
    return () => window.removeEventListener('points-updated', handleUpdate)
  }, [])

  const totalPages = Math.ceil(total / size)

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-3xl mx-auto w-full">
        <div className="mb-6 p-5 rounded-xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)', color: '#fff' }}>
              <User size={24} />
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{user?.nickname || user?.username}</h2>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <Mail size={12} />
                <span>{user?.username}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-4 rounded-lg" style={{ background: 'var(--bg-primary)' }}>
            <Coins size={20} style={{ color: 'var(--accent)' }} />
            <div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>当前积分</p>
              <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>{user?.is_admin ? '∞' : points}</p>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>积分记录</h3>
            <button onClick={() => fetchData(page)} disabled={loading}
              className="p-1.5 rounded-lg hover:bg-black/5 transition-colors disabled:opacity-50"
              style={{ color: 'var(--text-secondary)' }}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 rounded-full animate-spin-slow" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-color)' }} />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-secondary)' }}>暂无记录</div>
          ) : (
            <>
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>类型</th>
                      <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>说明</th>
                      <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>积分变动</th>
                      <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>余额</th>
                      <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => {
                      const info = typeMap[tx.type] || { label: tx.type, color: 'var(--text-secondary)' }
                      const isPositive = tx.amount > 0
                      return (
                        <tr key={tx.id} className="border-t" style={{ borderColor: 'var(--border-color)' }}>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: info.color + '18', color: info.color }}>
                              {isPositive ? <ArrowUpCircle size={12} /> : <ArrowDownCircle size={12} />}
                              {info.label}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 truncate max-w-[200px]" style={{ color: 'var(--text-primary)' }}>{tx.description || '-'}</td>
                          <td className="px-4 py-2.5 text-right font-medium tabular-nums" style={{ color: isPositive ? '#22c55e' : '#ef4444' }}>
                            {isPositive ? '+' : ''}{tx.amount}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{tx.balance_after}</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap text-xs" style={{ color: 'var(--text-secondary)' }}>
                            {new Date(tx.created_at).toLocaleString('zh-CN')}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
                    style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>上一页</button>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{page}/{totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-40"
                    style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)' }}>下一页</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </MainLayout>
  )
}

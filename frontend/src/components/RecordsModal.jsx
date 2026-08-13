import { useEffect, useState } from 'react'
import { ArrowUpCircle, ArrowDownCircle, RefreshCw, X } from 'lucide-react'
import { pointsAPI } from '../api'
import Pagination from './Pagination'

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
  recharge_pending: { label: '充值待审核', color: 'var(--color-warning)' },
  recharge_refund: { label: '回退发放', color: 'var(--color-error)' },
  invite_register_reward: { label: '邀请注册奖励', color: 'var(--color-success)' },
  invite_recharge_bonus: { label: '支持加赠', color: 'var(--color-success)' },
  invite_recharge_rebate: { label: '邀请奖励', color: 'var(--color-success)' },
}

const statusMap = {
  pending: { label: '待审核', color: 'var(--color-warning)' },
  approved: { label: '已发放', color: 'var(--color-success)' },
  rejected: { label: '未通过', color: 'var(--color-error)' },
  refunded: { label: '已回退发放', color: 'var(--color-error)' },
  expired: { label: '已过期', color: 'var(--text-secondary)' },
}

const channelLabel = { wechat: '微信', alipay: '支付宝' }

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

export default function RecordsModal({ open, onClose }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const size = 15

  const fetchData = async (p = 1) => {
    setLoading(true)
    try {
      const res = await pointsAPI.transactions(p, size)
      setTransactions(res.data.items || [])
      setTotal(res.data.total || 0)
    } catch {}
    setLoading(false)
  }

  // 打开时加载，翻页时重新加载
  useEffect(() => {
    if (!open) return
    fetchData(page)
  }, [open, page])

  if (!open) return null

  const totalPages = Math.ceil(total / size)

  return (
    <div className="fixed inset-0 z-[93] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl flex flex-col"
        style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 4%, var(--bg-primary)), var(--bg-primary) 180px)', border: '1px solid var(--border-color)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--border-color)' }}>
          <div className="min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>积分流水</h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>账户积分变动明细，每页 {size} 条</p>
          </div>
          <button onClick={onClose} aria-label="关闭" className="p-1.5 rounded-lg hover:bg-bg-hover shrink-0" style={{ color: 'var(--text-secondary)' }}><X size={18} /></button>
        </div>
        {/* 内容：完整流水表格 + 分页 */}
        <div className="overflow-y-auto p-5">
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
                        const modelName = tx.model_name ? tx.model_name : '-'
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
                                ? `充值审核通过，发放 ${formatPoints(tx.amount)} 积分`
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
      </div>
    </div>
  )
}

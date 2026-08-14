import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, X } from 'lucide-react'
import { groupBuyAPI } from '../api'

const DISMISS_KEY = 'atelier_gb_banner_dismissed'

function readDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}

/**
 * 拼团横幅：挂在聊天页空态顶部。
 * 条件：存在 package_type==='membership' 且 teams.length>0 的活动 → 取第一个活动 + teams[0]（remain_need 最小）。
 * 接口失败静默隐藏；关闭后本会话不再显示（localStorage 标记）。
 */
export default function GroupBuyBanner() {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(readDismissed)
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    if (dismissed) return
    let active = true
    groupBuyAPI.active().then(({ data }) => {
      if (!active) return
      const items = Array.isArray(data?.items) ? data.items : []
      const activity = items.find(it => it.package_type === 'membership' && Array.isArray(it.teams) && it.teams.length > 0)
      if (!activity) return
      setBanner({ activity, team: activity.teams[0] })
    }).catch(() => { /* 失败静默隐藏 */ })
    return () => { active = false }
  }, [dismissed])

  if (dismissed || !banner) return null
  const { activity, team } = banner
  const remain = Math.max(0, Number(team.remain_need) || 0)
  const paid = Number(team.paid_count) || 0
  const price = Number(activity.group_price)
  const orig = Number(activity.original_price)
  const subtitle = remain > 0
    ? `${paid} 人正在拼团，还差 ${remain} 人成团`
    : `已有 ${paid} 人成团，立即加入享受拼团价`

  return (
    <div
      className="relative mb-4 flex items-center justify-between gap-3 overflow-hidden rounded-2xl border px-4 py-3 pr-2"
      style={{
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 14%, var(--bg-card)), color-mix(in srgb, var(--color-warning) 9%, var(--bg-card)) 65%, var(--bg-card))',
        borderColor: 'color-mix(in srgb, var(--accent) 32%, var(--border-color))',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Users size={14} className="shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{activity.package_name}拼团进行中</span>
          {activity.discount_text && (
            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }}>{activity.discount_text}</span>
          )}
        </div>
        <div className="mt-1 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{subtitle}</div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>¥</span>
          <span className="text-lg font-bold leading-none tabular-nums" style={{ color: 'var(--text-primary)' }}>{Number.isFinite(price) ? price : 0}</span>
          {Number.isFinite(orig) && orig > price && (
            <span className="text-[10px] tabular-nums line-through" style={{ color: 'var(--text-secondary)' }}>¥{orig}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-1.5">
        <button
          type="button"
          aria-label="关闭拼团横幅"
          onClick={() => {
            try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
            setDismissed(true)
          }}
          className="self-end rounded-md p-0.5 transition-colors hover:bg-bg-hover"
          style={{ color: 'var(--text-secondary)' }}
        >
          <X size={14} />
        </button>
        <button
          type="button"
          onClick={() => navigate(`/group-buy/team/${team.id}`)}
          className="rounded-xl px-3.5 py-1.5 text-xs font-medium text-white transition-all hover:brightness-105 active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))', boxShadow: '0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent)' }}
        >
          去拼团
        </button>
      </div>
    </div>
  )
}

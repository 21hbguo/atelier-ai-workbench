import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Check, Coins, Gift, KeyRound, ShieldCheck, Sparkles, WalletCards } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import PointsModal from '../components/PointsModal'
import RecordsModal from '../components/RecordsModal'
import RedeemModal from '../components/RedeemModal'
import { pointsAPI } from '../api'
import { readUser } from '../auth'

const transactionLabels = {
  daily_checkin: '每日签到',
  generate_consume: '图像生成',
  prompt_optimize: '提示词优化',
  redeem_code: '兑换积分',
  invite_register_reward: '邀请注册奖励',
  invite_recharge_rebate: '邀请奖励',
  generate_refund: '生成退还',
}

const formatPoints = value => {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(4).replace(/\.?(0+)$/, '') : '0'
}

const formatTime = value => {
  if (!value) return '刚刚'
  const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T')
  const date = new Date(normalized.includes('+') || normalized.endsWith('Z') ? normalized : `${normalized}+08:00`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AccountPage() {
  const user = readUser()
  const [points, setPoints] = useState(user?.points ?? 0)
  const [checkedInToday, setCheckedInToday] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [pointsOpen, setPointsOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [redeemOpen, setRedeemOpen] = useState(false)
  const displayName = user?.nickname || user?.account || user?.username || '用户'
  const account = user?.account || user?.username || '-'
  const initial = displayName.slice(0, 1).toUpperCase()
  const isAdmin = Boolean(user?.is_admin)

  const refresh = useCallback(() => {
    Promise.allSettled([
      pointsAPI.balance(),
      pointsAPI.checkinStatus(),
      pointsAPI.transactions(1, 3),
    ]).then(([balance, checkin, records]) => {
      if (balance.status === 'fulfilled') setPoints(balance.value.data?.points ?? 0)
      if (checkin.status === 'fulfilled') setCheckedInToday(Boolean(checkin.value.data?.checked_in_today))
      if (records.status === 'fulfilled') setTransactions(records.value.data?.items || [])
    })
  }, [setPoints, setCheckedInToday, setTransactions])

  useEffect(() => {
    refresh()
    window.addEventListener('points-updated', refresh)
    return () => window.removeEventListener('points-updated', refresh)
  }, [refresh])

  const actions = [
    { onClick: () => setPointsOpen(true), icon: WalletCards, title: '积分与套餐', description: '查看余额、订阅与消费记录' },
    { onClick: () => setRedeemOpen(true), icon: Coins, title: '兑换码', description: '兑换活动或邀请积分' },
    { to: '/settings', icon: KeyRound, title: '安全设置', description: '更新密码与查看登录会话' },
  ]

  return (
    <MainLayout>
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-7" style={{ background: 'var(--bg-primary)' }}>
        <div className="mx-auto max-w-5xl">
          <header className="mb-5 flex items-start justify-between gap-4">
            <div><p className="mb-1 text-xs" style={{ color: 'var(--text-secondary)' }}>账户与偏好</p><h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>账户概览</h1></div>
            <div className="hidden items-center gap-2 rounded-full border px-3 py-2 text-xs sm:inline-flex" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-ai-bubble)', color: 'var(--text-secondary)' }}><i className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-success)' }} />账户状态正常</div>
          </header>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <section className="relative overflow-hidden rounded-2xl border p-4 sm:col-span-2" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
              <div className="absolute -right-12 -top-20 h-52 w-52 rounded-full border-[28px]" style={{ borderColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' }} />
              <div className="relative flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white" style={{ background: 'var(--accent)' }}>{initial}</div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{displayName}</h2>
                  <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-secondary)' }}>{account}</p>
                  <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--accent)' }}><Check size={12} className="rounded-full text-white" style={{ background: 'var(--accent)' }} />账户已验证</span>
                </div>
              </div>
              <div className="relative mt-4 flex gap-2"><Link to="/settings" className="rounded-lg px-3 py-2 text-xs font-semibold text-white" style={{ background: 'var(--accent)' }}>编辑资料</Link><Link to="/settings" className="rounded-lg border px-3 py-2 text-xs font-semibold" style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}>账户安全</Link></div>
            </section>

            <QuickCard onClick={() => setPointsOpen(true)} icon={Coins} label="当前积分" value={formatPoints(points)} sub="可用于生成与对话" />
            <QuickCard onClick={() => setPointsOpen(true)} icon={Check} label="今日签到" value={checkedInToday === null ? '签到状态加载中' : checkedInToday ? '今日已签到' : '今日未签到'} sub={checkedInToday ? '明天再来签到' : '每日签到可领积分'} tone={checkedInToday ? 'var(--color-success)' : 'var(--accent)'} />
            <QuickCard icon={ShieldCheck} label="账户状态" value="正常" sub="身份已验证" tone="var(--color-success)" />
            <QuickCard to="/notifications" icon={Bell} label="通知" value="查看" sub="公告与消息提醒" />
          </div>

          <div className="mt-5 mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>常用功能</h2><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>快捷进入对应页面</span></div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{actions.map(({ to, onClick, icon: Icon, title, description }) => {
            const content = <><span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }}><Icon size={15} /></span><h3 className="mt-3 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3><p className="mt-1 text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{description}</p></>
            const cls = 'rounded-2xl border p-4 text-left transition-transform hover:-translate-y-0.5'
            const style = { background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }
            return to ? <Link key={title} to={to} className={cls} style={style}>{content}</Link> : <button key={title} type="button" onClick={onClick} className={cls} style={style}>{content}</button>
          })}</div>

          <section className="mt-5 rounded-2xl border p-4 sm:p-5" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>近期动态</h2><button type="button" onClick={() => setRecordsOpen(true)} className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>查看全部</button></div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">{transactions.length ? transactions.map(item => <Activity key={item.id} item={item} />) : <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>暂无积分流水</p>}</div>
          </section>
        </div>
      </main>
      <PointsModal open={pointsOpen} onClose={() => setPointsOpen(false)} />
      <RecordsModal open={recordsOpen} onClose={() => setRecordsOpen(false)} />
      <RedeemModal open={redeemOpen} onClose={() => setRedeemOpen(false)} />
    </MainLayout>
  )
}

function QuickCard({ to, onClick, icon: Icon, label, value, sub, tone }) {
  const inner = (
    <div className="flex h-full flex-col rounded-2xl border p-4 transition-transform hover:-translate-y-0.5" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ background: tone ? `color-mix(in srgb, ${tone} 10%, transparent)` : 'color-mix(in srgb, var(--accent) 10%, transparent)', color: tone || 'var(--accent)' }}><Icon size={15} /></span>
        <span className="truncate text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      <div className="mt-auto pt-3">
        <strong className="block truncate text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{value}</strong>
        {sub && <span className="mt-1 block truncate text-[10px]" style={{ color: 'var(--text-secondary)' }}>{sub}</span>}
      </div>
    </div>
  )
  if (onClick) return <div className="block cursor-pointer" onClick={onClick}>{inner}</div>
  return to ? <Link to={to} className="block">{inner}</Link> : inner
}

function Activity({ item }) {
  const positive = Number(item.amount) >= 0
  return <div className="flex min-w-0 items-center gap-2 md:border-r md:pr-3 last:border-0"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: positive ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'color-mix(in srgb, var(--color-error) 10%, transparent)', color: positive ? 'var(--accent)' : 'var(--color-error)' }}>{positive ? <Gift size={13} /> : <Sparkles size={13} />}</span><div className="min-w-0"><strong className="block truncate text-xs" style={{ color: 'var(--text-primary)' }}>{item.description || transactionLabels[item.type] || '积分变动'}</strong><span className="block truncate text-[10px]" style={{ color: 'var(--text-secondary)' }}>{formatTime(item.created_at)} · {positive ? '+' : ''}{formatPoints(item.amount)} 积分</span></div></div>
}

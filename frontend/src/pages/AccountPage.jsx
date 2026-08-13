import { Link } from 'react-router-dom'
import { Bell, ChevronRight, Coins, FileText, HeartHandshake, KeyRound, LockKeyhole, MessageCircle, ShieldCheck, UserRound } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import { readUser } from '../auth'

const entryGroups = [
  {
    title: '账户与安全',
    items: [
      { to: '/settings', icon: KeyRound, title: '密码与登录安全', description: '修改密码、查看最近登录会话' },
      { to: '/notifications', icon: Bell, title: '通知中心', description: '查看平台公告与服务消息' },
    ],
  },
  {
    title: '服务与规则',
    items: [
      { to: '/wallet', icon: Coins, title: '套餐与积分', description: '查看套餐、积分记录与邀请奖励' },
      { to: '/agreement', icon: FileText, title: '用户协议', description: '了解服务使用规范与账号规则' },
      { to: '/privacy', icon: ShieldCheck, title: '隐私政策', description: '了解个人信息的收集与保护方式' },
      { to: '/refund', icon: HeartHandshake, title: '积分规则', description: '查看捐赠支持与积分发放说明' },
    ],
  },
]

export default function AccountPage() {
  const user = readUser()
  const displayName = user?.nickname || user?.account || user?.username || '用户'
  const account = user?.account || user?.username || '-'

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <section className="rounded-2xl border p-4 sm:p-5" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>
                <UserRound size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{displayName}</h1>
                <p className="mt-0.5 text-xs truncate" style={{ color: 'var(--text-secondary)' }}>账号：{account}</p>
              </div>
              <Link to="/settings" className="hidden sm:inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium hover:opacity-80" style={{ background: 'var(--bg-primary)', color: 'var(--accent)' }}>
                <LockKeyhole size={14} />安全设置
              </Link>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {entryGroups.map(group => (
              <section key={group.title} className="rounded-2xl border p-3" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
                <h2 className="px-1 pb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{group.title}</h2>
                <div className="space-y-1">
                  {group.items.map(({ to, icon: Icon, title, description }) => (
                    <Link key={to} to={to} className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-bg-hover transition-colors">
                      <Icon size={17} style={{ color: 'var(--accent)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>{title}</div>
                        <div className="mt-0.5 text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{description}</div>
                      </div>
                      <ChevronRight size={16} style={{ color: 'var(--text-secondary)' }} />
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <Link to="/chat" className="flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm hover:bg-bg-hover transition-colors" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            <MessageCircle size={16} />返回 AI 助手
          </Link>
        </div>
      </div>
    </MainLayout>
  )
}

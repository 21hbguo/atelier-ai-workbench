import { useEffect, useState } from 'react'
import { ShieldAlert, KeyRound } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import { accountAPI } from '../api'
import { useAppDialog } from '../components/AppDialogProvider'

export default function SettingsPage() {
  const dialog = useAppDialog()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 会话数据仅用于多 IP 风险提示（最近登录会话列表已隐藏）
  const [sessions, setSessions] = useState([])

  useEffect(() => {
    accountAPI.sessions(1, 10).then(({ data }) => setSessions(data.items || [])).catch(() => {})
  }, [])

  const onChangePassword = async () => {
    if (!oldPassword || !newPassword) return
    setSubmitting(true)
    try {
      await accountAPI.changePassword({ old_password: oldPassword, new_password: newPassword })
      setOldPassword('')
      setNewPassword('')
      dialog.alert('密码修改成功')
    } catch (e) {
      dialog.alert(e.message || '修改失败')
    }
    setSubmitting(false)
  }

  const hasRisk = sessions.some(v => v.risk_level === 'high')

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-3">
              <KeyRound size={16} style={{ color: 'var(--accent)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>修改密码</span>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
                placeholder="当前密码"
                className="flex-1 min-w-0 px-3 py-2 rounded-2xl text-sm border outline-none"
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
                className="flex-1 min-w-0 px-3 py-2 rounded-2xl text-sm border outline-none"
                style={{
                  background: 'var(--bg-primary)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
              <button
                onClick={onChangePassword}
                disabled={submitting || !oldPassword || newPassword.length < 6}
                className="flex-shrink-0 px-4 py-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {submitting ? '提交中...' : '确认修改'}
              </button>
            </div>
          </div>

          {hasRisk && (
            <div
              className="p-3 rounded-2xl border text-sm flex items-center gap-2"
              style={{
                background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
                borderColor: 'var(--color-warning)',
                color: 'var(--color-warning)',
              }}
            >
              <ShieldAlert size={16} />检测到近24小时存在多IP/多设备登录，请确认是否本人操作。
            </div>
          )}

        </div>
      </div>
    </MainLayout>
  )
}

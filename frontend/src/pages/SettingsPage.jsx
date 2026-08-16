import { useEffect, useState } from 'react'
import { ShieldAlert, KeyRound, ListChecks } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import Pagination from '../components/Pagination'
import { accountAPI, configAPI } from '../api'
import { useAppDialog } from '../components/AppDialogProvider'

const CI_MAX_LEN = 2000

export default function SettingsPage() {
  const dialog = useAppDialog()
  // 「最近登录会话」列表与「多IP登录风险提示」由管理后台「配置中心 → 显示最近登录会话」开关控制（默认隐藏）
  const [showLoginSessions, setShowLoginSessions] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sessions, setSessions] = useState([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  // 自定义指令（用户级长期指令，注入每次 AI 对话的 system prompt）
  const [ci, setCi] = useState('')
  const [savedCi, setSavedCi] = useState('')
  const [ciLoading, setCiLoading] = useState(false)
  const [ciSaving, setCiSaving] = useState(false)
  const size = 10

  const fetchSessions = async (p = 1) => {
    setLoading(true)
    try {
      const { data } = await accountAPI.sessions(p, size)
      setSessions(data.items || [])
      setTotal(data.total || 0)
    } catch (e) {
      dialog.alert(e.message || '加载失败')
    }
    setLoading(false)
  }

  useEffect(() => { fetchSessions(page) }, [page])

  useEffect(() => {
    configAPI.get().then(({ data }) => setShowLoginSessions(Boolean(data?.show_login_sessions))).catch(() => {})
  }, [])

  // 挂载时回填已保存的自定义指令（失败提示但不阻断其他区块）
  useEffect(() => {
    let cancelled = false
    setCiLoading(true)
    accountAPI.getCustomInstructions()
      .then(({ data }) => {
        if (cancelled) return
        const text = data?.custom_instructions || ''
        setCi(text)
        setSavedCi(text)
      })
      .catch(e => { if (!cancelled) dialog.alert(e.message || '加载失败') })
      .finally(() => { if (!cancelled) setCiLoading(false) })
    return () => { cancelled = true }
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

  const onSaveCi = async () => {
    setCiSaving(true)
    try {
      await accountAPI.updateCustomInstructions({ custom_instructions: ci.trim() })
      setSavedCi(ci.trim())
      dialog.alert('保存成功')
    } catch (e) {
      dialog.alert(e.message || '保存失败')
    }
    setCiSaving(false)
  }

  const onResetCi = () => setCi(savedCi)

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

          <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2 mb-2">
              <ListChecks size={16} style={{ color: 'var(--accent)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>自定义指令</span>
            </div>
            <div className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
              将附加到每次 AI 对话的系统提示中，用于长期偏好（语气/格式/固定要求），修改后立即生效；
              对 AI 绘画、提示词优化不生效。
            </div>
            <textarea
              value={ci}
              onChange={e => setCi(e.target.value)}
              maxLength={CI_MAX_LEN}
              rows={5}
              placeholder="例：请用简洁口语化风格回复，避免啰嗦；涉及代码时给出可直接使用的完整代码。"
              className="w-full px-3 py-2 rounded-2xl text-sm border outline-none resize-y"
              style={{
                background: 'var(--bg-primary)',
                borderColor: 'var(--border-color)',
                color: 'var(--text-primary)',
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs" style={{ color: ci.length > CI_MAX_LEN ? 'var(--color-error)' : 'var(--text-secondary)' }}>
                {ciLoading ? '读取中...' : `${ci.length}/${CI_MAX_LEN}`}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onResetCi}
                  disabled={ciLoading || ci === savedCi}
                  className="flex-shrink-0 px-4 py-1.5 rounded-2xl text-sm border disabled:opacity-50"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                >
                  重置
                </button>
                <button
                  onClick={onSaveCi}
                  disabled={ciSaving || ciLoading || ci.length > CI_MAX_LEN}
                  className="flex-shrink-0 px-4 py-1.5 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--accent)' }}
                >
                  {ciSaving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>

          {showLoginSessions && hasRisk && (
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

          {showLoginSessions && (
            <div className="p-4 rounded-2xl border" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
            <div className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>最近登录会话</div>
            {loading ? (
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>加载中...</div>
            ) : sessions.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>暂无记录</div>
            ) : (
              <div className="space-y-2">
                {sessions.map(s => (
                  <div
                    key={s.id}
                    className="p-3 rounded-2xl border"
                    style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs" style={{ color: 'var(--text-primary)' }}>
                        {s.ip || '未知IP'}
                        {s.is_current && (
                          <span
                            className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] text-white"
                            style={{ background: 'var(--accent)' }}
                          >
                            当前
                          </span>
                        )}
                      </div>
                      <div
                        className="text-[10px]"
                        style={{
                          color: s.risk_level === 'high'
                            ? 'var(--color-error)'
                            : s.risk_level === 'medium'
                              ? 'var(--color-warning)'
                              : 'var(--color-success)',
                        }}
                      >
                        {s.risk_level}
                      </div>
                    </div>
                    <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                      {s.user_agent || '-'}
                    </div>
                    <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                      登录时间：{(() => {
                        const v = String(s.created_at || '')
                        const withTz = v.includes('T')
                          ? (v.includes('+') || v.includes('Z') ? v : v + '+08:00')
                          : v.replace(' ', 'T') + '+08:00'
                        return new Date(withTz).toLocaleString('zh-CN')
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / size))} onPageChange={setPage} />
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  )
}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI, configAPI } from '../api'
import { writeUser } from '../auth'

export default function LoginPage() {
  const accountRe = /^[A-Za-z0-9_]{4,16}$/
  const [isRegister, setIsRegister] = useState(false)
  const [registerEnabled, setRegisterEnabled] = useState(true)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    configAPI.get().then(({ data }) => {
      const enabled = data?.register_enabled !== false
      setRegisterEnabled(enabled)
      if (!enabled) setIsRegister(false)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown(c => c - 1), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  const handleSendCode = async () => {
    if (!email || cooldown > 0) return
    if (!accountRe.test((account || '').trim())) { setError('请先填写账号（4-16位字母、数字或下划线）'); return }
    if ((password || '').length < 6) { setError('请先设置密码（至少6个字符）'); return }
    setSendingCode(true)
    setError('')
    try {
      await authAPI.sendCode(email)
      setCooldown(60)
    } catch (err) {
      setError(err.message)
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (isRegister && !registerEnabled) { setError('当前已关闭注册'); return }
    if (isRegister && !accountRe.test((account || '').trim())) { setError('账号需为4到16位字母、数字或下划线'); return }
    setLoading(true)

    try {
      const data = isRegister
        ? (await authAPI.register({ account, password, nickname: nickname || '', email, code })).data
        : (await authAPI.login({ account, password })).data
      writeUser(data.user)
      if (isRegister && data.user?.points > 0) {
        localStorage.setItem('just_registered', JSON.stringify({ points: data.user.points }))
      }
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="login-glow" />
      <div className="login-glow login-glow-2" />
      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <h1 className="login-title" style={{ fontFamily: "'Alex Brush', cursive", fontSize: '3.5rem' }}>Atelier</h1>
          <p className="text-sm mt-1 tracking-widest" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>AI 造梦工坊</p>
          <p className="text-xs mt-3" style={{ color: 'var(--text-secondary)' }}>
            {isRegister ? '创建账号，开始你的 AI 创作之旅' : registerEnabled ? '欢迎回来，继续你的创作' : '当前仅开放登录，注册已关闭'}
          </p>
          <p className="text-[11px] mt-2" style={{ color: 'var(--text-secondary)', opacity: 0.6 }}>
            无需复杂配置，一句话或一张图，即刻开启灵感之旅
          </p>
        </div>

        <div className="login-card rounded-2xl p-6" style={{ background: 'var(--bg-ai-bubble)', boxShadow: 'var(--shadow-lg)' }}>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>账号</label>
              <input
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors focus:ring-2"
                style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)', '--tw-ring-color': 'var(--accent)' }}
                placeholder="4-16 位字母、数字或下划线"
                required
                minLength={5}
                maxLength={16}
              />
            </div>

            {isRegister && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>昵称</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors focus:ring-2"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  placeholder="可选"
                />
              </div>
            )}

            {isRegister && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>邮箱</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors focus:ring-2"
                  style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                  placeholder="用于接收验证码"
                  required
                />
              </div>
            )}

            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors focus:ring-2"
                style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="至少 6 个字符"
                required
                minLength={6}
              />
            </div>

            {isRegister && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>验证码</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="flex-1 px-3 py-2.5 rounded-lg border text-sm outline-none transition-colors focus:ring-2"
                    style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                    placeholder="6 位验证码"
                    required
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={sendingCode || cooldown > 0 || !email}
                    className="px-3 py-2.5 rounded-lg text-xs font-medium border whitespace-nowrap disabled:opacity-50"
                    style={{ borderColor: 'var(--border-color)', color: cooldown > 0 ? 'var(--text-secondary)' : 'var(--accent)', background: 'var(--bg-primary)' }}
                  >
                    {cooldown > 0 ? `${cooldown}s` : sendingCode ? '发送中...' : '发送验证码'}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p className="text-sm text-[var(--color-error)] text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'var(--accent)', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? '处理中...' : isRegister ? '注册' : '登录'}
            </button>
          </form>

          {registerEnabled ? <p className="text-center mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {isRegister ? '已有账号？' : '没有账号？'}
            <button
              onClick={() => { setIsRegister(!isRegister); setError('') }}
              className="ml-1 font-medium"
              style={{ color: 'var(--accent)' }}
            >
              {isRegister ? '去登录' : '去注册'}
            </button>
          </p> : <p className="text-center mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>注册入口已关闭</p>}
        </div>

        <p className="text-center mt-6 text-[11px]" style={{ color: 'var(--text-secondary)', opacity: 0.5 }}>
          Atelier · AI 造梦工坊
        </p>
      </div>
    </div>
  )
}

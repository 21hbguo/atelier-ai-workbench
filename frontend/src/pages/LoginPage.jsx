import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { authAPI, configAPI } from '../api'
import { writeUser } from '../auth'

const REGISTER_DRAFT_KEY = 'register_form_draft_v1'
const RESET_DRAFT_KEY = 'reset_form_draft_v1'

const isDevTurnstileHost = host => {
  const value = String(host || '').trim().toLowerCase()
  if (!value) return false
  const hostname = value.split(':')[0].replace(/^\[|\]$/g, '')
  if (['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.ts.net'))
    return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const parts = hostname.split('.').map(Number)
    if (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    )
      return true
  }
  return false
}

export default function LoginPage() {
  const accountRe = /^[A-Za-z0-9_]{4,16}$/
  const allowedEmailDomains = [
    'qq.com', 'vip.qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net',
    '188.com', 'sina.com', 'sohu.com', '139.com', '189.cn', '21cn.com',
    'aliyun.com', 'gmail.com', 'outlook.com', 'hotmail.com',
  ]
  const location = useLocation()
  const navigate = useNavigate()
  const [mode, setMode] = useState(() => {
    const q = new URLSearchParams(location.search).get('mode')
    return q === 'register' || q === 'reset' ? q : 'login'
  })
  const [registerEnabled, setRegisterEnabled] = useState(true)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileReady, setTurnstileReady] = useState(false)
  const isRegister = mode === 'register'
  const isReset = mode === 'reset'
  const canBypassTurnstile = isDevTurnstileHost(typeof window !== 'undefined' ? window.location.host : '')

  useEffect(() => {
    if (!turnstileSiteKey) return
    if (window.turnstile) {
      setTurnstileReady(true)
      return
    }
    const existing = document.getElementById('cf-turnstile-script')
    if (existing) {
      const timer = setInterval(() => {
        if (window.turnstile) {
          setTurnstileReady(true)
          clearInterval(timer)
        }
      }, 200)
      return () => clearInterval(timer)
    }
    const script = document.createElement('script')
    script.id = 'cf-turnstile-script'
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => setTurnstileReady(true)
    document.head.appendChild(script)
  }, [turnstileSiteKey])

  useEffect(() => {
    setTurnstileToken('')
    setTurnstileReady(!!window.turnstile || false)
  }, [mode])

  useEffect(() => {
    if (!isRegister) return
    try {
      const raw = localStorage.getItem(REGISTER_DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw)
      if (draft && typeof draft === 'object') {
        setAccount(typeof draft.account === 'string' ? draft.account : '')
        setPassword(typeof draft.password === 'string' ? draft.password : '')
        setNickname(typeof draft.nickname === 'string' ? draft.nickname : '')
        setEmail(typeof draft.email === 'string' ? draft.email : '')
        setCode(typeof draft.code === 'string' ? draft.code : '')
        setAgreed(!!draft.agreed)
        setCooldown(Number(draft.cooldown) > 0 ? Number(draft.cooldown) : 0)
      }
    } catch {}
  }, [isRegister])

  useEffect(() => {
    if (!isReset) return
    try {
      const raw = localStorage.getItem(RESET_DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw)
      if (draft && typeof draft === 'object') {
        setEmail(typeof draft.email === 'string' ? draft.email : '')
        setCode(typeof draft.code === 'string' ? draft.code : '')
        setResetPassword(typeof draft.resetPassword === 'string' ? draft.resetPassword : '')
        setCooldown(Number(draft.cooldown) > 0 ? Number(draft.cooldown) : 0)
      }
    } catch {}
  }, [isReset])

  useEffect(() => {
    if (!isRegister) return
    try {
      localStorage.setItem(REGISTER_DRAFT_KEY, JSON.stringify({
        account, password, nickname, email, code, agreed, cooldown,
      }))
    } catch {}
  }, [isRegister, account, password, nickname, email, code, agreed, cooldown])

  useEffect(() => {
    if (!isReset) return
    try {
      localStorage.setItem(RESET_DRAFT_KEY, JSON.stringify({
        email, code, resetPassword, cooldown,
      }))
    } catch {}
  }, [isReset, email, code, resetPassword, cooldown])

  const switchMode = next => {
    const target = next === 'register' || next === 'reset' ? next : 'login'
    setMode(target)
    setError('')
    setCooldown(0)
    if (target !== 'register') {
      setAccount('')
      setPassword('')
      setNickname('')
      setAgreed(false)
      try { localStorage.removeItem(REGISTER_DRAFT_KEY) } catch {}
    }
    if (target !== 'reset') {
      setResetPassword('')
      try { localStorage.removeItem(RESET_DRAFT_KEY) } catch {}
    }
    navigate(target === 'login' ? '/login' : `/login?mode=${target}`, { replace: true })
  }

  useEffect(() => {
    configAPI.get().then(({ data }) => {
      const enabled = data?.register_enabled !== false
      setRegisterEnabled(enabled)
      setTurnstileSiteKey(data?.turnstile_site_key || '')
      if (!enabled && mode === 'register') switchMode('login')
    }).catch(() => {})
  }, [mode])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown(c => c - 1), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  useEffect(() => {
    if (!turnstileSiteKey || !turnstileReady || !window.turnstile) return
    const node = document.getElementById('turnstile-box')
    if (!node) return
    node.innerHTML = ''
    setTurnstileToken('')
    window.turnstile.render(node, {
      sitekey: turnstileSiteKey,
      theme: 'light',
      callback: token => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(''),
      'error-callback': () => setTurnstileToken(''),
    })
  }, [turnstileSiteKey, turnstileReady, mode])

  const validateEmailDomain = value => {
    const normalized = String(value || '').trim().toLowerCase()
    const domain = normalized.includes('@') ? normalized.split('@').pop() : ''
    if (!allowedEmailDomains.includes(domain)) return '请使用常用邮箱地址'
    return ''
  }

  const handleSendCode = async () => {
    if (!email || cooldown > 0) return
    if (isRegister) {
      if (!agreed) {
        setError('请先勾选并同意相关协议')
        return
      }
      if (!accountRe.test((account || '').trim())) {
        setError('请先填写账号（4-16位字母、数字或下划线）')
        return
      }
      if ((password || '').length < 6) {
        setError('请先设置密码（至少6个字符）')
        return
      }
    }
    if (isReset && (resetPassword || '').length < 6) {
      setError('请先设置新密码（至少6个字符）')
      return
    }
    const emailError = validateEmailDomain(email)
    if (emailError) {
      setError(emailError)
      return
    }
    setSendingCode(true)
    setError('')
    try {
      if (isReset) await authAPI.sendResetCode(email, turnstileToken || 'dev-bypass')
      else await authAPI.sendCode(email, turnstileToken || 'dev-bypass')
      setCooldown(60)
    } catch (err) {
      setError(err.message)
    } finally {
      setSendingCode(false)
    }
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    if (turnstileSiteKey && !canBypassTurnstile && !turnstileToken) {
      setError('请先完成人机验证')
      return
    }
    if (isRegister && !registerEnabled) {
      setError('当前已关闭注册')
      return
    }
    if (isRegister && !agreed) {
      setError('请先勾选并同意相关协议')
      return
    }
    if (isRegister && !accountRe.test((account || '').trim())) {
      setError('账号需为4到16位字母、数字或下划线')
      return
    }
    if (isRegister || isReset) {
      const emailError = validateEmailDomain(email)
      if (emailError) {
        setError(emailError)
        return
      }
    }
    if (isReset && (resetPassword || '').length < 6) {
      setError('新密码至少 6 个字符')
      return
    }
    setLoading(true)
    try {
      const data = isRegister
        ? (await authAPI.register({
            account,
            password,
            nickname: nickname || '',
            email,
            code,
            turnstile_token: turnstileToken || 'dev-bypass',
          })).data
        : isReset
          ? (await authAPI.resetPassword({
              email,
              code,
              password: resetPassword,
              turnstile_token: turnstileToken || 'dev-bypass',
            })).data
          : (await authAPI.login({
              account,
              password,
              turnstile_token: turnstileToken || 'dev-bypass',
            })).data
      writeUser(data.user)
      if (isRegister && data.user?.points > 0)
        localStorage.setItem('just_registered', JSON.stringify({ points: data.user.points }))
      if (isRegister) try { localStorage.removeItem(REGISTER_DRAFT_KEY) } catch {}
      if (isReset) try { localStorage.removeItem(RESET_DRAFT_KEY) } catch {}
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="login-page min-h-[100dvh] flex items-start sm:items-center justify-center px-4 pt-[14vh] pb-6 sm:p-4"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div className="login-glow" />
      <div className="login-glow login-glow-2" />
      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-5 sm:mb-8">
          <h1
            className="login-title leading-none"
            style={{ fontFamily: "'Alex Brush', cursive", fontSize: 'clamp(2.8rem,12vw,3.5rem)' }}
          >
            Atelier
          </h1>
          <p className="text-sm mt-1 tracking-widest" style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>
            AI 造梦工坊
          </p>
          <p className="text-sm mt-2.5 sm:mt-3.5" style={{ color: 'var(--text-secondary)' }}>
            {isRegister
              ? '创建账号，开始你的 AI 创作之旅'
              : isReset
                ? '通过邮箱验证码重置密码'
                : registerEnabled
                  ? '欢迎回来，继续你的创作'
                  : '当前仅开放登录，注册已关闭'}
          </p>
          <p className="text-xs mt-2 sm:mt-2.5" style={{ color: 'var(--text-secondary)', opacity: 0.72 }}>
            无需复杂配置，一句话或一张图，即刻开启灵感之旅
          </p>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)', opacity: 0.82 }}>
            现已支持 GPT-Image-2！
          </p>
        </div>
        <div
          className="login-card rounded-2xl p-4 sm:p-6"
          style={{ background: 'var(--bg-ai-bubble)', boxShadow: 'var(--shadow-lg)' }}
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:gap-4">
            {!isReset && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>
                  {isRegister ? '账号' : '账号或邮箱'}
                </label>
                <input
                  type="text"
                  value={account}
                  onChange={e => setAccount(e.target.value)}
                  className="w-full px-3 py-2.5 sm:py-2.5 rounded-2xl border text-sm outline-none transition-colors focus:ring-2"
                  style={{
                    background: 'var(--bg-primary)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)',
                    '--tw-ring-color': 'var(--accent)',
                  }}
                  placeholder={isRegister ? '4-16 位字母、数字或下划线' : '输入账号或注册邮箱'}
                  required
                  minLength={isRegister ? 5 : 3}
                  maxLength={isRegister ? 16 : 255}
                />
              </div>
            )}
            {isRegister && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>昵称</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  className="w-full px-3 py-2.5 sm:py-2.5 rounded-2xl border text-sm outline-none transition-colors focus:ring-2"
                  style={{
                    background: 'var(--bg-primary)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="可选"
                />
              </div>
            )}
            {(isRegister || isReset) && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>邮箱</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value)
                    if (error) setError('')
                  }}
                  className="w-full px-3 py-2.5 sm:py-2.5 rounded-2xl border text-sm outline-none transition-colors focus:ring-2"
                  style={{
                    background: 'var(--bg-primary)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="仅支持常用邮箱"
                  required
                />
              </div>
            )}
            {!isReset && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 sm:py-2.5 rounded-2xl border text-sm outline-none transition-colors focus:ring-2"
                  style={{
                    background: 'var(--bg-primary)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="至少 6 个字符"
                  required
                  minLength={6}
                />
              </div>
            )}
            {isReset && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>新密码</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                  className="w-full px-3 py-2.5 sm:py-2.5 rounded-2xl border text-sm outline-none transition-colors focus:ring-2"
                  style={{
                    background: 'var(--bg-primary)',
                    borderColor: 'var(--border-color)',
                    color: 'var(--text-primary)',
                  }}
                  placeholder="至少 6 个字符"
                  required
                  minLength={6}
                />
              </div>
            )}
            {isRegister && (
              <label
                className="flex items-start gap-2 text-xs leading-5 sm:leading-6"
                style={{ color: 'var(--text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span>
                  我已阅读并同意{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/agreement')}
                    className="underline underline-offset-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    《用户协议》
                  </button>
                  、
                  <button
                    type="button"
                    onClick={() => navigate('/privacy')}
                    className="underline underline-offset-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    《隐私政策》
                  </button>
                </span>
              </label>
            )}
            {(isRegister || isReset) && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>验证码</label>
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                  <input
                    type="text"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    className="w-full min-w-0 px-3 py-2.5 sm:py-2.5 rounded-2xl border text-sm outline-none transition-colors focus:ring-2"
                    style={{
                      background: 'var(--bg-primary)',
                      borderColor: 'var(--border-color)',
                      color: 'var(--text-primary)',
                    }}
                    placeholder="6 位验证码"
                    required
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={sendingCode || cooldown > 0 || !email || (isRegister && !agreed)}
                    className="w-full px-2 py-2.5 sm:py-2.5 rounded-2xl text-[11px] font-medium border whitespace-nowrap disabled:opacity-50"
                    style={{
                      borderColor: 'var(--border-color)',
                      color: cooldown > 0 ? 'var(--text-secondary)' : 'var(--accent)',
                      background: 'var(--bg-primary)',
                    }}
                  >
                    {cooldown > 0 ? `${cooldown}s` : sendingCode ? '发送中...' : '发送验证码'}
                  </button>
                </div>
              </div>
            )}
            {turnstileSiteKey && !canBypassTurnstile && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>人机验证</label>
                <div id="turnstile-box" className="min-h-[65px]" />
              </div>
            )}
            {error && <p className="text-sm text-[var(--color-error)] text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-2xl text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'var(--accent)', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? '处理中...' : isRegister ? '注册' : isReset ? '重置密码' : '登录'}
            </button>
          </form>
          <div className="text-center mt-3 sm:mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {isReset ? (
              <>
                <button
                  onClick={() => switchMode('login')}
                  className="font-medium"
                  style={{ color: 'var(--accent)' }}
                >
                  返回登录
                </button>
                {registerEnabled && (
                  <>
                    <span className="mx-2" style={{ opacity: 0.5 }}>|</span>
                    <button
                      onClick={() => switchMode('register')}
                      className="font-medium"
                      style={{ color: 'var(--accent)' }}
                    >
                      去注册
                    </button>
                  </>
                )}
              </>
            ) : registerEnabled ? (
              <>
                {isRegister ? '已有账号？' : '没有账号？'}
                <button
                  onClick={() => switchMode(isRegister ? 'login' : 'register')}
                  className="ml-1 font-medium"
                  style={{ color: 'var(--accent)' }}
                >
                  {isRegister ? '去登录' : '去注册'}
                </button>
                {!isRegister && (
                  <>
                    <span className="mx-2" style={{ opacity: 0.5 }}>|</span>
                    <button
                      onClick={() => switchMode('reset')}
                      className="font-medium"
                      style={{ color: 'var(--accent)' }}
                    >
                      忘记密码
                    </button>
                  </>
                )}
              </>
            ) : !isRegister ? (
              <button
                onClick={() => switchMode('reset')}
                className="font-medium"
                style={{ color: 'var(--accent)' }}
              >
                忘记密码
              </button>
            ) : (
              <span>注册入口已关闭</span>
            )}
          </div>
        </div>
        <p
          className="text-center mt-4 sm:mt-6 text-[11px]"
          style={{ color: 'var(--text-secondary)', opacity: 0.5 }}
        >
          Atelier · AI 造梦工坊
        </p>
      </div>
    </div>
  )
}

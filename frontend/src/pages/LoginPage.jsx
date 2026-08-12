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

const FEATURES = [
  { icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', label: '多模型聚合', desc: 'GPT / Claude / Gemini / Kimi / GLM' },
  { icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z', label: '多模态创作', desc: '对话、生图、图像理解' },
  { icon: 'M12 3l1.9 5.8a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-1.9a2 2 0 001.3-1.3L12 3z', label: '提示词优化', desc: '一键润色，出图更稳定' },
  { icon: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', label: '作品广场', desc: '灵感分享，一键同款' },
  { icon: 'M13 10V3L4 14h7v7l9-11h-7z', label: '每日签到', desc: '免费积分，持续使用' },
  { icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', label: '安全私密', desc: '私人服务器，数据可控' },
]

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
      navigate('/chat', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const modeTitle = isRegister
    ? '创建账号'
    : isReset
      ? '重置密码'
      : '欢迎回来'
  const modeSubtitle = isRegister
    ? '开始你的 AI 创作之旅'
    : isReset
      ? '通过邮箱验证码重置密码'
      : registerEnabled
        ? '继续你的创作'
        : '当前仅开放登录'

  return (
    <div className="login-page-centered">
      <div className="login-centered-inner">
        {/* 品牌区 */}
        <div className="login-brand-area">
          <h1 className="login-brand-title">Atelier</h1>
          <p className="login-brand-subtitle">AI 工作台</p>
          <p className="login-brand-desc">
            无需复杂配置，一句话或一张图，即刻开启灵感之旅
          </p>
          <p className="login-brand-models">
            支持 GPT 5.6 · KIMI k3 · GLM 5.2 等顶尖模型
          </p>
          <div className="login-features">
            {FEATURES.map((f, i) => (
              <div key={i} className="login-feature-item">
                <svg className="login-feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.icon} />
                </svg>
                <div>
                  <div className="login-feature-label">{f.label}</div>
                  <div className="login-feature-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 表单区 */}
        <div className="login-form-area">
          <div className="login-form-header">
            <h2 className="login-form-title">{modeTitle}</h2>
            <p className="login-form-subtitle">{modeSubtitle}</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {!isReset && (
              <div className="login-field">
                <label className="login-field-label">
                  {isRegister ? '账号' : '账号或邮箱'}
                </label>
                <input
                  type="text"
                  value={account}
                  onChange={e => setAccount(e.target.value)}
                  className="login-input"
                  placeholder={isRegister ? '4-16 位字母、数字或下划线' : '输入账号或注册邮箱'}
                  required
                  minLength={isRegister ? 5 : 3}
                  maxLength={isRegister ? 16 : 255}
                />
              </div>
            )}
            {isRegister && (
              <div className="login-field">
                <label className="login-field-label">昵称</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  className="login-input"
                  placeholder="可选"
                />
              </div>
            )}
            {(isRegister || isReset) && (
              <div className="login-field">
                <label className="login-field-label">邮箱</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value)
                    if (error) setError('')
                  }}
                  className="login-input"
                  placeholder="仅支持常用邮箱"
                  required
                />
              </div>
            )}
            {!isReset && (
              <div className="login-field">
                <label className="login-field-label">密码</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="login-input"
                  placeholder="至少 6 个字符"
                  required
                  minLength={6}
                />
              </div>
            )}
            {isReset && (
              <div className="login-field">
                <label className="login-field-label">新密码</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)}
                  className="login-input"
                  placeholder="至少 6 个字符"
                  required
                  minLength={6}
                />
              </div>
            )}
            {isRegister && (
              <label className="login-agree">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                  className="login-agree-check"
                />
                <span>
                  我已阅读并同意{' '}
                  <button type="button" onClick={() => navigate('/agreement')} className="login-link">
                    《用户协议》
                  </button>
                  、
                  <button type="button" onClick={() => navigate('/privacy')} className="login-link">
                    《隐私政策》
                  </button>
                </span>
              </label>
            )}
            {(isRegister || isReset) && (
              <div className="login-field">
                <label className="login-field-label">验证码</label>
                <div className="login-code-row">
                  <input
                    type="text"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    className="login-input"
                    placeholder="6 位验证码"
                    required
                    maxLength={6}
                  />
                  <button
                    type="button"
                    onClick={handleSendCode}
                    disabled={sendingCode || cooldown > 0 || !email || (isRegister && !agreed)}
                    className="login-code-btn"
                  >
                    {cooldown > 0 ? `${cooldown}s` : sendingCode ? '发送中...' : '发送验证码'}
                  </button>
                </div>
              </div>
            )}
            {turnstileSiteKey && !canBypassTurnstile && (
              <div className="login-field">
                <label className="login-field-label">人机验证</label>
                <div id="turnstile-box" className="login-turnstile" />
              </div>
            )}
            {error && <p className="login-error">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="login-submit-btn"
            >
              {loading ? '处理中...' : isRegister ? '注册' : isReset ? '重置密码' : '登录'}
            </button>
          </form>

          <div className="login-switch-row">
            {isReset ? (
              <>
                <button onClick={() => switchMode('login')} className="login-link">返回登录</button>
                {registerEnabled && (
                  <>
                    <span className="login-switch-sep">|</span>
                    <button onClick={() => switchMode('register')} className="login-link">去注册</button>
                  </>
                )}
              </>
            ) : registerEnabled ? (
              <>
                {isRegister ? '已有账号？' : '没有账号？'}
                <button onClick={() => switchMode(isRegister ? 'login' : 'register')} className="login-link">
                  {isRegister ? '去登录' : '去注册'}
                </button>
                {!isRegister && (
                  <>
                    <span className="login-switch-sep">|</span>
                    <button onClick={() => switchMode('reset')} className="login-link">忘记密码</button>
                  </>
                )}
              </>
            ) : !isRegister ? (
              <button onClick={() => switchMode('reset')} className="login-link">忘记密码</button>
            ) : (
              <span className="login-disabled-text">注册入口已关闭</span>
            )}
          </div>

          <p className="login-footer-text">Atelier · AI 工作台</p>
        </div>
      </div>
    </div>
  )
}

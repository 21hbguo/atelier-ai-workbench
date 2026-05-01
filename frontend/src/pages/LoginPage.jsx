import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI } from '../api'

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = isRegister
        ? (await authAPI.register({ username, password, nickname: nickname || username })).data
        : (await authAPI.login({ username, password })).data

      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>AI 图像生成</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            {isRegister ? '创建账号开始创作' : '登录以继续'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
              style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              placeholder="3-20 个字符"
              required
              minLength={3}
              maxLength={20}
            />
          </div>

          {isRegister && (
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>昵称</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border text-sm"
                style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                placeholder="可选，默认为用户名"
              />
            </div>
          )}

          <div>
            <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border text-sm"
              style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
              placeholder="至少 6 个字符"
              required
              minLength={6}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity"
            style={{ background: 'var(--accent)', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? '处理中...' : isRegister ? '注册' : '登录'}
          </button>
        </form>

        <p className="text-center mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {isRegister ? '已有账号？' : '没有账号？'}
          <button
            onClick={() => { setIsRegister(!isRegister); setError('') }}
            className="ml-1 font-medium"
            style={{ color: 'var(--accent)' }}
          >
            {isRegister ? '去登录' : '去注册'}
          </button>
        </p>
      </div>
    </div>
  )
}

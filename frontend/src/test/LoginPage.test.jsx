import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useNavigate, useLocation } from 'react-router-dom'
import LoginPage from '../pages/LoginPage'
import { authAPI, configAPI } from '../api'
import { writeUser } from '../auth'

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
  useLocation: vi.fn(),
}))

vi.mock('../api', () => ({
  authAPI: {
    login: vi.fn(),
    register: vi.fn(),
    resetPassword: vi.fn(),
    sendCode: vi.fn(),
    sendResetCode: vi.fn(),
  },
  configAPI: {
    get: vi.fn(),
  },
}))

vi.mock('../auth', () => ({
  writeUser: vi.fn(),
}))

const mockNavigate = vi.fn()

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockNavigate.mockClear()
  useNavigate.mockReturnValue(mockNavigate)
  useLocation.mockReturnValue({ search: '', pathname: '/login' })
  configAPI.get.mockResolvedValue({ data: { register_enabled: true } })
})

const renderLogin = (search = '') => {
  useLocation.mockReturnValue({ search, pathname: '/login' })
  return render(<LoginPage />)
}

const getForm = () => document.querySelector('form')
const submitForm = () => fireEvent.submit(getForm())
const clickSubmit = (name) => fireEvent.click(screen.getByRole('button', { name }))

describe('LoginPage', () => {
  it('renders login form with account and password fields', async () => {
    renderLogin()
    await waitFor(() => {
      expect(screen.getByPlaceholderText('输入账号或注册邮箱')).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('至少 6 个字符')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
  })

  it('renders title and subtitle', async () => {
    renderLogin()
    await waitFor(() => {
      expect(screen.getByText('Atelier')).toBeInTheDocument()
    })
    expect(screen.getByText('欢迎回来，继续你的创作')).toBeInTheDocument()
  })

  it('successful login navigates to home', async () => {
    const user = { account: 'testuser', points: 10 }
    authAPI.login.mockResolvedValue({ data: { user } })
    renderLogin()

    fireEvent.change(screen.getByPlaceholderText('输入账号或注册邮箱'), { target: { value: 'testuser' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'password123' } })
    submitForm()

    await waitFor(() => {
      expect(authAPI.login).toHaveBeenCalledWith({
        account: 'testuser',
        password: 'password123',
        turnstile_token: 'dev-bypass',
      })
    })
    expect(writeUser).toHaveBeenCalledWith(user)
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('failed login shows error message', async () => {
    authAPI.login.mockRejectedValue(new Error('账号或密码错误'))
    renderLogin()

    fireEvent.change(screen.getByPlaceholderText('输入账号或注册邮箱'), { target: { value: 'baduser' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'badpass' } })
    submitForm()

    await waitFor(() => {
      expect(screen.getByText('账号或密码错误')).toBeInTheDocument()
    })
  })

  it('shows loading state during submission', async () => {
    let resolveLogin
    authAPI.login.mockReturnValue(new Promise(r => { resolveLogin = r }))
    renderLogin()

    fireEvent.change(screen.getByPlaceholderText('输入账号或注册邮箱'), { target: { value: 'user' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'password123' } })
    submitForm()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '处理中...' })).toBeDisabled()
    })

    resolveLogin({ data: { user: { account: 'user' } } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '登录' })).toBeEnabled()
    })
  })

  it('toggles to register mode', async () => {
    renderLogin()
    await waitFor(() => {
      expect(screen.getByText('去注册')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('去注册'))

    expect(mockNavigate).toHaveBeenCalledWith('/login?mode=register', { replace: true })
    await waitFor(() => {
      expect(screen.getByText('创建账号，开始你的 AI 创作之旅')).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('4-16 位字母、数字或下划线')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('仅支持常用邮箱')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument()
  })

  it('toggles to forgot password mode', async () => {
    renderLogin()
    await waitFor(() => {
      expect(screen.getByText('忘记密码')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('忘记密码'))

    expect(mockNavigate).toHaveBeenCalledWith('/login?mode=reset', { replace: true })
    await waitFor(() => {
      expect(screen.getByText('通过邮箱验证码重置密码')).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText('仅支持常用邮箱')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('至少 6 个字符')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重置密码' })).toBeInTheDocument()
  })

  it('initiates in register mode via URL param', async () => {
    renderLogin('?mode=register')
    await waitFor(() => {
      expect(screen.getByText('创建账号，开始你的 AI 创作之旅')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument()
  })

  it('initiates in reset mode via URL param', async () => {
    renderLogin('?mode=reset')
    await waitFor(() => {
      expect(screen.getByText('通过邮箱验证码重置密码')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '重置密码' })).toBeInTheDocument()
  })

  it('returns to login from register mode', async () => {
    renderLogin('?mode=register')
    await waitFor(() => {
      expect(screen.getByText('去登录')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('去登录'))

    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('returns to login from reset mode', async () => {
    renderLogin('?mode=reset')
    await waitFor(() => {
      expect(screen.getByText('返回登录')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('返回登录'))

    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
  })

  it('validates account format in register mode', async () => {
    renderLogin('?mode=register')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('4-16 位字母、数字或下划线')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('4-16 位字母、数字或下划线'), { target: { value: 'ab' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByPlaceholderText('仅支持常用邮箱'), { target: { value: 'test@qq.com' } })
    fireEvent.click(screen.getByRole('checkbox'))
    submitForm()

    await waitFor(() => {
      expect(screen.getByText('账号需为4到16位字母、数字或下划线')).toBeInTheDocument()
    })
    expect(authAPI.register).not.toHaveBeenCalled()
  })

  it('validates agreement checkbox in register mode', async () => {
    renderLogin('?mode=register')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('4-16 位字母、数字或下划线')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('4-16 位字母、数字或下划线'), { target: { value: 'testuser' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByPlaceholderText('仅支持常用邮箱'), { target: { value: 'test@qq.com' } })
    clickSubmit('注册')

    await waitFor(() => {
      expect(authAPI.register).not.toHaveBeenCalled()
    })
  })

  it('validates email domain in register mode', async () => {
    renderLogin('?mode=register')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('仅支持常用邮箱')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('4-16 位字母、数字或下划线'), { target: { value: 'testuser' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByPlaceholderText('仅支持常用邮箱'), { target: { value: 'test@invalid.com' } })
    fireEvent.click(screen.getByRole('checkbox'))
    clickSubmit('注册')

    await waitFor(() => {
      expect(authAPI.register).not.toHaveBeenCalled()
    })
  })

  it('successful register navigates to home', async () => {
    const user = { account: 'newuser', points: 50 }
    authAPI.register.mockResolvedValue({ data: { user } })
    renderLogin('?mode=register')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('4-16 位字母、数字或下划线')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('4-16 位字母、数字或下划线'), { target: { value: 'newuser' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByPlaceholderText('仅支持常用邮箱'), { target: { value: 'test@qq.com' } })
    fireEvent.click(screen.getByRole('checkbox'))
    submitForm()

    await waitFor(() => {
      expect(authAPI.register).toHaveBeenCalledWith(expect.objectContaining({
        account: 'newuser',
        password: 'password123',
        email: 'test@qq.com',
      }))
    })
    expect(writeUser).toHaveBeenCalledWith(user)
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('successful reset password navigates to home', async () => {
    const user = { account: 'user' }
    authAPI.resetPassword.mockResolvedValue({ data: { user } })
    renderLogin('?mode=reset')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('仅支持常用邮箱')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('仅支持常用邮箱'), { target: { value: 'test@qq.com' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'newpass123' } })
    fireEvent.change(screen.getByPlaceholderText('6 位验证码'), { target: { value: '123456' } })
    submitForm()

    await waitFor(() => {
      expect(authAPI.resetPassword).toHaveBeenCalledWith(expect.objectContaining({
        email: 'test@qq.com',
        code: '123456',
        password: 'newpass123',
      }))
    })
    expect(writeUser).toHaveBeenCalledWith(user)
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('shows register disabled message when register is off', async () => {
    configAPI.get.mockResolvedValue({ data: { register_enabled: false } })
    renderLogin()
    await waitFor(() => {
      expect(screen.getByText('当前仅开放登录，注册已关闭')).toBeInTheDocument()
    })
    expect(screen.queryByText('去注册')).not.toBeInTheDocument()
  })

  it('renders send code button in register mode', async () => {
    renderLogin('?mode=register')
    await waitFor(() => {
      expect(screen.getByText('发送验证码')).toBeInTheDocument()
    })
  })

  it('renders send code button in reset mode', async () => {
    renderLogin('?mode=reset')
    await waitFor(() => {
      expect(screen.getByText('发送验证码')).toBeInTheDocument()
    })
  })

  it('validates reset password length', async () => {
    renderLogin('?mode=reset')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('仅支持常用邮箱')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('仅支持常用邮箱'), { target: { value: 'test@qq.com' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: '123' } })
    submitForm()

    await waitFor(() => {
      expect(screen.getByText('新密码至少 6 个字符')).toBeInTheDocument()
    })
    expect(authAPI.resetPassword).not.toHaveBeenCalled()
  })

  it('validates email domain in reset mode', async () => {
    renderLogin('?mode=reset')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('仅支持常用邮箱')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('仅支持常用邮箱'), { target: { value: 'test@bad.com' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'newpass123' } })
    submitForm()

    await waitFor(() => {
      expect(screen.getByText('请使用常用邮箱地址')).toBeInTheDocument()
    })
  })

  it('sends verification code in register mode', async () => {
    authAPI.sendCode.mockResolvedValue({})
    renderLogin('?mode=register')
    await waitFor(() => {
      expect(screen.getByPlaceholderText('4-16 位字母、数字或下划线')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByPlaceholderText('4-16 位字母、数字或下划线'), { target: { value: 'testuser' } })
    fireEvent.change(screen.getByPlaceholderText('至少 6 个字符'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByPlaceholderText('仅支持常用邮箱'), { target: { value: 'test@qq.com' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('发送验证码'))

    await waitFor(() => {
      expect(authAPI.sendCode).toHaveBeenCalledWith('test@qq.com', 'dev-bypass')
    })
  })
})

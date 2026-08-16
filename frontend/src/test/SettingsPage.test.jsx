import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { sessionsMock, changePasswordMock, alertMock, confirmMock, configGetMock, getCiMock, updateCiMock } = vi.hoisted(() => ({
  sessionsMock: vi.fn(),
  changePasswordMock: vi.fn(),
  alertMock: vi.fn(),
  confirmMock: vi.fn(async () => true),
  configGetMock: vi.fn(),
  getCiMock: vi.fn(),
  updateCiMock: vi.fn(),
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: alertMock, confirm: confirmMock, choose: vi.fn(async () => null) }),
}))

vi.mock('../api', () => ({
  accountAPI: {
    sessions: sessionsMock,
    changePassword: changePasswordMock,
    getCustomInstructions: getCiMock,
    updateCustomInstructions: updateCiMock,
  },
  configAPI: { get: configGetMock },
  notificationAPI: { unreadCount: vi.fn(async () => ({ data: { count: 0 } })) },
  announcementAPI: { getUnread: vi.fn(async () => ({ data: { items: [] } })) },
}))

vi.mock('../components/Sidebar', () => ({ default: () => <div data-testid="sidebar" /> }))

import SettingsPage from '../pages/SettingsPage'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../ThemeContext'
import { LayoutModeProvider } from '../LayoutModeContext'

const renderPage = () =>
  render(
    <MemoryRouter>
      <ThemeProvider>
        <LayoutModeProvider>
          <SettingsPage />
        </LayoutModeProvider>
      </ThemeProvider>
    </MemoryRouter>
  )

const mockSessions = (items, total = items.length) => {
  sessionsMock.mockResolvedValue({ data: { items, total } })
}

beforeEach(() => {
  cleanup()
  alertMock.mockReset()
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
  sessionsMock.mockReset()
  changePasswordMock.mockReset()
  configGetMock.mockReset()
  configGetMock.mockResolvedValue({ data: { show_login_sessions: false } })
  getCiMock.mockReset()
  getCiMock.mockResolvedValue({ data: { custom_instructions: '' } })
  updateCiMock.mockReset()
  updateCiMock.mockResolvedValue({})
  mockSessions([])
})

describe('SettingsPage', () => {
  it('renders password change section', async () => {
    renderPage()
    expect(screen.getByText('修改密码')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('当前密码')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('新密码（至少6位）')).toBeInTheDocument()
    expect(screen.getByText('确认修改')).toBeInTheDocument()
  })

  it('hides session history section but still fetches sessions (feature flag off)', async () => {
    renderPage()
    expect(screen.queryByText('最近登录会话')).not.toBeInTheDocument()
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())
  })

  it('disables submit when passwords are empty', () => {
    renderPage()
    expect(screen.getByText('确认修改')).toBeDisabled()
  })

  it('disables submit when new password is shorter than 6 chars', () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('当前密码'), { target: { value: 'abc' } })
    fireEvent.change(screen.getByPlaceholderText('新密码（至少6位）'), { target: { value: '12345' } })
    expect(screen.getByText('确认修改')).toBeDisabled()
  })

  it('enables submit when both passwords are valid', () => {
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('当前密码'), { target: { value: 'oldpass' } })
    fireEvent.change(screen.getByPlaceholderText('新密码（至少6位）'), { target: { value: 'newpass' } })
    expect(screen.getByText('确认修改')).not.toBeDisabled()
  })

  it('calls changePassword and clears form on success', async () => {
    changePasswordMock.mockResolvedValue({})
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('当前密码'), { target: { value: 'oldpass' } })
    fireEvent.change(screen.getByPlaceholderText('新密码（至少6位）'), { target: { value: 'newpass' } })
    fireEvent.click(screen.getByText('确认修改'))
    await waitFor(() => expect(changePasswordMock).toHaveBeenCalledWith({ old_password: 'oldpass', new_password: 'newpass' }))
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('密码修改成功'))
    expect(screen.getByPlaceholderText('当前密码').value).toBe('')
    expect(screen.getByPlaceholderText('新密码（至少6位）').value).toBe('')
  })

  it('shows error dialog on password change failure', async () => {
    changePasswordMock.mockRejectedValue(new Error('旧密码错误'))
    renderPage()
    fireEvent.change(screen.getByPlaceholderText('当前密码'), { target: { value: 'wrong' } })
    fireEvent.change(screen.getByPlaceholderText('新密码（至少6位）'), { target: { value: 'newpass' } })
    fireEvent.click(screen.getByText('确认修改'))
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('旧密码错误'))
  })

  it('does not show session loading/empty/items UI while hidden', async () => {
    mockSessions([
      { id: 's1', ip: '1.2.3.4', user_agent: 'Chrome/120', risk_level: 'low', is_current: true, created_at: '2025-01-01T12:00:00+08:00' },
    ])
    renderPage()
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument()
    expect(screen.queryByText('暂无记录')).not.toBeInTheDocument()
    expect(screen.queryByText('1.2.3.4')).not.toBeInTheDocument()
    expect(screen.queryByText('未知IP')).not.toBeInTheDocument()
    expect(screen.queryByText('当前')).not.toBeInTheDocument()
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())
  })

  it('does not show risk warning even with high-risk sessions while hidden', async () => {
    mockSessions([
      { id: 's1', ip: '1.2.3.4', user_agent: 'Chrome', risk_level: 'high', is_current: false, created_at: '2025-01-01T12:00:00+08:00' },
    ])
    renderPage()
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())
    expect(screen.queryByText(/检测到近24小时存在多IP/)).not.toBeInTheDocument()
  })

  it('does not show risk warning when all sessions are low risk', async () => {
    mockSessions([
      { id: 's1', ip: '1.2.3.4', user_agent: 'Chrome', risk_level: 'low', is_current: true, created_at: '2025-01-01T12:00:00+08:00' },
    ])
    renderPage()
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())
    expect(screen.queryByText(/检测到近24小时/)).not.toBeInTheDocument()
  })

  it('shows alert on session fetch failure', async () => {
    sessionsMock.mockRejectedValue(new Error('网络错误'))
    renderPage()
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('网络错误'))
  })

  it('shows session history and risk warning when config flag is on', async () => {
    configGetMock.mockResolvedValue({ data: { show_login_sessions: true } })
    mockSessions([
      { id: 's1', ip: '1.2.3.4', user_agent: 'Chrome', risk_level: 'high', is_current: true, created_at: '2025-01-01T12:00:00+08:00' },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText('最近登录会话')).toBeInTheDocument())
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument()
    expect(screen.getByText('Chrome')).toBeInTheDocument()
    expect(screen.getByText('当前')).toBeInTheDocument()
    expect(screen.getByText(/检测到近24小时存在多IP/)).toBeInTheDocument()
  })

  it('does not render session UI when config flag is off', async () => {
    mockSessions([
      { id: 's1', ip: '1.2.3.4', user_agent: 'Chrome', risk_level: 'high', is_current: true, created_at: '2025-01-01T12:00:00+08:00' },
    ])
    renderPage()
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())
    expect(screen.queryByText('最近登录会话')).not.toBeInTheDocument()
    expect(screen.queryByText(/检测到近24小时存在多IP/)).not.toBeInTheDocument()
  })

  describe('自定义指令', () => {
    const ciInput = () => screen.getByPlaceholderText(/例：请用简洁口语化风格回复/)

    it('renders card and backfills saved instructions', async () => {
      getCiMock.mockResolvedValue({ data: { custom_instructions: '请用简洁风格回复' } })
      renderPage()
      expect(screen.getByText('自定义指令')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByText('8/2000')).toBeInTheDocument())
      expect(ciInput().value).toBe('请用简洁风格回复')
    })

    it('saves trimmed instructions and shows success', async () => {
      renderPage()
      await waitFor(() => expect(getCiMock).toHaveBeenCalled())
      fireEvent.change(ciInput(), { target: { value: '  请用中文  ' } })
      fireEvent.click(screen.getByText('保存'))
      await waitFor(() => expect(updateCiMock).toHaveBeenCalledWith({ custom_instructions: '请用中文' }))
      await waitFor(() => expect(alertMock).toHaveBeenCalledWith('保存成功'))
    })

    it('shows error dialog on save failure', async () => {
      updateCiMock.mockRejectedValue(new Error('内容包含违规词汇，请修改后重试'))
      renderPage()
      await waitFor(() => expect(getCiMock).toHaveBeenCalled())
      fireEvent.change(ciInput(), { target: { value: 'bad' } })
      fireEvent.click(screen.getByText('保存'))
      await waitFor(() => expect(alertMock).toHaveBeenCalledWith('内容包含违规词汇，请修改后重试'))
    })

    it('disables save when longer than 2000 chars', async () => {
      renderPage()
      await waitFor(() => expect(getCiMock).toHaveBeenCalled())
      fireEvent.change(ciInput(), { target: { value: 'x'.repeat(2001) } })
      expect(screen.getByText('2001/2000')).toBeInTheDocument()
      expect(screen.getByText('保存')).toBeDisabled()
    })

    it('reset restores saved content', async () => {
      getCiMock.mockResolvedValue({ data: { custom_instructions: '已保存内容' } })
      renderPage()
      await waitFor(() => expect(screen.getByText('5/2000')).toBeInTheDocument())
      fireEvent.change(ciInput(), { target: { value: '临时修改' } })
      fireEvent.click(screen.getByText('重置'))
      expect(ciInput().value).toBe('已保存内容')
    })
  })
})

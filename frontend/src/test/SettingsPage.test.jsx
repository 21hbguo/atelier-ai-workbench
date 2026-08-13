import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { sessionsMock, changePasswordMock, alertMock, confirmMock } = vi.hoisted(() => ({
  sessionsMock: vi.fn(),
  changePasswordMock: vi.fn(),
  alertMock: vi.fn(),
  confirmMock: vi.fn(async () => true),
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: alertMock, confirm: confirmMock, choose: vi.fn(async () => null) }),
}))

vi.mock('../api', () => ({
  accountAPI: { sessions: sessionsMock, changePassword: changePasswordMock },
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

  it('hides recent login sessions section but still fetches sessions for risk warning', async () => {
    mockSessions([
      { id: 's1', ip: '1.2.3.4', user_agent: 'Chrome/120', risk_level: 'low', is_current: true, created_at: '2025-01-01T12:00:00+08:00' },
    ])
    renderPage()
    expect(screen.queryByText('最近登录会话')).not.toBeInTheDocument()
    expect(screen.queryByText('1.2.3.4')).not.toBeInTheDocument()
    expect(screen.queryByText('暂无记录')).not.toBeInTheDocument()
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

  it('shows risk warning when a session has high risk', async () => {
    mockSessions([
      { id: 's1', ip: '1.2.3.4', user_agent: 'Chrome', risk_level: 'high', is_current: false, created_at: '2025-01-01T12:00:00+08:00' },
    ])
    renderPage()
    await waitFor(() => expect(screen.getByText(/检测到近24小时存在多IP/)).toBeInTheDocument())
  })

  it('does not show risk warning when all sessions are low risk', async () => {
    mockSessions([
      { id: 's1', ip: '1.2.3.4', user_agent: 'Chrome', risk_level: 'low', is_current: true, created_at: '2025-01-01T12:00:00+08:00' },
    ])
    renderPage()
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())
    expect(screen.queryByText(/检测到近24小时/)).not.toBeInTheDocument()
  })

})

import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const {
  alertMock,
  pointsBalanceMock,
  pointsCheckinStatusMock,
  pointsCheckinMock,
  authLogoutMock,
  unreadCountMock,
  getUnreadMock,
  toggleThemeMock,
  toggleLayoutModeMock,
  toggleCurrentColsMock,
  readUserMock,
  clearUserMock,
} = vi.hoisted(() => ({
  alertMock: vi.fn(),
  pointsBalanceMock: vi.fn(),
  pointsCheckinStatusMock: vi.fn(),
  pointsCheckinMock: vi.fn(),
  authLogoutMock: vi.fn(),
  unreadCountMock: vi.fn(),
  getUnreadMock: vi.fn(),
  toggleThemeMock: vi.fn(),
  toggleLayoutModeMock: vi.fn(),
  toggleCurrentColsMock: vi.fn(),
  readUserMock: vi.fn(),
  clearUserMock: vi.fn(),
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: alertMock, confirm: vi.fn(async () => true), choose: vi.fn(async () => null) }),
}))

vi.mock('../ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: toggleThemeMock }),
}))

vi.mock('../LayoutModeContext', () => ({
  useLayoutMode: () => ({
    layoutMode: 'masonry',
    toggleLayoutMode: toggleLayoutModeMock,
    currentCols: 3,
    currentBreakpointLabel: '桌面',
    toggleCurrentCols: toggleCurrentColsMock,
  }),
}))

vi.mock('../auth', () => ({
  readUser: readUserMock,
  clearUser: clearUserMock,
  writeUser: vi.fn(),
}))

vi.mock('../api', () => ({
  pointsAPI: {
    balance: pointsBalanceMock,
    checkinStatus: pointsCheckinStatusMock,
    checkin: pointsCheckinMock,
  },
  authAPI: { logout: authLogoutMock },
  notificationAPI: { unreadCount: unreadCountMock },
  announcementAPI: { getUnread: getUnreadMock },
}))

let mockNavigate = vi.fn()
let mockLocation = { pathname: '/', search: '' }

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
  }
})

import Sidebar from '../components/Sidebar'
import { MemoryRouter } from 'react-router-dom'

const renderSidebar = (props = {}) =>
  render(
    <MemoryRouter>
      <Sidebar open={false} onClose={vi.fn()} {...props} />
    </MemoryRouter>
  )

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockNavigate = vi.fn()
  mockLocation = { pathname: '/', search: '' }
  readUserMock.mockReturnValue({ id: 1, username: 'tester', nickname: '测试员', points: 50, is_admin: false })
  pointsBalanceMock.mockResolvedValue({ data: { points: 80 } })
  pointsCheckinStatusMock.mockResolvedValue({ data: { checked_in_today: false } })
  pointsCheckinMock.mockResolvedValue({ data: { points: 90, message: '签到成功' } })
  authLogoutMock.mockResolvedValue({})
  unreadCountMock.mockResolvedValue({ data: { count: 3 } })
  getUnreadMock.mockResolvedValue({ data: { items: [{ id: 1 }] } })
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ total: 0 }) }))
})

describe('Sidebar', () => {
  it('renders all navigation links', () => {
    renderSidebar()
    expect(screen.getByText('AI绘画')).toBeInTheDocument()
    expect(screen.getByText('广场')).toBeInTheDocument()
    expect(screen.getByText('我的提示词')).toBeInTheDocument()
    expect(screen.getAllByText('积分详情').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('通知')).toBeInTheDocument()
  })

  it('displays user nickname', () => {
    renderSidebar()
    expect(screen.getByText('测试员')).toBeInTheDocument()
  })

  it('falls back to username when nickname is empty', () => {
    readUserMock.mockReturnValue({ id: 1, username: 'tester', nickname: '', points: 0, is_admin: false })
    renderSidebar()
    expect(screen.getByText('tester')).toBeInTheDocument()
  })

  it('shows admin links for admin user', () => {
    readUserMock.mockReturnValue({ id: 1, username: 'admin', nickname: '管理员', points: 0, is_admin: true })
    renderSidebar()
    expect(screen.getByText('管理后台')).toBeInTheDocument()
    expect(screen.getByText('充值审核')).toBeInTheDocument()
  })

  it('hides admin links for non-admin user', () => {
    readUserMock.mockReturnValue({ id: 1, username: 'tester', nickname: '普通', points: 0, is_admin: false })
    renderSidebar()
    expect(screen.queryByText('管理后台')).not.toBeInTheDocument()
    expect(screen.queryByText('充值审核')).not.toBeInTheDocument()
  })

  it('shows notification badge when unread count > 0', async () => {
    unreadCountMock.mockResolvedValue({ data: { count: 5 } })
    getUnreadMock.mockResolvedValue({ data: { items: [] } })
    renderSidebar()
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument())
  })

  it('hides notification badge when unread count is 0', async () => {
    unreadCountMock.mockResolvedValue({ data: { count: 0 } })
    getUnreadMock.mockResolvedValue({ data: { items: [] } })
    renderSidebar()
    await waitFor(() => {
      const noticeLink = screen.getByText('通知').closest('a')
      expect(noticeLink.querySelector('span.rounded-full')).toBeNull()
    })
  })

  it('shows 99+ when notification count exceeds 99', async () => {
    unreadCountMock.mockResolvedValue({ data: { count: 60 } })
    getUnreadMock.mockResolvedValue({ data: { items: Array.from({ length: 50 }, (_, i) => ({ id: i })) } })
    renderSidebar()
    await waitFor(() => expect(screen.getByText('99+')).toBeInTheDocument())
  })

  it('renders mobile overlay when open and closes on overlay click', () => {
    const onClose = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <Sidebar open={true} onClose={onClose} />
      </MemoryRouter>
    )
    const overlay = container.querySelector('[class*="fixed"][class*="inset-0"][class*="bg-black"]')
    expect(overlay).toBeInTheDocument()
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides overlay when closed', () => {
    const { container } = renderSidebar({ open: false })
    const overlay = container.querySelector('[class*="fixed"][class*="inset-0"][class*="bg-black"]')
    expect(overlay).not.toBeInTheDocument()
  })

  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(
      <MemoryRouter>
        <Sidebar open={true} onClose={onClose} />
      </MemoryRouter>
    )
    const aside = container.querySelector('aside')
    const closeBtn = within(aside).getByRole('button', { name: '' })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('fetches balance and checkin status on mount', async () => {
    renderSidebar()
    await waitFor(() => {
      expect(pointsBalanceMock).toHaveBeenCalled()
      expect(pointsCheckinStatusMock).toHaveBeenCalled()
      expect(unreadCountMock).toHaveBeenCalled()
      expect(getUnreadMock).toHaveBeenCalled()
    })
  })

  it('calls logout and navigates to login', async () => {
    renderSidebar()
    fireEvent.click(screen.getByText('退出登录'))
    await waitFor(() => {
      expect(authLogoutMock).toHaveBeenCalled()
      expect(clearUserMock).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith('/login')
    })
  })

  it('toggles theme when theme button is clicked', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('深色'))
    expect(toggleThemeMock).toHaveBeenCalledTimes(1)
  })

  it('toggles layout mode', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('切换为网格'))
    expect(toggleLayoutModeMock).toHaveBeenCalledTimes(1)
  })

  it('toggles column count', () => {
    renderSidebar()
    fireEvent.click(screen.getByText('桌面列数 3列'))
    expect(toggleCurrentColsMock).toHaveBeenCalledTimes(1)
  })

  it('renders footer links', () => {
    renderSidebar()
    expect(screen.getByText('用户协议')).toBeInTheDocument()
    expect(screen.getByText('隐私政策')).toBeInTheDocument()
    expect(screen.getByText('捐赠说明与积分规则')).toBeInTheDocument()
  })

  it('fetches recharge pending count for admin', async () => {
    readUserMock.mockReturnValue({ id: 1, username: 'admin', nickname: 'A', points: 0, is_admin: true })
    global.fetch = vi.fn(async (url) => {
      if (url.includes('recharge-requests')) return { ok: true, json: async () => ({ total: 3 }) }
      return { ok: true, json: async () => ({}) }
    })
    renderSidebar()
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('recharge-requests'),
        expect.any(Object)
      )
    })
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument())
  })

  it('does not fetch recharge count for non-admin', async () => {
    readUserMock.mockReturnValue({ id: 1, username: 'tester', nickname: 'T', points: 0, is_admin: false })
    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    global.fetch = fetchSpy
    renderSidebar()
    await waitFor(() => expect(pointsBalanceMock).toHaveBeenCalled())
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('recharge-requests'),
      expect.any(Object)
    )
  })
})

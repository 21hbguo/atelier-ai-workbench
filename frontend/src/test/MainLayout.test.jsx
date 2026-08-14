import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const {
  unreadCountMock,
  getUnreadMock,
  readUserMock,
  pointsBalanceMock,
  pointsCheckinStatusMock,
  authLogoutMock,
  toggleThemeMock,
  toggleLayoutModeMock,
  toggleCurrentColsMock,
  clearUserMock,
  subscriptionMeMock,
  notificationListMock,
  announcementListMock,
} = vi.hoisted(() => ({
  unreadCountMock: vi.fn(),
  getUnreadMock: vi.fn(),
  readUserMock: vi.fn(),
  pointsBalanceMock: vi.fn(),
  pointsCheckinStatusMock: vi.fn(),
  authLogoutMock: vi.fn(),
  toggleThemeMock: vi.fn(),
  toggleLayoutModeMock: vi.fn(),
  toggleCurrentColsMock: vi.fn(),
  clearUserMock: vi.fn(),
  subscriptionMeMock: vi.fn(),
  notificationListMock: vi.fn(),
  announcementListMock: vi.fn(),
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: vi.fn(), confirm: vi.fn(async () => true), choose: vi.fn(async () => null) }),
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
    checkin: vi.fn(async () => ({ data: { points: 10, message: 'ok' } })),
  },
  authAPI: { logout: authLogoutMock },
  notificationAPI: { unreadCount: unreadCountMock, list: notificationListMock },
  announcementAPI: { getUnread: getUnreadMock, list: announcementListMock },
  subscriptionAPI: { me: subscriptionMeMock },
}))

let mockLocation = { pathname: '/', search: '' }

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => mockLocation,
  }
})

import MainLayout from '../components/MainLayout'
import NotificationsModal from '../components/NotificationsModal'
import { MemoryRouter } from 'react-router-dom'

const renderLayout = (props = {}) =>
  render(
    <MemoryRouter>
      <MainLayout {...props}>
        <div data-testid="child">child content</div>
      </MainLayout>
    </MemoryRouter>
  )

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockLocation = { pathname: '/', search: '' }
  readUserMock.mockReturnValue({ id: 1, username: 'tester', nickname: 'T', points: 50, is_admin: false })
  pointsBalanceMock.mockResolvedValue({ data: { points: 80 } })
  pointsCheckinStatusMock.mockResolvedValue({ data: { checked_in_today: false } })
  authLogoutMock.mockResolvedValue({})
  unreadCountMock.mockResolvedValue({ data: { count: 0 } })
  getUnreadMock.mockResolvedValue({ data: { items: [] } })
  notificationListMock.mockResolvedValue({ data: { items: [] } })
  announcementListMock.mockResolvedValue({ data: { items: [] } })
  subscriptionMeMock.mockResolvedValue({ data: { plan: null } })
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})

describe('MainLayout', () => {
  it('renders children', () => {
    renderLayout()
    expect(screen.getByTestId('child')).toHaveTextContent('child content')
  })

  it('renders Sidebar component', () => {
    renderLayout()
    expect(screen.getByText('Atelier AI')).toBeInTheDocument()
  })

  it('renders mobile topbar with quick nav links', () => {
    readUserMock.mockReturnValue({ id: 1, username: 'admin', nickname: 'A', points: 0, is_admin: true })
    renderLayout()
    const topbarLinks = document.querySelectorAll('.mobile-topbar-link-text')
    const labels = [...topbarLinks].map(el => el.textContent)
    expect(labels).toEqual(['助手', '绘画', '通知'])
  })

  it('shows notification link in topbar for regular users', () => {
    renderLayout()
    const topbarLinks = document.querySelectorAll('.mobile-topbar-link-text')
    const labels = [...topbarLinks].map(el => el.textContent)
    expect(labels).toEqual(['助手', '绘画', '通知'])
  })

  it('opens sidebar when menu button is clicked', () => {
    renderLayout()
    const menuBtn = document.querySelector('.mobile-topbar-menu')
    fireEvent.click(menuBtn)
    const sidebar = document.querySelector('aside')
    expect(sidebar.parentElement.className).toContain('translate-x-0')
  })

  it('pushes history marker when sidebar opens', () => {
    renderLayout()
    fireEvent.click(document.querySelector('.mobile-topbar-menu'))
    expect(window.history.state?.atelierSidebar).toBe('open')
    window.history.replaceState(null, '')
  })

  it('closes sidebar on system back (popstate)', () => {
    renderLayout()
    fireEvent.click(document.querySelector('.mobile-topbar-menu'))
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')) })
    const sidebar = document.querySelector('aside')
    expect(sidebar.parentElement.className).toContain('-translate-x-full')
    window.history.replaceState(null, '')
  })

  it('goes back to clean up pushed history when closing via overlay', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    renderLayout()
    fireEvent.click(document.querySelector('.mobile-topbar-menu'))
    const overlay = document.querySelector('[class*="fixed"][class*="inset-0"][class*="bg-black"]')
    fireEvent.click(overlay)
    expect(backSpy).toHaveBeenCalledTimes(1)
    backSpy.mockRestore()
  })

  it('fetches unread counts on mount', async () => {
    renderLayout()
    await waitFor(() => {
      expect(unreadCountMock).toHaveBeenCalled()
      expect(getUnreadMock).toHaveBeenCalled()
    }, { timeout: 3000 })
  })

  it('shows notification dot when unread count > 0', async () => {
    readUserMock.mockReturnValue({ id: 1, username: 'admin', nickname: 'A', points: 0, is_admin: true })
    unreadCountMock.mockResolvedValue({ data: { count: 3 } })
    getUnreadMock.mockResolvedValue({ data: { items: [] } })
    renderLayout()
    await waitFor(() => {
      const dots = document.querySelectorAll('.rounded-full')
      const errorDot = [...dots].find(el => el.style.background === 'var(--color-error)')
      expect(errorDot).toBeTruthy()
    }, { timeout: 3000 })
  })

  it('hides notification dot when unread count is 0', async () => {
    unreadCountMock.mockResolvedValue({ data: { count: 0 } })
    getUnreadMock.mockResolvedValue({ data: { items: [] } })
    renderLayout()
    await waitFor(() => {
      expect(unreadCountMock).toHaveBeenCalled()
    }, { timeout: 3000 })
    const dots = document.querySelectorAll('.rounded-full')
    const errorDot = [...dots].find(el => el.style.background === 'var(--color-error)')
    expect(errorDot).toBeFalsy()
  })

  it('applies dragProps to root element', () => {
    const { container } = render(
      <MemoryRouter>
        <MainLayout dragProps={{ 'data-testid': 'root' }}>
          <div>child</div>
        </MainLayout>
      </MemoryRouter>
    )
    expect(screen.getByTestId('root')).toBeInTheDocument()
  })

  it('handles notifications-updated event', async () => {
    renderLayout()
    await waitFor(() => {
      expect(unreadCountMock).toHaveBeenCalled()
    }, { timeout: 3000 })
    const before = unreadCountMock.mock.calls.length
    unreadCountMock.mockResolvedValue({ data: { count: 7 } })
    getUnreadMock.mockResolvedValue({ data: { items: [] } })
    window.dispatchEvent(new Event('notifications-updated'))
    await waitFor(() => {
      expect(unreadCountMock.mock.calls.length).toBeGreaterThan(before)
    }, { timeout: 3000 })
  })

  it('keeps notifications modal open when sidebar closes after clicking notification (regression)', async () => {
    render(
      <MemoryRouter>
        <MainLayout><div /></MainLayout>
        <NotificationsModal />
      </MemoryRouter>
    )
    // 打开抽屉（推入 atelierSidebar 历史标记）
    fireEvent.click(document.querySelector('.mobile-topbar-menu'))
    await waitFor(() => expect(document.querySelector('aside').parentElement.className).toContain('translate-x-0'))
    expect(window.history.state?.atelierSidebar).toBe('open')
    // 点击抽屉里的「通知」（通知为 button，其余导航为 a 链接）
    fireEvent.click(document.querySelector('aside button.sidebar-nav-link'))
    // 抽屉关闭，但通知弹窗保持打开（抽屉 cleanup 的 history.back 不得误关弹窗）
    await waitFor(() => expect(screen.getByText('通知中心')).toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('aside').parentElement.className).toContain('-translate-x-full'))
    expect(screen.getByText('通知中心')).toBeInTheDocument()
    window.history.replaceState(null, '')
  })
})

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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
  notificationAPI: { unreadCount: unreadCountMock },
  announcementAPI: { getUnread: getUnreadMock },
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
    expect(screen.getByText('Atelier-ai')).toBeInTheDocument()
  })

  it('renders mobile topbar with quick nav links', () => {
    readUserMock.mockReturnValue({ id: 1, username: 'admin', nickname: 'A', points: 0, is_admin: true })
    renderLayout()
    const topbarLinks = document.querySelectorAll('.mobile-topbar-link-text')
    const labels = [...topbarLinks].map(el => el.textContent)
    expect(labels).toEqual(['助手', '绘画', '作品', '广场', '通知'])
  })

  it('hides notification link in topbar for regular users', () => {
    renderLayout()
    const topbarLinks = document.querySelectorAll('.mobile-topbar-link-text')
    const labels = [...topbarLinks].map(el => el.textContent)
    expect(labels).toEqual(['助手', '绘画', '作品', '广场'])
  })

  it('opens sidebar when menu button is clicked', () => {
    renderLayout()
    const menuBtn = document.querySelector('.mobile-topbar-menu')
    fireEvent.click(menuBtn)
    const sidebar = document.querySelector('aside')
    expect(sidebar.parentElement.className).toContain('translate-x-0')
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
})

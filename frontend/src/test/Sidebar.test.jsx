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
  subscriptionMeMock,
  chatSessionsMock,
  chatCreateSessionMock,
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
  subscriptionMeMock: vi.fn(),
  chatSessionsMock: vi.fn(),
  chatCreateSessionMock: vi.fn(),
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
  chatAPI: {
    sessions: chatSessionsMock,
    createSession: chatCreateSessionMock,
  },
  pointsAPI: {
    balance: pointsBalanceMock,
    checkinStatus: pointsCheckinStatusMock,
    checkin: pointsCheckinMock,
  },
  authAPI: { logout: authLogoutMock },
  notificationAPI: { unreadCount: unreadCountMock },
  announcementAPI: { getUnread: getUnreadMock },
  subscriptionAPI: { me: subscriptionMeMock },
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
  subscriptionMeMock.mockResolvedValue({ data: { plan: null } })
  chatSessionsMock.mockResolvedValue({ data: { items: [{ id: 's1', title: '会话一' }, { id: 's2', title: '会话二' }] } })
  localStorage.clear()
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ total: 0 }) }))
})

describe('Sidebar', () => {
  it('renders top-level navigation links', () => {
    renderSidebar()
    expect(screen.getByText('AI 助手')).toBeInTheDocument()
    expect(screen.getByText('AI 绘画')).toBeInTheDocument()
    expect(screen.queryByText('积分')).not.toBeInTheDocument()
  })

  it('hides second sidebar on non-draw pages', () => {
    renderSidebar()
    expect(screen.queryByText('我的作品')).not.toBeInTheDocument()
    expect(screen.queryByText('广场')).not.toBeInTheDocument()
    expect(screen.queryByText('我的提示词')).not.toBeInTheDocument()
    expect(screen.queryByText('切换为网格')).not.toBeInTheDocument()
  })

  it('shows second sidebar items on draw-related pages', () => {
    mockLocation = { pathname: '/draw', search: '' }
    readUserMock.mockReturnValue({ id: 1, username: 'admin', nickname: '管理员', points: 0, is_admin: true })
    renderSidebar()
    expect(screen.getByText('画图')).toBeInTheDocument()
    expect(screen.getByText('我的作品')).toBeInTheDocument()
    expect(screen.getByText('广场')).toBeInTheDocument()
    expect(screen.getByText('我的提示词')).toBeInTheDocument()
    expect(screen.getByText('通知')).toBeInTheDocument()
    expect(screen.getByText('切换为网格')).toBeInTheDocument()
    expect(screen.getByText('桌面列数 3列')).toBeInTheDocument()
  })

  it('collapses nav to short labels, then expands back', () => {
    renderSidebar()
    fireEvent.click(screen.getByTitle('折叠侧边栏'))
    const short = screen.getByText('助手')
    expect(short.classList.contains('text-[10px]')).toBe(true)
    expect(screen.queryByText('AI 助手')).not.toBeInTheDocument()
    expect(screen.getByTitle('展开侧边栏')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('展开侧边栏'))
    expect(screen.getByText('AI 助手')).toBeInTheDocument()
  })

  it('displays account name in sidebar footer', () => {
    renderSidebar()
    // 左下角用户行显示账户名（昵称优先）
    expect(screen.getByText('测试员')).toBeInTheDocument()
    expect(screen.queryByText('今日已用')).not.toBeInTheDocument()
  })

  it('shows first char of display name in avatar circle', () => {
    readUserMock.mockReturnValue({ id: 1, username: 'tester', nickname: '测试员', points: 0, is_admin: false })
    renderSidebar()
    // 中文昵称取首字
    expect(screen.getByText('测')).toBeInTheDocument()
  })

  it('shows uppercase first letter of latin display name in avatar circle', () => {
    readUserMock.mockReturnValue({ id: 1, username: 'tester', nickname: 'alice', points: 0, is_admin: false })
    renderSidebar()
    // 英文昵称取首字母并大写
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('falls back to question mark when no display name', () => {
    readUserMock.mockReturnValue({ id: 1, username: '', nickname: '', points: 0, is_admin: false })
    renderSidebar()
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('keeps account link even without nickname', () => {
    readUserMock.mockReturnValue({ id: 1, username: 'tester', nickname: '', points: 0, is_admin: false })
    renderSidebar()
    // 用户行仍可点击跳转账户中心
    const link = screen.getByTitle('账户中心')
    expect(link).toHaveAttribute('href', '/account')
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
    mockLocation = { pathname: '/draw', search: '' }
    readUserMock.mockReturnValue({ id: 1, username: 'admin', nickname: '管理员', points: 0, is_admin: true })
    renderSidebar()
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument())
  })

  it('hides notification badge when unread count is 0', async () => {
    unreadCountMock.mockResolvedValue({ data: { count: 0 } })
    getUnreadMock.mockResolvedValue({ data: { items: [] } })
    mockLocation = { pathname: '/draw', search: '' }
    readUserMock.mockReturnValue({ id: 1, username: 'admin', nickname: '管理员', points: 0, is_admin: true })
    renderSidebar()
    await waitFor(() => {
      const noticeLink = screen.getByText('通知').closest('a')
      expect(noticeLink.querySelector('span.rounded-full')).toBeNull()
    })
  })

  it('shows 99+ when notification count exceeds 99', async () => {
    unreadCountMock.mockResolvedValue({ data: { count: 60 } })
    getUnreadMock.mockResolvedValue({ data: { items: Array.from({ length: 50 }, (_, i) => ({ id: i })) } })
    mockLocation = { pathname: '/draw', search: '' }
    readUserMock.mockReturnValue({ id: 1, username: 'admin', nickname: '管理员', points: 0, is_admin: true })
    renderSidebar()
    await waitFor(() => expect(screen.getByText('99+')).toBeInTheDocument())
  })

  it('hides notification item for regular users', () => {
    mockLocation = { pathname: '/draw', search: '' }
    renderSidebar()
    expect(screen.getByText('我的作品')).toBeInTheDocument()
    expect(screen.queryByText('通知')).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await waitFor(() => {
      expect(authLogoutMock).toHaveBeenCalled()
      expect(clearUserMock).toHaveBeenCalled()
      expect(mockNavigate).toHaveBeenCalledWith('/login')
    })
  })

  it('toggles theme when theme button is clicked', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }))
    expect(toggleThemeMock).toHaveBeenCalledTimes(1)
  })

  it('toggles layout mode', () => {
    mockLocation = { pathname: '/draw', search: '' }
    renderSidebar()
    fireEvent.click(screen.getByText('切换为网格'))
    expect(toggleLayoutModeMock).toHaveBeenCalledTimes(1)
  })

  it('toggles column count', () => {
    mockLocation = { pathname: '/draw', search: '' }
    renderSidebar()
    fireEvent.click(screen.getByText('桌面列数 3列'))
    expect(toggleCurrentColsMock).toHaveBeenCalledTimes(1)
  })

  it('does not render footer links', () => {
    renderSidebar()
    expect(screen.queryByText('用户协议')).not.toBeInTheDocument()
    expect(screen.queryByText('隐私政策')).not.toBeInTheDocument()
    expect(screen.queryByText('充值说明与积分规则')).not.toBeInTheDocument()
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

  it('shows chat session list in sub-nav on /chat page', async () => {
    mockLocation = { pathname: '/chat', search: '' }
    renderSidebar()
    await waitFor(() => expect(screen.getByText('会话一')).toBeInTheDocument())
    expect(screen.getByText('会话二')).toBeInTheDocument()
    expect(screen.getByText('新建会话')).toBeInTheDocument()
  })

  it('selecting a session writes localStorage and dispatches chat-session-selected', async () => {
    mockLocation = { pathname: '/chat', search: '' }
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const onClose = vi.fn()
    renderSidebar({ onClose })
    await waitFor(() => expect(screen.getByText('会话一')).toBeInTheDocument())
    fireEvent.click(screen.getByText('会话一'))
    expect(localStorage.getItem('chat_active_session_id')).toBe('s1')
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat-session-selected' }))
    expect(onClose).toHaveBeenCalled()
    dispatchSpy.mockRestore()
  })

  it('new session button dispatches chat-session-created', async () => {
    mockLocation = { pathname: '/chat', search: '' }
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    renderSidebar()
    await waitFor(() => expect(screen.getByText('新建会话')).toBeInTheDocument())
    fireEvent.click(screen.getByText('新建会话'))
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat-session-created' }))
    expect(chatCreateSessionMock).not.toHaveBeenCalled()
    dispatchSpy.mockRestore()
  })

  it('does not highlight AI 绘画 on /chat page', () => {
    mockLocation = { pathname: '/chat', search: '' }
    renderSidebar()
    const drawLink = screen.getByText('AI 绘画').closest('a')
    expect(drawLink.style.color).not.toBe('var(--accent)')
    expect(drawLink.className).not.toContain('bg-accent/10')
    // AI 助手自身保持高亮
    const chatLink = screen.getByText('AI 助手').closest('a')
    expect(chatLink.style.color).toBe('var(--accent)')
  })

  it('keeps group highlight of AI 绘画 on draw sub pages', () => {
    mockLocation = { pathname: '/works', search: '' }
    renderSidebar()
    const drawLink = screen.getByText('AI 绘画').closest('a')
    expect(drawLink.style.color).toBe('var(--accent)')
    expect(drawLink.className).toContain('bg-accent/10')
  })
})

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const {
  teamMock,
  createTeamAndPayMock,
  upgradeMock,
  configGetMock,
  getRechargeRequestMock,
  readUserMock,
  dialogAlertMock,
  navigateMock,
} = vi.hoisted(() => ({
  teamMock: vi.fn(),
  createTeamAndPayMock: vi.fn(),
  upgradeMock: vi.fn(),
  configGetMock: vi.fn(),
  getRechargeRequestMock: vi.fn(),
  readUserMock: vi.fn(),
  dialogAlertMock: vi.fn(),
  navigateMock: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ teamId: '99' }),
  useNavigate: () => navigateMock,
}))

vi.mock('../api', () => ({
  groupBuyAPI: {
    team: teamMock,
    createTeamAndPay: createTeamAndPayMock,
    upgrade: upgradeMock,
  },
  configAPI: { get: configGetMock },
  pointsAPI: {
    getRechargeRequest: getRechargeRequestMock,
    confirmRechargeRequest: vi.fn(),
  },
}))

vi.mock('../auth', () => ({
  readUser: readUserMock,
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: dialogAlertMock, confirm: vi.fn() }),
}))

vi.mock('../components/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}))

vi.mock('../components/RechargePayModal', () => ({
  default: () => <div data-testid="recharge-pay-modal" />,
}))

import GroupBuyTeamPage from '../pages/GroupBuyTeamPage'

const mockUser = { id: 1, username: 'testuser', nickname: 'Test' }

const baseTeam = {
  id: 99,
  group_buy_id: 5,
  status: 0,
  expire_at: '2099-06-01 12:00:00',
  paid_count: 1,
  group_size: 3,
  group_price: 19.9,
  original_price: 39.9,
  package_name: '月度会员',
  package_type: 'membership',
  my_paid: false,
  my_member: null,
  members: [
    { id: 1, user_id: 1, status: 1, is_virtual: false, virtual_nickname: '', virtual_avatar: '', is_creator: true, is_self: false },
    { id: 2, user_id: 2, status: 1, is_virtual: true, virtual_nickname: '小助手', virtual_avatar: '', is_creator: false, is_self: false },
  ],
}

function setupDefaultMocks() {
  teamMock.mockResolvedValue({ data: baseTeam })
  configGetMock.mockResolvedValue({
    data: { alipay_pay_qr_url: 'https://qr/alipay', wechat_pay_qr_url: 'https://qr/wechat' },
  })
  getRechargeRequestMock.mockResolvedValue({ data: { status: 'pending' } })
  readUserMock.mockReturnValue(mockUser)
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  setupDefaultMocks()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('GroupBuyTeamPage', () => {
  it('renders package name, status badge and progress', async () => {
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('月度会员拼团')).toBeInTheDocument())
    expect(screen.getByText('拼团中')).toBeInTheDocument()
    expect(screen.getByText(/还差 2 人成团/)).toBeInTheDocument()
    expect(screen.getByText(/1\/3 人/)).toBeInTheDocument()
    expect(screen.getByText('19.9')).toBeInTheDocument()
    expect(screen.getByText('原价 ¥39.9')).toBeInTheDocument()
  })

  it('renders member grid with virtual member and empty slot', async () => {
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('月度会员拼团')).toBeInTheDocument())
    expect(screen.getByText('小助手')).toBeInTheDocument()
    expect(screen.getByText('👑')).toBeInTheDocument()
    expect(screen.getAllByText('虚位以待').length).toBeGreaterThanOrEqual(1)
  })

  it('renders member grid with self highlight', async () => {
    teamMock.mockResolvedValue({
      data: {
        ...baseTeam,
        my_paid: true,
        members: [
          { id: 1, user_id: 1, status: 1, is_virtual: false, virtual_nickname: '', virtual_avatar: '', is_creator: true, is_self: true },
          { id: 2, user_id: 2, status: 1, is_virtual: true, virtual_nickname: '小助手', virtual_avatar: '', is_creator: false, is_self: false },
        ],
      },
    })
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('月度会员拼团')).toBeInTheDocument())
    expect(screen.getByText('我')).toBeInTheDocument()
  })

  it('shows login button and navigates with redirect for anonymous user', async () => {
    readUserMock.mockReturnValue(null)
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('登录后加入')).toBeInTheDocument())
    fireEvent.click(screen.getByText('登录后加入'))
    expect(navigateMock).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent('/group-buy/team/99')}`)
  })

  it('shows join button for logged-in user not paid', async () => {
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('立即加入拼团 ¥19.9')).toBeInTheDocument())
  })

  it('shows invite button for paid member while joining', async () => {
    teamMock.mockResolvedValue({ data: { ...baseTeam, my_paid: true } })
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('邀请好友拼团')).toBeInTheDocument())
  })

  it('shows 去使用 when team is formed', async () => {
    teamMock.mockResolvedValue({ data: { ...baseTeam, status: 1 } })
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('已成团')).toBeInTheDocument())
    expect(screen.getByText('去使用')).toBeInTheDocument()
  })

  it('navigates to chat when clicking 去使用', async () => {
    teamMock.mockResolvedValue({ data: { ...baseTeam, status: 1 } })
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('去使用')).toBeInTheDocument())
    fireEvent.click(screen.getByText('去使用'))
    expect(navigateMock).toHaveBeenCalledWith('/chat')
  })

  it('shows expired notice for non-paid user on expired team', async () => {
    teamMock.mockResolvedValue({ data: { ...baseTeam, status: 2, my_paid: false } })
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('已过期')).toBeInTheDocument())
    expect(screen.getByText(/该团已过期/)).toBeInTheDocument()
  })

  it('shows upgrade button with price diff for paid user on expired team', async () => {
    teamMock.mockResolvedValue({ data: { ...baseTeam, status: 2, my_paid: true } })
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('补差价升级 ¥20')).toBeInTheDocument())
  })

  it('renders rules and FAQ section', async () => {
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('拼团规则')).toBeInTheDocument())
    expect(screen.getByText('常见问题')).toBeInTheDocument()
    expect(screen.getByText(/未成团补差价/)).toBeInTheDocument()
  })

  it('shows not found state when team API fails', async () => {
    teamMock.mockRejectedValue(new Error('Not Found'))
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('拼团不存在或已结束')).toBeInTheDocument())
  })

  it('opens pay dialog and calls createTeamAndPay with channel', async () => {
    createTeamAndPayMock.mockResolvedValue({
      data: { team_id: 99, request_id: 777, amount: 19.9, remaining_seconds: 600, message: 'ok' },
    })
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('立即加入拼团 ¥19.9')).toBeInTheDocument())
    fireEvent.click(screen.getByText('立即加入拼团 ¥19.9'))
    expect(screen.getByText('确认加入拼团')).toBeInTheDocument()
    expect(screen.getByText('支付宝')).toBeInTheDocument()
    expect(screen.getByText('微信')).toBeInTheDocument()
    fireEvent.click(screen.getByText('微信'))
    fireEvent.click(screen.getByText('提交并获取支付二维码'))
    await waitFor(() => {
      expect(createTeamAndPayMock).toHaveBeenCalledWith(5, { channel: 'wechat' })
    })
    expect(screen.getByTestId('recharge-pay-modal')).toBeInTheDocument()
  })

  it('calls upgrade API when submitting upgrade pay', async () => {
    upgradeMock.mockResolvedValue({
      data: { team_id: 99, request_id: 778, amount: 20, remaining_seconds: 600, message: 'ok' },
    })
    teamMock.mockResolvedValue({ data: { ...baseTeam, status: 2, my_paid: true } })
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('补差价升级 ¥20')).toBeInTheDocument())
    fireEvent.click(screen.getByText('补差价升级 ¥20'))
    expect(screen.getByText('补差价升级')).toBeInTheDocument()
    fireEvent.click(screen.getByText('提交并获取支付二维码'))
    await waitFor(() => {
      expect(upgradeMock).toHaveBeenCalledWith(99, { channel: 'alipay' })
    })
  })

  it('alerts when pay channel QR not configured', async () => {
    configGetMock.mockResolvedValue({ data: { alipay_pay_qr_url: '', wechat_pay_qr_url: '' } })
    render(<GroupBuyTeamPage />)
    await waitFor(() => expect(screen.getByText('立即加入拼团 ¥19.9')).toBeInTheDocument())
    fireEvent.click(screen.getByText('立即加入拼团 ¥19.9'))
    fireEvent.click(screen.getByText('提交并获取支付二维码'))
    await waitFor(() => {
      expect(dialogAlertMock).toHaveBeenCalledWith('微信收款码未配置，请切换支付方式')
    })
  })
})

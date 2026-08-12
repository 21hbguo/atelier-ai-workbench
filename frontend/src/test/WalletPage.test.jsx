import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const {
  readUserMock,
  balanceMock,
  transactionsMock,
  checkinStatusMock,
  checkinMock,
  redeemMock,
  inviteInfoMock,
  inviteHistoryMock,
  generateInviteCodeMock,
  createRechargeRequestMock,
  getRechargeRequestMock,
  confirmRechargeRequestMock,
  changePasswordMock,
  configModelsMock,
  chatModelsMock,
  apiGetMock,
  dialogAlertMock,
  dialogConfirmMock,
} = vi.hoisted(() => ({
  readUserMock: vi.fn(),
  balanceMock: vi.fn(),
  transactionsMock: vi.fn(),
  checkinStatusMock: vi.fn(),
  checkinMock: vi.fn(),
  redeemMock: vi.fn(),
  inviteInfoMock: vi.fn(),
  inviteHistoryMock: vi.fn(),
  generateInviteCodeMock: vi.fn(),
  createRechargeRequestMock: vi.fn(),
  getRechargeRequestMock: vi.fn(),
  confirmRechargeRequestMock: vi.fn(),
  changePasswordMock: vi.fn(),
  configModelsMock: vi.fn(),
  chatModelsMock: vi.fn(),
  apiGetMock: vi.fn(),
  dialogAlertMock: vi.fn(),
  dialogConfirmMock: vi.fn(),
}))

vi.mock('../auth', () => ({
  readUser: readUserMock,
  writeUser: vi.fn(),
  clearUser: vi.fn(),
}))

vi.mock('../api', () => ({
  default: { get: apiGetMock },
  pointsAPI: {
    balance: balanceMock,
    transactions: transactionsMock,
    checkinStatus: checkinStatusMock,
    checkin: checkinMock,
    redeem: redeemMock,
    inviteInfo: inviteInfoMock,
    inviteHistory: inviteHistoryMock,
    generateInviteCode: generateInviteCodeMock,
    createRechargeRequest: createRechargeRequestMock,
    getRechargeRequest: getRechargeRequestMock,
    confirmRechargeRequest: confirmRechargeRequestMock,
  },
  accountAPI: { changePassword: changePasswordMock },
  chatAPI: { models: chatModelsMock },
  configAPI: { models: configModelsMock },
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: dialogAlertMock, confirm: dialogConfirmMock, choose: vi.fn() }),
}))

vi.mock('../components/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}))

vi.mock('../components/Pagination', () => ({
  default: ({ page, totalPages, onPageChange }) => (
    <div data-testid="pagination">
      <span>{page}/{totalPages}</span>
      <button onClick={() => onPageChange(page + 1)}>next</button>
    </div>
  ),
}))

import WalletPage from '../pages/WalletPage'

const mockUser = {
  id: 1,
  username: 'testuser',
  nickname: 'Test',
  account: 'test@example.com',
  points: 100,
}

const mockTransactions = [
  {
    id: 1,
    type: 'daily_checkin',
    amount: 5,
    balance_after: 105,
    description: '每日签到',
    created_at: '2026-05-09 10:00:00',
    channel: null,
    tx_no: null,
    recharge_status: null,
    review_note: null,
    model_name: null,
  },
  {
    id: 2,
    type: 'generate_consume',
    amount: -10,
    balance_after: 95,
    description: 'AI 生图消耗',
    created_at: '2026-05-09 11:00:00',
    channel: null,
    tx_no: null,
    recharge_status: null,
    review_note: null,
    model_name: 'gpt-image-1',
  },
  {
    id: 3,
    type: 'redeem_code',
    amount: 50,
    balance_after: 145,
    description: '',
    created_at: '2026-05-09 12:00:00',
    channel: 'alipay',
    tx_no: 'TX123',
    recharge_status: 'approved',
    review_note: null,
    model_name: null,
    recharge_request_id: 10,
  },
]

function setupDefaultMocks() {
  readUserMock.mockReturnValue(mockUser)
  balanceMock.mockResolvedValue({ data: { points: 100 } })
  transactionsMock.mockResolvedValue({
    data: { items: mockTransactions, total: 20 },
  })
  checkinStatusMock.mockResolvedValue({ data: { checked_in_today: false } })
  inviteInfoMock.mockResolvedValue({
    data: { invite_code: 'ABC123', inviter_name: '', register_invite_code: '', summary: { invited_register_count: 0, total_rebate_points: 0, total_recharge_amount: 0, risk_hit_count: 0 } },
  })
  inviteHistoryMock.mockResolvedValue({ data: { items: [], total: 0 } })
  configModelsMock.mockResolvedValue({ data: { models: [] } })
  chatModelsMock.mockResolvedValue({ data: { items: [] } })
  apiGetMock.mockResolvedValue({
    data: {
      recharge_packages: [
        { amount: 10, points: 100, label: '轻量支持' },
        { amount: 30, points: 300, label: '常用支持' },
      ],
      wechat_pay_qr_url: 'https://qr/wechat',
      alipay_pay_qr_url: 'https://qr/alipay',
      donation_contact: '',
      manual_recharge_notice: 'test notice',
      invite_enabled: true,
      invite_register_reward_points: 20,
      invite_recharge_bonus_percent: 10,
      invite_recharge_rebate_percent: 10,
    },
  })
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  setupDefaultMocks()
  localStorage.clear()
  localStorage.setItem('user', JSON.stringify(mockUser))
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('WalletPage', () => {
  describe('balance display', () => {
    it('shows current points from user data', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('100')).toBeInTheDocument()
      })
    })

    it('shows user nickname and account', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument()
        expect(screen.getByText('test@example.com')).toBeInTheDocument()
      })
    })

    it('fetches balance on mount', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(balanceMock).toHaveBeenCalled()
        expect(transactionsMock).toHaveBeenCalled()
      })
    })

    it('updates balance from API response', async () => {
      balanceMock.mockResolvedValue({ data: { points: 200 } })
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('200')).toBeInTheDocument()
      })
    })
  })

  describe('transaction history', () => {
    it('renders transaction table with records', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getAllByText('每日签到').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('AI 生图消耗').length).toBeGreaterThanOrEqual(1)
      })
    })

    it('shows positive and negative amounts', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('+5')).toBeInTheDocument()
        expect(screen.getByText('-10')).toBeInTheDocument()
      })
    })

    it('shows balance after for each transaction', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('105')).toBeInTheDocument()
        expect(screen.getByText('95')).toBeInTheDocument()
      })
    })

    it('shows recharge status for approved transactions', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('已发放')).toBeInTheDocument()
      })
    })

    it('shows channel label for recharge transactions', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('支付宝')).toBeInTheDocument()
      })
    })

    it('shows transaction number', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('TX123')).toBeInTheDocument()
      })
    })

    it('shows empty state when no transactions', async () => {
      transactionsMock.mockResolvedValue({ data: { items: [], total: 0 } })
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('暂无记录')).toBeInTheDocument()
      })
    })

    it('shows pagination when total exceeds page size', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByTestId('pagination')).toBeInTheDocument()
        expect(screen.getByText('1/2')).toBeInTheDocument()
      })
    })

    it('shows model name for generate transactions', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('gpt-image-1')).toBeInTheDocument()
      })
    })
  })

  describe('checkin action', () => {
    it('shows checkin button when not checked in', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('签到')).toBeInTheDocument()
      })
    })

    it('shows checked-in state', async () => {
      checkinStatusMock.mockResolvedValue({ data: { checked_in_today: true } })
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText(/已签到/)).toBeInTheDocument()
      })
    })

    it('calls checkin API and updates points on success', async () => {
      checkinMock.mockResolvedValue({ data: { points: 105 } })
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('签到')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('签到'))
      await waitFor(() => {
        expect(checkinMock).toHaveBeenCalled()
        expect(screen.getByText(/已签到/)).toBeInTheDocument()
      })
    })

    it('shows alert on checkin failure', async () => {
      checkinMock.mockRejectedValue(new Error('签到失败'))
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('签到')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('签到'))
      await waitFor(() => {
        expect(dialogAlertMock).toHaveBeenCalledWith('签到失败')
      })
    })
  })

  describe('redeem code', () => {
    it('renders redeem tab', async () => {
      render(<WalletPage />)
      fireEvent.click(screen.getByText('兑换码'))
      expect(screen.getByPlaceholderText('输入兑换码')).toBeInTheDocument()
    })

    it('calls redeem API and shows success message', async () => {
      redeemMock.mockResolvedValue({
        data: { balance: 150, points_awarded: 50 },
      })
      balanceMock.mockResolvedValue({ data: { points: 150 } })
      render(<WalletPage />)
      fireEvent.click(screen.getByText('兑换码'))
      const input = screen.getByPlaceholderText('输入兑换码')
      fireEvent.change(input, { target: { value: 'CODE123' } })
      fireEvent.click(screen.getByText('领取'))
      await waitFor(() => {
        expect(redeemMock).toHaveBeenCalledWith('CODE123')
        expect(screen.getByText(/领取成功/)).toBeInTheDocument()
      })
    })

    it('shows error message on redeem failure', async () => {
      redeemMock.mockRejectedValue(new Error('兑换码无效'))
      render(<WalletPage />)
      fireEvent.click(screen.getByText('兑换码'))
      const input = screen.getByPlaceholderText('输入兑换码')
      fireEvent.change(input, { target: { value: 'BADCODE' } })
      fireEvent.click(screen.getByText('领取'))
      await waitFor(() => {
        expect(screen.getByText('兑换码无效')).toBeInTheDocument()
      })
    })

    it('disables redeem button when input is empty', async () => {
      render(<WalletPage />)
      fireEvent.click(screen.getByText('兑换码'))
      const btn = screen.getByText('领取')
      expect(btn).toBeDisabled()
    })
  })

  describe('tab switching', () => {
    it('defaults to records tab', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getAllByText('积分记录').length).toBeGreaterThanOrEqual(1)
      })
    })

    it('switches to donate tab', async () => {
      render(<WalletPage />)
      fireEvent.click(screen.getByText('捐赠支持'))
      expect(screen.getByText(/捐赠说明/)).toBeInTheDocument()
    })

    it('switches to invite tab', async () => {
      render(<WalletPage />)
      fireEvent.click(screen.getByText('邀请中心'))
      await waitFor(() => {
        expect(screen.getByText('你的邀请码')).toBeInTheDocument()
      })
    })
  })

  describe('recharge flow', () => {
    it('shows recharge packages on donate tab', async () => {
      render(<WalletPage />)
      fireEvent.click(screen.getByText('捐赠支持'))
      expect(screen.getByText('轻量支持')).toBeInTheDocument()
      expect(screen.getByText('常用支持')).toBeInTheDocument()
    })

    it('submits recharge request and shows QR modal', async () => {
      createRechargeRequestMock.mockResolvedValue({
        data: { id: 1, amount: 9.5, discount: 0.5, tx_no: 'TX001', remaining_seconds: 600 },
      })
      getRechargeRequestMock.mockResolvedValue({
        data: { id: 1, channel: 'alipay', amount: 9.5, points: 100, status: 'pending', user_confirmed: false, created_at: '2026-05-10 00:00:00', remaining_seconds: 600 },
      })
      render(<WalletPage />)
      fireEvent.click(screen.getByText('捐赠支持'))
      await waitFor(() => {
        expect(screen.getByText('轻量支持')).toBeInTheDocument()
      })
      const submitBtn = screen.getByRole('button', { name: /提交并获取捐赠二维码/ })
      fireEvent.click(submitBtn)
      await waitFor(() => {
        expect(createRechargeRequestMock).toHaveBeenCalled()
        expect(screen.getByText('10:00')).toBeInTheDocument()
      })
    })

    it('shows expired state and renew button when request is expired', async () => {
      createRechargeRequestMock.mockResolvedValue({
        data: { id: 1, amount: 9.5, discount: 0.5, tx_no: 'TX001', remaining_seconds: 600 },
      })
      getRechargeRequestMock.mockResolvedValueOnce({
        data: { id: 1, channel: 'alipay', amount: 9.5, points: 100, status: 'expired', user_confirmed: false, created_at: '2026-05-10 00:00:00', remaining_seconds: 0 },
      })
      render(<WalletPage />)
      fireEvent.click(screen.getByText('捐赠支持'))
      await waitFor(() => {
        expect(screen.getByText('轻量支持')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: /提交并获取捐赠二维码/ }))
      await waitFor(() => {
        expect(screen.getByText('当前支付金额已失效')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '重新生成金额' })).toBeInTheDocument()
      })
    })
    it('shows countdown in modal header when request is active', async () => {
      createRechargeRequestMock.mockResolvedValue({
        data: { id: 1, amount: 9.5, discount: 0.5, tx_no: 'TX001', remaining_seconds: 600 },
      })
      getRechargeRequestMock.mockResolvedValueOnce({
        data: { id: 1, channel: 'alipay', amount: 9.5, points: 100, status: 'pending', user_confirmed: false, created_at: '2026-05-10 00:00:00', remaining_seconds: 600 },
      })
      render(<WalletPage />)
      fireEvent.click(screen.getByText('捐赠支持'))
      await waitFor(() => {
        expect(screen.getByText('轻量支持')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: /提交并获取捐赠二维码/ }))
      await waitFor(() => {
        expect(screen.getByText('10:00')).toBeInTheDocument()
      })
    })

    it('shows error on recharge submit failure', async () => {
      createRechargeRequestMock.mockRejectedValue(new Error('提交失败'))
      render(<WalletPage />)
      fireEvent.click(screen.getByText('捐赠支持'))
      await waitFor(() => {
        expect(screen.getByText('轻量支持')).toBeInTheDocument()
      })
      const submitBtn = screen.getByRole('button', { name: /提交并获取捐赠二维码/ })
      fireEvent.click(submitBtn)
      await waitFor(() => {
        expect(screen.getByText('提交失败')).toBeInTheDocument()
      })
    })
  })

  describe('password change', () => {
    it('renders password inputs', async () => {
      render(<WalletPage />)
      expect(screen.getByPlaceholderText('当前密码')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/新密码/)).toBeInTheDocument()
    })

    it('calls changePassword API on submit', async () => {
      changePasswordMock.mockResolvedValue({})
      render(<WalletPage />)
      fireEvent.change(screen.getByPlaceholderText('当前密码'), { target: { value: 'old123' } })
      fireEvent.change(screen.getByPlaceholderText(/新密码/), { target: { value: 'new123456' } })
      fireEvent.click(screen.getByText('确认修改'))
      await waitFor(() => {
        expect(changePasswordMock).toHaveBeenCalledWith({
          old_password: 'old123',
          new_password: 'new123456',
        })
        expect(dialogAlertMock).toHaveBeenCalledWith('密码修改成功')
      })
    })

    it('shows alert on password change failure', async () => {
      changePasswordMock.mockRejectedValue(new Error('密码错误'))
      render(<WalletPage />)
      fireEvent.change(screen.getByPlaceholderText('当前密码'), { target: { value: 'wrong' } })
      fireEvent.change(screen.getByPlaceholderText(/新密码/), { target: { value: 'new123456' } })
      fireEvent.click(screen.getByText('确认修改'))
      await waitFor(() => {
        expect(dialogAlertMock).toHaveBeenCalledWith('密码错误')
      })
    })

    it('disables submit when new password is too short', async () => {
      render(<WalletPage />)
      fireEvent.change(screen.getByPlaceholderText('当前密码'), { target: { value: 'old' } })
      fireEvent.change(screen.getByPlaceholderText(/新密码/), { target: { value: '123' } })
      const btn = screen.getByText('确认修改')
      expect(btn).toBeDisabled()
    })
  })

  describe('invite center', () => {
    it('shows invite code when available', async () => {
      render(<WalletPage />)
      fireEvent.click(screen.getByText('邀请中心'))
      await waitFor(() => {
        expect(screen.getByText('ABC123')).toBeInTheDocument()
      })
    })

    it('shows generate button when no invite code', async () => {
      inviteInfoMock.mockResolvedValue({
        data: { invite_code: '', summary: {} },
      })
      render(<WalletPage />)
      fireEvent.click(screen.getByText('邀请中心'))
      await waitFor(() => {
        expect(screen.getByText('立即生成邀请码')).toBeInTheDocument()
      })
    })

    it('generates invite code on button click', async () => {
      generateInviteCodeMock.mockResolvedValue({
        data: { invite_code: 'NEW123' },
      })
      inviteInfoMock.mockResolvedValue({
        data: { invite_code: '', summary: {} },
      })
      render(<WalletPage />)
      fireEvent.click(screen.getByText('邀请中心'))
      await waitFor(() => {
        expect(screen.getByText('立即生成邀请码')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('立即生成邀请码'))
      await waitFor(() => {
        expect(generateInviteCodeMock).toHaveBeenCalled()
      })
    })

    it('shows invite summary stats', async () => {
      inviteInfoMock.mockResolvedValue({
        data: {
          invite_code: 'ABC',
          summary: {
            invited_register_count: 5,
            total_rebate_points: 100,
            total_recharge_amount: 50,
            risk_hit_count: 0,
          },
        },
      })
      render(<WalletPage />)
      fireEvent.click(screen.getByText('邀请中心'))
      await waitFor(() => {
        expect(screen.getByText('邀请注册')).toBeInTheDocument()
        expect(screen.getByText('累计邀请奖励')).toBeInTheDocument()
        expect(screen.getByText('风险拦截')).toBeInTheDocument()
      })
    })
  })

  describe('points-updated event', () => {
    it('listens for points-updated event and updates display', async () => {
      render(<WalletPage />)
      await waitFor(() => {
        expect(screen.getByText('当前积分')).toBeInTheDocument()
      })
      readUserMock.mockReturnValue({ ...mockUser, points: 999 })
      window.dispatchEvent(new Event('points-updated'))
      await waitFor(() => {
        expect(screen.getByText('999')).toBeInTheDocument()
      })
    })
  })
})

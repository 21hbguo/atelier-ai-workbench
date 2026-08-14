import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const { readUserMock, balanceMock, inviteInfoMock, transactionsMock, subscriptionMeMock } = vi.hoisted(() => ({ readUserMock: vi.fn(), balanceMock: vi.fn(), inviteInfoMock: vi.fn(), transactionsMock: vi.fn(), subscriptionMeMock: vi.fn() }))

vi.mock('../auth', () => ({ readUser: readUserMock }))
vi.mock('../api', () => ({ pointsAPI: { balance: balanceMock, inviteInfo: inviteInfoMock, transactions: transactionsMock }, subscriptionAPI: { me: subscriptionMeMock } }))
vi.mock('../components/MainLayout', () => ({ default: ({ children }) => <div>{children}</div> }))

import AccountPage from '../pages/AccountPage'

const renderPage = () => render(<MemoryRouter><AccountPage /></MemoryRouter>)

beforeEach(() => {
  cleanup()
  readUserMock.mockReturnValue({ account: 'atelier-user', nickname: '设计师', points: 10 })
  balanceMock.mockResolvedValue({ data: { points: 248, ai_daily_remaining: null, ai_daily_total: null } })
  inviteInfoMock.mockResolvedValue({ data: { summary: { invited_register_count: 3 } } })
  transactionsMock.mockResolvedValue({ data: { items: [{ id: 1, type: 'daily_checkin', amount: 10, description: '每日签到', created_at: '2026-08-13 09:12:00' }] } })
  subscriptionMeMock.mockResolvedValue({ data: { plan: { name: '免费套餐', is_free: true, features: {} }, cycle: null, permanent_points: 0, total_points: 248 } })
})

describe('AccountPage', () => {
  it('loads and renders balance, plan and recent transactions without check-in card', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('248').length).toBeGreaterThan(0))
    expect(screen.getByText('免费套餐')).toBeInTheDocument()
    expect(screen.getByText('开通套餐解锁更多权益')).toBeInTheDocument()
    expect(screen.queryByText('今日签到')).not.toBeInTheDocument()
    expect(screen.queryByText('签到')).not.toBeInTheDocument()
    expect(screen.queryByText('邀请好友')).not.toBeInTheDocument()
    expect(screen.getAllByText('每日签到').length).toBeGreaterThan(0)
  })

  it('renders daily quota progress bar with remaining percent', async () => {
    balanceMock.mockResolvedValue({ data: { points: 248, ai_daily_remaining: 8, ai_daily_total: 10 } })
    renderPage()
    await waitFor(() => expect(screen.getByText('80%')).toBeInTheDocument())
    expect(screen.getByText('今日额度')).toBeInTheDocument()
  })

  it('opens points modal via plan entry without check-in button', async () => {
    renderPage()
    fireEvent.click(screen.getByText('积分与套餐'))
    await waitFor(() => expect(screen.getByText('我的积分')).toBeInTheDocument())
    expect(screen.queryByText('签到')).not.toBeInTheDocument()
  })

  it('opens redeem modal when redeem action is clicked', async () => {
    renderPage()
    const redeemAction = screen.getByText('兑换码')
    expect(redeemAction.closest('a')).toBeNull()
    fireEvent.click(redeemAction)
    await waitFor(() => expect(screen.getByPlaceholderText('输入兑换码')).toBeInTheDocument())
    expect(screen.getByText('领取')).toBeInTheDocument()
  })
})

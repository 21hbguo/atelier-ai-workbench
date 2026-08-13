import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const { readUserMock, balanceMock, checkinStatusMock, inviteInfoMock, transactionsMock, subscriptionMeMock } = vi.hoisted(() => ({ readUserMock: vi.fn(), balanceMock: vi.fn(), checkinStatusMock: vi.fn(), inviteInfoMock: vi.fn(), transactionsMock: vi.fn(), subscriptionMeMock: vi.fn() }))

vi.mock('../auth', () => ({ readUser: readUserMock }))
vi.mock('../api', () => ({ pointsAPI: { balance: balanceMock, checkinStatus: checkinStatusMock, inviteInfo: inviteInfoMock, transactions: transactionsMock }, subscriptionAPI: { me: subscriptionMeMock } }))
vi.mock('../components/MainLayout', () => ({ default: ({ children }) => <div>{children}</div> }))

import AccountPage from '../pages/AccountPage'

const renderPage = () => render(<MemoryRouter><AccountPage /></MemoryRouter>)

beforeEach(() => {
  cleanup()
  readUserMock.mockReturnValue({ account: 'atelier-user', nickname: '设计师', points: 10 })
  balanceMock.mockResolvedValue({ data: { points: 248 } })
  checkinStatusMock.mockResolvedValue({ data: { checked_in_today: true } })
  inviteInfoMock.mockResolvedValue({ data: { summary: { invited_register_count: 3 } } })
  transactionsMock.mockResolvedValue({ data: { items: [{ id: 1, type: 'daily_checkin', amount: 10, description: '每日签到', created_at: '2026-08-13 09:12:00' }] } })
  subscriptionMeMock.mockResolvedValue({ data: { plan: { name: '免费套餐' }, cycle: null } })
})

describe('AccountPage', () => {
  it('loads and renders balance, check-in status, invitation summary and recent transactions', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('248').length).toBeGreaterThan(0))
    expect(screen.getByText('今日已签到')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getAllByText('每日签到').length).toBeGreaterThan(0)
  })

  it('uses wallet query deep links for redeem and invite actions', () => {
    renderPage()
    expect(screen.getByText('兑换码').closest('a')).toHaveAttribute('href', '/wallet?tab=redeem')
    expect(screen.getByText('邀请中心').closest('a')).toHaveAttribute('href', '/wallet?tab=invite')
  })
})

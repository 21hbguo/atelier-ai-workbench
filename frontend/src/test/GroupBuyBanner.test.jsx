import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { activeMock, navigateMock } = vi.hoisted(() => ({
  activeMock: vi.fn(),
  navigateMock: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('../api', () => ({
  groupBuyAPI: { active: activeMock },
}))

import GroupBuyBanner from '../components/GroupBuyBanner'

const membershipActivity = {
  id: 1,
  package_id: 10,
  package_name: '月度会员',
  package_type: 'membership',
  group_size: 3,
  group_price: 19.9,
  original_price: 39.9,
  discount_text: '5折',
  status: 1,
  teams: [{ id: 99, paid_count: 1, remain_need: 2 }],
}

const creditsActivity = {
  id: 2,
  package_id: 20,
  package_name: '积分包',
  package_type: 'credits',
  group_size: 3,
  group_price: 9.9,
  original_price: 19.9,
  discount_text: '5折',
  status: 1,
  teams: [{ id: 88, paid_count: 1, remain_need: 2 }],
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('GroupBuyBanner', () => {
  it('renders banner for membership activity with teams', async () => {
    activeMock.mockResolvedValue({ data: { items: [membershipActivity] } })
    render(<GroupBuyBanner />)
    await waitFor(() => {
      expect(screen.getByText(/月度会员拼团进行中/)).toBeInTheDocument()
    })
    expect(screen.getByText('5折')).toBeInTheDocument()
    expect(screen.getByText(/1 人正在拼团，还差 2 人成团/)).toBeInTheDocument()
    expect(screen.getByText('去拼团')).toBeInTheDocument()
  })

  it('shows strikethrough original price and group price', async () => {
    activeMock.mockResolvedValue({ data: { items: [membershipActivity] } })
    render(<GroupBuyBanner />)
    await waitFor(() => {
      expect(screen.getByText('19.9')).toBeInTheDocument()
      expect(screen.getByText('¥39.9')).toBeInTheDocument()
    })
  })

  it('navigates to team page on button click', async () => {
    activeMock.mockResolvedValue({ data: { items: [membershipActivity] } })
    render(<GroupBuyBanner />)
    await waitFor(() => expect(screen.getByText('去拼团')).toBeInTheDocument())
    fireEvent.click(screen.getByText('去拼团'))
    expect(navigateMock).toHaveBeenCalledWith('/group-buy/team/99')
  })

  it('hides silently when API fails', async () => {
    activeMock.mockRejectedValue(new Error('网络错误'))
    render(<GroupBuyBanner />)
    await waitFor(() => expect(activeMock).toHaveBeenCalled())
    expect(screen.queryByText(/拼团进行中/)).not.toBeInTheDocument()
    expect(screen.queryByText('去拼团')).not.toBeInTheDocument()
  })

  it('hides when no membership activity with teams', async () => {
    activeMock.mockResolvedValue({ data: { items: [creditsActivity] } })
    render(<GroupBuyBanner />)
    await waitFor(() => expect(activeMock).toHaveBeenCalled())
    expect(screen.queryByText(/拼团进行中/)).not.toBeInTheDocument()
  })

  it('hides when activity has no teams', async () => {
    activeMock.mockResolvedValue({ data: { items: [{ ...membershipActivity, teams: [] }] } })
    render(<GroupBuyBanner />)
    await waitFor(() => expect(activeMock).toHaveBeenCalled())
    expect(screen.queryByText(/拼团进行中/)).not.toBeInTheDocument()
  })

  it('dismiss sets localStorage key and hides banner', async () => {
    activeMock.mockResolvedValue({ data: { items: [membershipActivity] } })
    render(<GroupBuyBanner />)
    await waitFor(() => expect(screen.getByText('去拼团')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('关闭拼团横幅'))
    expect(localStorage.getItem('atelier_gb_banner_dismissed')).toBe('1')
    expect(screen.queryByText(/拼团进行中/)).not.toBeInTheDocument()
  })

  it('stays hidden when dismiss key already exists', async () => {
    localStorage.setItem('atelier_gb_banner_dismissed', '1')
    activeMock.mockResolvedValue({ data: { items: [membershipActivity] } })
    render(<GroupBuyBanner />)
    await new Promise(r => setTimeout(r, 0))
    expect(activeMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/拼团进行中/)).not.toBeInTheDocument()
  })
})

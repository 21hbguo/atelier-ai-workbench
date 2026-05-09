import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { listMock, revokeMock, dialogAlertMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  revokeMock: vi.fn(),
  dialogAlertMock: vi.fn(),
}))

vi.mock('../api', () => ({
  shareAPI: {
    list: listMock,
    revoke: revokeMock,
    create: vi.fn(),
  },
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({ alert: dialogAlertMock, confirm: vi.fn(), choose: vi.fn() }),
}))

vi.mock('../components/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}))

import SharesPage from '../pages/SharesPage'

const mockShares = [
  {
    id: 1,
    filename: 'photo1.png',
    token: 'abc123',
    expires_at: '2099-12-31 23:59:59',
    is_revoked: false,
  },
  {
    id: 2,
    filename: 'photo2.png',
    token: 'def456',
    expires_at: '2020-01-01 00:00:00',
    is_revoked: false,
  },
  {
    id: 3,
    filename: 'photo3.png',
    token: 'ghi789',
    expires_at: '2099-12-31 23:59:59',
    is_revoked: true,
  },
]

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  listMock.mockResolvedValue({ data: { items: mockShares } })
})

describe('SharesPage', () => {
  describe('share list', () => {
    it('renders page title', async () => {
      render(<SharesPage />)
      expect(screen.getByText('分享管理')).toBeInTheDocument()
    })

    it('fetches and displays share items', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('photo1.png')).toBeInTheDocument()
        expect(screen.getByText('photo2.png')).toBeInTheDocument()
        expect(screen.getByText('photo3.png')).toBeInTheDocument()
      })
    })

    it('calls shareAPI.list on mount', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        expect(listMock).toHaveBeenCalledTimes(1)
      })
    })

    it('shows empty state when no shares', async () => {
      listMock.mockResolvedValue({ data: { items: [] } })
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('暂无分享')).toBeInTheDocument()
      })
    })

    it('shows loading state initially', () => {
      listMock.mockReturnValue(new Promise(() => {}))
      render(<SharesPage />)
      expect(screen.getByText('加载中...')).toBeInTheDocument()
    })

    it('shows alert on fetch failure', async () => {
      listMock.mockRejectedValue(new Error('网络错误'))
      render(<SharesPage />)
      await waitFor(() => {
        expect(dialogAlertMock).toHaveBeenCalledWith('网络错误')
      })
    })
  })

  describe('expiry display', () => {
    it('shows active status for non-expired shares', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('生效中')).toBeInTheDocument()
      })
    })

    it('shows expired status for past-due shares', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('已过期')).toBeInTheDocument()
      })
    })

    it('shows revoked status for revoked shares', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('已撤销')).toBeInTheDocument()
      })
    })

    it('displays expiry date text', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        const expiryElements = screen.getAllByText(/到期/)
        expect(expiryElements.length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('revoke action', () => {
    it('shows revoke button for active shares', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        const revokeButtons = screen.getAllByText('撤销')
        expect(revokeButtons.length).toBe(2)
      })
    })

    it('hides revoke button for revoked shares', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('photo3.png')).toBeInTheDocument()
      })
      const revokeButtons = screen.getAllByText('撤销')
      expect(revokeButtons.length).toBe(2)
    })

    it('calls shareAPI.revoke on revoke click', async () => {
      revokeMock.mockResolvedValue({})
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('photo1.png')).toBeInTheDocument()
      })
      const revokeButtons = screen.getAllByText('撤销')
      fireEvent.click(revokeButtons[0])
      await waitFor(() => {
        expect(revokeMock).toHaveBeenCalledWith(1)
      })
    })

    it('updates UI after successful revoke', async () => {
      revokeMock.mockResolvedValue({})
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('photo1.png')).toBeInTheDocument()
      })
      const revokeButtons = screen.getAllByText('撤销')
      fireEvent.click(revokeButtons[0])
      await waitFor(() => {
        const revokedStatuses = screen.getAllByText('已撤销')
        expect(revokedStatuses.length).toBe(2)
      })
    })

    it('shows alert on revoke failure', async () => {
      revokeMock.mockRejectedValue(new Error('撤销失败'))
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('photo1.png')).toBeInTheDocument()
      })
      const revokeButtons = screen.getAllByText('撤销')
      fireEvent.click(revokeButtons[0])
      await waitFor(() => {
        expect(dialogAlertMock).toHaveBeenCalledWith('撤销失败')
      })
    })
  })

  describe('copy link', () => {
    it('shows copy link button for each share', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        const copyButtons = screen.getAllByText('复制链接')
        expect(copyButtons.length).toBe(3)
      })
    })

    it('copies share URL to clipboard on click', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.assign(navigator, { clipboard: { writeText } })
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('photo1.png')).toBeInTheDocument()
      })
      const copyButtons = screen.getAllByText('复制链接')
      fireEvent.click(copyButtons[0])
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/abc123`)
    })

    it('silently handles clipboard write failure', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('no clipboard'))
      Object.assign(navigator, { clipboard: { writeText } })
      render(<SharesPage />)
      await waitFor(() => {
        expect(screen.getByText('photo1.png')).toBeInTheDocument()
      })
      const copyButtons = screen.getAllByText('复制链接')
      fireEvent.click(copyButtons[0])
      await waitFor(() => {
        expect(writeText).toHaveBeenCalled()
      })
    })
  })

  describe('refresh', () => {
    it('re-fetches data when refresh button is clicked', async () => {
      render(<SharesPage />)
      await waitFor(() => {
        expect(listMock).toHaveBeenCalledTimes(1)
      })
      fireEvent.click(screen.getByText('刷新'))
      await waitFor(() => {
        expect(listMock).toHaveBeenCalledTimes(2)
      })
    })
  })
})

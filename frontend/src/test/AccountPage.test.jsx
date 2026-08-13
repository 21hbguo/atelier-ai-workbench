import { render, screen, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../ThemeContext'
import { LayoutModeProvider } from '../LayoutModeContext'

const readUserMock = vi.hoisted(() => vi.fn())

vi.mock('../auth', () => ({ readUser: readUserMock }))
vi.mock('../components/Sidebar', () => ({ default: () => <div data-testid="sidebar" /> }))

import AccountPage from '../pages/AccountPage'

const renderPage = () => render(
  <MemoryRouter>
    <ThemeProvider>
      <LayoutModeProvider>
        <AccountPage />
      </LayoutModeProvider>
    </ThemeProvider>
  </MemoryRouter>
)

beforeEach(() => {
  cleanup()
  readUserMock.mockReturnValue({ account: 'atelier-user', nickname: '设计师' })
})

describe('AccountPage', () => {
  it('renders the current user and compact two-column entry groups', () => {
    renderPage()
    expect(screen.getByText('设计师')).toBeInTheDocument()
    expect(screen.getByText('账户与安全')).toBeInTheDocument()
    expect(screen.getByText('服务与规则')).toBeInTheDocument()
  })

  it('links to existing account features and legal pages', () => {
    renderPage()
    expect(screen.getByText('密码与登录安全').closest('a')).toHaveAttribute('href', '/settings')
    expect(screen.getByText('套餐与积分').closest('a')).toHaveAttribute('href', '/wallet')
    expect(screen.getByText('用户协议').closest('a')).toHaveAttribute('href', '/agreement')
    expect(screen.getByText('隐私政策').closest('a')).toHaveAttribute('href', '/privacy')
  })
})

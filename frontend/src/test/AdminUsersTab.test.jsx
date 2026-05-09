import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../components/SearchInput', () => ({
  default: ({ value, onChange, placeholder }) => (
    <input
      data-testid="search-input"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('../components/Pagination', () => ({
  default: ({ page, totalPages, onPageChange }) => (
    <div data-testid="pagination">
      <span>{page}/{totalPages}</span>
      <button onClick={() => onPageChange(page + 1)}>next</button>
    </div>
  ),
}))

import AdminUsersTab from '../pages/admin-tabs/AdminUsersTab'

const makeUser = (overrides = {}) => ({
  id: 1,
  account: 'testuser',
  username: 'testuser',
  nickname: 'Test User',
  points: 100,
  is_admin: false,
  is_frozen: false,
  invite_code: 'ABC123',
  inviter_name: null,
  invited_register_count: 0,
  total_rebate_points: 0,
  total_recharge_amount: null,
  invite_risk_hit_count: 0,
  last_ip: '1.2.3.4',
  last_active: '2026-05-01',
  ...overrides,
})

const defaultProps = {
  userTotal: 0,
  userQuery: '',
  setUserQuery: vi.fn(),
  handleMigratePoints: vi.fn(),
  loading: false,
  users: [],
  setAdjustUserId: vi.fn(),
  setAdjustAmount: vi.fn(),
  setAdjustDesc: vi.fn(),
  resetPwdUserId: null,
  setResetPwdUserId: vi.fn(),
  resetPwdValue: '',
  setResetPwdValue: vi.fn(),
  handleToggleFreeze: vi.fn(),
  handleDeleteUser: vi.fn(),
  handleResetPassword: vi.fn(),
  userPage: 1,
  setUserPage: vi.fn(),
  createUserDraft: { username: '', password: '', nickname: '' },
  setCreateUserDraft: vi.fn(),
  creatingUser: false,
  handleCreateUser: vi.fn(),
}

const renderTab = (overrides = {}) =>
  render(<AdminUsersTab {...defaultProps} {...overrides} />)

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminUsersTab', () => {
  it('renders create user form', () => {
    renderTab()
    expect(screen.getByText('管理员注册用户')).toBeInTheDocument()
    expect(screen.getByText('创建用户')).toBeInTheDocument()
  })

  it('shows user total count', () => {
    renderTab({ userTotal: 10 })
    expect(screen.getByText('共 10 个用户')).toBeInTheDocument()
  })

  it('renders search input', () => {
    renderTab()
    expect(screen.getByPlaceholderText('搜索账号/昵称...')).toBeInTheDocument()
  })

  it('shows loading spinner when loading', () => {
    renderTab({ loading: true })
    expect(document.querySelector('.animate-spin-slow')).toBeInTheDocument()
  })

  it('renders user list', () => {
    const users = [
      makeUser({ id: 1, nickname: 'Alice', account: 'alice' }),
      makeUser({ id: 2, nickname: 'Bob', account: 'bob', is_admin: true }),
    ]
    renderTab({ users, userTotal: 2 })
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('账号 alice')).toBeInTheDocument()
  })

  it('shows admin badge for admin users', () => {
    const users = [makeUser({ id: 1, is_admin: true })]
    renderTab({ users })
    expect(screen.getByText('管')).toBeInTheDocument()
  })

  it('shows points for each user', () => {
    const users = [makeUser({ id: 1, points: 500 })]
    renderTab({ users })
    expect(screen.getByText('500')).toBeInTheDocument()
  })

  it('calls setAdjustUserId when points clicked', () => {
    const setAdjustUserId = vi.fn()
    const setAdjustAmount = vi.fn()
    const setAdjustDesc = vi.fn()
    const users = [makeUser({ id: 1, points: 100 })]
    renderTab({ users, setAdjustUserId, setAdjustAmount, setAdjustDesc })
    fireEvent.click(screen.getByText('100'))
    expect(setAdjustUserId).toHaveBeenCalledWith(1)
    expect(setAdjustAmount).toHaveBeenCalledWith('')
    expect(setAdjustDesc).toHaveBeenCalledWith('')
  })

  it('calls handleToggleFreeze on freeze button click', () => {
    const handleToggleFreeze = vi.fn()
    const users = [makeUser({ id: 1, account: 'alice', is_frozen: false })]
    renderTab({ users, handleToggleFreeze })
    const freezeBtn = screen.getByTitle('冻结')
    fireEvent.click(freezeBtn)
    expect(handleToggleFreeze).toHaveBeenCalledWith(1, 'alice')
  })

  it('calls handleDeleteUser on delete button click', () => {
    const handleDeleteUser = vi.fn()
    const users = [makeUser({ id: 1, account: 'alice' })]
    renderTab({ users, handleDeleteUser })
    fireEvent.click(screen.getByTitle('删除'))
    expect(handleDeleteUser).toHaveBeenCalledWith(1, 'alice')
  })

  it('does not show action buttons for admin users', () => {
    const users = [makeUser({ id: 1, is_admin: true })]
    renderTab({ users })
    expect(screen.queryByTitle('冻结')).not.toBeInTheDocument()
    expect(screen.queryByTitle('删除')).not.toBeInTheDocument()
    expect(screen.queryByTitle('重置密码')).not.toBeInTheDocument()
  })

  it('shows frozen status icon', () => {
    const users = [makeUser({ id: 1, is_frozen: true })]
    renderTab({ users })
    expect(screen.getByTitle('启用')).toBeInTheDocument()
  })

  it('shows reset password row when resetPwdUserId matches', () => {
    const users = [makeUser({ id: 1 })]
    renderTab({ users, resetPwdUserId: 1 })
    expect(screen.getByPlaceholderText('至少6位')).toBeInTheDocument()
    expect(screen.getByText('确认')).toBeInTheDocument()
    expect(screen.getByText('取消')).toBeInTheDocument()
  })

  it('calls setResetPwdValue on password input change', () => {
    const setResetPwdValue = vi.fn()
    const users = [makeUser({ id: 1 })]
    renderTab({ users, resetPwdUserId: 1, setResetPwdValue })
    fireEvent.change(screen.getByPlaceholderText('至少6位'), { target: { value: 'newpass' } })
    expect(setResetPwdValue).toHaveBeenCalledWith('newpass')
  })

  it('calls handleResetPassword on confirm click', () => {
    const handleResetPassword = vi.fn()
    const users = [makeUser({ id: 1 })]
    renderTab({ users, resetPwdUserId: 1, resetPwdValue: 'newpass123', handleResetPassword })
    fireEvent.click(screen.getByText('确认'))
    expect(handleResetPassword).toHaveBeenCalledWith(1)
  })

  it('disables confirm button when password is too short', () => {
    const users = [makeUser({ id: 1 })]
    renderTab({ users, resetPwdUserId: 1, resetPwdValue: '12345' })
    expect(screen.getByText('确认')).toBeDisabled()
  })

  it('calls setResetPwdUserId(null) on cancel click', () => {
    const setResetPwdUserId = vi.fn()
    const users = [makeUser({ id: 1 })]
    renderTab({ users, resetPwdUserId: 1, setResetPwdUserId })
    fireEvent.click(screen.getByText('取消'))
    expect(setResetPwdUserId).toHaveBeenCalledWith(null)
  })

  it('shows pagination', () => {
    renderTab({ userTotal: 50 })
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
  })

  it('shows invite info columns', () => {
    const users = [makeUser({ id: 1, invite_code: 'INV123', inviter_name: 'Admin', invited_register_count: 3, total_rebate_points: 50 })]
    renderTab({ users })
    expect(screen.getByText('INV123')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
  })

  it('shows recharge amount when available', () => {
    const users = [makeUser({ id: 1, total_recharge_amount: 99.5 })]
    renderTab({ users })
    expect(screen.getByText('¥99.50')).toBeInTheDocument()
  })

  it('calls handleCreateUser on create button click', () => {
    const handleCreateUser = vi.fn()
    const createUserDraft = { username: 'newuser', password: 'pass123', nickname: '' }
    renderTab({ createUserDraft, handleCreateUser })
    fireEvent.click(screen.getByText('创建用户'))
    expect(handleCreateUser).toHaveBeenCalledTimes(1)
  })

  it('disables create button when username is empty', () => {
    const createUserDraft = { username: '', password: 'pass123', nickname: '' }
    renderTab({ createUserDraft })
    expect(screen.getByText('创建用户')).toBeDisabled()
  })

  it('disables create button when password is empty', () => {
    const createUserDraft = { username: 'newuser', password: '', nickname: '' }
    renderTab({ createUserDraft })
    expect(screen.getByText('创建用户')).toBeDisabled()
  })

  it('shows creating state', () => {
    renderTab({ creatingUser: true })
    expect(screen.getByText('创建中...')).toBeInTheDocument()
  })
})

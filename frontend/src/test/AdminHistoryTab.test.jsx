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

import AdminHistoryTab from '../pages/admin-tabs/AdminHistoryTab'

const defaultProps = {
  historyTotal: 0,
  historyQuery: '',
  setHistoryQuery: vi.fn(),
  historySummary: { total: 0, pending: 0, queued: 0, processing: 0, running: 0, generating: 0, completed: 0, failed: 0 },
  loading: false,
  history: [],
  modelLabelMap: {},
  handleDeleteHistory: vi.fn(),
  historyPage: 1,
  setHistoryPage: vi.fn(),
}

const renderTab = (overrides = {}) =>
  render(<AdminHistoryTab {...defaultProps} {...overrides} />)

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminHistoryTab', () => {
  it('shows total records count', () => {
    renderTab({ historyTotal: 42 })
    expect(screen.getByText('共 42 条记录')).toBeInTheDocument()
  })

  it('renders search input', () => {
    renderTab()
    expect(screen.getByPlaceholderText('搜索提示词/账号...')).toBeInTheDocument()
  })

  it('shows loading spinner when loading', () => {
    renderTab({ loading: true })
    expect(document.querySelector('.animate-spin-slow')).toBeInTheDocument()
    expect(screen.queryByText('暂无记录')).not.toBeInTheDocument()
  })

  it('shows empty state when no history', () => {
    renderTab({ history: [] })
    expect(screen.getByText('暂无记录')).toBeInTheDocument()
  })

  it('renders summary stats', () => {
    const historySummary = { total: 100, pending: 5, queued: 3, processing: 2, running: 1, generating: 0, completed: 80, failed: 9 }
    renderTab({ historySummary })
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders history items', () => {
    const history = [
      {
        task_id: 't1',
        nickname: 'Alice',
        username: 'alice',
        prompt: 'a cat',
        params: { model_id: 'gpt-image-2' },
        status: 'completed',
        points_cost: 10,
        points_balance_after: 90,
        started_at: '2026-05-01T10:00:00+08:00',
        completed_at: '2026-05-01T10:00:05+08:00',
        last_ip: '1.2.3.4',
        created_at: '2026-05-01',
      },
    ]
    renderTab({ history, historyTotal: 1 })
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('a cat')).toBeInTheDocument()
    expect(screen.getAllByText('已完成').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('90')).toBeInTheDocument()
    expect(screen.getByText('5s')).toBeInTheDocument()
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument()
  })

  it('renders model name from modelLabelMap', () => {
    const history = [
      {
        task_id: 't1',
        nickname: 'Alice',
        prompt: 'test',
        params: { model_id: 'gpt-image-2' },
        status: 'completed',
      },
    ]
    renderTab({ history, historyTotal: 1, modelLabelMap: { 'gpt-image-2': 'GPT-Image-2' } })
    expect(screen.getByText('GPT-Image-2')).toBeInTheDocument()
  })

  it('renders provider id from params', () => {
    const history = [
      {
        task_id: 't1',
        nickname: 'Bob',
        prompt: 'test',
        params: { model_id: 'm1', provider_id: 'provider-a' },
        status: 'completed',
      },
    ]
    renderTab({ history, historyTotal: 1 })
    expect(screen.getByText('provider-a')).toBeInTheDocument()
  })

  it('shows pending status label', () => {
    const history = [
      { task_id: 't1', nickname: 'A', prompt: '', params: {}, status: 'pending' },
    ]
    renderTab({ history, historyTotal: 1 })
    expect(screen.getAllByText('等待中').length).toBeGreaterThanOrEqual(1)
  })

  it('shows failed status label', () => {
    const history = [
      { task_id: 't1', nickname: 'A', prompt: '', params: {}, status: 'failed' },
    ]
    renderTab({ history, historyTotal: 1 })
    expect(screen.getAllByText('失败').length).toBeGreaterThanOrEqual(1)
  })

  it('shows queued status label', () => {
    const history = [
      { task_id: 't1', nickname: 'A', prompt: '', params: {}, status: 'queued' },
    ]
    renderTab({ history, historyTotal: 1 })
    expect(screen.getAllByText('排队中').length).toBeGreaterThanOrEqual(1)
  })

  it('shows generating status label', () => {
    const history = [
      { task_id: 't1', nickname: 'A', prompt: '', params: {}, status: 'generating' },
    ]
    renderTab({ history, historyTotal: 1 })
    expect(screen.getAllByText('生成中').length).toBeGreaterThanOrEqual(1)
  })

  it('calls handleDeleteHistory on delete click', () => {
    const handleDeleteHistory = vi.fn()
    const history = [
      { task_id: 'task-123', nickname: 'A', prompt: '', params: {}, status: 'completed' },
    ]
    renderTab({ history, historyTotal: 1, handleDeleteHistory })
    fireEvent.click(screen.getByTitle('删除'))
    expect(handleDeleteHistory).toHaveBeenCalledWith('task-123')
  })

  it('shows pagination when total > 20', () => {
    renderTab({ historyTotal: 50, historyPage: 1 })
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('does not show pagination when total <= 20', () => {
    renderTab({ historyTotal: 10 })
    expect(screen.queryByTestId('pagination')).not.toBeInTheDocument()
  })

  it('shows fallback values for missing fields', () => {
    const history = [
      { task_id: 't1', prompt: null, params: {}, status: 'completed' },
    ]
    renderTab({ history, historyTotal: 1 })
    expect(screen.getByText('无提示词')).toBeInTheDocument()
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })
})

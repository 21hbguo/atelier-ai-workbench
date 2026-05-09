import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../components/Pagination', () => ({
  default: ({ page, totalPages, onPageChange }) => (
    <div data-testid="pagination">
      <span>{page}/{totalPages}</span>
      <button onClick={() => onPageChange(page + 1)}>next</button>
    </div>
  ),
}))

import AdminAnnouncementsTab from '../pages/admin-tabs/AdminAnnouncementsTab'

const defaultProps = {
  newTitle: '',
  setNewTitle: vi.fn(),
  newContent: '',
  setNewContent: vi.fn(),
  handleCreateAnnouncement: vi.fn(),
  creatingAnnouncement: false,
  announcementTotal: 0,
  loading: false,
  announcements: [],
  handleDeleteAnnouncement: vi.fn(),
  announcementPage: 1,
  setAnnouncementPage: vi.fn(),
}

const renderTab = (overrides = {}) =>
  render(<AdminAnnouncementsTab {...defaultProps} {...overrides} />)

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AdminAnnouncementsTab', () => {
  it('renders create form with title and content inputs', () => {
    renderTab()
    expect(screen.getByText('发布公告')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('公告标题')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('公告内容')).toBeInTheDocument()
    expect(screen.getByText('发布')).toBeInTheDocument()
  })

  it('shows character counts', () => {
    renderTab({ newTitle: 'hello', newContent: 'world' })
    expect(screen.getByText('5/200')).toBeInTheDocument()
    expect(screen.getByText('5/5000')).toBeInTheDocument()
  })

  it('disables publish button when title is empty', () => {
    renderTab({ newTitle: '', newContent: 'content' })
    expect(screen.getByText('发布')).toBeDisabled()
  })

  it('disables publish button when content is empty', () => {
    renderTab({ newTitle: 'title', newContent: '' })
    expect(screen.getByText('发布')).toBeDisabled()
  })

  it('disables publish button when creating', () => {
    renderTab({ newTitle: 'title', newContent: 'content', creatingAnnouncement: true })
    expect(screen.getByText('发布中...')).toBeDisabled()
  })

  it('calls handleCreateAnnouncement on publish click', () => {
    const handleCreateAnnouncement = vi.fn()
    renderTab({ newTitle: 'title', newContent: 'content', handleCreateAnnouncement })
    fireEvent.click(screen.getByText('发布'))
    expect(handleCreateAnnouncement).toHaveBeenCalledTimes(1)
  })

  it('calls setNewTitle on title input change', () => {
    const setNewTitle = vi.fn()
    renderTab({ setNewTitle })
    fireEvent.change(screen.getByPlaceholderText('公告标题'), { target: { value: 'new title' } })
    expect(setNewTitle).toHaveBeenCalledWith('new title')
  })

  it('calls setNewContent on content input change', () => {
    const setNewContent = vi.fn()
    renderTab({ setNewContent })
    fireEvent.change(screen.getByPlaceholderText('公告内容'), { target: { value: 'new content' } })
    expect(setNewContent).toHaveBeenCalledWith('new content')
  })

  it('shows total announcements count', () => {
    renderTab({ announcementTotal: 5 })
    expect(screen.getByText('共 5 条公告')).toBeInTheDocument()
  })

  it('shows loading spinner when loading', () => {
    renderTab({ loading: true })
    expect(screen.queryByText('暂无公告')).not.toBeInTheDocument()
    expect(document.querySelector('.animate-spin-slow')).toBeInTheDocument()
  })

  it('shows empty state when no announcements', () => {
    renderTab({ announcements: [] })
    expect(screen.getByText('暂无公告')).toBeInTheDocument()
  })

  it('renders announcement list', () => {
    const announcements = [
      { id: 1, title: 'Announcement 1', author_name: 'Admin', created_at: '2026-05-01' },
      { id: 2, title: 'Announcement 2', author_name: null, created_at: '2026-05-02' },
    ]
    renderTab({ announcements, announcementTotal: 2 })
    expect(screen.getByText('Announcement 1')).toBeInTheDocument()
    expect(screen.getByText('Announcement 2')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('管理员')).toBeInTheDocument()
  })

  it('calls handleDeleteAnnouncement on delete click', () => {
    const handleDeleteAnnouncement = vi.fn()
    const announcements = [
      { id: 1, title: 'Test', author_name: 'Admin', created_at: '2026-05-01' },
    ]
    renderTab({ announcements, handleDeleteAnnouncement })
    fireEvent.click(screen.getByTitle('删除'))
    expect(handleDeleteAnnouncement).toHaveBeenCalledWith(1)
  })

  it('shows pagination', () => {
    renderTab({ announcementTotal: 50 })
    expect(screen.getByTestId('pagination')).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })
})

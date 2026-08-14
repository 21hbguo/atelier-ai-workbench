import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const {
  alertMock,
  notificationListMock,
  notificationMarkReadMock,
  notificationMarkAllReadMock,
  notificationClearReadMock,
  announcementListMock,
  announcementMarkReadMock,
} = vi.hoisted(() => ({
  alertMock: vi.fn(),
  notificationListMock: vi.fn(),
  notificationMarkReadMock: vi.fn(),
  notificationMarkAllReadMock: vi.fn(),
  notificationClearReadMock: vi.fn(),
  announcementListMock: vi.fn(),
  announcementMarkReadMock: vi.fn(),
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({
    alert: alertMock,
    confirm: vi.fn(async () => true),
    choose: vi.fn(async () => null),
  }),
}))

vi.mock('../api', () => ({
  notificationAPI: {
    list: notificationListMock,
    markRead: notificationMarkReadMock,
    markAllRead: notificationMarkAllReadMock,
    clearRead: notificationClearReadMock,
  },
  announcementAPI: {
    list: announcementListMock,
    markRead: announcementMarkReadMock,
  },
}))

vi.mock('../components/Pagination', () => ({
  default: ({ page, totalPages, onPageChange }) => (
    <div data-testid="pagination">
      <span>{page}/{totalPages}</span>
      <button onClick={() => onPageChange(page - 1)} data-testid="prev">prev</button>
      <button onClick={() => onPageChange(page + 1)} data-testid="next">next</button>
    </div>
  ),
}))

import NotificationsModal from '../components/NotificationsModal'

const ok = data => Promise.resolve({ data })

const makeNotification = (id, overrides = {}) => ({
  id,
  title: `通知${id}`,
  content: `内容${id}`,
  is_read: false,
  created_at: `2026-05-0${id}T10:00:00+08:00`,
  ...overrides,
})

const makeAnnouncement = (id, overrides = {}) => ({
  id,
  title: `公告${id}`,
  content: `公告内容${id}`,
  is_read: false,
  created_at: `2026-05-0${id}T12:00:00+08:00`,
  ...overrides,
})

const openModal = () => {
  render(<NotificationsModal />)
  fireEvent(window, new Event('notifications-open'))
}

beforeEach(() => {
  cleanup()
  alertMock.mockReset()
  notificationListMock.mockReset()
  notificationMarkReadMock.mockReset()
  notificationMarkAllReadMock.mockReset()
  notificationClearReadMock.mockReset()
  announcementListMock.mockReset()
  announcementMarkReadMock.mockReset()

  notificationListMock.mockResolvedValue(ok({ items: [] }))
  announcementListMock.mockResolvedValue(ok({ items: [] }))
  notificationMarkReadMock.mockResolvedValue(ok({}))
  notificationMarkAllReadMock.mockResolvedValue(ok({}))
  notificationClearReadMock.mockResolvedValue(ok({ deleted: 0 }))
  announcementMarkReadMock.mockResolvedValue(ok({}))
})

describe('NotificationsModal', () => {
  it('is closed initially and opens on notifications-open event', async () => {
    render(<NotificationsModal />)
    expect(screen.queryByText('通知中心')).not.toBeInTheDocument()
    fireEvent(window, new Event('notifications-open'))
    await waitFor(() => expect(screen.getByText('通知中心')).toBeInTheDocument())
  })

  it('shows loading state initially', () => {
    notificationListMock.mockReturnValue(new Promise(() => {}))
    announcementListMock.mockReturnValue(new Promise(() => {}))
    openModal()
    expect(screen.getByText('加载中...')).toBeInTheDocument()
  })

  it('shows empty state when no items', async () => {
    openModal()
    await waitFor(() => expect(screen.getByText('暂无通知')).toBeInTheDocument())
  })

  it('renders notification and announcement items with correct badges', async () => {
    notificationListMock.mockResolvedValue(ok({ items: [makeNotification(1)] }))
    announcementListMock.mockResolvedValue(ok({ items: [makeAnnouncement(2)] }))
    openModal()
    await screen.findByText('通知1')
    expect(screen.getByText('公告2')).toBeInTheDocument()
    expect(screen.getByText('通知')).toBeInTheDocument()
    expect(screen.getByText('公告')).toBeInTheDocument()
  })

  it('shows mark-read button only for unread items', async () => {
    notificationListMock.mockResolvedValue(ok({
      items: [makeNotification(1), makeNotification(2, { is_read: true })],
    }))
    openModal()
    await screen.findByText('通知1')
    const markBtns = screen.getAllByText('标为已读')
    expect(markBtns).toHaveLength(1)
  })

  it('calls correct API when marking a single notification as read', async () => {
    notificationListMock.mockResolvedValue(ok({ items: [makeNotification(1)] }))
    openModal()
    await screen.findByText('通知1')
    fireEvent.click(screen.getByText('标为已读'))
    await waitFor(() => expect(notificationMarkReadMock).toHaveBeenCalledWith(1))
    expect(announcementMarkReadMock).not.toHaveBeenCalled()
  })

  it('calls correct API when marking a single announcement as read', async () => {
    announcementListMock.mockResolvedValue(ok({ items: [makeAnnouncement(5)] }))
    openModal()
    await screen.findByText('公告5')
    fireEvent.click(screen.getByText('标为已读'))
    await waitFor(() => expect(announcementMarkReadMock).toHaveBeenCalledWith(5))
    expect(notificationMarkReadMock).not.toHaveBeenCalled()
  })

  it('dispatches notifications-updated event after marking read', async () => {
    notificationListMock.mockResolvedValue(ok({ items: [makeNotification(1)] }))
    const handler = vi.fn()
    window.addEventListener('notifications-updated', handler)
    openModal()
    await screen.findByText('通知1')
    fireEvent.click(screen.getByText('标为已读'))
    await waitFor(() => expect(handler).toHaveBeenCalled())
    window.removeEventListener('notifications-updated', handler)
  })

  it('mark all read calls notificationAPI.markAllRead and marks unread announcements', async () => {
    notificationListMock.mockResolvedValue(ok({ items: [makeNotification(1)] }))
    announcementListMock.mockResolvedValue(ok({
      items: [makeAnnouncement(10), makeAnnouncement(11, { is_read: true })],
    }))
    openModal()
    await screen.findByText('通知1')
    fireEvent.click(screen.getByText('全部已读'))
    await waitFor(() => expect(notificationMarkAllReadMock).toHaveBeenCalled())
    expect(announcementMarkReadMock).toHaveBeenCalledTimes(1)
    expect(announcementMarkReadMock).toHaveBeenCalledWith(10)
  })

  it('clear read succeeds and refetches', async () => {
    notificationClearReadMock.mockResolvedValue(ok({ deleted: 3 }))
    notificationListMock.mockResolvedValue(ok({ items: [makeNotification(1)] }))
    openModal()
    await screen.findByText('通知1')
    fireEvent.click(screen.getByText('清除已读'))
    await waitFor(() => expect(notificationClearReadMock).toHaveBeenCalled())
  })

  it('clear read shows alert when nothing to clear', async () => {
    notificationClearReadMock.mockResolvedValue(ok({ deleted: 0 }))
    openModal()
    await waitFor(() => expect(screen.getByText('暂无通知')).toBeInTheDocument())
    fireEvent.click(screen.getByText('清除已读'))
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('没有已读通知可清除'))
  })

  it('shows error alert on API failure', async () => {
    notificationListMock.mockRejectedValue(new Error('网络错误'))
    openModal()
    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('网络错误'))
  })

  it('merges and sorts items by created_at descending', async () => {
    notificationListMock.mockResolvedValue(ok({
      items: [makeNotification(1, { created_at: '2026-05-01T10:00:00+08:00' })],
    }))
    announcementListMock.mockResolvedValue(ok({
      items: [makeAnnouncement(2, { created_at: '2026-05-05T12:00:00+08:00' })],
    }))
    openModal()
    await screen.findByText('公告2')
    const items = screen.getAllByText(/^(公告|通知)\d$/)
    expect(items[0]).toHaveTextContent('公告2')
    expect(items[1]).toHaveTextContent('通知1')
  })

  it('paginates client-side with size 20', async () => {
    const notifications = Array.from({ length: 15 }, (_, i) =>
      makeNotification(i + 1, { created_at: `2026-05-09T10:${String(i).padStart(2, '0')}:00+08:00` })
    )
    const announcements = Array.from({ length: 10 }, (_, i) =>
      makeAnnouncement(i + 100, { created_at: `2026-05-09T11:${String(i).padStart(2, '0')}:00+08:00` })
    )
    notificationListMock.mockResolvedValue(ok({ items: notifications }))
    announcementListMock.mockResolvedValue(ok({ items: announcements }))
    openModal()
    await screen.findByText('公告100')
    expect(screen.getByTestId('pagination')).toHaveTextContent('1/2')
  })

  it('renders formatted time', async () => {
    notificationListMock.mockResolvedValue(ok({
      items: [makeNotification(1, { created_at: '2026-05-09T14:30:00+08:00' })],
    }))
    openModal()
    await screen.findByText('通知1')
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('closes on Escape key', async () => {
    openModal()
    await waitFor(() => expect(screen.getByText('通知中心')).toBeInTheDocument())
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('通知中心')).not.toBeInTheDocument())
  })

  it('closes on backdrop click', async () => {
    openModal()
    await waitFor(() => expect(screen.getByText('通知中心')).toBeInTheDocument())
    const backdrop = document.querySelector('.fixed.inset-0.z-\\[95\\] > .absolute')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop)
    await waitFor(() => expect(screen.queryByText('通知中心')).not.toBeInTheDocument())
  })

  it('closes on phone back gesture (popstate)', async () => {
    openModal()
    await waitFor(() => expect(screen.getByText('通知中心')).toBeInTheDocument())
    expect(window.history.state?.atelierNotifications).toBe('open')
    fireEvent(window, new Event('popstate'))
    await waitFor(() => expect(screen.queryByText('通知中心')).not.toBeInTheDocument())
  })
})

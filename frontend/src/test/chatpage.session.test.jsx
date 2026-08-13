import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// 会话恢复/生成中切换的回归测试：直接渲染 ChatAssistantPage（不走 App 路由）。
// mock 风格参考 src/test/chatpage.smoke.test.jsx 与 src/test/reference-upload.test.jsx：
// 用 vi.hoisted 暴露 mock fn，beforeEach 里重置默认行为。

const {
  modelMock,
  modelsMock,
  costMock,
  sessionsMock,
  messagesMock,
  createSessionMock,
  renameSessionMock,
  deleteSessionMock,
  batchDeleteSessionsMock,
  deleteMessagesMock,
  uploadDocMock,
  sendStreamMock,
  balanceMock,
  taskGetMock,
  alertMock,
  confirmMock,
  dialogStable,
} = vi.hoisted(() => {
  const modelMock = vi.fn()
  const modelsMock = vi.fn()
  const costMock = vi.fn()
  const sessionsMock = vi.fn()
  const messagesMock = vi.fn()
  const createSessionMock = vi.fn()
  const renameSessionMock = vi.fn()
  const deleteSessionMock = vi.fn()
  const batchDeleteSessionsMock = vi.fn()
  const deleteMessagesMock = vi.fn()
  const uploadDocMock = vi.fn()
  const sendStreamMock = vi.fn()
  const balanceMock = vi.fn()
  const taskGetMock = vi.fn()
  const alertMock = vi.fn()
  const confirmMock = vi.fn()
  // useAppDialog 必须返回跨渲染稳定的对象：useEffect([activeId, dialog]) 依赖 dialog 引用，
  // 每次渲染返回新对象会触发 setMessages([])（新数组引用不 bail out）→ 无限渲染循环
  const dialogStable = { alert: alertMock, confirm: confirmMock }
  return {
    modelMock, modelsMock, costMock, sessionsMock, messagesMock, createSessionMock,
    renameSessionMock, deleteSessionMock, batchDeleteSessionsMock, deleteMessagesMock,
    uploadDocMock, sendStreamMock, balanceMock, taskGetMock, alertMock, confirmMock, dialogStable,
  }
})

vi.mock('../hooks/useUserSync', () => ({ useUserSync: () => {} }))

vi.mock('../api', () => ({
  chatAPI: {
    model: modelMock,
    models: modelsMock,
    cost: costMock,
    sessions: sessionsMock,
    messages: messagesMock,
    createSession: createSessionMock,
    renameSession: renameSessionMock,
    deleteSession: deleteSessionMock,
    batchDeleteSessions: batchDeleteSessionsMock,
    deleteMessages: deleteMessagesMock,
    uploadDoc: uploadDocMock,
    sendStream: sendStreamMock,
  },
  pointsAPI: {
    balance: balanceMock,
  },
  taskAPI: {
    get: taskGetMock,
  },
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => dialogStable,
}))

// 简化布局外壳：ChatAssistantPage 的依赖链里 MainLayout→Sidebar→Router/主题等，
// 本测试只关注会话行为，直接替换为透传 div。
vi.mock('../components/MainLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

import ChatAssistantPage from '../pages/ChatAssistantPage'

const ok = (data) => Promise.resolve({ data })

beforeEach(() => {
  cleanup()
  localStorage.clear()
  localStorage.setItem(
    'user',
    JSON.stringify({
      id: 1,
      user_id: 1,
      account: 'tester',
      username: 'tester',
      nickname: 'tester',
      is_admin: false,
      points: 100,
    })
  )
  modelMock.mockReset().mockResolvedValue(ok(null))
  modelsMock.mockReset().mockResolvedValue(ok({ items: [] }))
  costMock.mockReset().mockResolvedValue(ok({ cost_per_chat: 10 }))
  sessionsMock.mockReset().mockResolvedValue(ok({ items: [] }))
  messagesMock.mockReset().mockResolvedValue(ok({ items: [] }))
  createSessionMock.mockReset().mockResolvedValue(ok({ id: 99, title: '新对话' }))
  renameSessionMock.mockReset().mockResolvedValue(ok({}))
  deleteSessionMock.mockReset().mockResolvedValue(ok({}))
  batchDeleteSessionsMock.mockReset().mockResolvedValue(ok({ deleted: 0 }))
  deleteMessagesMock.mockReset().mockResolvedValue(ok({}))
  uploadDocMock.mockReset().mockResolvedValue(ok({}))
  // 关键：sendStream 返回一个可控的 pending Promise（永不 settle），
  // 组件因此停留在 sending 状态；options.signal 由 mock.calls 记录供 abort 断言。
  sendStreamMock.mockReset().mockImplementation(() => new Promise(() => {}))
  balanceMock.mockReset().mockResolvedValue(ok({ points: 100, ai_daily_total: 10, ai_daily_remaining: 10 }))
  taskGetMock.mockReset().mockResolvedValue(ok({}))
  alertMock.mockReset()
  confirmMock.mockReset().mockResolvedValue(true)
})

describe('ChatAssistantPage 会话恢复与生成中切换', () => {
  it('刷新后从 localStorage 恢复最近会话并加载其消息', async () => {
    localStorage.setItem('chat_active_session_id', '2')
    sessionsMock.mockResolvedValue(ok({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }))

    render(<ChatAssistantPage />)

    // 会话 2 被恢复：组件应调用 messages(2) 加载该会话的消息
    await waitFor(() => expect(messagesMock).toHaveBeenCalledWith(2))
    expect(sessionsMock).toHaveBeenCalledTimes(1)
  })

  it('无会话记忆时显示引导页：有会话列表也不恢复、不加载消息', async () => {
    // 不设置 chat_active_session_id
    sessionsMock.mockResolvedValue(ok({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }))

    render(<ChatAssistantPage />)

    // 会话列表加载完成（3 个会话项渲染出来）后，activeId 应保持 null：
    // 显示引导页而非恢复会话
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByText('新对话').length).toBe(3))
    expect(screen.getByText('和 AI 助手聊聊')).toBeInTheDocument()

    expect(messagesMock).not.toHaveBeenCalled()
    // 未被恢复 → 组件不应写入会话记忆
    expect(localStorage.getItem('chat_active_session_id')).toBeNull()
  })

  it('生成中可切换会话：abort 旧流并加载新会话消息', async () => {
    localStorage.setItem('chat_active_session_id', '1')
    sessionsMock.mockResolvedValue(ok({
      items: [{ id: 1, title: '会话一' }, { id: 2, title: '会话二' }],
    }))

    render(<ChatAssistantPage />)
    // 先等会话 1 恢复完成，确保发送落在已有会话上（activeIdRef=1）
    await waitFor(() => expect(messagesMock).toHaveBeenCalledWith(1))

    // 输入消息并回车发送 → sendStream 返回 pending promise，组件进入 sending 状态
    const textarea = screen.getByPlaceholderText('输入消息，Enter 发送，Shift+Enter 换行')
    fireEvent.change(textarea, { target: { value: '测试消息' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    await waitFor(() => expect(sendStreamMock).toHaveBeenCalledTimes(1))
    expect(sendStreamMock.mock.calls[0][0]).toBe(1) // 发送到会话 1
    expect(screen.getByText('停止生成')).toBeInTheDocument() // sending 状态可见

    const sendOptions = sendStreamMock.mock.calls[0][2]

    // 生成中点击会话列表中的另一个会话
    fireEvent.click(screen.getByText('会话二'))

    // 旧流被 abort，且组件切换到新会话并加载其消息
    expect(sendOptions.signal.aborted).toBe(true)
    await waitFor(() => expect(messagesMock).toHaveBeenCalledWith(2))
    expect(screen.queryByText('停止生成')).not.toBeInTheDocument()
  })
})

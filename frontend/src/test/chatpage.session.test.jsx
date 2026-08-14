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
  sendMessageMock,
  streamTaskMock,
  stopMessageMock,
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
  const sendMessageMock = vi.fn()
  const streamTaskMock = vi.fn()
  const stopMessageMock = vi.fn()
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
    uploadDocMock, sendMessageMock, streamTaskMock, stopMessageMock, balanceMock, taskGetMock,
    alertMock, confirmMock, dialogStable,
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
    sendMessage: sendMessageMock,
    streamTask: streamTaskMock,
    stopMessage: stopMessageMock,
  },
  pointsAPI: {
    balance: balanceMock,
  },
  taskAPI: {
    get: taskGetMock,
  },
  groupBuyAPI: {
    active: () => Promise.resolve({ data: { items: [] } }),
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

// 拼团横幅不在会话行为测试范围内，且其 useNavigate 需要 Router 环境，直接置空
vi.mock('../components/GroupBuyBanner', () => ({
  default: () => null,
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
  // 任务制：sendMessage 返回 { task_id, assistant_message_id, user_message_id }，
  // 组件随后发起 streamTask 订阅；streamTask 返回可控 pending Promise（永不 settle），
  // 组件因此停留在 sending 状态；options.signal 由 mock.calls 记录供 abort 断言。
  sendMessageMock.mockReset().mockResolvedValue(ok({ task_id: 'task-1', assistant_message_id: 'a-1', user_message_id: 'u-1' }))
  streamTaskMock.mockReset().mockImplementation(() => new Promise(() => {}))
  stopMessageMock.mockReset().mockResolvedValue(ok({ ok: true }))
  balanceMock.mockReset().mockResolvedValue(ok({ points: 100, ai_daily_total: 10, ai_daily_remaining: 10 }))
  taskGetMock.mockReset().mockResolvedValue(ok({}))
  alertMock.mockReset()
  confirmMock.mockReset().mockResolvedValue(true)
})

describe('ChatAssistantPage 会话恢复与生成中切换', () => {
  it('进入页面不恢复最近会话：即使有 localStorage 记忆也显示欢迎页', async () => {
    localStorage.setItem('chat_active_session_id', '2')
    sessionsMock.mockResolvedValue(ok({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] }))

    render(<ChatAssistantPage />)

    // 会话列表加载完成（3 个会话项渲染出来），但 activeId 保持 null：
    // 不加载任何会话消息，显示欢迎页引导用户新建/自选
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getAllByText('新对话').length).toBe(3))
    expect(screen.getByText('和 AI 助手聊聊')).toBeInTheDocument()

    expect(messagesMock).not.toHaveBeenCalled()
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

  it('生成中可切换会话：断开订阅并加载新会话消息（后台任务继续）', async () => {
    sessionsMock.mockResolvedValue(ok({
      items: [{ id: 1, title: '会话一' }, { id: 2, title: '会话二' }],
    }))

    render(<ChatAssistantPage />)
    // 进入页面为欢迎页，用户手动选择会话一
    await waitFor(() => expect(screen.getByText('会话一')).toBeInTheDocument())
    fireEvent.click(screen.getByText('会话一'))
    // 等会话 1 加载完成，确保发送落在已有会话上（activeIdRef=1）
    await waitFor(() => expect(messagesMock).toHaveBeenCalledWith(1))

    // 输入消息并回车发送 → sendMessage 创建任务，streamTask 订阅返回 pending promise，
    // 组件进入 sending 状态
    const textarea = screen.getByPlaceholderText('输入消息，Enter 发送，Shift+Enter 换行')
    fireEvent.change(textarea, { target: { value: '测试消息' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1))
    expect(sendMessageMock.mock.calls[0][0]).toBe(1) // 发送到会话 1
    await waitFor(() => expect(streamTaskMock).toHaveBeenCalledTimes(1))
    expect(streamTaskMock.mock.calls[0][0]).toBe('task-1') // 订阅返回的 task_id
    expect(screen.getByText('停止生成')).toBeInTheDocument() // sending 状态可见

    const streamOptions = streamTaskMock.mock.calls[0][1]

    // 生成中点击会话列表中的另一个会话
    fireEvent.click(screen.getByText('会话二'))

    // 订阅连接被断开（abort 订阅，非取消任务），组件切换到新会话并加载其消息
    expect(streamOptions.signal.aborted).toBe(true)
    await waitFor(() => expect(messagesMock).toHaveBeenCalledWith(2))
    expect(screen.queryByText('停止生成')).not.toBeInTheDocument()
  })
})

describe('ChatAssistantPage 无会话上传', () => {
  it('无会话时选择文件自动创建会话并上传', async () => {
    sessionsMock.mockResolvedValue(ok({ items: [] }))
    createSessionMock.mockResolvedValue(ok({ id: 99, title: '新对话' }))
    uploadDocMock.mockResolvedValue(ok({ file_id: 1, char_count: 10 }))

    const { container } = render(<ChatAssistantPage />)
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())

    // 无激活会话（未选任何会话）→ 选择文件
    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['hello world'], 'note.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    // 自动创建会话，上传使用新会话 id
    await waitFor(() => expect(createSessionMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(uploadDocMock).toHaveBeenCalled())
    expect(uploadDocMock.mock.calls[0][0]).toBe(99)
  })

  it('创建会话失败时不发起上传', async () => {
    sessionsMock.mockResolvedValue(ok({ items: [] }))
    createSessionMock.mockRejectedValue(new Error('创建失败'))

    const { container } = render(<ChatAssistantPage />)
    await waitFor(() => expect(sessionsMock).toHaveBeenCalled())

    const fileInput = container.querySelector('input[type="file"]')
    const file = new File(['hello world'], 'note.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(alertMock).toHaveBeenCalledWith('创建失败'))
    expect(uploadDocMock).not.toHaveBeenCalled()
  })
})

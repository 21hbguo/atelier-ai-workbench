import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// 全局会话搜索交互回归测试：直接渲染 ChatAssistantPage（不走 App 路由）。
// mock 风格参考 src/test/chatpage.session.test.jsx（vi.hoisted 暴露 mock fn，
// beforeEach 重置默认行为）。覆盖验收核心链路：
// 输入防抖搜索 → 结果渲染（标题+问/答标签+snippet）→ 点击跳转定位（锚点+高亮）→ 清空恢复。
// 注意：会话列表与结果列表可能含同名标题（如「画猫练习」），点击前必须等待
// 搜索态生效（会话列表消失），否则点击会落到会话列表条目上。
// 搜索词用「猫」等中文样本，与后端 ILIKE 语义对齐。

const {
  modelMock, modelsMock, costMock, sessionsMock, messagesMock, searchMock,
  createSessionMock, renameSessionMock, deleteSessionMock, batchDeleteSessionsMock,
  deleteMessagesMock, uploadDocMock, sendMessageMock, streamTaskMock, stopMessageMock,
  balanceMock, taskGetMock, dialogStable,
} = vi.hoisted(() => {
  const f = () => vi.fn()
  return {
    modelMock: f(), modelsMock: f(), costMock: f(), sessionsMock: f(), messagesMock: f(),
    searchMock: f(), createSessionMock: f(), renameSessionMock: f(), deleteSessionMock: f(),
    batchDeleteSessionsMock: f(), deleteMessagesMock: f(), uploadDocMock: f(),
    sendMessageMock: f(), streamTaskMock: f(), stopMessageMock: f(),
    balanceMock: f(), taskGetMock: f(),
    // useAppDialog 必须返回跨渲染稳定的对象：useEffect([activeId, dialog]) 依赖 dialog 引用，
    // 每次渲染返回新对象会触发 setMessages([])（新数组引用不 bail out）→ 无限渲染循环
    dialogStable: { alert: f(), confirm: f() },
  }
})

vi.mock('../hooks/useUserSync', () => ({ useUserSync: () => {} }))

vi.mock('../api', () => ({
  chatAPI: {
    model: modelMock, models: modelsMock, cost: costMock, sessions: sessionsMock,
    messages: messagesMock, search: searchMock, createSession: createSessionMock,
    renameSession: renameSessionMock, deleteSession: deleteSessionMock,
    batchDeleteSessions: batchDeleteSessionsMock, deleteMessages: deleteMessagesMock,
    uploadDoc: uploadDocMock, sendMessage: sendMessageMock, streamTask: streamTaskMock,
    stopMessage: stopMessageMock,
  },
  pointsAPI: { balance: balanceMock },
  subscriptionAPI: {
    me: () => Promise.resolve({ data: { plan: { name: '免费套餐', is_free: true, features: {} }, cycle: null } }),
  },
  taskAPI: { get: taskGetMock },
  groupBuyAPI: { active: () => Promise.resolve({ data: { items: [] } }) },
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => dialogStable,
}))

// 简化布局外壳：ChatAssistantPage 的依赖链里 MainLayout→Sidebar→Router/主题等，
// 本测试只关注搜索行为，直接替换为透传 div。
vi.mock('../components/MainLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('../components/GroupBuyBanner', () => ({
  default: () => null,
}))

import ChatAssistantPage from '../pages/ChatAssistantPage'

const ok = (data) => Promise.resolve({ data })

const SESSIONS = {
  items: [
    { id: 1, title: '会话A', created_at: '2026-08-01T00:00:00', updated_at: '2026-08-01T00:00:00', message_count: 0, last_message: '', last_message_at: null },
    { id: 3, title: '画猫练习', created_at: '2026-08-02T00:00:00', updated_at: '2026-08-02T00:00:00', message_count: 1, last_message: '好的', last_message_at: '2026-08-02T10:00:00' },
  ],
}

const MESSAGES = {
  items: [{
    id: 12, role: 'user', content: '帮我画一只猫，坐在窗边看夕阳', thinking: '',
    status: 'done', error: null, files: [], citations: [], widgets: [], sent_files: [],
    created_at: '2026-08-02T10:00:00',
  }],
}

// kind=message 命中：会话 3「画猫练习」的消息 12
const MESSAGE_HIT = {
  total: 1,
  items: [{
    kind: 'message', session_id: 3, session_title: '画猫练习', message_id: 12,
    role: 'user', snippet: '…帮我画一只猫，坐在窗边看夕阳…', ts: '2026-08-02T10:00:00',
  }],
}

// kind=session 命中：仅标题命中（消息无命中），message_id/role 为 null
const SESSION_HIT = {
  total: 1,
  items: [{
    kind: 'session', session_id: 5, session_title: '画猫的提示词', message_id: null,
    role: null, snippet: '画猫的提示词', ts: '2026-08-01T09:00:00',
  }],
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  localStorage.setItem(
    'user',
    JSON.stringify({
      id: 1, user_id: 1, account: 'tester', username: 'tester', nickname: 'tester',
      is_admin: false, points: 100,
    })
  )
  modelMock.mockReset().mockResolvedValue(ok(null))
  modelsMock.mockReset().mockResolvedValue(ok({ items: [] }))
  costMock.mockReset().mockResolvedValue(ok({ cost_per_chat: 10 }))
  sessionsMock.mockReset().mockResolvedValue(ok(SESSIONS))
  messagesMock.mockReset().mockResolvedValue(ok(MESSAGES))
  searchMock.mockReset().mockResolvedValue(ok(MESSAGE_HIT))
  createSessionMock.mockReset().mockResolvedValue(ok({ id: 99, title: '新对话' }))
  renameSessionMock.mockReset().mockResolvedValue(ok({}))
  deleteSessionMock.mockReset().mockResolvedValue(ok({}))
  batchDeleteSessionsMock.mockReset().mockResolvedValue(ok({ deleted: 0 }))
  deleteMessagesMock.mockReset().mockResolvedValue(ok({}))
  uploadDocMock.mockReset().mockResolvedValue(ok({}))
  sendMessageMock.mockReset().mockResolvedValue(ok({ task_id: 'task-1', assistant_message_id: 'a-1', user_message_id: 'u-1' }))
  streamTaskMock.mockReset().mockImplementation(() => new Promise(() => {}))
  stopMessageMock.mockReset().mockResolvedValue(ok({ ok: true }))
  balanceMock.mockReset().mockResolvedValue(ok({ points: 100, ai_daily_total: 10, ai_daily_remaining: 10 }))
  taskGetMock.mockReset().mockResolvedValue(ok({}))
})

// 打开搜索框（桌面端图标 → 展开输入框）并输入关键词
async function openSearchAndType(text) {
  fireEvent.click(screen.getByTitle('搜索'))
  const input = screen.getByPlaceholderText('搜索会话与消息')
  fireEvent.change(input, { target: { value: text } })
  return input
}

// 等待搜索态真正生效：请求发出 + 会话列表被结果列表替换（防抖 300ms 后）
async function waitSearchMode(keyword) {
  await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1))
  expect(searchMock.mock.calls[0][0]).toBe(keyword)
  await waitFor(() => expect(screen.queryByText('会话A')).not.toBeInTheDocument())
}

describe('ChatAssistantPage 全局会话搜索', () => {
  it('输入关键词 → 防抖后请求 → 结果渲染（标题 + 问/答标签 + snippet）；清空恢复会话列表', async () => {
    render(<ChatAssistantPage />)
    await waitFor(() => expect(screen.getByText('会话A')).toBeInTheDocument())

    await openSearchAndType('猫')
    await waitSearchMode('猫')
    // 请求参数：q/page/size
    expect(searchMock.mock.calls[0][1]).toBe(1)
    expect(searchMock.mock.calls[0][2]).toBe(20)

    // 结果渲染：会话标题 + 问标签 + snippet 片段
    await waitFor(() => expect(screen.getByText('画猫练习')).toBeInTheDocument())
    expect(screen.getByText('问')).toBeInTheDocument()
    expect(screen.getByText(/帮我画一只猫/)).toBeInTheDocument()

    // 清空搜索框 → 恢复会话列表（结果列表的问标签消失）
    fireEvent.click(screen.getByTitle('清空搜索'))
    await waitFor(() => expect(screen.getByText('会话A')).toBeInTheDocument())
    expect(screen.queryByText('问')).not.toBeInTheDocument()
  })

  it('无命中 → 显示空态文案', async () => {
    searchMock.mockResolvedValue(ok({ total: 0, items: [] }))
    render(<ChatAssistantPage />)
    await waitFor(() => expect(screen.getByText('会话A')).toBeInTheDocument())

    await openSearchAndType('不存在的词xyz')
    await waitSearchMode('不存在的词xyz')

    await waitFor(() => expect(screen.getByText('未找到相关会话或消息')).toBeInTheDocument())
  })

  it('kind=message 结果点击 → 切换会话并加载消息 → 锚点定位 + 高亮', async () => {
    render(<ChatAssistantPage />)
    await waitFor(() => expect(screen.getByText('会话A')).toBeInTheDocument())

    await openSearchAndType('猫')
    await waitSearchMode('猫')
    // 结果条目出现（搜索态下会话列表已消失，此处「画猫练习」必为结果条目）
    await waitFor(() => expect(screen.getByText('画猫练习')).toBeInTheDocument())

    // 点击消息命中结果 → 复用 handleSelectSession(3)：加载会话 3 的消息
    fireEvent.click(screen.getByText('画猫练习'))
    await waitFor(() => expect(messagesMock).toHaveBeenCalledWith(3))

    // 消息渲染出锚点 msg-12
    await waitFor(() => expect(document.getElementById('msg-12')).toBeTruthy())
    // scrollToPendingMessage：rAF 后定位并添加 2s 高亮 class
    await waitFor(() => expect(document.getElementById('msg-12').classList.contains('search-flash')).toBe(true))
  })

  it('kind=session 结果点击 → 仅切换会话，不定位消息', async () => {
    searchMock.mockResolvedValue(ok(SESSION_HIT))
    messagesMock.mockResolvedValue(ok({ items: [] }))
    render(<ChatAssistantPage />)
    await waitFor(() => expect(screen.getByText('会话A')).toBeInTheDocument())

    await openSearchAndType('提示词')
    await waitSearchMode('提示词')
    // 标题命中显示「标题」标签而非问/答
    await waitFor(() => expect(screen.getByText('标题')).toBeInTheDocument())

    // 标题与 snippet 同文本（各一个元素），点击任意结果条目区域
    fireEvent.click(screen.getAllByText('画猫的提示词')[0])
    // 切换到会话 5（加载空消息列表），无锚点可定位
    await waitFor(() => expect(messagesMock).toHaveBeenCalledWith(5))
    expect(document.getElementById('msg-undefined')).toBeNull()
  })

  it('命中当前已激活会话的消息 → 不重复切换，仅执行定位（early-return 分支）', async () => {
    render(<ChatAssistantPage />)
    await waitFor(() => expect(screen.getByText('会话A')).toBeInTheDocument())

    // 先手动进入会话 3（「画猫练习」），消息已加载
    fireEvent.click(screen.getByText('画猫练习'))
    await waitFor(() => expect(messagesMock).toHaveBeenCalledWith(3))
    expect(messagesMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.getElementById('msg-12')).toBeTruthy())

    // 搜索命中的正是当前会话（session_id=3）
    await openSearchAndType('猫')
    await waitSearchMode('猫')
    await waitFor(() => expect(screen.getByText('画猫练习')).toBeInTheDocument())
    fireEvent.click(screen.getByText('画猫练习'))

    // 不再重新加载消息，但定位高亮照常执行
    expect(messagesMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.getElementById('msg-12').classList.contains('search-flash')).toBe(true))
  })

  it('total 超一页时展示分页并支持翻页请求', async () => {
    searchMock.mockResolvedValue(ok({ ...MESSAGE_HIT, total: 25 }))
    render(<ChatAssistantPage />)
    await waitFor(() => expect(screen.getByText('会话A')).toBeInTheDocument())

    await openSearchAndType('猫')
    await waitSearchMode('猫')
    await waitFor(() => expect(screen.getByText('下一页')).toBeInTheDocument())

    fireEvent.click(screen.getByText('下一页'))
    // 翻页 → page=2 重新请求
    await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(2))
    expect(searchMock.mock.calls[1][1]).toBe(2)
  })
})

import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
const { titleItemsMock, testTitleMock, promptCategoriesMock, updateAuditResultMock, approveAuditMock, rejectAuditMock, getAuditTaskMock } = vi.hoisted(() => ({
  titleItemsMock: vi.fn(),
  testTitleMock: vi.fn(),
  promptCategoriesMock: vi.fn(),
  updateAuditResultMock: vi.fn(),
  approveAuditMock: vi.fn(),
  rejectAuditMock: vi.fn(),
  getAuditTaskMock: vi.fn(async () => ({ data: {} })),
}))
vi.mock('../api', () => ({
  adminAPI: {
    titleItems: titleItemsMock,
    testTitle: testTitleMock,
    updateAuditResult: updateAuditResultMock,
    approveAudit: approveAuditMock,
    rejectAudit: rejectAuditMock,
    getAuditTask: getAuditTaskMock,
  },
  promptAPI: {
    categories: promptCategoriesMock,
  },
}))
import AdminClassificationTab from '../pages/admin-tabs/AdminClassificationTab'
function renderTab(overrides = {}) {
  return render(
    <AdminClassificationTab
      tasks={[]}
      total={0}
      page={1}
      setPage={vi.fn()}
      detail={null}
      setDetail={vi.fn()}
      selected={new Set()}
      setSelected={vi.fn()}
      onCreateTask={vi.fn()}
      categories={[]}
      onRefreshTasks={vi.fn()}
      auditTasks={[]}
      auditTotal={0}
      auditPage={1}
      setAuditPage={vi.fn()}
      auditDetail={null}
      setAuditDetail={vi.fn()}
      auditSelected={new Set()}
      setAuditSelected={vi.fn()}
      onCreateAuditTask={vi.fn()}
      onRefreshAuditTasks={vi.fn()}
      {...overrides}
    />
  )
}
beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  promptCategoriesMock.mockResolvedValue({ data: { categories: [] } })
  testTitleMock.mockResolvedValue({ data: { title: '建议标题' } })
})
describe('AdminClassificationTab', () => {
  it('标题生成子tab不混入分类任务面板', async () => {
    titleItemsMock.mockResolvedValue({ data: { items: [], total: 0 } })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '标题生成' }))
    expect(await screen.findByText('现有库标题管理')).toBeInTheDocument()
    expect(screen.queryByText('AI 自动分类')).not.toBeInTheDocument()
    expect(screen.queryByText('开始新分类')).not.toBeInTheDocument()
    expect(screen.queryByText('LLM 调试')).not.toBeInTheDocument()
  })
  it('提示词库条目支持别名字段显示并可生成建议标题', async () => {
    titleItemsMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'p1',
            title: '已有别名标题',
            item_prompt: '这是提示词内容',
            author_name: '作者甲',
            category_label: '人像',
          },
        ],
        total: 1,
      },
    })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: '标题生成' }))
    expect((await screen.findAllByText('已有别名标题')).length).toBe(2)
    expect(screen.getByText('这是提示词内容')).toBeInTheDocument()
    expect(screen.getByText(/提示词库 · 作者甲 · 人像/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '生成建议' }))
    await waitFor(() => expect(testTitleMock).toHaveBeenCalledWith({ prompt: '这是提示词内容', raw_name: '已有别名标题', prefer_prompt: true }))
    expect((await screen.findAllByText('建议标题')).length).toBe(2)
  })
  it('分类详情页支持失败筛选并显示批量操作', () => {
    renderTab({
      detail: {
        id: 11,
        status: 'pending_review',
        processed_items: 2,
        total_items: 3,
        results: [
          { id: 'r1', item_name: '条目一', item_prompt: '提示词一', item_category: '风景', suggested_category: 'portrait', suggested_category_label: '人像', status: 'pending', confidence: 'high', is_new_category: false },
          { id: 'r2', item_name: '条目二', item_prompt: '提示词二', item_category: '', suggested_category: '_error', status: 'pending', confidence: 'low', is_new_category: false },
          { id: 'r3', item_name: '条目三', item_prompt: '提示词三', item_category: '', suggested_category: '_removed', status: 'rejected', confidence: 'medium', is_new_category: false },
        ],
      },
      categories: [{ slug: 'portrait', label: '人像' }],
    })
    expect(screen.getByText('分类任务 #11')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /分类失败 \(1\)/ }))
    expect(screen.getByText('条目二')).toBeInTheDocument()
    expect(screen.queryByText('条目一')).not.toBeInTheDocument()
    expect(screen.getByTitle('移除')).toBeInTheDocument()
    expect(screen.queryByTitle('通过')).not.toBeInTheDocument()
  })
  it('审核详情页切换后显示审核建议而不是分类建议', () => {
    renderTab({
      auditDetail: {
        id: 21,
        status: 'completed',
        processed_items: 1,
        total_items: 1,
        results: [
          {
            id: 'a1',
            item_name: '可疑内容',
            item_prompt: '可疑提示词',
            item_category: '未分类',
            item_author: '审核员',
            risk_level: 'high',
            suggested_action: 'delete',
            reason_summary: '包含违规词',
            reason_detail: '命中敏感规则',
            hit_rules: ['rule-1'],
            status: 'pending',
            confidence: 'high',
          },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '内容审核' }))
    expect(screen.getByText('审核任务 #21')).toBeInTheDocument()
    expect(screen.getByText('高风险')).toBeInTheDocument()
    expect(screen.getByText('建议删除')).toBeInTheDocument()
    expect(screen.getByText('包含违规词')).toBeInTheDocument()
    expect(screen.queryByText('分类失败')).not.toBeInTheDocument()
  })
  it('审核编辑态保存会调用更新接口', async () => {
    updateAuditResultMock.mockResolvedValue({ data: {} })
    getAuditTaskMock.mockResolvedValue({ data: { id: 31, status: 'pending_review', processed_items: 1, total_items: 1, results: [] } })
    renderTab({
      auditDetail: {
        id: 31,
        status: 'pending_review',
        processed_items: 1,
        total_items: 1,
        results: [
          {
            id: 'a2',
            item_name: '待复核内容',
            item_prompt: '待复核提示词',
            item_category: '未分类',
            item_author: '审核员',
            risk_level: 'medium',
            suggested_action: 'review',
            reason_summary: '初始摘要',
            reason_detail: '初始详情',
            hit_rules: ['rule-a'],
            status: 'pending',
            confidence: 'medium',
          },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: '内容审核' }))
    const summaryInput = screen.getByDisplayValue('初始摘要')
    fireEvent.change(summaryInput, { target: { value: '更新后的摘要' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateAuditResultMock).toHaveBeenCalledWith('a2', expect.objectContaining({ reason_summary: '更新后的摘要', hit_rules: ['rule-a'] })))
    await waitFor(() => expect(getAuditTaskMock).toHaveBeenCalledWith(31))
  })
  it('分类建议支持改成已有分类', () => {
    const setDetail = vi.fn()
    renderTab({
      setDetail,
      detail: {
        id: 41,
        status: 'pending_review',
        processed_items: 1,
        total_items: 1,
        results: [
          { id: 'c1', item_name: '分类条目', item_prompt: '分类提示词', item_category: '原分类', suggested_category: 'portrait', suggested_category_label: '人像', status: 'pending', confidence: 'high', is_new_category: false },
        ],
      },
      categories: [{ slug: 'portrait', label: '人像' }, { slug: 'landscape', label: '风景' }],
    })
    fireEvent.click(screen.getByTitle('更改分类'))
    fireEvent.click(screen.getByRole('button', { name: '风景' }))
    expect(setDetail).not.toHaveBeenCalled()
  })
})

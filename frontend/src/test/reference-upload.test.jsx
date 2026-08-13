import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const {
  uploadMock,
  activeSummaryMock,
  submitTextMock,
  submitTextImageMock,
  alertMock,
  confirmMock,
  submissionQueueStore,
} = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  activeSummaryMock: vi.fn(),
  submitTextMock: vi.fn(),
  submitTextImageMock: vi.fn(),
  alertMock: vi.fn(),
  confirmMock: vi.fn(async () => true),
  submissionQueueStore: new Map(),
}))

vi.mock('../components/AppDialogProvider', () => ({
  useAppDialog: () => ({
    alert: alertMock,
    confirm: confirmMock,
    choose: vi.fn(async () => null),
  }),
}))

vi.mock('../utils/imageDB', () => ({
  getCachedImages: vi.fn(async () => []),
  setCachedImages: vi.fn(async () => {}),
  getPendingImage: vi.fn(async () => null),
  clearPendingImage: vi.fn(async () => {}),
  setSubmissionQueue: vi.fn(async (key, items) => {
    submissionQueueStore.set(key, Array.isArray(items) ? items : [])
  }),
  getPrunedSubmissionQueue: vi.fn(async (key) => submissionQueueStore.get(key) || []),
  getSubmissionQueue: vi.fn(async (key) => submissionQueueStore.get(key) || []),
}))

vi.mock('../api', () => {
  const ok = (data) => Promise.resolve({ data })
  return {
    promptOptimizeAPI: {
      optimize: vi.fn(),
      optimizeStream: vi.fn(),
    },
    uploadAPI: { upload: uploadMock },
    generateAPI: {
      submitText: submitTextMock,
      submitTextImage: submitTextImageMock,
    },
    taskAPI: {
      activeSummary: activeSummaryMock,
      list: vi.fn(async () => ({ data: [] })),
      get: vi.fn(async () => ({
        data: {
          task_id: 't1',
          status: 'processing',
          progress: 10,
          result_urls: [],
          error: null,
          params: {},
          prompt: '',
          type: 'text',
        },
      })),
      getByClientRequestId: vi.fn(async () => ({
        data: {
          task_id: 't1',
          status: 'processing',
          progress: 10,
          result_urls: [],
          error: null,
          params: {},
          prompt: '',
          type: 'text',
        },
      })),
      retry: vi.fn(async () => ({ data: {} })),
      delete: vi.fn(async () => ({ data: {} })),
      batchDelete: vi.fn(async () => ({ data: { deleted: 0, deleted_ids: [], failed: [] } })),
    },
    imageAPI: {
      list: vi.fn(async () => ({ data: { images: [] } })),
      extend: vi.fn(async () => ({
        data: { success_count: 0, skipped_count: 0, failed_count: 0, total_cost: 0, points: 100 },
      })),
      delete: vi.fn(async () => ({ data: {} })),
      batchDelete: vi.fn(async () => ({ data: { deleted: 0, deleted_filenames: [], failed: [] } })),
    },
    squareAPI: {
      share: vi.fn(async () => ({ data: { id: 1 } })),
      unshare: vi.fn(async () => ({ data: {} })),
      my: vi.fn(async () => ok({ images: [] })),
      list: vi.fn(async () => ok({ images: [], total: 0 })),
      like: vi.fn(async () => ok({})),
    },
    adminAPI: {
      users: vi.fn(async () => ({ data: { users: [], total: 0 } })),
    },
    pointsAPI: {
      balance: vi.fn(async () => ok({ points: 100 })),
      checkinStatus: vi.fn(async () => ok({ checked_in_today: false })),
      checkin: vi.fn(async () => ok({ points: 110, message: 'ok' })),
    },
    subscriptionAPI: {
      me: vi.fn(async () => ok({ plan: { name: '免费套餐', is_free: true } })),
    },
    configAPI: {
      get: vi.fn(async () =>
        ok({
          home_page_size: 24,
          square_page_size: 20,
          points_cost_per_generation: 10,
          points_cost_per_optimize: 10,
          points_cost_per_optimize_refine: 20,
          points_cost_per_image_extend: 2,
        })
      ),
      models: vi.fn(async () =>
        ok({
          default_model_id: 'gpt-image-2',
          models: [
            {
              model_id: 'gpt-image-2',
              label: 'GPT-Image-2',
              params: {
                size: {
                  label: '比例',
                  type: 'select',
                  default: 'auto',
                  options: [
                    { value: 'auto', label: '自动' },
                    { value: '1:1', label: '1:1' },
                    { value: '3:2', label: '3:2' },
                    { value: '2:3', label: '2:3' },
                    { value: '4:3', label: '4:3' },
                    { value: '3:4', label: '3:4' },
                    { value: '16:9', label: '16:9' },
                    { value: '9:16', label: '9:16' },
                  ],
                },
              },
            },
            {
              model_id: 'grsai-vip',
              label: 'GPT-Image-2-VIP',
              params: {
                points_cost: 15,
                resolution_costs: { auto: 15, low: 15, medium: 25, high: 40 },
                size: {
                  label: '比例',
                  type: 'select',
                  default: 'auto',
                  options: [
                    { value: 'auto', label: '自动' },
                    { value: '1:1', label: '1:1' },
                    { value: '16:9', label: '16:9' },
                  ],
                },
                resolution: {
                  label: '分辨率',
                  type: 'select',
                  default: 'low',
                  options: [
                    { value: 'low', label: '1K' },
                    { value: 'medium', label: '2K' },
                    { value: 'high', label: '4K' },
                  ],
                },
                quality: {
                  label: '画质',
                  type: 'select',
                  default: 'auto',
                  options: [
                    { value: 'auto', label: '自动' },
                    { value: 'high', label: '高' },
                  ],
                },
              },
            },
          ],
        })
      ),
    },
    promptAPI: {
      listPublic: vi.fn(async () => ok({ prompts: [] })),
      categories: vi.fn(async () => ok({ categories: [] })),
    },
    notificationAPI: {
      unreadCount: vi.fn(async () => ok({ count: 0 })),
      list: vi.fn(async () => ok({ items: [] })),
      markRead: vi.fn(async () => ok({})),
      markAllRead: vi.fn(async () => ok({})),
      clearRead: vi.fn(async () => ok({ deleted: 0 })),
    },
    announcementAPI: {
      getUnread: vi.fn(async () => ok({ items: [] })),
      list: vi.fn(async () => ok({ items: [], total: 0 })),
      markRead: vi.fn(async () => ok({})),
    },
  }
})

import ChatInput from '../components/ChatInput'
import ChatPage from '../pages/ChatPage'
import { LayoutModeProvider } from '../LayoutModeContext'
import { ThemeProvider } from '../ThemeContext'
import { MemoryRouter } from 'react-router-dom'
import { getSubmissionQueue } from '../utils/imageDB'

beforeEach(() => {
  cleanup()
  submissionQueueStore.clear()
  localStorage.clear()
  localStorage.setItem(
    'user',
    JSON.stringify({
      id: 1,
      user_id: 1,
      username: 'tester',
      nickname: 'tester',
      points: 100,
      is_admin: false,
    })
  )
  uploadMock.mockReset()
  activeSummaryMock.mockReset()
  submitTextMock.mockReset()
  submitTextImageMock.mockReset()
  alertMock.mockReset()
  confirmMock.mockReset()
  confirmMock.mockResolvedValue(true)
  activeSummaryMock.mockResolvedValue({
    data: { active_count: 0, global_limit: 20, available_slots: 20 },
  })
  submitTextMock.mockResolvedValue({
    data: { task_id: 'task-text', status: 'processing', message: 'ok' },
  })
  submitTextImageMock.mockResolvedValue({
    data: { task_id: 'task-image', status: 'processing', message: 'ok' },
  })
  window.fetch = vi.fn(async (url) => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'image/png' }),
    blob: async () => new Blob(['img'], { type: 'image/png' }),
    json: async () => ({}),
    text: async () => '',
    url,
  }))
})

describe('reference upload flow', () => {
  it('blocks submit on failed upload and allows submit after delete', async () => {
    const onSubmit = vi.fn(async () => true)
    uploadMock.mockRejectedValueOnce(new Error('上传失败'))
    const { container } = render(
      <ChatInput
        onSubmit={onSubmit}
        loading={false}
        requestCost={10}
        optimizeCost={10}
        refineOptimizeCost={20}
      />
    )
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['img'], 'fail.png', { type: 'image/png' })] },
    })
    await waitFor(() =>
      expect(screen.getByText('存在上传失败的参考图，请删除后重新添加')).toBeInTheDocument()
    )
    fireEvent.change(screen.getByPlaceholderText('和 AI 助手聊聊，支持多模型对话与多模态创作 ✨'), {
      target: { value: 'test prompt' },
    })
    expect(screen.getByTitle('生成')).toBeDisabled()
    const deleteBtn = container.querySelector('.absolute.-top-1.-right-1')
    fireEvent.click(deleteBtn)
    await waitFor(() =>
      expect(
        screen.queryByText('存在上传失败的参考图，请删除后重新添加')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTitle('生成')).not.toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('switches thumbnail from percent to processing before upload resolves', async () => {
    let resolveUpload
    uploadMock.mockImplementationOnce(() => new Promise(resolve => { resolveUpload = resolve }))
    const { container } = render(
      <ChatInput
        onSubmit={vi.fn(async () => true)}
        loading={false}
        requestCost={10}
        optimizeCost={10}
        refineOptimizeCost={20}
      />
    )
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['img'], 'progress.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
    const options = uploadMock.mock.calls[0][1]
    options.onProgress(60)
    await waitFor(() => expect(screen.getByText('60%')).toBeInTheDocument())
    options.onProgress(100)
    await waitFor(() => expect(screen.getByText('处理中')).toBeInTheDocument())
    expect(screen.queryByText('100%')).not.toBeInTheDocument()
    resolveUpload({ data: { url: 'https://cdn.example/progress.png', storage_name: 'uploads/progress.png' } })
    await waitFor(() => expect(screen.queryByText('处理中')).not.toBeInTheDocument())
  })

  it('shows gpt-image-2 ratio only', async () => {
    render(
      <ChatInput
        onSubmit={vi.fn(async () => true)}
        loading={false}
        requestCost={10}
        optimizeCost={10}
        refineOptimizeCost={20}
      />
    )
    fireEvent.click(screen.getByTitle('参数设置'))
    await screen.findByText('模型')
    expect(screen.getByText('比例')).toBeInTheDocument()
    expect(screen.queryByText('尺寸')).not.toBeInTheDocument()
    expect(screen.queryByText('分辨率')).not.toBeInTheDocument()
    expect(screen.queryByText('画质')).not.toBeInTheDocument()
  })

  it('queues only preuploaded success images', async () => {
    uploadMock.mockResolvedValue({
      data: { url: 'https://cdn.example/ref.png', storage_name: 'uploads/ref.png' },
    })
    const { container } = render(
      <MemoryRouter>
        <ThemeProvider>
          <LayoutModeProvider>
            <ChatPage />
          </LayoutModeProvider>
        </ThemeProvider>
      </MemoryRouter>
    )
    fireEvent.change(await screen.findByPlaceholderText('和 AI 助手聊聊，支持多模型对话与多模态创作 ✨'), {
      target: { value: 'prompt' },
    })
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [new File(['img'], 'ok.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTitle('生成'))
    await screen.findByText('批量生成')
    fireEvent.click(screen.getByText('确认生成'))
    const queueKey = 'submission_queue_1'
    await waitFor(async () => expect((await getSubmissionQueue(queueKey)).length).toBe(1))
    const items = await getSubmissionQueue(queueKey)
    expect(items[0].images.map(img => img.uploadedUrl)).toEqual(['https://cdn.example/ref.png'])
    expect(items[0].images.map(img => img.uploadedStorageName)).toEqual(['uploads/ref.png'])
    expect(uploadMock).toHaveBeenCalledTimes(1)
  })

  it('submits vip auto ratio with empty upstream size mode but keeps billing tier', async () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <ChatInput
        onSubmit={onSubmit}
        loading={false}
        requestCost={10}
        optimizeCost={10}
        refineOptimizeCost={20}
      />
    )
    fireEvent.click(screen.getByTitle('参数设置'))
    const modelLabel = await screen.findByText('模型')
    const getSelect = (labelText) =>
      within(screen.getByText(labelText).closest('label')).getByRole('combobox')
    fireEvent.change(within(modelLabel.closest('label')).getByRole('combobox'), {
      target: { value: 'grsai-vip' },
    })
    fireEvent.change(screen.getByPlaceholderText('和 AI 助手聊聊，支持多模型对话与多模态创作 ✨'), {
      target: { value: 'vip prompt' },
    })
    fireEvent.change(getSelect('分辨率'), { target: { value: 'high' } })
    fireEvent.change(getSelect('画质'), { target: { value: 'high' } })
    fireEvent.keyDown(screen.getByPlaceholderText('和 AI 助手聊聊，支持多模型对话与多模态创作 ✨'), {
      key: 'Enter',
      code: 'Enter',
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].params.model_id).toBe('grsai-vip')
    expect(onSubmit.mock.calls[0][0].params.resolution).toBe('high')
    expect(onSubmit.mock.calls[0][0].params.size).toBe('auto')
    expect(onSubmit.mock.calls[0][0].params.aspectRatio).toBe('')
  })

  it('submits vip ratio through size when non-auto', async () => {
    const onSubmit = vi.fn(async () => true)
    render(
      <ChatInput
        onSubmit={onSubmit}
        loading={false}
        requestCost={10}
        optimizeCost={10}
        refineOptimizeCost={20}
      />
    )
    fireEvent.click(screen.getByTitle('参数设置'))
    const modelLabel = await screen.findByText('模型')
    const getSelect = (labelText) =>
      within(screen.getByText(labelText).closest('label')).getByRole('combobox')
    fireEvent.change(within(modelLabel.closest('label')).getByRole('combobox'), {
      target: { value: 'grsai-vip' },
    })
    fireEvent.change(getSelect('比例'), { target: { value: '16:9' } })
    fireEvent.change(getSelect('分辨率'), { target: { value: 'high' } })
    fireEvent.change(screen.getByPlaceholderText('和 AI 助手聊聊，支持多模型对话与多模态创作 ✨'), {
      target: { value: 'vip prompt' },
    })
    fireEvent.keyDown(screen.getByPlaceholderText('和 AI 助手聊聊，支持多模型对话与多模态创作 ✨'), {
      key: 'Enter',
      code: 'Enter',
    })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].params.size).toBe('16:9')
    expect(onSubmit.mock.calls[0][0].params.aspectRatio).toBe('16:9')
    expect(onSubmit.mock.calls[0][0].params.resolution).toBe('high')
  })

  it('updates vip cost by resolution tier', async () => {
    render(
      <ChatInput
        onSubmit={vi.fn(async () => true)}
        loading={false}
        requestCost={10}
        optimizeCost={10}
        refineOptimizeCost={20}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('和 AI 助手聊聊，支持多模型对话与多模态创作 ✨'), {
      target: { value: 'vip prompt' },
    })
    fireEvent.click(screen.getByTitle('参数设置'))
    const modelLabel = await screen.findByText('模型')
    const getSelect = (labelText) =>
      within(screen.getByText(labelText).closest('label')).getByRole('combobox')
    fireEvent.change(within(modelLabel.closest('label')).getByRole('combobox'), {
      target: { value: 'grsai-vip' },
    })
    fireEvent.click(screen.getByTitle('生成'))
    await screen.findByText('批量生成')
    expect(screen.getByText('15')).toBeInTheDocument()
    fireEvent.click(screen.getByText('取消'))
    fireEvent.change(getSelect('分辨率'), { target: { value: 'medium' } })
    fireEvent.click(screen.getByTitle('生成'))
    await screen.findByText('批量生成')
    expect(screen.getByText('25')).toBeInTheDocument()
    fireEvent.click(screen.getByText('取消'))
    fireEvent.change(getSelect('分辨率'), { target: { value: 'high' } })
    fireEvent.click(screen.getByTitle('生成'))
    await screen.findByText('批量生成')
    expect(screen.getByText('40')).toBeInTheDocument()
  })
})

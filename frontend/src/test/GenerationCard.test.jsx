import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

const { shareMock, createShareLinkMock } = vi.hoisted(() => ({
  shareMock: vi.fn(async () => ({ data: { id: 1 } })),
  createShareLinkMock: vi.fn(async () => ({ data: { url: '/s/abc123' } })),
}))

vi.mock('../api', () => ({
  squareAPI: { share: shareMock },
  shareAPI: { create: createShareLinkMock },
}))

vi.mock('../utils/expiry', () => ({
  getExpiryInfo: vi.fn(({ isPermanent }) => {
    if (isPermanent) return { expired: false, text: '长久', detail: '已分享到广场，长久保存', msLeft: null }
    return { expired: false, text: '3天到期', detail: '3天后过期', msLeft: 86400000 * 3 }
  }),
}))

import GenerationCard from '../components/GenerationCard'

function makeTask(overrides = {}) {
  return {
    task_id: 't1',
    status: 'completed',
    result_urls: ['/api/images/file/abc.png'],
    params: { prompt: 'a cat', size: '1:1' },
    started_at: null,
    expires_at: null,
    is_permanent: false,
    error: null,
    ...overrides,
  }
}

function renderCard(taskOverrides = {}, props = {}) {
  return render(<GenerationCard task={makeTask(taskOverrides)} {...props} />)
}

function getImg(container) {
  return container.querySelector('img')
}

beforeEach(() => {
  cleanup()
  shareMock.mockClear()
  createShareLinkMock.mockClear()
  shareMock.mockResolvedValue({ data: { id: 1 } })
  createShareLinkMock.mockResolvedValue({ data: { url: '/s/abc123' } })
})

describe('GenerationCard', () => {
  describe('rendering in different states', () => {
    it('renders completed task with image', () => {
      const { container } = renderCard()
      const img = getImg(container)
      expect(img).toBeInTheDocument()
      expect(img.src).toContain('abc.png')
    })

    it('renders processing status with spinner and progress', () => {
      const { container } = renderCard({
        status: 'processing',
        result_urls: [],
        started_at: new Date().toISOString(),
      })
      expect(screen.getAllByText(/生成中/).length).toBeGreaterThan(0)
      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })

    it('renders queued status', () => {
      renderCard({ status: 'queued', result_urls: [] })
      expect(screen.getAllByText(/排队中/).length).toBeGreaterThan(0)
    })

    it('renders running status as processing', () => {
      renderCard({ status: 'running', result_urls: [], started_at: new Date().toISOString() })
      expect(screen.getAllByText(/生成中/).length).toBeGreaterThan(0)
    })

    it('renders failed status with error indicator', () => {
      renderCard({ status: 'failed', result_urls: [], error: 'Network timeout' })
      expect(screen.getAllByText(/失败/).length).toBeGreaterThan(0)
      expect(screen.getAllByText('Network timeout').length).toBeGreaterThanOrEqual(1)
    })

    it('renders pending status', () => {
      renderCard({ status: 'pending', result_urls: [] })
      expect(screen.getAllByText(/等待中/).length).toBeGreaterThan(0)
    })

    it('renders fallback title for failed task without prompt', () => {
      renderCard({ status: 'failed', result_urls: [], params: {}, prompt: '' })
      expect(screen.getByText('生成失败')).toBeInTheDocument()
    })

    it('renders fallback title for new task without prompt', () => {
      renderCard({ status: 'pending', result_urls: [], params: {}, prompt: '' })
      expect(screen.getByText('新的创作')).toBeInTheDocument()
    })
  })

  describe('media display', () => {
    it('shows image with thumb and thumb2x srcSet', () => {
      const { container } = renderCard()
      const img = getImg(container)
      expect(img.getAttribute('srcset')).toContain('2x')
    })

    it('renders placeholder when no result_urls and not completed', () => {
      const { container } = renderCard({
        status: 'pending',
        result_urls: [],
        previewImages: ['https://preview/img.jpg'],
      })
      const img = getImg(container)
      expect(img).toBeNull()
      expect(container.querySelector('.aspect-square')).toBeInTheDocument()
    })

    it('applies blur class when thumbnailBlurred is true', () => {
      const { container } = renderCard({}, { thumbnailBlurred: true })
      const img = getImg(container)
      expect(img.className).toContain('blur-md')
    })

    it('does not apply blur class by default', () => {
      const { container } = renderCard()
      const img = getImg(container)
      expect(img.className).not.toContain('blur-md')
    })

    it('renders masonry img without wrapper shell', () => {
      const { container } = renderCard({}, { masonry: true })
      expect(container.querySelector('.card-feed-media-shell')).toBeNull()
      const img = getImg(container)
      expect(img.className).toContain('card-feed-media-masonry')
    })

    it('renders non-masonry img with wrapper shell', () => {
      const { container } = renderCard({}, { masonry: false })
      expect(container.querySelector('.card-feed-media-shell')).toBeInTheDocument()
    })

    it('uses aspect ratio from image dimensions', () => {
      const { container } = renderCard({ width: 800, height: 600 })
      const shell = container.querySelector('.card-feed-media-shell')
      expect(shell.style.aspectRatio).toBe('800 / 600')
    })

    it('defaults to 1:1 aspect ratio without dimensions', () => {
      const { container } = renderCard()
      const shell = container.querySelector('.card-feed-media-shell')
      expect(shell.style.aspectRatio).toBe('1 / 1')
    })
  })

  describe('action buttons for completed tasks', () => {
    it('renders "做同款" button when onAddPrompt is provided', () => {
      renderCard({}, { onAddPrompt: vi.fn() })
      expect(screen.getByText('做同款')).toBeInTheDocument()
    })

    it('does not render "做同款" button without onAddPrompt', () => {
      renderCard()
      expect(screen.queryByText('做同款')).not.toBeInTheDocument()
    })

    it('does not render "做同款" when prompt is empty', () => {
      renderCard({ params: { prompt: '' }, prompt: '' }, { onAddPrompt: vi.fn() })
      expect(screen.queryByText('做同款')).not.toBeInTheDocument()
    })

    it('calls onAddPrompt with prompt text when "做同款" is clicked', () => {
      const onAddPrompt = vi.fn()
      renderCard({}, { onAddPrompt })
      fireEvent.click(screen.getByText('做同款'))
      expect(onAddPrompt).toHaveBeenCalledWith('a cat')
    })

    it('renders "参考图" button when onAddImage is provided', () => {
      renderCard({}, { onAddImage: vi.fn() })
      expect(screen.getByText('参考图')).toBeInTheDocument()
    })

    it('calls onAddImage with full image url when "参考图" is clicked', () => {
      const onAddImage = vi.fn()
      renderCard({}, { onAddImage })
      fireEvent.click(screen.getByText('参考图'))
      expect(onAddImage).toHaveBeenCalledWith(expect.stringContaining('abc.png'), expect.objectContaining({ task_id: 't1' }))
    })

    it('renders "入库" button when onAddToPromptLibrary is provided', () => {
      renderCard({}, { onAddToPromptLibrary: vi.fn() })
      expect(screen.getByText('入库')).toBeInTheDocument()
    })

    it('calls onAddToPromptLibrary with task when "入库" is clicked', () => {
      const onAddToPromptLibrary = vi.fn()
      const task = makeTask()
      render(<GenerationCard task={task} onAddToPromptLibrary={onAddToPromptLibrary} />)
      fireEvent.click(screen.getByText('入库'))
      expect(onAddToPromptLibrary).toHaveBeenCalledWith(task)
    })

    it('renders blur toggle button when onToggleThumbnailBlur is provided', () => {
      const { container } = renderCard({}, { onToggleThumbnailBlur: vi.fn() })
      const buttons = container.querySelectorAll('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('calls onToggleThumbnailBlur on toggle click', () => {
      const onToggle = vi.fn()
      renderCard({}, { onToggleThumbnailBlur: onToggle })
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[buttons.length - 1])
      expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('hides action buttons for non-completed tasks', () => {
      renderCard(
        { status: 'processing', result_urls: [], started_at: new Date().toISOString() },
        { onAddPrompt: vi.fn(), onAddImage: vi.fn() }
      )
      expect(screen.queryByText('做同款')).not.toBeInTheDocument()
      expect(screen.queryByText('参考图')).not.toBeInTheDocument()
    })
  })

  describe('status badge in footer', () => {
    it('shows "文生图" for completed text-to-image task', () => {
      renderCard({ params: { prompt: 'cat', image_urls: [] } })
      expect(screen.getByText('文生图')).toBeInTheDocument()
    })

    it('shows "图生图" for completed image-to-image task', () => {
      renderCard({ params: { prompt: 'cat', image_urls: ['ref.png'] } })
      expect(screen.getByText('图生图')).toBeInTheDocument()
    })

    it('shows "失败" for failed task', () => {
      renderCard({ status: 'failed', result_urls: [] })
      expect(screen.getAllByText(/失败/).length).toBeGreaterThan(0)
    })

    it('shows processing label for non-completed task', () => {
      renderCard({ status: 'processing', result_urls: [], started_at: new Date().toISOString() })
      expect(screen.getAllByText(/生成中/).length).toBeGreaterThan(0)
    })
  })

  describe('select mode', () => {
    it('renders checkbox when in select mode', () => {
      const { container } = renderCard({}, { selectMode: true, checked: false, onToggleCheck: vi.fn() })
      expect(container.querySelector('.rounded-lg.border-2')).toBeInTheDocument()
    })

    it('shows check icon when checked', () => {
      const { container } = renderCard({}, { selectMode: true, checked: true, onToggleCheck: vi.fn() })
      expect(container.querySelector('.bg-accent')).toBeInTheDocument()
    })

    it('shows status badge in select mode for non-completed', () => {
      renderCard(
        { status: 'processing', result_urls: [], started_at: new Date().toISOString() },
        { selectMode: true, checked: false, onToggleCheck: vi.fn() }
      )
      expect(screen.getAllByText(/生成中/).length).toBeGreaterThan(0)
    })

    it('calls onToggleCheck on click in select mode', () => {
      const onToggleCheck = vi.fn()
      const { container } = renderCard({}, { selectMode: true, checked: false, onToggleCheck })
      fireEvent.click(container.firstChild)
      expect(onToggleCheck).toHaveBeenCalledTimes(1)
    })

    it('does not show status badge in select mode for completed', () => {
      const { container } = renderCard({}, { selectMode: true, checked: false, onToggleCheck: vi.fn() })
      expect(container.querySelector('.backdrop-blur-sm')).toBeNull()
    })
  })

  describe('view detail', () => {
    it('calls onViewDetail on click for completed task (non-select mode)', () => {
      const onViewDetail = vi.fn()
      const { container } = renderCard({}, { onViewDetail })
      fireEvent.click(container.firstChild)
      expect(onViewDetail).toHaveBeenCalledTimes(1)
    })

    it('does not call onViewDetail on click for non-completed task', () => {
      const onViewDetail = vi.fn()
      const { container } = renderCard(
        { status: 'processing', result_urls: [], started_at: new Date().toISOString() },
        { onViewDetail }
      )
      fireEvent.click(container.firstChild)
      expect(onViewDetail).not.toHaveBeenCalled()
    })
  })

  describe('expiry info', () => {
    it('displays expiry text for completed task', () => {
      renderCard()
      expect(screen.getByText('3天到期')).toBeInTheDocument()
    })

    it('displays permanent badge for permanent task', () => {
      renderCard({ is_permanent: true })
      expect(screen.getByText('长久')).toBeInTheDocument()
    })
  })

  describe('username display', () => {
    it('shows username when provided', () => {
      renderCard({}, { username: 'Alice' })
      expect(screen.getByText('Alice')).toBeInTheDocument()
    })

    it('does not show username when not provided', () => {
      const { container } = renderCard()
      const meta = container.querySelector('.text-\\[11px\\]')
      expect(meta).toBeNull()
    })
  })

  describe('error display', () => {
    it('shows error text in footer when task has error', () => {
      renderCard({ error: 'Something went wrong' })
      expect(screen.getAllByText('Something went wrong').length).toBe(2)
    })

    it('shows error in bottom overlay for non-select mode', () => {
      renderCard({ error: 'Overlay error' })
      expect(screen.getAllByText('Overlay error').length).toBeGreaterThanOrEqual(1)
    })

    it('hides bottom error overlay in select mode', () => {
      renderCard(
        { error: 'Hidden error' },
        { selectMode: true, checked: false, onToggleCheck: vi.fn() }
      )
      expect(screen.getByText('Hidden error')).toBeInTheDocument()
    })
  })

  describe('progress bar', () => {
    it('renders progress bar for processing tasks', () => {
      const { container } = renderCard({
        status: 'processing',
        result_urls: [],
        started_at: new Date().toISOString(),
      })
      expect(container.querySelector('.h-1')).toBeInTheDocument()
    })

    it('does not render progress bar for completed tasks', () => {
      const { container } = renderCard()
      expect(container.querySelector('.transition-all.duration-1000')).toBeNull()
    })
  })

  describe('prompt text display', () => {
    it('renders prompt as title text', () => {
      renderCard()
      expect(screen.getByText('a cat')).toBeInTheDocument()
    })

    it('normalizes whitespace in prompt', () => {
      renderCard({ params: { prompt: '  a   big   cat  ' } })
      expect(screen.getByText('a big cat')).toBeInTheDocument()
    })

    it('uses task.prompt as fallback when params.prompt is absent', () => {
      renderCard({ params: {}, prompt: 'fallback prompt' })
      expect(screen.getByText('fallback prompt')).toBeInTheDocument()
    })
  })

  describe('VIP model metadata', () => {
    it('renders prompt text for grsai-vip model', () => {
      renderCard({
        params: { prompt: 'vip test', model_id: 'grsai-vip', resolution: 'high', size: '16:9', quality: 'high' },
      })
      expect(screen.getByText('vip test')).toBeInTheDocument()
    })
  })

  describe('checked overlay', () => {
    it('shows accent overlay when checked in select mode', () => {
      const { container } = renderCard({}, { selectMode: true, checked: true, onToggleCheck: vi.fn() })
      expect(container.querySelector('.bg-accent\\/10')).toBeInTheDocument()
    })

    it('does not show accent overlay when unchecked in select mode', () => {
      const { container } = renderCard({}, { selectMode: true, checked: false, onToggleCheck: vi.fn() })
      expect(container.querySelector('.bg-accent\\/10')).toBeNull()
    })
  })

  describe('masonry class', () => {
    it('applies masonry class to outer card', () => {
      const { container } = renderCard({}, { masonry: true })
      expect(container.firstChild.className).toContain('card-feed-item-masonry')
    })

    it('does not apply masonry class by default', () => {
      const { container } = renderCard()
      expect(container.firstChild.className).not.toContain('card-feed-item-masonry')
    })
  })

  describe('prompt fallback chain', () => {
    it('uses params.prompt first', () => {
      renderCard({ params: { prompt: 'from params' }, prompt: 'from task' })
      expect(screen.getByText('from params')).toBeInTheDocument()
    })

    it('falls back to task.prompt when params.prompt is empty', () => {
      renderCard({ params: { prompt: '' }, prompt: 'from task' })
      expect(screen.getByText('from task')).toBeInTheDocument()
    })
  })
})

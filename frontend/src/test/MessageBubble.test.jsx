import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MessageBubble from '../components/MessageBubble'

const baseMsg = (overrides = {}) => ({
  role: 'user',
  prompt: '',
  ...overrides,
})

beforeEach(() => cleanup())

describe('MessageBubble', () => {
  it('renders user message with end alignment', () => {
    const { container } = render(<MessageBubble message={baseMsg({ prompt: 'hello' })} />)
    expect(container.querySelector('.justify-end')).toBeTruthy()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('renders assistant message with start alignment', () => {
    const { container } = render(<MessageBubble message={baseMsg({ role: 'assistant', prompt: 'hi' })} />)
    expect(container.querySelector('.justify-start')).toBeTruthy()
  })

  it('renders prompt text', () => {
    render(<MessageBubble message={baseMsg({ prompt: 'my prompt' })} />)
    expect(screen.getByText('my prompt')).toBeInTheDocument()
  })

  it('renders error message', () => {
    render(<MessageBubble message={baseMsg({ error: 'something failed' })} />)
    expect(screen.getByText('something failed')).toBeInTheDocument()
  })

  it('renders statusText with spinner', () => {
    render(<MessageBubble message={baseMsg({ statusText: '生成中...' })} />)
    expect(screen.getByText('生成中...')).toBeInTheDocument()
  })

  it('renders progress bar when progress is provided', () => {
    const { container } = render(
      <MessageBubble message={baseMsg({ statusText: '处理中', progress: 50 })} />
    )
    expect(screen.getByText('处理中')).toBeInTheDocument()
    const bar = container.querySelector('[style*="width: 50%"]')
    expect(bar).toBeTruthy()
  })

  it('renders user-uploaded images', () => {
    const { container } = render(
      <MessageBubble message={baseMsg({ images: ['https://example.com/img1.png'] })} />
    )
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://example.com/img1.png')
  })

  it('renders result images for assistant', () => {
    const { container } = render(
      <MessageBubble
        message={baseMsg({
          role: 'assistant',
          resultImages: ['https://example.com/result.png'],
        })}
      />
    )
    const imgs = container.querySelectorAll('img')
    expect([...imgs].some(i => i.src.includes('result.png'))).toBe(true)
  })

  it('shows action buttons for assistant result images', () => {
    render(
      <MessageBubble
        message={baseMsg({
          role: 'assistant',
          resultImages: ['https://example.com/r.png'],
        })}
        onRegenerate={vi.fn()}
        onSavePrompt={vi.fn()}
      />
    )
    expect(screen.getByText(/重新生成/)).toBeInTheDocument()
    expect(screen.getByText(/保存提示词/)).toBeInTheDocument()
    expect(screen.getByText('下载 1')).toBeInTheDocument()
  })

  it('calls onRegenerate when clicked', () => {
    const onRegenerate = vi.fn()
    render(
      <MessageBubble
        message={baseMsg({
          role: 'assistant',
          resultImages: ['https://example.com/r.png'],
        })}
        onRegenerate={onRegenerate}
        onSavePrompt={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText(/重新生成/))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
  })

  it('calls onSavePrompt when clicked', () => {
    const onSavePrompt = vi.fn()
    render(
      <MessageBubble
        message={baseMsg({
          role: 'assistant',
          resultImages: ['https://example.com/r.png'],
        })}
        onRegenerate={vi.fn()}
        onSavePrompt={onSavePrompt}
      />
    )
    fireEvent.click(screen.getByText(/保存提示词/))
    expect(onSavePrompt).toHaveBeenCalledTimes(1)
  })

  it('toggles params panel', () => {
    render(
      <MessageBubble
        message={baseMsg({ params: { size: '1:1', model: 'gpt-4' } })}
      />
    )
    const toggleBtn = screen.getByText('生成参数')
    expect(screen.queryByText(/size/)).not.toBeInTheDocument()
    fireEvent.click(toggleBtn)
    expect(screen.getByText(/size/)).toBeInTheDocument()
    expect(screen.getByText(/model/)).toBeInTheDocument()
  })

  it('displays timestamp', () => {
    render(
      <MessageBubble message={baseMsg({ timestamp: '2025-01-01T12:30:00+08:00' })} />
    )
    expect(screen.getByText('12:30')).toBeInTheDocument()
  })

  it('opens lightbox on image click', () => {
    const { container } = render(
      <MessageBubble message={baseMsg({ images: ['https://example.com/big.png'] })} />
    )
    fireEvent.click(container.querySelector('.cursor-pointer'))
    const lightboxImg = container.querySelector('.fixed img')
    expect(lightboxImg).toHaveAttribute('src', 'https://example.com/big.png')
  })

  it('closes lightbox on backdrop click', () => {
    const { container } = render(
      <MessageBubble message={baseMsg({ images: ['https://example.com/big.png'] })} />
    )
    fireEvent.click(container.querySelector('.cursor-pointer'))
    const backdrop = container.querySelector('.fixed.inset-0')
    fireEvent.click(backdrop)
    expect(container.querySelector('.fixed.inset-0')).toBeNull()
  })

  it('renders multiple result images in 2-column grid', () => {
    const { container } = render(
      <MessageBubble
        message={baseMsg({
          role: 'assistant',
          resultImages: [
            'https://example.com/r1.png',
            'https://example.com/r2.png',
          ],
        })}
        onRegenerate={vi.fn()}
        onSavePrompt={vi.fn()}
      />
    )
    const grid = container.querySelector('[style*="repeat(2, 1fr)"]')
    expect(grid).toBeTruthy()
    expect(screen.getByText('下载 1')).toBeInTheDocument()
    expect(screen.getByText('下载 2')).toBeInTheDocument()
  })

  it('hides action buttons for user result images', () => {
    render(
      <MessageBubble
        message={baseMsg({
          role: 'user',
          resultImages: ['https://example.com/r.png'],
        })}
        onRegenerate={vi.fn()}
        onSavePrompt={vi.fn()}
      />
    )
    expect(screen.queryByText(/重新生成/)).not.toBeInTheDocument()
    expect(screen.queryByText(/保存提示词/)).not.toBeInTheDocument()
  })

  it('hides null params values', () => {
    render(
      <MessageBubble message={baseMsg({ params: { size: '1:1', quality: null } })} />
    )
    fireEvent.click(screen.getByText('生成参数'))
    expect(screen.getByText(/size/)).toBeInTheDocument()
    expect(screen.queryByText(/quality/)).not.toBeInTheDocument()
  })
})

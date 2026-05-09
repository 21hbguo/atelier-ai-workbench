import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import WelcomeModal from '../components/WelcomeModal'

beforeEach(() => cleanup())

describe('WelcomeModal', () => {
  it('renders nothing when points is falsy', () => {
    const { container } = render(<WelcomeModal points={0} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when points is null', () => {
    const { container } = render(<WelcomeModal points={null} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders modal with correct content', () => {
    render(<WelcomeModal points={50} onClose={vi.fn()} />)
    expect(screen.getByText('欢迎加入 Atelier')).toBeInTheDocument()
    expect(screen.getByText('开启你的 AI 创作之旅')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('积分')).toBeInTheDocument()
    expect(screen.getByText('注册赠送')).toBeInTheDocument()
    expect(screen.getByText('积分可用于生成 AI 图片，每日签到也可获取积分哦')).toBeInTheDocument()
    expect(screen.getByText('开始创作')).toBeInTheDocument()
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(<WelcomeModal points={10} onClose={onClose} />)
    fireEvent.click(container.firstChild)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when X button is clicked', () => {
    const onClose = vi.fn()
    const { container } = render(<WelcomeModal points={10} onClose={onClose} />)
    const closeBtn = container.querySelector('.absolute.top-3.right-3')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when "开始创作" button is clicked', () => {
    const onClose = vi.fn()
    render(<WelcomeModal points={10} onClose={onClose} />)
    fireEvent.click(screen.getByText('开始创作'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when inner content is clicked', () => {
    const onClose = vi.fn()
    render(<WelcomeModal points={10} onClose={onClose} />)
    fireEvent.click(screen.getByText('欢迎加入 Atelier'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('displays the provided points value', () => {
    render(<WelcomeModal points={999} onClose={vi.fn()} />)
    expect(screen.getByText('999')).toBeInTheDocument()
  })
})

import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import UnifiedCard from '../components/UnifiedCard'

describe('UnifiedCard', () => {
  it('renders mediaNode content', () => {
    render(<UnifiedCard mediaNode={<img src="/test.png" alt="test" />} />)
    expect(screen.getByAltText('test')).toBeInTheDocument()
  })

  it('renders footerNode', () => {
    render(<UnifiedCard footerNode={<span>footer-text</span>} />)
    expect(screen.getByText('footer-text')).toBeInTheDocument()
  })

  it('renders hoverNode', () => {
    render(<UnifiedCard hoverNode={<span>hover-content</span>} />)
    expect(screen.getByText('hover-content')).toBeInTheDocument()
  })

  it('renders bottomNode', () => {
    render(<UnifiedCard bottomNode={<span>bottom-content</span>} />)
    expect(screen.getByText('bottom-content')).toBeInTheDocument()
  })

  it('renders topLeftNode', () => {
    render(<UnifiedCard topLeftNode={<span>top-left</span>} />)
    expect(screen.getByText('top-left')).toBeInTheDocument()
  })

  it('renders topRightNode', () => {
    render(<UnifiedCard topRightNode={<span>top-right</span>} />)
    expect(screen.getByText('top-right')).toBeInTheDocument()
  })

  it('renders selectNode', () => {
    render(<UnifiedCard selectNode={<span>select-box</span>} />)
    expect(screen.getByText('select-box')).toBeInTheDocument()
  })

  it('renders overlayNode', () => {
    render(<UnifiedCard overlayNode={<span>overlay-content</span>} />)
    expect(screen.getByText('overlay-content')).toBeInTheDocument()
  })

  it('renders all slot nodes together', () => {
    render(
      <UnifiedCard
        mediaNode={<span>media</span>}
        footerNode={<span>footer</span>}
        hoverNode={<span>hover</span>}
        bottomNode={<span>bottom</span>}
        topLeftNode={<span>tl</span>}
        topRightNode={<span>tr</span>}
        selectNode={<span>sel</span>}
        overlayNode={<span>ov</span>}
      />
    )
    expect(screen.getByText('media')).toBeInTheDocument()
    expect(screen.getByText('footer')).toBeInTheDocument()
    expect(screen.getByText('hover')).toBeInTheDocument()
    expect(screen.getByText('bottom')).toBeInTheDocument()
    expect(screen.getByText('tl')).toBeInTheDocument()
    expect(screen.getByText('tr')).toBeInTheDocument()
    expect(screen.getByText('sel')).toBeInTheDocument()
    expect(screen.getByText('ov')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<UnifiedCard onClick={onClick} mediaNode={<span>m</span>} />)
    fireEvent.click(screen.getByText('m').closest('.group'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies checked ring class when checked=true', () => {
    const { container } = render(<UnifiedCard checked={true} />)
    expect(container.firstChild.className).toContain('ring-2')
    expect(container.firstChild.className).toContain('ring-accent/50')
  })

  it('does not apply ring class when checked=false', () => {
    const { container } = render(<UnifiedCard checked={false} />)
    expect(container.firstChild.className).not.toContain('ring-2')
  })

  it('defaults checked to false', () => {
    const { container } = render(<UnifiedCard />)
    expect(container.firstChild.className).not.toContain('ring-2')
  })

  it('appends custom className', () => {
    const { container } = render(<UnifiedCard className="my-custom-class" />)
    expect(container.firstChild.className).toContain('my-custom-class')
  })

  it('passes extra props to root element', () => {
    const { container } = render(<UnifiedCard data-testid="card-root" id="my-card" />)
    expect(container.firstChild.id).toBe('my-card')
    expect(screen.getByTestId('card-root')).toBeInTheDocument()
  })

  it('renders with no props without errors', () => {
    const { container } = render(<UnifiedCard />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('has group class for hover targeting', () => {
    const { container } = render(<UnifiedCard />)
    expect(container.firstChild.className).toContain('group')
  })

  it('has rounded and overflow-hidden styling', () => {
    const { container } = render(<UnifiedCard />)
    expect(container.firstChild.className).toContain('rounded-2xl')
    expect(container.firstChild.className).toContain('overflow-hidden')
  })
})

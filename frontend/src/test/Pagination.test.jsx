import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import Pagination from '../components/Pagination'

const defaultProps = { page: 1, totalPages: 10, onPageChange: vi.fn() }

const setup = (overrides = {}) => {
  const props = { ...defaultProps, ...overrides, onPageChange: overrides.onPageChange || vi.fn() }
  const result = render(<Pagination {...props} />)
  return { ...result, props }
}

describe('Pagination', () => {
  beforeEach(() => cleanup())

  it('returns null when totalPages <= 1', () => {
    const { container } = setup({ totalPages: 1 })
    expect(container.innerHTML).toBe('')
  })

  it('returns null when totalPages is 0', () => {
    const { container } = setup({ totalPages: 0 })
    expect(container.innerHTML).toBe('')
  })

  it('renders prev/next buttons and page indicator', () => {
    setup({ page: 3, totalPages: 10 })
    expect(screen.getByText('上一页')).toBeInTheDocument()
    expect(screen.getByText('下一页')).toBeInTheDocument()
    expect(screen.getByText('/ 10')).toBeInTheDocument()
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
  })

  it('disables prev button on first page', () => {
    setup({ page: 1, totalPages: 5 })
    expect(screen.getByText('上一页')).toBeDisabled()
    expect(screen.getByText('下一页')).not.toBeDisabled()
  })

  it('disables next button on last page', () => {
    setup({ page: 5, totalPages: 5 })
    expect(screen.getByText('下一页')).toBeDisabled()
    expect(screen.getByText('上一页')).not.toBeDisabled()
  })

  it('does not disable either button on middle page', () => {
    setup({ page: 3, totalPages: 5 })
    expect(screen.getByText('上一页')).not.toBeDisabled()
    expect(screen.getByText('下一页')).not.toBeDisabled()
  })

  it('calls onPageChange with page-1 on prev click', () => {
    const onPageChange = vi.fn()
    setup({ page: 3, totalPages: 5, onPageChange })
    fireEvent.click(screen.getByText('上一页'))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('calls onPageChange with page+1 on next click', () => {
    const onPageChange = vi.fn()
    setup({ page: 3, totalPages: 5, onPageChange })
    fireEvent.click(screen.getByText('下一页'))
    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  it('does not call onPageChange when prev clicked on first page', () => {
    const onPageChange = vi.fn()
    setup({ page: 1, totalPages: 5, onPageChange })
    fireEvent.click(screen.getByText('上一页'))
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('does not call onPageChange when next clicked on last page', () => {
    const onPageChange = vi.fn()
    setup({ page: 5, totalPages: 5, onPageChange })
    fireEvent.click(screen.getByText('下一页'))
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('allows editing the page input', () => {
    setup({ page: 3, totalPages: 10 })
    const input = screen.getByDisplayValue('3')
    fireEvent.change(input, { target: { value: '7' } })
    expect(input.value).toBe('7')
  })

  it('strips non-digit characters from input', () => {
    setup({ page: 3, totalPages: 10 })
    const input = screen.getByDisplayValue('3')
    fireEvent.change(input, { target: { value: 'abc7xyz' } })
    expect(input.value).toBe('7')
  })

  it('submits draft on Enter key', () => {
    const onPageChange = vi.fn()
    setup({ page: 1, totalPages: 10, onPageChange })
    const input = screen.getByDisplayValue('1')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageChange).toHaveBeenCalledWith(5)
  })

  it('submits draft on blur', () => {
    const onPageChange = vi.fn()
    setup({ page: 1, totalPages: 10, onPageChange })
    const input = screen.getByDisplayValue('1')
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.blur(input)
    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  it('clamps draft value to valid range', () => {
    const onPageChange = vi.fn()
    setup({ page: 1, totalPages: 10, onPageChange })
    const input = screen.getByDisplayValue('1')
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageChange).toHaveBeenCalledWith(10)
  })

  it('clamps draft value below 1', () => {
    const onPageChange = vi.fn()
    setup({ page: 5, totalPages: 10, onPageChange })
    const input = screen.getByDisplayValue('5')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('navigates to page 1 on empty input blur (Number("") is 0, clamped to 1)', () => {
    const onPageChange = vi.fn()
    setup({ page: 3, totalPages: 10, onPageChange })
    const input = screen.getByDisplayValue('3')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onPageChange).toHaveBeenCalledWith(1)
    expect(input.value).toBe('1')
  })

  it('does not call onPageChange when entering the same page', () => {
    const onPageChange = vi.fn()
    setup({ page: 5, totalPages: 10, onPageChange })
    const input = screen.getByDisplayValue('5')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('syncs draft when page prop changes', () => {
    const { rerender } = render(
      <Pagination page={1} totalPages={10} onPageChange={vi.fn()} />
    )
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
    rerender(<Pagination page={7} totalPages={10} onPageChange={vi.fn()} />)
    expect(screen.getByDisplayValue('7')).toBeInTheDocument()
  })

  it('ignores non-Enter keyDown events', () => {
    const onPageChange = vi.fn()
    setup({ page: 1, totalPages: 10, onPageChange })
    const input = screen.getByDisplayValue('1')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'a' })
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('scrolls to top of scrollTargetId element before navigating', () => {
    const div = document.createElement('div')
    div.id = 'scroll-area'
    div.scrollTop = 500
    document.body.appendChild(div)

    const onPageChange = vi.fn()
    setup({ page: 1, totalPages: 5, onPageChange, scrollTargetId: 'scroll-area' })
    fireEvent.click(screen.getByText('下一页'))
    expect(div.scrollTop).toBe(0)
    expect(onPageChange).toHaveBeenCalledWith(2)

    document.body.removeChild(div)
  })
})

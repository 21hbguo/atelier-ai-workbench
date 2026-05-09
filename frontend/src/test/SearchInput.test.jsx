import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SearchInput from '../components/SearchInput'

describe('SearchInput', () => {
  beforeEach(() => {
    cleanup()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('renders collapsed search button', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    expect(screen.getByTitle('搜索')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows preview text when value is set', () => {
    render(<SearchInput value="hello" onChange={vi.fn()} />)
    expect(screen.getByText('h…')).toBeInTheDocument()
  })

  it('shows clear button when value exists', () => {
    render(<SearchInput value="test" onChange={vi.fn()} />)
    expect(screen.getByTitle('清空搜索')).toBeInTheDocument()
  })

  it('does not show clear button when value is empty', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    expect(screen.queryByTitle('清空搜索')).not.toBeInTheDocument()
  })

  it('expands input on search button click', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('搜索'))
    act(() => vi.advanceTimersByTime(60))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('calls onChange with debounce', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} debounceMs={300} />)
    fireEvent.click(screen.getByTitle('搜索'))
    act(() => vi.advanceTimersByTime(60))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenCalledWith('abc')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('debounces rapid input changes', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} debounceMs={300} />)
    fireEvent.click(screen.getByTitle('搜索'))
    act(() => vi.advanceTimersByTime(60))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'a' } })
    fireEvent.change(input, { target: { value: 'ab' } })
    fireEvent.change(input, { target: { value: 'abc' } })
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('abc')
  })

  it('clears input and calls onChange immediately', () => {
    const onChange = vi.fn()
    render(<SearchInput value="test" onChange={onChange} />)
    fireEvent.click(screen.getByTitle('清空搜索'))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('closes expanded input on blur', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('搜索'))
    act(() => vi.advanceTimersByTime(60))
    const input = screen.getByRole('textbox')
    fireEvent.blur(input)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('closes expanded input on Enter key', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('搜索'))
    act(() => vi.advanceTimersByTime(60))
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('closes expanded input on Escape key', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)
    fireEvent.click(screen.getByTitle('搜索'))
    act(() => vi.advanceTimersByTime(60))
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('syncs local value when value prop changes', () => {
    const { rerender } = render(<SearchInput value="" onChange={vi.fn()} />)
    rerender(<SearchInput value="updated" onChange={vi.fn()} />)
    expect(screen.getByText('u…')).toBeInTheDocument()
  })

  it('uses custom placeholder', () => {
    render(<SearchInput value="" onChange={vi.fn()} placeholder="找点什么..." />)
    fireEvent.click(screen.getByTitle('搜索'))
    act(() => vi.advanceTimersByTime(60))
    expect(screen.getByPlaceholderText('找点什么...')).toBeInTheDocument()
  })

  it('clears debounce timer on unmount', () => {
    const onChange = vi.fn()
    const { unmount } = render(<SearchInput value="" onChange={onChange} debounceMs={300} />)
    fireEvent.click(screen.getByTitle('搜索'))
    act(() => vi.advanceTimersByTime(60))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'test' } })
    unmount()
    act(() => vi.advanceTimersByTime(300))
    expect(onChange).not.toHaveBeenCalled()
  })
})

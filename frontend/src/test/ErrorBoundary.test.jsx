import { render, screen, cleanup } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import ErrorBoundary from '../components/ErrorBoundary'

const ThrowingChild = ({ shouldThrow }) => {
  if (shouldThrow) throw new Error('child exploded')
  return <div>child ok</div>
}

describe('ErrorBoundary', () => {
  let consoleSpy

  beforeEach(() => {
    cleanup()
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    delete window.__LAST_ERROR_BOUNDARY__
  })

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>hello</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('catches error and shows fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText('页面出错了')).toBeInTheDocument()
    expect(screen.getByText('请刷新页面重试')).toBeInTheDocument()
    expect(screen.getByText('刷新页面')).toBeInTheDocument()
  })

  it('displays error message when present', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getAllByText('child exploded').length).toBeGreaterThan(0)
  })

  it('hides error message paragraph when error has no message', () => {
    const ThrowNoMessage = () => { throw {} }
    render(
      <ErrorBoundary>
        <ThrowNoMessage />
      </ErrorBoundary>
    )
    expect(screen.getByText('页面出错了')).toBeInTheDocument()
    expect(screen.queryByText('child exploded')).not.toBeInTheDocument()
  })

  it('logs error to console and sets window.__LAST_ERROR_BOUNDARY__', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    )
    expect(consoleSpy).toHaveBeenCalled()
    expect(window.__LAST_ERROR_BOUNDARY__).toBeDefined()
    expect(window.__LAST_ERROR_BOUNDARY__.message).toBe('child exploded')
  })

  it('refresh button calls window.location.reload', () => {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
    })

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    )
    screen.getByText('刷新页面').click()
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('stays in error state after rerender (same instance)', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    )
    expect(screen.getByText('页面出错了')).toBeInTheDocument()

    rerender(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('页面出错了')).toBeInTheDocument()
  })

  it('fresh instance renders children normally', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('child ok')).toBeInTheDocument()
    expect(screen.queryByText('页面出错了')).not.toBeInTheDocument()
  })
})

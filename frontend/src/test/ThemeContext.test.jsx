import { render, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { ThemeProvider, useTheme } from '../ThemeContext'

function Harness({ ctxRef }) {
  const ctx = useTheme()
  ctxRef.current = ctx
  return <span data-testid="ready" />
}

function setup() {
  const ctxRef = { current: null }
  render(
    <ThemeProvider>
      <Harness ctxRef={ctxRef} />
    </ThemeProvider>
  )
  return ctxRef
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

describe('useTheme', () => {
  it('returns undefined when used outside ThemeProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctxRef = { current: null }
    render(<Harness ctxRef={ctxRef} />)
    expect(ctxRef.current).toBeUndefined()
    spy.mockRestore()
  })
})

describe('theme state', () => {
  it('defaults to light (dark=false) when localStorage is empty', () => {
    const ctx = setup()
    expect(ctx.current.dark).toBe(false)
  })

  it('reads dark theme from localStorage', () => {
    localStorage.setItem('theme', 'dark')
    const ctx = setup()
    expect(ctx.current.dark).toBe(true)
  })

  it('defaults to light for non-dark localStorage value', () => {
    localStorage.setItem('theme', 'light')
    const ctx = setup()
    expect(ctx.current.dark).toBe(false)
  })

  it('defaults to light for arbitrary localStorage value', () => {
    localStorage.setItem('theme', 'something')
    const ctx = setup()
    expect(ctx.current.dark).toBe(false)
  })
})

describe('toggle', () => {
  it('toggles dark on and off', () => {
    const ctx = setup()
    expect(ctx.current.dark).toBe(false)
    act(() => { ctx.current.toggle() })
    expect(ctx.current.dark).toBe(true)
    act(() => { ctx.current.toggle() })
    expect(ctx.current.dark).toBe(false)
  })

  it('persists to localStorage on toggle', () => {
    const ctx = setup()
    act(() => { ctx.current.toggle() })
    expect(localStorage.getItem('theme')).toBe('dark')
    act(() => { ctx.current.toggle() })
    expect(localStorage.getItem('theme')).toBe('light')
  })
})

describe('document classList', () => {
  it('adds dark class when dark is true', () => {
    localStorage.setItem('theme', 'dark')
    setup()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('does not add dark class when dark is false', () => {
    setup()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('toggles dark class on documentElement', () => {
    const ctx = setup()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    act(() => { ctx.current.toggle() })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    act(() => { ctx.current.toggle() })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

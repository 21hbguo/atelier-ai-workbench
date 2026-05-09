import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { LayoutModeProvider, useLayoutMode } from '../LayoutModeContext'

function Harness({ ctxRef }) {
  const ctx = useLayoutMode()
  ctxRef.current = ctx
  return <span data-testid="ready" />
}

function setup(innerWidth = 1200) {
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, writable: true, configurable: true })
  const ctxRef = { current: null }
  render(
    <LayoutModeProvider>
      <Harness ctxRef={ctxRef} />
    </LayoutModeProvider>
  )
  return ctxRef
}

function setWidth(w) {
  Object.defineProperty(window, 'innerWidth', { value: w, writable: true, configurable: true })
  act(() => { fireEvent(window, new Event('resize')) })
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.style.cssText = ''
})

describe('useLayoutMode', () => {
  it('returns undefined when used outside LayoutModeProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctxRef = { current: null }
    render(<Harness ctxRef={ctxRef} />)
    expect(ctxRef.current).toBeUndefined()
    spy.mockRestore()
  })
})

describe('layoutMode state', () => {
  it('defaults to masonry when localStorage is empty', () => {
    const ctx = setup()
    expect(ctx.current.layoutMode).toBe('masonry')
  })

  it('reads grid from localStorage', () => {
    localStorage.setItem('image_card_layout', 'grid')
    const ctx = setup()
    expect(ctx.current.layoutMode).toBe('grid')
  })

  it('defaults to masonry for invalid localStorage value', () => {
    localStorage.setItem('image_card_layout', 'invalid')
    const ctx = setup()
    expect(ctx.current.layoutMode).toBe('masonry')
  })
})

describe('toggleLayoutMode', () => {
  it('toggles masonry -> grid -> masonry', () => {
    const ctx = setup()
    expect(ctx.current.layoutMode).toBe('masonry')
    act(() => { ctx.current.toggleLayoutMode() })
    expect(ctx.current.layoutMode).toBe('grid')
    act(() => { ctx.current.toggleLayoutMode() })
    expect(ctx.current.layoutMode).toBe('masonry')
  })

  it('persists layoutMode to localStorage', () => {
    const ctx = setup()
    act(() => { ctx.current.toggleLayoutMode() })
    expect(localStorage.getItem('image_card_layout')).toBe('grid')
  })
})

describe('cols defaults and validation', () => {
  it('uses defaultCols when localStorage is empty', () => {
    const ctx = setup()
    expect(ctx.current.cols).toEqual({ base: 1, sm: 3, md: 4, lg: 5 })
  })

  it('reads valid cols from localStorage', () => {
    localStorage.setItem('image_card_cols', JSON.stringify({ base: 2, sm: 4, md: 5, lg: 6 }))
    const ctx = setup()
    expect(ctx.current.cols).toEqual({ base: 2, sm: 4, md: 5, lg: 6 })
  })

  it('falls back to defaults for invalid values in localStorage', () => {
    localStorage.setItem('image_card_cols', JSON.stringify({ base: 99, sm: 0, md: 1, lg: 9 }))
    const ctx = setup()
    expect(ctx.current.cols).toEqual({ base: 1, sm: 3, md: 4, lg: 5 })
  })

  it('falls back to defaults when localStorage has malformed JSON', () => {
    localStorage.setItem('image_card_cols', 'not-json')
    const ctx = setup()
    expect(ctx.current.cols).toEqual({ base: 1, sm: 3, md: 4, lg: 5 })
  })

  it('partially validates: valid fields kept, invalid fall back', () => {
    localStorage.setItem('image_card_cols', JSON.stringify({ base: 2, sm: 99, md: 5, lg: 6 }))
    const ctx = setup()
    expect(ctx.current.cols).toEqual({ base: 2, sm: 3, md: 5, lg: 6 })
  })
})

describe('currentBreakpoint', () => {
  it('returns lg for width >= 1024', () => {
    const ctx = setup(1200)
    expect(ctx.current.currentBreakpoint).toBe('lg')
  })

  it('returns md for width >= 768 and < 1024', () => {
    const ctx = setup(800)
    expect(ctx.current.currentBreakpoint).toBe('md')
  })

  it('returns sm for width >= 640 and < 768', () => {
    const ctx = setup(700)
    expect(ctx.current.currentBreakpoint).toBe('sm')
  })

  it('returns base for width < 640', () => {
    const ctx = setup(320)
    expect(ctx.current.currentBreakpoint).toBe('base')
  })

  it('returns lg at exact boundary 1024', () => {
    const ctx = setup(1024)
    expect(ctx.current.currentBreakpoint).toBe('lg')
  })

  it('returns md at exact boundary 768', () => {
    const ctx = setup(768)
    expect(ctx.current.currentBreakpoint).toBe('md')
  })

  it('returns sm at exact boundary 640', () => {
    const ctx = setup(640)
    expect(ctx.current.currentBreakpoint).toBe('sm')
  })
})

describe('currentBreakpoint updates on resize', () => {
  it('updates breakpoint when window resizes', () => {
    const ctx = setup(1200)
    expect(ctx.current.currentBreakpoint).toBe('lg')
    setWidth(700)
    expect(ctx.current.currentBreakpoint).toBe('sm')
  })
})

describe('currentCols and currentBreakpointLabel', () => {
  it('returns cols for current breakpoint', () => {
    const ctx = setup(1200)
    expect(ctx.current.currentCols).toBe(ctx.current.cols.lg)
  })

  it('returns correct label for each breakpoint', () => {
    const ctx = setup(1200)
    expect(ctx.current.currentBreakpointLabel).toBe('桌面')
    setWidth(800)
    expect(ctx.current.currentBreakpointLabel).toBe('平板')
    setWidth(700)
    expect(ctx.current.currentBreakpointLabel).toBe('小屏')
    setWidth(320)
    expect(ctx.current.currentBreakpointLabel).toBe('手机')
  })
})

describe('toggleCurrentCols', () => {
  it('cycles through breakpoint options for current breakpoint', () => {
    const ctx = setup(1200) // lg, default=5, options=[3,4,5,6]
    expect(ctx.current.cols.lg).toBe(5)
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.lg).toBe(6)
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.lg).toBe(3)
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.lg).toBe(4)
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.lg).toBe(5)
  })

  it('only changes the current breakpoint column', () => {
    const ctx = setup(1200)
    const origMd = ctx.current.cols.md
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.md).toBe(origMd)
  })

  it('cycles sm options correctly', () => {
    const ctx = setup(700) // sm, default=3, options=[2,3,4]
    expect(ctx.current.cols.sm).toBe(3)
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.sm).toBe(4)
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.sm).toBe(2)
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.sm).toBe(3)
  })

  it('cycles base options correctly', () => {
    const ctx = setup(320) // base, default=1, options=[1,2]
    expect(ctx.current.cols.base).toBe(1)
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.base).toBe(2)
    act(() => { ctx.current.toggleCurrentCols() })
    expect(ctx.current.cols.base).toBe(1)
  })
})

describe('localStorage persistence for cols', () => {
  it('saves cols to localStorage on change', () => {
    const ctx = setup(1200)
    act(() => { ctx.current.toggleCurrentCols() })
    const saved = JSON.parse(localStorage.getItem('image_card_cols'))
    expect(saved.lg).toBe(6)
  })
})

describe('CSS custom properties', () => {
  it('sets CSS custom properties on mount', () => {
    setup(1200)
    const root = document.documentElement.style
    expect(root.getPropertyValue('--card-feed-grid-cols-base')).toBe('1')
    expect(root.getPropertyValue('--card-feed-grid-cols-sm')).toBe('3')
    expect(root.getPropertyValue('--card-feed-grid-cols-md')).toBe('4')
    expect(root.getPropertyValue('--card-feed-grid-cols-lg')).toBe('5')
    expect(root.getPropertyValue('--card-feed-masonry-cols-base')).toBe('1')
    expect(root.getPropertyValue('--card-feed-masonry-cols-sm')).toBe('3')
    expect(root.getPropertyValue('--card-feed-masonry-cols-md')).toBe('4')
    expect(root.getPropertyValue('--card-feed-masonry-cols-lg')).toBe('5')
  })

  it('updates CSS custom properties when cols change', () => {
    const ctx = setup(1200)
    act(() => { ctx.current.toggleCurrentCols() }) // lg 5 -> 6
    const root = document.documentElement.style
    expect(root.getPropertyValue('--card-feed-grid-cols-lg')).toBe('6')
    expect(root.getPropertyValue('--card-feed-masonry-cols-lg')).toBe('6')
  })
})

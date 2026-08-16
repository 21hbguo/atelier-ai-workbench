import { renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import useDelayedQuotaRemaining from '../hooks/useDelayedQuotaRemaining'

describe('useDelayedQuotaRemaining', () => {
  it('始终实时同步真实剩余值（初始/增加/减少）', () => {
    const { result, rerender } = renderHook(({ v }) => useDelayedQuotaRemaining(v), { initialProps: { v: 5 } })
    expect(result.current).toBe(5)
    // 增加立即生效
    rerender({ v: 8 })
    expect(result.current).toBe(8)
    // 减少也立即生效（修复：不再延迟，消除「额度耐用」错觉）
    rerender({ v: 4 })
    expect(result.current).toBe(4)
  })

  it('值为 null（不限次）时同步透传', () => {
    const { result, rerender } = renderHook(({ v }) => useDelayedQuotaRemaining(v), { initialProps: { v: null } })
    expect(result.current).toBe(null)
    rerender({ v: 5 })
    expect(result.current).toBe(5)
  })

  it('enabled=false（免费版）时实时同步', () => {
    const { result, rerender } = renderHook(({ v }) => useDelayedQuotaRemaining(v, { enabled: false }), { initialProps: { v: 5 } })
    rerender({ v: 4 })
    expect(result.current).toBe(4)
  })
})

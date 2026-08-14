import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import useDelayedQuotaRemaining from '../hooks/useDelayedQuotaRemaining'

describe('useDelayedQuotaRemaining', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('同步初始值与增加（充值/重置）场景', () => {
    const { result, rerender } = renderHook(({ v }) => useDelayedQuotaRemaining(v), { initialProps: { v: 5 } })
    expect(result.current).toBe(5)
    // 增加立即生效，无需等延迟
    rerender({ v: 8 })
    expect(result.current).toBe(8)
  })

  it('减少时延迟后（6~20 秒内）才同步，期间保持旧值', () => {
    const { result, rerender } = renderHook(({ v }) => useDelayedQuotaRemaining(v), { initialProps: { v: 5 } })
    rerender({ v: 4 })
    // 延迟期内仍显示旧值（耐用错觉）
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBe(5)
    // 超过最大延迟后必然已同步
    act(() => { vi.advanceTimersByTime(20000) })
    expect(result.current).toBe(4)
  })

  it('延迟期内多次减少，最终收敛到最新真实值', () => {
    const { result, rerender } = renderHook(({ v }) => useDelayedQuotaRemaining(v), { initialProps: { v: 5 } })
    rerender({ v: 4 })
    act(() => { vi.advanceTimersByTime(3000) })
    rerender({ v: 3 }) // 再次减少，旧 timer 作废、重新计时
    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current).toBe(5) // 两轮都未到最小延迟，仍显示初始值
    act(() => { vi.advanceTimersByTime(20000) })
    expect(result.current).toBe(3) // 最终收敛到最新真实值
  })

  it('值为 null（不限次）时同步透传', () => {
    const { result, rerender } = renderHook(({ v }) => useDelayedQuotaRemaining(v), { initialProps: { v: null } })
    expect(result.current).toBe(null)
    rerender({ v: 5 })
    expect(result.current).toBe(5)
  })

  it('enabled=false（免费版）时减少也实时同步，不延迟', () => {
    const { result, rerender } = renderHook(({ v }) => useDelayedQuotaRemaining(v, { enabled: false }), { initialProps: { v: 5 } })
    rerender({ v: 4 })
    expect(result.current).toBe(4) // 立即生效
    act(() => { vi.advanceTimersByTime(30000) })
    expect(result.current).toBe(4)
  })
})

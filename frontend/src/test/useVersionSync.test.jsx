import { render, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  useVersionSync, APP_BUILD_ID, VERSION_CHECK_INTERVAL_MS,
  VERSION_RELOAD_KEY, VERSION_PROMPT_TIMEOUT_MS, VERSION_RELOAD_COOLDOWN_MS,
  locationBridge,
} from '../hooks/useVersionSync'
function Harness({ onState }) {
  const st = useVersionSync()
  onState?.(st)
  return null
}
describe('useVersionSync', () => {
  let visibilityState = 'visible'
  let lastState = null
  const flush = () => act(async () => { await Promise.resolve() })
  beforeEach(() => {
    cleanup()
    vi.useFakeTimers()
    sessionStorage.clear()
    vi.restoreAllMocks()
    fetch.mockReset()
    history.replaceState({}, '', '/login')
    visibilityState = 'visible'
    lastState = null
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilityState })
    vi.spyOn(locationBridge, 'replace').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const renderHarness = () => render(<Harness onState={s => { lastState = s }} />)
  it('does not show update when build id matches', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ buildId: APP_BUILD_ID }) })
    renderHarness()
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(lastState.updateAvailable).toBe(false)
    expect(locationBridge.replace).not.toHaveBeenCalled()
  })
  it('shows update banner when build id changes, no immediate reload', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ buildId: `${APP_BUILD_ID}-next` }) })
    renderHarness()
    await flush()
    expect(lastState.updateAvailable).toBe(true)
    expect(locationBridge.replace).not.toHaveBeenCalled()
  })
  it('auto-reloads after prompt timeout as fallback', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ buildId: `${APP_BUILD_ID}-next` }) })
    renderHarness()
    await flush()
    expect(lastState.updateAvailable).toBe(true)
    await vi.advanceTimersByTimeAsync(VERSION_PROMPT_TIMEOUT_MS)
    expect(locationBridge.replace).toHaveBeenCalledTimes(1)
    expect(locationBridge.replace.mock.calls[0][0]).toContain('_v=')
  })
  it('reloadNow forces immediate reload on user click', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ buildId: `${APP_BUILD_ID}-next` }) })
    renderHarness()
    await flush()
    act(() => { lastState.reloadNow() })
    expect(locationBridge.replace).toHaveBeenCalledTimes(1)
    expect(locationBridge.replace.mock.calls[0][0]).toContain('_v=')
  })
  it('does not auto-reload twice for the same build id within cooldown', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ buildId: `${APP_BUILD_ID}-next` }) })
    renderHarness()
    await flush()
    // 第一次自动刷新兜底触发
    await vi.advanceTimersByTimeAsync(VERSION_PROMPT_TIMEOUT_MS)
    expect(locationBridge.replace).toHaveBeenCalledTimes(1)
    // 模拟刷新后页面仍是旧版：hook 重挂载立即检查到新 buildId，但冷却期内不再自动刷新
    visibilityState = 'hidden'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    visibilityState = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    await vi.advanceTimersByTimeAsync(VERSION_PROMPT_TIMEOUT_MS)
    await flush()
    expect(locationBridge.replace).toHaveBeenCalledTimes(1)
  })
  it('retries reload after cooldown expires when still on old build', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ buildId: `${APP_BUILD_ID}-next` }) })
    renderHarness()
    await flush()
    await vi.advanceTimersByTimeAsync(VERSION_PROMPT_TIMEOUT_MS)
    expect(locationBridge.replace).toHaveBeenCalledTimes(1)
    // 冷却期过后仍检测到新 buildId（用户仍未升级）→ 应再次触发横幅与自动刷新
    await vi.advanceTimersByTimeAsync(VERSION_RELOAD_COOLDOWN_MS + 1000)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    await vi.advanceTimersByTimeAsync(VERSION_PROMPT_TIMEOUT_MS)
    await flush()
    expect(locationBridge.replace).toHaveBeenCalledTimes(2)
  })
  it('checks again when page becomes visible', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ buildId: APP_BUILD_ID }) })
    visibilityState = 'hidden'
    renderHarness()
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    visibilityState = 'visible'
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('checks on interval', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ buildId: APP_BUILD_ID }) })
    renderHarness()
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(VERSION_CHECK_INTERVAL_MS)
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('stores reload attempt marker in sessionStorage for cooldown', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ buildId: `${APP_BUILD_ID}-next` }) })
    renderHarness()
    await flush()
    await vi.advanceTimersByTimeAsync(VERSION_PROMPT_TIMEOUT_MS)
    const raw = sessionStorage.getItem(VERSION_RELOAD_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed.buildId).toBe(`${APP_BUILD_ID}-next`)
    expect(typeof parsed.ts).toBe('number')
  })
})

import { render, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useVersionSync, APP_BUILD_ID, VERSION_CHECK_INTERVAL_MS, VERSION_RELOAD_KEY, locationBridge } from '../hooks/useVersionSync'
function Harness(){useVersionSync();return null}
describe('useVersionSync',()=>{
  let visibilityState='visible'
  const flush=()=>act(async()=>{await Promise.resolve()})
  beforeEach(()=>{
    cleanup()
    vi.useFakeTimers()
    sessionStorage.clear()
    vi.restoreAllMocks()
    fetch.mockReset()
    history.replaceState({},'', '/login')
    visibilityState='visible'
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibilityState})
    vi.spyOn(locationBridge,'replace').mockImplementation(()=>{})
  })
  afterEach(()=>{
    vi.useRealTimers()
  })
  it('does not reload when build id matches',async()=>{
    fetch.mockResolvedValue({ok:true,json:async()=>({buildId:APP_BUILD_ID})})
    render(<Harness />)
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(locationBridge.replace).not.toHaveBeenCalled()
  })
  it('reloads when build id changes',async()=>{
    fetch.mockResolvedValue({ok:true,json:async()=>({buildId:`${APP_BUILD_ID}-next`})})
    render(<Harness />)
    await flush()
    expect(locationBridge.replace).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(VERSION_RELOAD_KEY)).toBe(`${APP_BUILD_ID}-next`)
    expect(locationBridge.replace.mock.calls[0][0]).toContain('_v=')
  })
  it('checks again when page becomes visible',async()=>{
    fetch.mockResolvedValue({ok:true,json:async()=>({buildId:APP_BUILD_ID})})
    visibilityState='hidden'
    render(<Harness />)
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    visibilityState='visible'
    await act(async()=>{
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('checks on interval',async()=>{
    fetch.mockResolvedValue({ok:true,json:async()=>({buildId:APP_BUILD_ID})})
    render(<Harness />)
    await flush()
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(VERSION_CHECK_INTERVAL_MS)
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

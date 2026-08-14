import { useEffect, useRef, useState } from 'react'
export const APP_BUILD_ID=import.meta.env.VITE_APP_BUILD_ID||'dev'
export const VERSION_CHECK_INTERVAL_MS=300000
// 检测到新版本后，等待用户点击「立即刷新」的窗口；超时自动强制刷新兜底
export const VERSION_PROMPT_TIMEOUT_MS=30000
// 同一次 buildId 刷新后的冷却期：防止刷新后仍停留在旧版（如缓存未更新）导致无限刷新循环。
// 冷却期内同一 buildId 不再自动刷新（用户手动点击不受限）；超过冷却期若仍是旧版则允许再次尝试。
export const VERSION_RELOAD_COOLDOWN_MS=60000
export const VERSION_RELOAD_KEY='app_version_reload_target'
export const locationBridge={replace:url=>window.location.replace(url)}
async function loadLatestBuildId(signal){
  const res=await fetch(`/version.json?t=${Date.now()}`,{cache:'no-store',headers:{'cache-control':'no-cache'},signal})
  if(!res.ok)return''
  const data=await res.json().catch(()=>null)
  return typeof data?.buildId==='string'?data.buildId:''
}
function buildReloadUrl(){
  const url=new URL(window.location.href)
  url.searchParams.set('_v',Date.now().toString())
  return url.toString()
}
// 防重：返回 true 表示冷却期内已尝试刷新过该 buildId，跳过本次刷新
function isWithinCooldown(nextBuildId){
  try{
    const raw=sessionStorage.getItem(VERSION_RELOAD_KEY)
    if(!raw)return false
    const parsed=JSON.parse(raw)
    if(parsed?.buildId===nextBuildId && Date.now()-Number(parsed.ts||0)<VERSION_RELOAD_COOLDOWN_MS)return true
  }catch{}
  return false
}
function markReloadAttempt(nextBuildId){
  try{
    sessionStorage.setItem(VERSION_RELOAD_KEY,JSON.stringify({buildId:nextBuildId,ts:Date.now()}))
  }catch{}
}
export function useVersionSync(){
  const [updateAvailable,setUpdateAvailable]=useState(false)
  const pendingBuildIdRef=useRef('')
  const checkingRef=useRef(false)
  const currentBuildIdRef=useRef(APP_BUILD_ID)
  const autoReloadTimerRef=useRef(null)
  // 用户点击「立即刷新」：绕过冷却强制刷新
  const reloadNow=()=>{
    locationBridge.replace(buildReloadUrl())
  }
  // 检测到新版本：进入「可升级」状态，展示横幅；超时后自动刷新兜底
  const scheduleAutoReload=(nextBuildId)=>{
    pendingBuildIdRef.current=nextBuildId
    setUpdateAvailable(true)
    if(autoReloadTimerRef.current)return
    autoReloadTimerRef.current=setTimeout(()=>{
      autoReloadTimerRef.current=null
      if(isWithinCooldown(pendingBuildIdRef.current))return
      markReloadAttempt(pendingBuildIdRef.current)
      locationBridge.replace(buildReloadUrl())
    },VERSION_PROMPT_TIMEOUT_MS)
  }
  useEffect(()=>{
    // 清理版本刷新残留的 ?_v= 参数：刷新完成后地址栏恢复干净，无需手动删除
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('_v')) {
        url.searchParams.delete('_v')
        window.history.replaceState(window.history.state, '', url.toString())
      }
    } catch { /* URL 解析失败时跳过清理 */ }
    let active=true
    let controller=null
    const check=async()=>{
      if(!active||checkingRef.current)return
      checkingRef.current=true
      controller?.abort()
      controller=new AbortController()
      try{
        const latestBuildId=await loadLatestBuildId(controller.signal)
        if(active&&latestBuildId&&latestBuildId!==currentBuildIdRef.current){
          scheduleAutoReload(latestBuildId)
        }
      }catch{}
      checkingRef.current=false
    }
    const onVisibilityChange=()=>{if(document.visibilityState==='visible')void check()}
    const onOnline=()=>{void check()}
    void check()
    const timer=window.setInterval(()=>{void check()},VERSION_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange',onVisibilityChange)
    window.addEventListener('online',onOnline)
    return()=>{
      active=false
      controller?.abort()
      checkingRef.current=false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange',onVisibilityChange)
      window.removeEventListener('online',onOnline)
      if(autoReloadTimerRef.current){window.clearTimeout(autoReloadTimerRef.current);autoReloadTimerRef.current=null}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  return {updateAvailable,reloadNow}
}

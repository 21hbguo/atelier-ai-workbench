import { useEffect, useRef } from 'react'
export const APP_BUILD_ID=import.meta.env.VITE_APP_BUILD_ID||'dev'
export const VERSION_CHECK_INTERVAL_MS=300000
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
function reloadToLatest(nextBuildId){
  if(sessionStorage.getItem(VERSION_RELOAD_KEY)===nextBuildId)return
  sessionStorage.setItem(VERSION_RELOAD_KEY,nextBuildId)
  locationBridge.replace(buildReloadUrl())
}
export function useVersionSync(){
  const checkingRef=useRef(false)
  const currentBuildIdRef=useRef(APP_BUILD_ID)
  useEffect(()=>{
    let active=true
    let controller=null
    const check=async()=>{
      if(!active||checkingRef.current)return
      checkingRef.current=true
      controller?.abort()
      controller=new AbortController()
      try{
        const latestBuildId=await loadLatestBuildId(controller.signal)
        if(active&&latestBuildId&&latestBuildId!==currentBuildIdRef.current)reloadToLatest(latestBuildId)
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
    }
  },[])
}

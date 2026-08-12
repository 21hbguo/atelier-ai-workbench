import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Coins, MessageCircle } from 'lucide-react'
import ChatInput from '../components/ChatInput'
import MainLayout from '../components/MainLayout'
import PortfolioShowcaseCard from '../components/PortfolioShowcaseCard'
import { useAppDialog } from '../components/AppDialogProvider'
import { taskAPI, pointsAPI, configAPI } from '../api'
import { readUser } from '../auth'
import { setSubmissionQueue, getPrunedSubmissionQueue } from '../utils/imageDB'

function formatLocalTime(d){const pad=n=>String(n).padStart(2,'0');return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`}
function makeTaskId(){if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();if(typeof crypto!=='undefined'&&typeof crypto.getRandomValues==='function'){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}return`task-${Date.now()}-${Math.random().toString(16).slice(2,10)}`}
function getUploadExt(type,name=''){const mime=String(type||'').split(';')[0].trim().toLowerCase();if(mime==='image/png')return'png';if(mime==='image/jpeg')return'jpg';if(mime==='image/webp')return'webp';const match=String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/);const ext=match?.[1]||'';return['png','jpg','jpeg','webp'].includes(ext)?(ext==='jpeg'?'jpg':ext):'png'}
function normalizeUploadName(name,type,url=''){const raw=String(name||'').trim()||decodeURIComponent(String(url||'').split('?')[0].split('/').pop()||'');const base=(raw.replace(/\.[^.]+$/,'')||'reference').replace(/[^\w.-]/g,'_').replace(/^\.+/,'')||'reference';return`${base}.${getUploadExt(type,raw)}`}
function isVipModel(modelId=''){return modelId==='grsai-vip'}
function getImageRatioLabel(value=''){return value||'自动'}
function getVipResolutionLabel(value=''){return value==='low'?'1K':value==='medium'?'2K':value==='high'?'4K':'1K'}
function getVipResolutionCost(params={},fallback=10){const costs=params?._resolution_costs||params?.resolution_costs||{};const key=params?.resolution||'auto';const value=costs[key]??costs.auto??params?._points_cost;const num=Number(value);return num>0?Math.round(num):fallback}
function getModelCost(params={},fallback=10){return isVipModel(params?.model_id)?getVipResolutionCost(params,fallback):(Number(params?._points_cost)>0?Math.round(Number(params._points_cost)):fallback)}
function getGenerationSizeLabel(params={}){if(isVipModel(params?.model_id)){const resolution=params?.resolution||'low';const ratio=params?.size||params?.aspect_ratio||params?.aspectRatio||'auto';const quality=params?.quality||'';const parts=[`比例:${getImageRatioLabel(ratio)}`,`分辨率:${getVipResolutionLabel(resolution)}`];if(quality)parts.push(`画质:${quality}`);return parts.join(' / ')}const size=params?.size||'';return size?`比例:${getImageRatioLabel(size)}`:''}
function normalizeSubmissionParams(params={}){const next={...(params||{})};if(isVipModel(next.model_id)){next.size=next.size||'auto';next.resolution=next.resolution||'low';next.aspect_ratio=next.size&&next.size!=='auto'?next.size:''}return next}
function formatSubmitSettings(params,shareToSquare,imageCount){const modelLabel=params?._model_label||params?.model_id||'默认模型';const lines=[`模型：${modelLabel}`];const sizeLabel=getGenerationSizeLabel(params);if(sizeLabel)lines.push(sizeLabel);const extra=Object.entries(params||{}).filter(([key,value])=>!['size','resolution','aspect_ratio','aspectRatio','quality','model_id','_model_label','_points_cost','_resolution_costs','resolution_costs','roll_count','optimize_stream'].includes(key)&&value!==undefined&&value!==null&&value!=='');for(const[key,value]of extra)lines.push(`${key}：${value}`);lines.push(`参考图：${imageCount||0} 张`);lines.push(`分享：${shareToSquare?'开启':'关闭'}`);return lines.join('\n')}
function buildSubmissionImages(items=[]){return items.map((img,idx)=>({id:img?.id||`reference-${idx}`,name:img?.name||img?.file?.name||`reference-${idx}`,type:img?.type||img?.file?.type||'image/png',url:img?.url||'',preview:img?.preview||img?.url||'',file:img?.file||null,uploadStatus:img?.uploadStatus||'',uploadProgress:Number(img?.uploadProgress)||0,uploadedUrl:img?.uploadedUrl||'',uploadedStorageName:img?.uploadedStorageName||'',uploadError:img?.uploadError||''}))}

export default function ChatPage(){
  const dialog=useAppDialog()
  const navigate=useNavigate()
  const inputRef=useRef(null)
  const [currentUser,setCurrentUser]=useState(()=>readUser())
  const [points,setPoints]=useState(currentUser?.points??0)
  const [requestCost,setRequestCost]=useState(10)
  const [optimizeCost,setOptimizeCost]=useState(10)
  const [refineOptimizeCost,setRefineOptimizeCost]=useState(20)
  const [checkedInToday,setCheckedInToday]=useState(false)
  const [checkinLoading,setCheckinLoading]=useState(false)
  const [dragging,setDragging]=useState(false)
  const dragCounter=useRef(0)
  const loading=false
  const submissionQueueKey=(currentUser?.id?`submission_queue_${currentUser.id}`:'submission_queue_guest')

  useEffect(()=>{const syncUser=()=>setCurrentUser(readUser());window.addEventListener('auth-changed',syncUser);window.addEventListener('points-updated',syncUser);return()=>{window.removeEventListener('auth-changed',syncUser);window.removeEventListener('points-updated',syncUser)}},[])
  useEffect(()=>{setPoints(currentUser?.points??0)},[currentUser])
  useEffect(()=>{pointsAPI.balance().then(res=>setPoints(res.data.points)).catch(()=>{});pointsAPI.checkinStatus().then(res=>setCheckedInToday(!!res.data.checked_in_today)).catch(()=>{});const handleUpdate=()=>{const u=readUser();setCurrentUser(u);if(u)setPoints(u.points??0)};window.addEventListener('points-updated',handleUpdate);return()=>window.removeEventListener('points-updated',handleUpdate)},[])
  useEffect(()=>{configAPI.get().then(res=>{setRequestCost(Math.max(0,Number(res.data?.points_cost_per_generation)||10));setOptimizeCost(Math.max(0,Number(res.data?.points_cost_per_optimize)||10));setRefineOptimizeCost(Math.max(0,Number(res.data?.points_cost_per_optimize_refine)||20))}).catch(()=>{setRequestCost(10);setOptimizeCost(10);setRefineOptimizeCost(20)})},[])
  const handleCheckIn=useCallback(async()=>{if(checkedInToday||checkinLoading)return;setCheckinLoading(true);try{const res=await pointsAPI.checkin();setPoints(res.data.points);setCheckedInToday(true);const u=readUser();if(u){u.points=res.data.points;localStorage.setItem('user',JSON.stringify(u))}window.dispatchEvent(new Event('points-updated'))}catch(err){dialog.alert(err.message||'签到失败')}finally{setCheckinLoading(false)}},[checkedInToday,checkinLoading,dialog])

  const handleSubmit=useCallback(async({prompt,images,params,shareToSquare,rollCount=1,clearInput})=>{
    const batchCount=Math.min(5,Math.max(1,Number(rollCount)||1))
    const modelCost=getModelCost(params,requestCost)
    const totalCost=batchCount*modelCost
    if(points<totalCost){dialog.alert(`积分不足，当前仅剩 ${points} 积分，本次需要 ${totalCost} 积分。`);return false}
    try{
      const {data}=await taskAPI.activeSummary()
      const activeCount=Math.max(0,Number(data?.active_count)||0)
      const globalLimit=Math.max(1,Number(data?.global_limit)||20)
      if(activeCount+batchCount>globalLimit){dialog.alert(`当前全站正在生成 ${activeCount} 张，最多同时 ${globalLimit} 张。请稍后再试。`);return false}
    }catch(e){dialog.alert(e?.message||'提交前检查失败，请稍后再试');return false}
    const submitMessage=batchCount>1?`本次将提交 ${batchCount} 次生成，预计消耗 ${totalCost} 积分，是否继续？`:`本次将提交 1 次生成，预计消耗 ${modelCost} 积分，是否继续？`
    if(!await dialog.confirm(`${submitMessage}\n\n当前设置\n${formatSubmitSettings(params,shareToSquare,images?.length||0)}`))return false
    try{
      const now=formatLocalTime(new Date())
      const baseImages=buildSubmissionImages(images||[])
      const activeImages=baseImages.filter(img=>img?.uploadStatus!=='error')
      const successImages=activeImages.filter(img=>img?.uploadStatus==='success'&&img?.uploadedUrl&&(img?.uploadedStorageName||img?.uploadedUrl))
      if(activeImages.length!==successImages.length){dialog.alert('存在未完成上传的参考图，请等待上传完成或删除失败图片后再提交');return false}
      const sharedUploadParams=successImages.length>0?{image_urls:successImages.map(img=>img.uploadedUrl).filter(Boolean),local_image_urls:successImages.map(img=>img.uploadedStorageName||img.uploadedUrl).filter(Boolean)}:{}
      const normalizedParams=normalizeSubmissionParams({ ...params,...sharedUploadParams,prompt,share_to_square:!!shareToSquare })
      const existing=await getPrunedSubmissionQueue(submissionQueueKey).catch(()=>[])
      const submissions=Array.from({length:batchCount},(_,index)=>({client_request_id:makeTaskId(),temp_task_id:`pending-${Date.now()}-${index}-${Math.random().toString(16).slice(2,8)}`,real_task_id:null,prompt,images:successImages,params:normalizedParams,shareToSquare:!!shareToSquare,type:successImages.length?'text_image':'text',status:'processing',created_at:now,started_at:now,error:null}))
      await setSubmissionQueue(submissionQueueKey,[...existing,...submissions])
      clearInput?.()
      navigate('/works')
      return'cleared'
    }catch(e){dialog.alert('提交失败: '+(e?.message||'未知错误'));return false}
  },[dialog,navigate,points,requestCost,submissionQueueKey])

  const handleDragEnter=useCallback((e)=>{e.preventDefault();e.stopPropagation();if(e.dataTransfer.types.includes('Files')){if(e.currentTarget.contains(e.relatedTarget))return;dragCounter.current++;setDragging(true)}},[])
  const handleDragLeave=useCallback((e)=>{e.preventDefault();e.stopPropagation();if(e.currentTarget.contains(e.relatedTarget))return;dragCounter.current--;if(dragCounter.current===0)setDragging(false)},[])
  const handleDragOver=useCallback((e)=>{e.preventDefault();e.stopPropagation()},[])
  const handleDrop=useCallback((e)=>{e.preventDefault();e.stopPropagation();dragCounter.current=0;setDragging(false);const files=Array.from(e.dataTransfer.files).filter(f=>/\.(png|jpe?g|webp)$/i.test(f.name));if(files.length>0)inputRef.current?.addFiles(files)},[])
  const dragProps={onDragEnter:handleDragEnter,onDragLeave:handleDragLeave,onDragOver:handleDragOver,onDrop:handleDrop}
  const bottomDock=(
    <div className="lg:static fixed inset-x-0 z-20 flex-shrink-0" style={{ background: 'var(--bg-primary)', borderTop: `1px solid var(--border-color)`, bottom: 'env(keyboard-inset-height, 0px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ChatInput ref={inputRef} onSubmit={handleSubmit} loading={loading} requestCost={requestCost} optimizeCost={optimizeCost} refineOptimizeCost={refineOptimizeCost}/>
    </div>
  )
  const handleUsePrompt=useCallback((prompt)=>{inputRef.current?.setPrompt(String(prompt||''))},[])

  return(
    <MainLayout dragProps={dragProps}>
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {dragging&&(
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none" style={{background:'var(--bg-primary)',opacity:0.92}}>
            <div className="flex flex-col items-center gap-3">
              <div className="w-20 h-20 rounded-2xl border-2 border-dashed flex items-center justify-center" style={{borderColor:'var(--accent)'}}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
              <p className="text-lg font-medium" style={{color:'var(--accent)'}}>拖放图片到此处上传</p>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="w-full pb-28 lg:pb-6">
            <div className="mobile-topbar-shell" style={{borderColor:'var(--border-color)'}}>
              <div className="mobile-topbar-inner w-full justify-start gap-1.5 px-4 lg:px-6">
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => navigate('/chat')} title="AI 助手对话"
                    className="inline-flex h-7 items-center gap-1 rounded-xl border px-2 text-[11px] font-medium transition-colors"
                    style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border-color)' }}>
                    <MessageCircle size={13} />
                    <span>会话</span>
                  </button>
                  <button onClick={handleCheckIn} disabled={checkedInToday||checkinLoading} className="inline-flex h-7 items-center justify-center rounded-xl border px-2 text-[11px] font-medium transition-colors disabled:opacity-60" style={{background:checkedInToday?'color-mix(in srgb,var(--color-success) 14%,transparent)':'var(--bg-primary)',color:checkedInToday?'var(--color-success)':'var(--text-primary)',borderColor:'var(--border-color)'}}>
                    {checkinLoading?'签到中':checkedInToday?'已签':'签到'}
                  </button>
                  <button onClick={()=>navigate('/wallet')} className="inline-flex h-7 items-center gap-1 rounded-2xl px-2.5 transition-colors" style={{background:'var(--accent)',color:'#fff'}}>
                    <Coins size={14}/>
                    <span className="text-xs font-semibold leading-none tabular-nums">{points}</span>
                    <span className="text-[11px] leading-none opacity-90">积分</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="mx-auto flex w-full max-w-6xl justify-center px-4 pt-6 sm:pt-10 lg:px-6">
              <PortfolioShowcaseCard onUsePrompt={handleUsePrompt} />
            </div>
          </div>
        </div>
      </div>
      {bottomDock}
    </MainLayout>
  )
}

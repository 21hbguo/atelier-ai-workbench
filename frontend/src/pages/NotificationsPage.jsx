import { useEffect, useState } from 'react'
import MainLayout from '../components/MainLayout'
import Pagination from '../components/Pagination'
import { notificationAPI } from '../api'
import { useAppDialog } from '../components/AppDialogProvider'

export default function NotificationsPage(){
const dialog=useAppDialog()
const [items,setItems]=useState([])
const [loading,setLoading]=useState(false)
const [page,setPage]=useState(1)
const [total,setTotal]=useState(0)
const size=20
const fetchData=async(p=1)=>{
setLoading(true)
try{const {data}=await notificationAPI.list(p,size);setItems(data.items||[]);setTotal(data.total||0)}catch(e){dialog.alert(e.message||'加载失败')}
setLoading(false)
}
useEffect(()=>{fetchData(page)},[page])
const markRead=async(id)=>{try{await notificationAPI.markRead(id);setItems(prev=>prev.map(v=>v.id===id?{...v,is_read:true,read_at:new Date().toISOString()}:v));window.dispatchEvent(new Event('notifications-updated'))}catch(e){dialog.alert(e.message||'操作失败')}}
const markAll=async()=>{try{await notificationAPI.markAllRead();setItems(prev=>prev.map(v=>({...v,is_read:true,read_at:v.read_at||new Date().toISOString()})));window.dispatchEvent(new Event('notifications-updated'))}catch(e){dialog.alert(e.message||'操作失败')}}
const clearRead=async()=>{try{const {data}=await notificationAPI.clearRead();if(data.deleted>0){setItems(prev=>prev.filter(v=>!v.is_read));setTotal(prev=>prev-data.deleted);window.dispatchEvent(new Event('notifications-updated'))}else{dialog.alert('没有已读通知可清除')}}catch(e){dialog.alert(e.message||'操作失败')}}
const totalPages=Math.max(1,Math.ceil(total/size))
return <MainLayout><div className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="max-w-4xl mx-auto"><div className="flex items-center justify-between mb-4"><h1 className="text-lg font-semibold" style={{color:'var(--text-primary)'}}>通知中心</h1><div className="flex gap-2"><button onClick={markAll} className="px-3 py-1.5 rounded-lg text-sm font-medium text-white" style={{background:'var(--accent)'}}>全部已读</button><button onClick={clearRead} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{color:'var(--text-secondary)',border:'1px solid var(--border-color)'}}>清除已读</button></div></div>{loading?<div className="text-sm" style={{color:'var(--text-secondary)'}}>加载中...</div>:items.length===0?<div className="text-sm" style={{color:'var(--text-secondary)'}}>暂无通知</div>:<div className="space-y-2">{items.map(n=><div key={n.id} className="p-3 rounded-xl border" style={{background:'var(--bg-ai-bubble)',borderColor:'var(--border-color)'}}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="text-sm font-medium" style={{color:'var(--text-primary)'}}>{n.title}</div><div className="text-xs mt-1" style={{color:'var(--text-secondary)'}}>{n.content}</div><div className="text-[11px] mt-1" style={{color:'var(--text-secondary)'}}>{(() => { const s = String(n.created_at || ''); const withTz = s.includes('T') ? (s.includes('+') || s.includes('Z') ? s : s + '+08:00') : s.replace(' ', 'T') + '+08:00'; return new Date(withTz).toLocaleString('zh-CN') })()}</div></div>{!n.is_read&&<button onClick={()=>markRead(n.id)} className="px-2 py-1 rounded text-xs" style={{color:'var(--accent)'}}>标为已读</button>}</div></div>)}</div>}<Pagination page={page} totalPages={totalPages} onPageChange={setPage} /></div></div></MainLayout>
}

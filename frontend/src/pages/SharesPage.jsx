import { useEffect, useState } from 'react'
import MainLayout from '../components/MainLayout'
import { shareAPI } from '../api'
import { useAppDialog } from '../components/AppDialogProvider'

export default function SharesPage(){
const dialog=useAppDialog()
const [items,setItems]=useState([])
const [loading,setLoading]=useState(false)
const fetchData=async()=>{setLoading(true);try{const {data}=await shareAPI.list();setItems(data.items||[])}catch(e){dialog.alert(e.message||'加载失败')}setLoading(false)}
useEffect(()=>{fetchData()},[])
const revoke=async(id)=>{try{await shareAPI.revoke(id);setItems(prev=>prev.map(v=>v.id===id?{...v,is_revoked:true}:v))}catch(e){dialog.alert(e.message||'撤销失败')}}
const copy=(token)=>navigator.clipboard.writeText(`${window.location.origin}/s/${token}`).catch(()=>{})
return <MainLayout><div className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="max-w-4xl mx-auto"><div className="flex items-center justify-between mb-4"><h1 className="text-lg font-semibold" style={{color:'var(--text-primary)'}}>分享管理</h1><button onClick={fetchData} className="px-3 py-1.5 rounded-2xl text-sm" style={{background:'var(--bg-ai-bubble)',color:'var(--text-primary)'}}>刷新</button></div>{loading?<div className="text-sm" style={{color:'var(--text-secondary)'}}>加载中...</div>:items.length===0?<div className="text-sm" style={{color:'var(--text-secondary)'}}>暂无分享</div>:<div className="space-y-2">{items.map(s=>{const parseBeijing=(v)=>{const s=String(v||'');const withTz=s.includes('T')?(s.includes('+')||s.includes('Z')?s:s+'+08:00'):s.replace(' ','T')+'+08:00';return new Date(withTz)};const expired=parseBeijing(s.expires_at).getTime()<Date.now();return <div key={s.id} className="p-3 rounded-2xl border" style={{background:'var(--bg-ai-bubble)',borderColor:'var(--border-color)'}}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="text-sm" style={{color:'var(--text-primary)'}}>{s.filename}</div><div className="text-xs mt-1" style={{color:'var(--text-secondary)'}}>到期：{parseBeijing(s.expires_at).toLocaleString('zh-CN')}</div><div className="text-xs mt-1" style={{color:s.is_revoked?'var(--color-error)':expired?'var(--color-warning)':'var(--color-success)'}}>{s.is_revoked?'已撤销':expired?'已过期':'生效中'}</div></div><div className="flex gap-2"><button onClick={()=>copy(s.token)} className="px-2 py-1 rounded-lg text-xs" style={{color:'var(--accent)'}}>复制链接</button>{!s.is_revoked&&<button onClick={()=>revoke(s.id)} className="px-2 py-1 rounded-lg text-xs text-[var(--color-error)]">撤销</button>}</div></div></div>})}</div>}</div></div></MainLayout>
}

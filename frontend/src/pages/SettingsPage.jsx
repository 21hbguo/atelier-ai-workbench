import { useEffect, useState } from 'react'
import { ShieldAlert, KeyRound } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import Pagination from '../components/Pagination'
import { accountAPI } from '../api'
import { useAppDialog } from '../components/AppDialogProvider'

export default function SettingsPage(){
const dialog=useAppDialog()
const [oldPassword,setOldPassword]=useState('')
const [newPassword,setNewPassword]=useState('')
const [submitting,setSubmitting]=useState(false)
const [sessions,setSessions]=useState([])
const [page,setPage]=useState(1)
const [total,setTotal]=useState(0)
const [loading,setLoading]=useState(false)
const size=10
const fetchSessions=async(p=1)=>{setLoading(true);try{const {data}=await accountAPI.sessions(p,size);setSessions(data.items||[]);setTotal(data.total||0)}catch(e){dialog.alert(e.message||'加载失败')}setLoading(false)}
useEffect(()=>{fetchSessions(page)},[page])
const onChangePassword=async()=>{if(!oldPassword||!newPassword)return;setSubmitting(true);try{await accountAPI.changePassword({old_password:oldPassword,new_password:newPassword});setOldPassword('');setNewPassword('');dialog.alert('密码修改成功')}catch(e){dialog.alert(e.message||'修改失败')}setSubmitting(false)}
const hasRisk=sessions.some(v=>v.risk_level==='high')
return <MainLayout><div className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="max-w-4xl mx-auto space-y-4"><div className="p-4 rounded-xl border" style={{background:'var(--bg-ai-bubble)',borderColor:'var(--border-color)'}}><div className="flex items-center gap-2 mb-3"><KeyRound size={16} style={{color:'var(--accent)'}} /><span className="text-sm font-medium" style={{color:'var(--text-primary)'}}>修改密码</span></div><div className="flex gap-2"><input type="password" value={oldPassword} onChange={e=>setOldPassword(e.target.value)} placeholder="当前密码" className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm border outline-none" style={{background:'var(--bg-primary)',borderColor:'var(--border-color)',color:'var(--text-primary)'}} /><input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="新密码（至少6位）" className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm border outline-none" style={{background:'var(--bg-primary)',borderColor:'var(--border-color)',color:'var(--text-primary)'}} /><button onClick={onChangePassword} disabled={submitting||!oldPassword||newPassword.length<6} className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{background:'var(--accent)'}}>{submitting?'提交中...':'确认修改'}</button></div></div>{hasRisk&&<div className="p-3 rounded-xl border text-sm flex items-center gap-2" style={{background:'color-mix(in srgb, var(--color-warning) 12%, transparent)',borderColor:'var(--color-warning)',color:'var(--color-warning)'}}><ShieldAlert size={16} />检测到近24小时存在多IP/多设备登录，请确认是否本人操作。</div>}<div className="p-4 rounded-xl border" style={{background:'var(--bg-ai-bubble)',borderColor:'var(--border-color)'}}><div className="text-sm font-medium mb-3" style={{color:'var(--text-primary)'}}>最近登录会话</div>{loading?<div className="text-xs" style={{color:'var(--text-secondary)'}}>加载中...</div>:sessions.length===0?<div className="text-xs" style={{color:'var(--text-secondary)'}}>暂无记录</div>:<div className="space-y-2">{sessions.map(s=><div key={s.id} className="p-3 rounded-lg border" style={{background:'var(--bg-primary)',borderColor:'var(--border-color)'}}><div className="flex items-center justify-between gap-2"><div className="text-xs" style={{color:'var(--text-primary)'}}>{s.ip||'未知IP'}{s.is_current&&<span className="ml-2 px-1.5 py-0.5 rounded text-[10px] text-white" style={{background:'var(--accent)'}}>当前</span>}</div><div className="text-[10px]" style={{color:s.risk_level==='high'?'var(--color-error)':s.risk_level==='medium'?'var(--color-warning)':'var(--color-success)'}}>{s.risk_level}</div></div><div className="text-[11px] mt-1" style={{color:'var(--text-secondary)'}}>{s.user_agent||'-'}</div><div className="text-[11px] mt-1" style={{color:'var(--text-secondary)'}}>登录时间：{new Date(s.created_at).toLocaleString('zh-CN')}</div></div>)}</div>}<Pagination page={page} totalPages={Math.max(1,Math.ceil(total/size))} onPageChange={setPage} /></div></div></div></MainLayout>
}

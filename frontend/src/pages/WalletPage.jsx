import { useState, useEffect } from 'react'
import { Coins, ArrowUpCircle, ArrowDownCircle, RefreshCw, User, Mail, Gift, Wallet, Upload } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import Pagination from '../components/Pagination'
import api, { pointsAPI, uploadAPI } from '../api'
const typeMap={register_bonus:{label:'注册赠送',color:'var(--accent)'},daily_checkin:{label:'每日签到',color:'var(--accent)'},generate_consume:{label:'生成消耗',color:'#ef4444'},generate_refund:{label:'生成退款',color:'#22c55e'},redeem_code:{label:'兑换码兑换',color:'var(--accent)'},admin_grant:{label:'管理员调整',color:'#8b5cf6'},migration:{label:'历史补偿',color:'var(--accent)'},migration_bonus:{label:'历史补偿',color:'var(--accent)'}}
const rechargePackages=[{amount:9.9,points:120,label:'体验包'},{amount:29.9,points:400,label:'进阶包'},{amount:59.9,points:900,label:'超值包'}]
const channelLabel={wechat:'微信',alipay:'支付宝'}
const statusMap={pending:{label:'待审核',color:'#f59e0b'},approved:{label:'已通过',color:'#22c55e'},rejected:{label:'已拒绝',color:'#ef4444'}}
export default function WalletPage(){
const user=JSON.parse(localStorage.getItem('user')||'null')
const isAdmin=Boolean(user?.is_admin)
const [points,setPoints]=useState(user?.points??0)
const [transactions,setTransactions]=useState([])
const [loading,setLoading]=useState(true)
const [page,setPage]=useState(1)
const [total,setTotal]=useState(0)
const size=15
const [redeemCode,setRedeemCode]=useState('')
const [redeemLoading,setRedeemLoading]=useState(false)
const [redeemMsg,setRedeemMsg]=useState(null)
const [payConfig,setPayConfig]=useState({wechat_pay_qr_url:'',alipay_pay_qr_url:'',manual_recharge_notice:''})
const [rechargeChannel,setRechargeChannel]=useState('wechat')
const [packageIdx,setPackageIdx]=useState(0)
const [rechargeAmount,setRechargeAmount]=useState(rechargePackages[0].amount)
const [rechargePoints,setRechargePoints]=useState(rechargePackages[0].points)
const [payerName,setPayerName]=useState('')
const [proofUrl,setProofUrl]=useState('')
const [remark,setRemark]=useState('')
const [submittingRecharge,setSubmittingRecharge]=useState(false)
const [uploadingProof,setUploadingProof]=useState(false)
const [proofLightbox,setProofLightbox]=useState(false)
const [checkedInToday,setCheckedInToday]=useState(null)
const [checkinLoading,setCheckinLoading]=useState(false)
const [rechargeMsg,setRechargeMsg]=useState(null)
const fetchData=async(p=1)=>{
setLoading(true)
try{
const [balRes,txRes]=await Promise.all([pointsAPI.balance(),pointsAPI.transactions(p,size)])
setPoints(balRes.data.points)
setTransactions(txRes.data.items||[])
setTotal(txRes.data.total||0)
const u=JSON.parse(localStorage.getItem('user')||'null')
if(u){u.points=balRes.data.points;localStorage.setItem('user',JSON.stringify(u))}
}catch{}
setLoading(false)
}
useEffect(()=>{fetchData(page)},[page])
useEffect(()=>{
api.get('/config').then(({data})=>{setPayConfig({wechat_pay_qr_url:data.wechat_pay_qr_url||'',alipay_pay_qr_url:data.alipay_pay_qr_url||'',manual_recharge_notice:data.manual_recharge_notice||'请备注用户名并在下方提交支付凭证，审核通过后自动发放兑换码'})}).catch(()=>{})
},[])
useEffect(()=>{
pointsAPI.checkinStatus().then(({data})=>{setCheckedInToday(data.checked_in_today)}).catch(()=>{})
},[])
useEffect(()=>{
const handleUpdate=()=>{
const u=JSON.parse(localStorage.getItem('user')||'null')
if(u)setPoints(u.points??0)
}
window.addEventListener('points-updated',handleUpdate)
return()=>window.removeEventListener('points-updated',handleUpdate)
},[])
const handleRedeem=async()=>{
if(!redeemCode.trim())return
setRedeemLoading(true)
setRedeemMsg(null)
try{
const res=await pointsAPI.redeem(redeemCode.trim())
setPoints(res.data.balance)
setRedeemMsg({type:'success',text:`兑换成功！+${res.data.points_awarded} 积分`})
setRedeemCode('')
const u=JSON.parse(localStorage.getItem('user')||'null')
if(u){u.points=res.data.balance;localStorage.setItem('user',JSON.stringify(u))}
window.dispatchEvent(new Event('points-updated'))
fetchData(page)
}catch(e){
setRedeemMsg({type:'error',text:e.message})
}finally{
setRedeemLoading(false)
}
}
const handleCheckIn=async()=>{
setCheckinLoading(true)
try{
const res=await pointsAPI.checkin()
setPoints(res.data.points)
setCheckedInToday(true)
const u=JSON.parse(localStorage.getItem('user')||'null')
if(u){u.points=res.data.points;localStorage.setItem('user',JSON.stringify(u))}
window.dispatchEvent(new Event('points-updated'))
fetchData(page)
}catch(e){
alert(e.message||'签到失败')
}finally{
setCheckinLoading(false)
}
}
const handlePickPackage=(idx)=>{setPackageIdx(idx);setRechargeAmount(rechargePackages[idx].amount);setRechargePoints(rechargePackages[idx].points)}
const handleUploadProof=async(e)=>{
const file=e.target.files?.[0]
if(!file)return
setUploadingProof(true)
try{
const {data}=await uploadAPI.uploadLocal(file)
setProofUrl(data.url||'')
setRechargeMsg({type:'success',text:'支付凭证上传成功'})
}catch(err){
setRechargeMsg({type:'error',text:err.message||'支付凭证上传失败'})
}finally{
setUploadingProof(false)
e.target.value=''
}
}
const handleSubmitRecharge=async()=>{
if(!proofUrl.trim()){setRechargeMsg({type:'error',text:'请上传支付凭证'});return}
setSubmittingRecharge(true)
setRechargeMsg(null)
try{
await pointsAPI.createRechargeRequest({channel:rechargeChannel,amount:rechargeAmount,points:rechargePoints,payer_name:payerName,proof_url:proofUrl,remark})
setProofUrl('')
setRemark('')
setRechargeMsg({type:'success',text:'充值申请已提交，审核通过后会自动发放兑换码'})
setRechargePage(1)
fetchRechargeRequests(1)
}catch(err){
setRechargeMsg({type:'error',text:err.message||'提交失败'})
}finally{
setSubmittingRecharge(false)
}
}
const totalPages=Math.ceil(total/size)
const activeQr=rechargeChannel==='wechat'?payConfig.wechat_pay_qr_url:payConfig.alipay_pay_qr_url
return(
<>
<MainLayout>
<div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-3xl mx-auto w-full">
<div className="mb-6 p-5 rounded-xl border" style={{background:'var(--bg-ai-bubble)',borderColor:'var(--border-color)'}}>
<div className="flex items-center gap-3 mb-4">
<div className="w-12 h-12 rounded-full flex items-center justify-center" style={{background:'var(--accent)',color:'#fff'}}><User size={24} /></div>
<div>
<h2 className="text-lg font-semibold" style={{color:'var(--text-primary)'}}>{user?.nickname||user?.username}</h2>
<div className="flex items-center gap-1.5 text-xs" style={{color:'var(--text-secondary)'}}><Mail size={12} /><span>{user?.username}</span></div>
</div>
</div>
<div className="flex items-center gap-2 p-4 rounded-lg" style={{background:'var(--bg-primary)'}}>
<Coins size={20} style={{color:'var(--accent)'}} />
<div className="flex-1">
<p className="text-xs" style={{color:'var(--text-secondary)'}}>当前积分</p>
<p className="text-2xl font-bold" style={{color:'var(--accent)'}}>{isAdmin?'∞':points}</p>
</div>
{!isAdmin&&checkedInToday!==null&&(
<button onClick={handleCheckIn} disabled={checkedInToday||checkinLoading} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors" style={{background:checkedInToday?'#22c55e':'var(--accent)',color:'#fff',opacity:checkedInToday?0.7:1}}>
{checkinLoading?'签到中...':checkedInToday?'已签到 ✓':'签到'}
</button>
)}
</div>
</div>
{!isAdmin&&(
<div className="mb-6 p-4 rounded-xl border" style={{background:'var(--bg-ai-bubble)',borderColor:'var(--border-color)'}}>
<div className="flex items-center gap-2 mb-3"><Gift size={16} style={{color:'var(--accent)'}} /><span className="text-sm font-medium" style={{color:'var(--text-primary)'}}>兑换码</span></div>
<div className="flex gap-2">
<input type="text" value={redeemCode} onChange={e=>setRedeemCode(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&handleRedeem()} placeholder="输入兑换码" className="flex-1 px-3 py-2 rounded-lg text-sm font-mono outline-none transition-colors" style={{background:'var(--bg-primary)',color:'var(--text-primary)',border:'1px solid var(--border-color)'}} />
<button onClick={handleRedeem} disabled={redeemLoading||!redeemCode.trim()} className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50" style={{background:'var(--accent)'}}>{redeemLoading?'兑换中...':'兑换'}</button>
</div>
{redeemMsg&&(<div className={`mt-2 px-3 py-2 rounded-lg text-xs ${redeemMsg.type==='success'?'text-green-600':'text-red-500'}`} style={{background:redeemMsg.type==='success'?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)'}}>{redeemMsg.text}</div>)}
</div>
)}
{!isAdmin&&(
<div className="mb-6 p-4 rounded-xl border" style={{background:'var(--bg-ai-bubble)',borderColor:'var(--border-color)'}}>
<div className="flex items-center gap-2 mb-3"><Wallet size={16} style={{color:'var(--accent)'}} /><span className="text-sm font-medium" style={{color:'var(--text-primary)'}}>人工充值</span></div>
<p className="text-xs mb-3" style={{color:'var(--text-secondary)'}}>{payConfig.manual_recharge_notice||'请备注用户名并在下方提交支付凭证，审核通过后自动发放兑换码'}</p>
<div className="flex gap-2 mb-3">{['wechat','alipay'].map(c=><button key={c} onClick={()=>setRechargeChannel(c)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${rechargeChannel===c?'text-white':'hover:bg-black/5'}`} style={{background:rechargeChannel===c?'var(--accent)':'var(--bg-primary)',color:rechargeChannel===c?'#fff':'var(--text-primary)',border:'1px solid var(--border-color)'}}>{channelLabel[c]}</button>)}</div>
<div className="mb-3 p-3 rounded-lg border flex items-center justify-center" style={{background:'var(--bg-primary)',borderColor:'var(--border-color)'}}>{activeQr?<img src={activeQr} alt="收款码" className="w-44 h-44 object-contain rounded-lg" />:<span className="text-xs" style={{color:'var(--text-secondary)'}}>管理员暂未配置{channelLabel[rechargeChannel]}收款码</span>}</div>
<div className="grid grid-cols-3 gap-2 mb-3">{rechargePackages.map((pkg,idx)=><button key={pkg.label} onClick={()=>handlePickPackage(idx)} className={`px-2 py-2 rounded-lg text-xs font-medium ${packageIdx===idx?'text-white':'hover:bg-black/5'}`} style={{background:packageIdx===idx?'var(--accent)':'var(--bg-primary)',color:packageIdx===idx?'#fff':'var(--text-primary)',border:'1px solid var(--border-color)'}}><div>{pkg.label}</div><div className="mt-0.5">¥{pkg.amount} / {pkg.points}积分</div></button>)}</div>
<div className="mb-2"><input type="text" value={payerName} onChange={e=>setPayerName(e.target.value)} placeholder="付款人（选填）" className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-colors" style={{background:'var(--bg-primary)',color:'var(--text-primary)',border:'1px solid var(--border-color)'}} /></div>
<textarea value={remark} onChange={e=>setRemark(e.target.value)} placeholder="备注（选填）" rows={2} className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none transition-colors mb-2" style={{background:'var(--bg-primary)',color:'var(--text-primary)',border:'1px solid var(--border-color)'}} />
<div className="flex flex-wrap items-center gap-2 mb-2"><label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer hover:bg-black/5" style={{color:'var(--text-primary)',border:'1px solid var(--border-color)'}}><Upload size={14} />{uploadingProof?'上传中...':'上传支付凭证'}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleUploadProof} /></label>{proofUrl&&<button type="button" onClick={()=>setProofLightbox(true)} className="text-xs underline" style={{color:'var(--accent)'}}>查看已上传凭证</button>}</div>
<button onClick={handleSubmitRecharge} disabled={submittingRecharge||!proofUrl.trim()} className="w-full px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50" style={{background:'var(--accent)'}}>{submittingRecharge?'提交中...':`提交充值申请（¥${rechargeAmount} / ${rechargePoints}积分）`}</button>
{rechargeMsg&&<div className={`mt-2 px-3 py-2 rounded-lg text-xs ${rechargeMsg.type==='success'?'text-green-600':'text-red-500'}`} style={{background:rechargeMsg.type==='success'?'rgba(34,197,94,0.1)':'rgba(239,68,68,0.1)'}}>{rechargeMsg.text}</div>}
</div>
)}
<div>
<div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold" style={{color:'var(--text-primary)'}}>积分记录</h3><button onClick={()=>fetchData(page)} disabled={loading} className="p-1.5 rounded-lg hover:bg-black/5 transition-colors disabled:opacity-50" style={{color:'var(--text-secondary)'}}><RefreshCw size={14} className={loading?'animate-spin':''} /></button></div>
{loading?(<div className="flex justify-center py-10"><div className="w-6 h-6 border-2 rounded-full animate-spin-slow" style={{borderTopColor:'var(--accent)',borderColor:'var(--border-color)'}} /></div>):transactions.length===0?(<div className="text-center py-10 text-sm" style={{color:'var(--text-secondary)'}}>暂无记录</div>):(<><div className="rounded-xl border overflow-hidden" style={{borderColor:'var(--border-color)'}}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr style={{background:'var(--bg-secondary)'}}><th className="text-left px-4 py-2.5 font-medium" style={{color:'var(--text-secondary)'}}>类型</th><th className="text-left px-4 py-2.5 font-medium" style={{color:'var(--text-secondary)'}}>说明</th><th className="text-right px-4 py-2.5 font-medium" style={{color:'var(--text-secondary)'}}>积分变动</th><th className="text-right px-4 py-2.5 font-medium" style={{color:'var(--text-secondary)'}}>余额</th><th className="text-center px-4 py-2.5 font-medium" style={{color:'var(--text-secondary)'}}>渠道</th><th className="text-left px-4 py-2.5 font-medium" style={{color:'var(--text-secondary)'}}>单号</th><th className="text-center px-4 py-2.5 font-medium" style={{color:'var(--text-secondary)'}}>状态</th><th className="text-left px-4 py-2.5 font-medium" style={{color:'var(--text-secondary)'}}>审核备注</th><th className="text-right px-4 py-2.5 font-medium" style={{color:'var(--text-secondary)'}}>时间</th></tr></thead><tbody>{transactions.map((tx)=>{const info=typeMap[tx.type]||{label:tx.type,color:'var(--text-secondary)'};const isPositive=tx.amount>0;const st=tx.recharge_status?(statusMap[tx.recharge_status]||null):null;return(<tr key={tx.id} className="border-t" style={{borderColor:'var(--border-color)'}}><td className="px-4 py-2.5"><span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{background:info.color+'18',color:info.color}}>{isPositive?<ArrowUpCircle size={12} />:<ArrowDownCircle size={12} />}{info.label}</span></td><td className="px-4 py-2.5 truncate max-w-[200px]" style={{color:'var(--text-primary)'}}>{tx.type==='redeem_code'?'-':tx.description||'-'}</td><td className="px-4 py-2.5 text-right font-medium tabular-nums" style={{color:isPositive?'#22c55e':'#ef4444'}}>{isPositive?'+':''}{tx.amount}</td><td className="px-4 py-2.5 text-right tabular-nums" style={{color:'var(--text-secondary)'}}>{tx.balance_after}</td><td className="px-4 py-2.5 text-center text-xs" style={{color:'var(--text-secondary)'}}>{tx.channel?channelLabel[tx.channel]||tx.channel:'-'}</td><td className="px-4 py-2.5 text-left text-xs truncate max-w-[120px]" style={{color:'var(--text-secondary)'}}>{tx.tx_no||'-'}</td><td className="px-4 py-2.5 text-center">{st?<span className="px-2 py-0.5 rounded-full text-xs" style={{color:st.color,background:st.color+'1A'}}>{st.label}</span>:'-'}</td><td className="px-4 py-2.5 text-left text-xs truncate max-w-[120px]" style={{color:'var(--text-secondary)'}}>{tx.review_note||'-'}</td><td className="px-4 py-2.5 text-right whitespace-nowrap text-xs" style={{color:'var(--text-secondary)'}}>{new Date(tx.created_at).toLocaleString('zh-CN')}</td></tr>)})}</tbody></table></div></div><Pagination page={page} totalPages={totalPages} onPageChange={setPage} /></>)}
</div>
</div>
</MainLayout>
{proofLightbox&&proofUrl&&(
<div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={()=>setProofLightbox(false)}>
<img src={proofUrl} alt="支付凭证" className="max-w-full max-h-full rounded-lg" onClick={e=>e.stopPropagation()} />
</div>
)}
</>
)}

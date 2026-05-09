import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
const AppDialogContext=createContext(null)
export function useAppDialog(){
  const v=useContext(AppDialogContext);
  if(!v)throw new Error('useAppDialog must be used within AppDialogProvider');
  return v
}
export default function AppDialogProvider({children}){
  const [alertState,setAlertState]=useState({open:false,message:''})
  const [confirmState,setConfirmState]=useState({open:false,message:''})
  const [chooseState,setChooseState]=useState({open:false,message:'',options:[]})
  const confirmResolverRef=useRef(null)
  const chooseResolverRef=useRef(null)
  const alert=useCallback((message)=>{setAlertState({open:true,message:String(message||'操作完成')})},[])
  const confirm=useCallback((message)=>new Promise(resolve=>{confirmResolverRef.current=resolve;setConfirmState({open:true,message:String(message||'确认继续？')})}),[])
  const choose=useCallback((message,options)=>new Promise(resolve=>{chooseResolverRef.current=resolve;setChooseState({open:true,message:String(message||'请选择'),options:options||[]})}),[])
  const closeAlert=useCallback(()=>setAlertState({open:false,message:''}),[])
  const handleConfirm=useCallback((ok)=>{if(confirmResolverRef.current)confirmResolverRef.current(!!ok);confirmResolverRef.current=null;setConfirmState({open:false,message:''})},[])
  const handleChoose=useCallback((value)=>{if(chooseResolverRef.current)chooseResolverRef.current(value);chooseResolverRef.current=null;setChooseState({open:false,message:'',options:[]})},[])
  const value=useMemo(()=>({alert,confirm,choose}),[alert,confirm,choose])
  return (
    <AppDialogContext.Provider value={value}>
      {children}
      {alertState.open&&(
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeAlert}/>
          <div className="relative w-full max-w-sm rounded-2xl p-5" style={{background:'var(--bg-primary)',border:'1px solid var(--border-color)'}}>
            <div className="text-sm leading-6 whitespace-pre-line" style={{color:'var(--text-primary)'}}>{alertState.message}</div>
            <div className="mt-4 flex justify-end">
              <button onClick={closeAlert} className="px-4 py-2 rounded-2xl text-sm font-medium text-white" style={{background:'var(--accent)'}}>确定</button>
            </div>
          </div>
        </div>
      )}
      {confirmState.open&&(
        <div className="fixed inset-0 z-[91] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={()=>handleConfirm(false)}/>
          <div className="relative w-full max-w-sm rounded-2xl p-5" style={{background:'var(--bg-primary)',border:'1px solid var(--border-color)'}}>
            <div className="text-sm leading-6 whitespace-pre-line" style={{color:'var(--text-primary)'}}>{confirmState.message}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={()=>handleConfirm(false)} className="px-4 py-2 rounded-2xl text-sm font-medium" style={{color:'var(--text-secondary)'}}>取消</button>
              <button onClick={()=>handleConfirm(true)} className="px-4 py-2 rounded-2xl text-sm font-medium text-white" style={{background:'var(--accent)'}}>确认</button>
            </div>
          </div>
        </div>
      )}
      {chooseState.open&&(
        <div className="fixed inset-0 z-[92] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={()=>handleChoose(null)}/>
          <div className="relative w-full max-w-sm rounded-2xl p-5" style={{background:'var(--bg-primary)',border:'1px solid var(--border-color)'}}>
            <div className="text-sm leading-6 whitespace-pre-line" style={{color:'var(--text-primary)'}}>{chooseState.message}</div>
            <div className="mt-4 flex flex-col gap-2">
              {chooseState.options.map((opt,i)=>(
                <button key={i} onClick={()=>handleChoose(opt.value)} className="px-4 py-2.5 rounded-2xl text-sm font-medium text-white" style={{background:opt.color||'var(--accent)'}}>{opt.label}</button>
              ))}
              <button onClick={()=>handleChoose(null)} className="px-4 py-2 rounded-2xl text-sm font-medium" style={{color:'var(--text-secondary)'}}>取消</button>
            </div>
          </div>
        </div>
      )}
    </AppDialogContext.Provider>
  )
}

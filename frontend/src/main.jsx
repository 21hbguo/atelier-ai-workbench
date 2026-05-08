import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const CHUNK_RELOAD_KEY='vite_chunk_reload_once'
window.addEventListener('error',e=>{
  const msg=String(e?.error?.message||e?.message||'')
  if(!msg.includes('Failed to fetch dynamically imported module'))return
  if(sessionStorage.getItem(CHUNK_RELOAD_KEY)==='1')return
  sessionStorage.setItem(CHUNK_RELOAD_KEY,'1')
  window.location.reload()
})
window.addEventListener('unhandledrejection',e=>{
  const msg=String(e?.reason?.message||e?.reason||'')
  if(!msg.includes('Failed to fetch dynamically imported module'))return
  if(sessionStorage.getItem(CHUNK_RELOAD_KEY)==='1')return
  sessionStorage.setItem(CHUNK_RELOAD_KEY,'1')
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

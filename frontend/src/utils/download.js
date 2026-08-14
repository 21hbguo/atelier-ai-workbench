import { imageAPI } from '../api'
function fallbackDownload(blob,filename){const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=filename||`download_${Date.now()}`;a.style.display='none';document.body.appendChild(a);try{a.click();return true}finally{setTimeout(()=>{a.remove();URL.revokeObjectURL(href)},1500)}}
// 规范化 MIME：showSaveFilePicker 的 accept 要求不带参数的合法 MIME（text/plain;charset=utf-8 → text/plain），
// 带参数会抛 TypeError 导致下载失败
function normalizeMime(type){const m=(String(type||'').split(';')[0]||'').trim().toLowerCase();return m||'application/octet-stream'}
export async function saveBlob(blob,filename='download'){
  if(window.isSecureContext&&typeof window.showSaveFilePicker==='function'){
    try{
      const ext=filename.includes('.')?`.${filename.split('.').pop().toLowerCase()}`:''
      const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Download',accept:{[normalizeMime(blob.type)]:ext?[ext]:['.bin']}}]})
      const writable=await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    }catch(e){
      if(e?.name==='AbortError')return false
      // showSaveFilePicker 异常（如 MIME 不被支持/权限受限）→ 回退普通下载，保证一定能下载
      console.warn('[download] showSaveFilePicker failed, fallback to anchor download:', e)
    }
  }
  return fallbackDownload(blob,filename)
}
export function getDownloadFilename(headers,fallback){const raw=headers?.['content-disposition']||headers?.get?.('content-disposition')||'';if(!raw)return fallback;const utf8=raw.match(/filename\\*=UTF-8''([^;]+)/i)?.[1];if(utf8)return decodeURIComponent(utf8);const plain=raw.match(/filename="?([^"]+)"?/i)?.[1];return plain||fallback}
export async function downloadImageByUrl(url,fallbackName='image.png'){const resp=await imageAPI.getBlobByUrl(url);return await saveBlob(resp.data,getDownloadFilename(resp.headers,fallbackName))}

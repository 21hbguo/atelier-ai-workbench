import { useRef, useState } from 'react'
import { Check, Download, Loader2, RefreshCw } from 'lucide-react'
import { imageAPI } from '../api'
import { saveBlob, getDownloadFilename } from '../utils/download'

// 按扩展名选文件图标（简单 emoji 映射，未知类型统一 📄）
const FILE_ICONS = {
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', bmp: '🖼️',
  pdf: '📕',
  zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
  js: '💻', ts: '💻', py: '💻', go: '💻', java: '💻', c: '💻', cpp: '💻', html: '💻', css: '💻', json: '💻',
  doc: '📝', docx: '📝',
  xls: '📊', xlsx: '📊',
  ppt: '📽️', pptx: '📽️',
  csv: '📄', txt: '📄', md: '📄',
}

// 文件大小人性化格式化：<1024 → B，<1MB → KB，否则 MB（保留 1 位小数）
export function formatFileSize(size) {
  const n = Number(size)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// 聊天文件卡片列表：每个文件一张小卡片（图标 + 文件名 + 大小 + 描述 + 下载按钮）
// 下载走 axios blob（自动带鉴权、401 自动续期），不用裸 <a>，避免 token 过期后下载 401 且无提示
export default function FileCard({ files }) {
  const [states, setStates] = useState({}) // { [url]: 'loading' | 'error' | 'done' }
  const resetTimers = useRef({}) // { [url]: timeoutId }，done 状态延迟清理用

  if (!Array.isArray(files) || files.length === 0) return null

  const setState = (url, s) => setStates(prev => ({ ...prev, [url]: s }))

  const handleDownload = async (f) => {
    if (!f?.url || states[f.url] === 'loading') return
    // 清除上一个 done 的延迟清理，避免它在新的下载进行中把状态清掉
    if (resetTimers.current[f.url]) {
      clearTimeout(resetTimers.current[f.url])
      delete resetTimers.current[f.url]
    }
    setState(f.url, 'loading')
    try {
      const resp = await imageAPI.getBlobByUrl(f.url)
      const ok = await saveBlob(resp.data, getDownloadFilename(resp.headers, f.filename || 'download'))
      if (ok === false) { // 用户取消了保存对话框（AbortError），不算失败
        setState(f.url, undefined)
        return
      }
      setState(f.url, 'done')
      resetTimers.current[f.url] = setTimeout(() => {
        setStates(prev => {
          const next = { ...prev }
          delete next[f.url]
          return next
        })
        delete resetTimers.current[f.url]
      }, 2000)
    } catch (e) {
      console.error('[FileCard] 下载失败:', e)
      setState(f.url, 'error')
    }
  }

  return (
    <>
      {files.map((f, i) => {
        const filename = f?.filename || ''
        const ext = (filename.includes('.') ? filename.split('.').pop().toLowerCase() : '')
        const st = f?.url ? states[f.url] : undefined
        return (
          <div key={`${f?.url || ''}-${i}`} className="file-card mb-3">
            <div className="flex items-center gap-2.5 p-2.5 rounded-lg border"
              style={{ borderColor: 'var(--border-color)', background: 'color-mix(in srgb, var(--bg-primary) 60%, transparent)' }}>
              <span className="text-lg flex-shrink-0">{FILE_ICONS[ext] || '📄'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }} title={filename}>{filename}</div>
                {f?.description ? (
                  <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>{f.description}</div>
                ) : null}
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{formatFileSize(f?.size)}</div>
              </div>
              <button type="button" onClick={() => handleDownload(f)} disabled={st === 'loading'}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors flex-shrink-0 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
                style={{ color: st === 'error' ? 'var(--danger, #ef4444)' : 'var(--text-secondary)' }}
                title={st === 'error' ? '下载失败，点击重试' : undefined}>
                {st === 'loading' ? <Loader2 size={14} className="animate-spin" /> :
                 st === 'done' ? <Check size={14} /> :
                 st === 'error' ? <RefreshCw size={14} /> : <Download size={14} />}
                {st === 'loading' ? '下载中…' : st === 'done' ? '已保存' : st === 'error' ? '重试' : '下载'}
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

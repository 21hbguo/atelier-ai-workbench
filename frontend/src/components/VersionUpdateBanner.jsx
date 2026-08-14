import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { VERSION_PROMPT_TIMEOUT_MS } from '../hooks/useVersionSync'

// 新版本提示横幅：检测到新版本后显示，用户可点击立即刷新；
// 若在 VERSION_PROMPT_TIMEOUT_MS 内未点击，由 useVersionSync 自动刷新兜底。
export default function VersionUpdateBanner({ show, onRefresh }) {
  const [leftMs, setLeftMs] = useState(VERSION_PROMPT_TIMEOUT_MS)
  useEffect(() => {
    if (!show) return
    setLeftMs(VERSION_PROMPT_TIMEOUT_MS)
    const id = window.setInterval(() => {
      setLeftMs(prev => Math.max(0, prev - 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [show])
  if (!show) return null
  const leftSec = Math.ceil(leftMs / 1000)
  return (
    <div className="fixed top-0 inset-x-0 z-[999] flex justify-center pointer-events-none">
      <div className="mt-3 flex items-center gap-3 pl-4 pr-2 py-2 rounded-xl shadow-lg pointer-events-auto animate-fade-in-up"
        style={{ background: 'var(--accent)', color: '#fff', maxWidth: 'min(92vw, 520px)' }}>
        <RefreshCw size={16} className="flex-shrink-0" />
        <span className="text-sm font-medium truncate">发现新版本，点击刷新获取最新功能</span>
        <span className="text-xs opacity-80 flex-shrink-0">{leftSec}s</span>
        <button onClick={onRefresh}
          className="flex-shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-opacity hover:opacity-85"
          style={{ background: 'rgba(255,255,255,0.22)' }}>
          立即刷新
        </button>
      </div>
    </div>
  )
}

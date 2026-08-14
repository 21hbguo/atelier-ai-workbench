import { Download } from 'lucide-react'

// SVG 安全兜底（后端已清理一轮，前端再剥离一层）：
// 大小写不敏感剥离 <script / <iframe / <object / <embed / <foreignObject 标签、
// on* 事件属性、javascript: 协议、expression( 动态执行
export function sanitizeSvg(code) {
  if (!code) return ''
  let s = String(code)
  s = s.replace(/<\s*\/?\s*(script|iframe|object|embed|foreignobject)\b[^>]*>/gi, '')
  s = s.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  s = s.replace(/javascript\s*:/gi, '')
  s = s.replace(/expression\s*\(/gi, '')
  return s
}

// 下载单个 widget（Blob + URL.createObjectURL；svg → text/svg+xml/.svg，html → text/html/.html）
// 注意：a.click() 后不能立即 revokeObjectURL，部分浏览器（尤其 Safari/iOS）在下载启动前
// 回收 blob URL 会导致下载失败，需延迟释放（与 utils/download.js 的 fallbackDownload 一致）
function downloadWidget(widget) {
  const isSvg = widget.kind === 'svg'
  const blob = new Blob([String(widget.code || '')], { type: isSvg ? 'text/svg+xml' : 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // 清洗文件名：标题可能含 / \ : * ? " < > | 等非法字符，直接作为 download 名会下载失败；
  // 替换为空格并合并连续空白，空格本身在文件名中合法
  const safeTitle = String(widget.title || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().replace(/\s+/g, ' ') || (isSvg ? 'widget' : 'widget')
  a.download = `${safeTitle}.${isSvg ? 'svg' : 'html'}`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 1500)
}

// 卡片内 SVG 自身样式（注入内容无法直接绑 style，用轻量 <style> 规则）
const SVG_STYLE = '.widget-svg svg{max-width:100%;height:auto;display:block;margin:0 auto}'

export default function WidgetViewer({ widgets }) {
  if (!Array.isArray(widgets) || widgets.length === 0) return null
  return (
    <>
      <style>{SVG_STYLE}</style>
      {widgets.map((w, i) => {
        const isSvg = w?.kind === 'svg'
        return (
          <div key={i} className="mb-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-medium min-w-0 truncate" style={{ color: 'var(--text-secondary)' }}>
                {w?.title || (isSvg ? 'Widget (SVG)' : 'Widget (HTML)')}
              </span>
              <button onClick={() => downloadWidget(w)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors flex-shrink-0"
                style={{ color: 'var(--text-secondary)' }}>
                <Download size={14} /> 下载 {isSvg ? 'SVG' : 'HTML'}
              </button>
            </div>
            {isSvg ? (
              <div className="widget-svg"
                style={{ display: 'flex', justifyContent: 'center', maxWidth: '100%', border: '1px solid var(--border-color)', borderRadius: 12, background: '#fff', padding: 12, overflow: 'auto' }}
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(w?.code) }} />
            ) : (
              <iframe sandbox="allow-scripts" srcDoc={String(w?.code || '')} title={w?.title || 'widget'}
                className="w-full" style={{ minHeight: 420, border: '1px solid var(--border-color)', borderRadius: 12, background: '#fff' }} />
            )}
          </div>
        )
      })}
    </>
  )
}

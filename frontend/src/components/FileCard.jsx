import { Download } from 'lucide-react'

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

// 聊天文件卡片列表：每个文件一张小卡片（图标 + 文件名 + 大小 + 描述 + 下载链接）
export default function FileCard({ files }) {
  if (!Array.isArray(files) || files.length === 0) return null
  return (
    <>
      {files.map((f, i) => {
        const filename = f?.filename || ''
        const ext = (filename.includes('.') ? filename.split('.').pop().toLowerCase() : '')
        return (
          <div key={i} className="file-card mb-3">
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
              {/* cookie 鉴权同源自动携带，download 指定下载文件名 */}
              <a href={f?.url} download={filename}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-bg-hover transition-colors flex-shrink-0"
                style={{ color: 'var(--text-secondary)' }}>
                <Download size={14} /> 下载
              </a>
            </div>
          </div>
        )
      })}
    </>
  )
}

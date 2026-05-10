import { useState, useEffect, useRef } from 'react'
import { Play, Loader2 } from 'lucide-react'
export default function AdminClassificationDebugPanel({ createType }) {
  const [output, setOutput] = useState('')
  const [testing, setTesting] = useState(false)
  const [useStream, setUseStream] = useState(true)
  const outputRef = useRef(null)
  const handleTest = async () => {
    setTesting(true)
    setOutput('')
    try {
      if (useStream) {
        const resp = await fetch('/api/admin/classification/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stream: true, item_type: createType }) })
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let fullText = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === 'token') {
                  fullText += data.text
                  setOutput(fullText)
                } else if (data.type === 'done') {
                  fullText = data.full_text || fullText
                  setOutput(fullText)
                } else if (data.type === 'error') {
                  setOutput(prev => prev + '\n[错误] ' + data.message)
                }
              } catch {}
            }
          }
        }
      } else {
        const resp = await fetch('/api/admin/classification/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stream: false, item_type: createType }) })
        const data = await resp.json()
        if (data.type === 'done') setOutput(data.full_text)
        else if (data.type === 'error') setOutput('[错误] ' + data.message)
      }
    } catch (e) {
      setOutput('[请求失败] ' + e.message)
    }
    setTesting(false)
  }
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [output])
  return (
    <div className="rounded-2xl border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>LLM 调试</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}><input type="checkbox" checked={useStream} onChange={e => setUseStream(e.target.checked)} className="rounded" />流式</label>
          <button onClick={() => setOutput('')} disabled={testing} className="px-2 py-1 rounded-lg text-xs hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>清空</button>
          <button onClick={handleTest} disabled={testing} className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium text-white hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {testing ? '测试中...' : '测试调用'}
          </button>
        </div>
      </div>
      <div ref={outputRef} className="p-3 text-xs font-mono overflow-auto max-h-60" style={{ color: 'var(--text-primary)', background: 'var(--bg-ai-bubble)' }}>{output || <span style={{ color: 'var(--text-secondary)' }}>点击"测试调用"查看 LLM 输出...</span>}</div>
    </div>
  )
}

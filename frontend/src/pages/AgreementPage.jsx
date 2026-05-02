import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function AgreementPage() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen py-12 px-4" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-3xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 mb-4 text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft size={16} />返回
        </button>
        <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>用户协议</h1>
        <div className="prose prose-sm max-w-none" style={{ color: 'var(--text-secondary)' }}>
          <p>协议内容待补充。</p>
        </div>
      </div>
    </div>
  )
}

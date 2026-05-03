import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings } from 'lucide-react'
import MainLayout from '../components/MainLayout'
import { readUser } from '../auth'

export default function SettingsPage() {
  const navigate = useNavigate()
  const user = readUser()
  useEffect(() => { if (user?.is_admin) navigate('/admin') }, [user, navigate])

  return (
    <MainLayout>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-2xl mx-auto w-full">
          <div className="p-6 rounded-2xl border text-center" style={{ background: 'var(--bg-ai-bubble)', borderColor: 'var(--border-color)' }}>
            <Settings size={28} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>设置功能已迁移</h2>
            <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>系统统计与配置管理已统一到管理后台。</p>
            <button onClick={() => navigate('/admin')} className="mt-4 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: 'var(--accent)' }}>前往管理后台</button>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
